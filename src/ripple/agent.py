"""Ripple research analyst as a LangChain Deep Agent, in two versions:

  rag  baseline, plain RAG: hybrid BM25 + vector search over the 10-Ks, LLM-reranked (kb_search only)
  v1   Ripple: every tool (graph, sector stats, shock maths, search) + a verifier sub-agent
  v2   v1 plus the fixes found through PRISM Root Cause

    uv run python -m ripple.agent v2 "Who supplies NVIDIA, and how exposed is each to NVIDIA?"
"""

import json
import math
import re
from functools import lru_cache
from typing import Optional

import duckdb
from deepagents import HarnessProfile, create_deep_agent, register_harness_profile
from langchain_core.tools import tool
from pydantic import BaseModel, Field

from . import prism_kb, retrieval
from .graph import ALIAS_PATTERNS, to_edge
from .jev import claim_key
from .label import out_path
from .llm import ROOT, callbacks, chat

# The agent answers from tools only: drop Deep Agents' built-in scratch-file and shell tools.
# All our models go through the OpenAI-compatible Nicrron client, so the "openai" provider profile covers them.
register_harness_profile("openai", HarnessProfile(excluded_tools=frozenset(
    {"ls", "read_file", "write_file", "edit_file", "delete", "glob", "grep", "execute"})))

AGENT_MODEL = "anthropic/claude-sonnet-5-5"
LABEL_MODEL = "anthropic/claude-sonnet-5-5"
DB = ROOT / "data" / "ripple.duckdb"


# ---------- data ----------

@lru_cache
def _db():
    con = duckdb.connect(str(DB), read_only=True)
    names = dict(con.execute("SELECT entity_id, name FROM entity").fetchall())
    tickers = {v.lower(): k for k, v in names.items()} | {k.lower(): k for k in names}
    return con, names, tickers


def _resolve(company: str) -> Optional[str]:
    """Ticker, entity id or company name -> entity id."""
    _, names, tickers = _db()
    c = company.strip().lower()
    if c in tickers:
        return tickers[c]
    for eid, pat in ALIAS_PATTERNS:
        if pat.search(company):
            return eid
    return None


@lru_cache
def graph_v2() -> list[dict]:
    """Verified links: each filing claim re-typed by the LLM labeller; 'none' dropped."""
    con, names, _ = _db()
    # every sentence that names another company, typed by the LLM labeller (no keyword gate)
    labels = {d["key"]: d for d in map(json.loads, out_path(LABEL_MODEL, "mention").read_text().splitlines())}
    rows = []
    for c in con.cursor().execute("SELECT * FROM mention").df().to_dict("records"):
        lab = labels[claim_key(c)]["choice"]
        if lab == "none":
            continue
        src, dst, typ = to_edge({**c, "relation": lab})
        rows.append({"src": src, "dst": dst, "type": typ, "filer": c["filer"], "stated_by": names[c["filer"]], "quote": c["quote"],
                     "source_link": c["link"], "share": c["weight"] if typ == "SUPPLIES" and lab == "customer" else None,
                     "share_kind": c["weight_kind"] if typ == "SUPPLIES" and lab == "customer" else None})
    return rows


# ---------- tools ----------

@tool
def kb_search(query: str, company: Optional[str] = None) -> str:
    """Search the 10-K filings of 15 US tech companies (hybrid BM25 + vector search, reranked).
    Optionally restrict to one company's filing (ticker or name). Returns passages with source links."""
    eid = _resolve(company) if company else None
    hits = retrieval.search(query, ticker=eid if eid and not eid.startswith("x:") else None)
    out = [{"company_filing": h["ticker"], "passage": h["text"][:900], "source_link": h["link"]} for h in hits]
    # the same filings in the PRISM Knowledge Base, when connected, so the retrieval step shows up there
    out += [{"company_filing": r.get("doc_name"), "passage": r.get("content", "")[:900], "source": "PRISM knowledge base"}
            for r in prism_kb.search(query, limit=3)]
    return json.dumps(out)


@tool
def graph_lookup(company: str, relation: str) -> str:
    """Relationships stated in 10-K filings. relation is one of: suppliers, customers, competitors, partners.
    Every result carries the exact filing quote and a source link."""
    eid = _resolve(company)
    if not eid:
        return json.dumps({"error": f"unknown company {company!r}"})
    _, names, _ = _db()
    out = []
    for e in graph_v2():
        if relation == "suppliers" and e["type"] == "SUPPLIES" and e["dst"] == eid:
            other = e["src"]
        elif relation == "customers" and e["type"] == "SUPPLIES" and e["src"] == eid:
            other = e["dst"]
        elif relation == "competitors" and e["type"] == "COMPETES_WITH" and eid in (e["src"], e["dst"]):
            other = e["dst"] if e["src"] == eid else e["src"]
        elif relation == "partners" and e["type"] == "PARTNERS" and eid in (e["src"], e["dst"]):
            other = e["dst"] if e["src"] == eid else e["src"]
        else:
            continue
        out.append({"company": names[other], "stated_by": e["stated_by"], "revenue_share": e["share"],
                    "quote": e["quote"][:500], "source_link": e["source_link"]})
    return json.dumps(out or {"result": f"no {relation} of {names[eid]} stated in the filings"})


@tool
def sector_stats(company: str) -> str:
    """How strongly a company's stock follows its sector over the last year (beta, correlation),
    and which sector it actually correlates with most. Source: daily prices."""
    eid = _resolve(company)
    con, names, _ = _db()
    row = con.cursor().execute("SELECT * FROM sector_edge WHERE ticker = ?", [eid]).df()
    if row.empty:
        return json.dumps({"error": f"no price data for {company!r} (only the 15 listed companies)"})
    r = row.iloc[0]
    corr = {k: round(float(r[f"corr_{k}"]), 2) for k in ("semis", "equipment", "hardware")}
    return json.dumps({"company": names[eid], "assigned_sector": r["sector"], "beta": round(float(r["beta"]), 2),
                       "correlation": round(float(r["corr"]), 2), "correlation_by_sector": corr,
                       "best_fit_sector": max(corr, key=corr.get), "days": int(r["n_days"]),
                       "source": "Yahoo daily adjusted closes, data/raw/prices_yahoo.csv"})


def _share(v) -> Optional[float]:
    """Disclosed revenue share, or None. Missing shares come out of DuckDB/pandas as NaN, which is truthy."""
    return float(v) if isinstance(v, (int, float)) and math.isfinite(v) and v > 0 else None


def shock_impacts(company: str, demand_drop_pct: float) -> dict:
    """Suppliers of `company` from the verified graph, with revenue at risk if it cuts purchases by demand_drop_pct %.
    Revenue at risk = supplier revenue (SEC XBRL) x the share of it the supplier's 10-K attributes to this customer
    x the cut. Quantified only where that share is disclosed; one row per supplier, preferring a disclosed share."""
    eid = _resolve(company)
    con, names, _ = _db()
    if eid is None:
        return {"company": None, "query": company, "drop_pct": demand_drop_pct, "suppliers": []}
    cur = con.cursor()
    rev = {t: (v, concept, period) for t, concept, v, period in cur.execute("SELECT ticker, concept, value, period_end FROM revenue").fetchall()}
    sector = {t: (sec, b, c) for t, sec, b, c in cur.execute("SELECT ticker, sector, beta, corr FROM sector_edge").fetchall()}
    best: dict[str, dict] = {}
    for e in graph_v2():
        if e["type"] != "SUPPLIES" or e["dst"] != eid or e["src"] == eid:
            continue
        sup, share = e["src"], _share(e["share"])
        if sup in best and (best[sup]["revenue_share"] is not None or share is None):
            continue  # keep the first evidence, upgraded only by a quote that discloses a share
        row = {"supplier": sup, "name": names[sup], "stated_by": e["stated_by"], "quote": e["quote"],
               "source_link": e["source_link"], "revenue_share": share,
               "share_kind": e.get("share_kind") if share is not None else None,
               "supplier_revenue_usd": None, "revenue_period_end": None, "revenue_at_risk_usd": None,
               "sector": None, "beta": None, "corr": None}
        if sup in rev:
            v, _, period = rev[sup]
            row |= {"supplier_revenue_usd": int(v), "revenue_period_end": str(period)}
            if share is not None:
                row["revenue_at_risk_usd"] = round(v * share * demand_drop_pct / 100)
        if sup in sector:
            sec, b, c = sector[sup]
            row |= {"sector": sec, "beta": round(b, 2), "corr": round(c, 2)}
        best[sup] = row
    rows = sorted(best.values(), key=lambda r: (r["revenue_at_risk_usd"] is None, -(r["revenue_at_risk_usd"] or 0), r["name"]))
    buyer_rev = rev.get(eid)
    return {"company": eid, "name": names[eid], "drop_pct": demand_drop_pct,
            "buyer_revenue_usd": int(buyer_rev[0]) if buyer_rev else None,
            "total_at_risk_usd": sum(r["revenue_at_risk_usd"] or 0 for r in rows),
            "quantified": sum(r["revenue_at_risk_usd"] is not None for r in rows), "suppliers": rows}


@tool
def shock(company: str, demand_drop_pct: float) -> str:
    """Demand shock: if `company` cuts purchases by demand_drop_pct %, estimate revenue at risk for its suppliers.
    Only quantified where a supplier's filing discloses this customer's revenue share; others are listed unquantified."""
    r = shock_impacts(company, demand_drop_pct)
    if not r["suppliers"]:
        return json.dumps({"result": f"no suppliers of {r.get('name') or company} in the graph"})
    out = []
    for s in r["suppliers"]:
        item = {"supplier": s["name"], "source_link": s["source_link"]}
        if s["revenue_at_risk_usd"] is not None:
            item |= {"revenue_share": s["revenue_share"], "supplier_revenue_usd": s["supplier_revenue_usd"],
                     "revenue_at_risk_usd": s["revenue_at_risk_usd"]}
        else:
            item["revenue_at_risk_usd"] = "not quantified: no disclosed revenue share"
        out.append(item)
    return json.dumps(out)


@tool
def check_claims(claims_json: str) -> str:
    """Verify claims. Input: JSON list of {"company": ..., "evidence": <exact quote>, "number": <optional>}.
    Each claim passes only if the evidence appears word-for-word in a filing and names the company (and the number)."""
    texts = _filing_texts()
    try:
        claims = json.loads(claims_json, strict=False)  # models sometimes put raw newlines inside strings
    except json.JSONDecodeError as e:
        return json.dumps({"error": f"claims_json is not valid JSON ({e}); send a JSON list of objects"})
    results = []
    for c in claims:
        ev = _squash(c.get("evidence", ""))
        found = bool(ev) and any(ev in t for t in texts)
        names_it = _names_company(c.get("company", ""), c.get("evidence", ""))
        num_ok = not c.get("number") or _squash(str(c["number"])) in ev
        results.append({"company": c.get("company"), "pass": found and names_it and num_ok,
                        "evidence_in_filing": found, "evidence_names_company": names_it, "number_in_evidence": num_ok})
    return json.dumps(results)


def _squash(t: str) -> str:
    return re.sub(r"\s+", "", t)


@lru_cache
def _filing_texts() -> tuple[str, ...]:
    return tuple(_squash(p.read_text()) for p in (ROOT / "data" / "raw" / "text").glob("*.txt"))


def _names_company(company: str, evidence: str) -> bool:
    eid = _resolve(company)
    if not eid:
        return company.lower() in evidence.lower()
    return any(pat.search(evidence) for e, pat in ALIAS_PATTERNS if e == eid)


class Claim(BaseModel):
    company: str = Field(description="The company named in the answer")
    relation: str = Field(description="supplier / customer / competitor / partner / other")
    evidence: str = Field(description="Exact quote from a filing passage or tool result that supports the claim")
    number: Optional[str] = Field(default=None, description="Any figure used (e.g. '16%'), exactly as in the evidence")
    source_link: str


class Memo(BaseModel):
    answer: str = Field(description="Short analyst memo answering the question")
    claims: list[Claim]


RULES = ("Name a company or a number only if a tool result supports it, and list every such company in `claims` with "
         "an exact quote as `evidence` and its `source_link`. If the sources don't answer the question, say so.")

RAG_PROMPT = ("You are a financial research analyst. Answer questions about 15 US tech companies using only "
             "kb_search over their latest 10-K filings. Search as many times as you need (try company filters). " + RULES)

RIPPLE_PROMPT = ("You are a financial research analyst with a verified relationship graph built from 10-K filings. "
             "Use graph_lookup for suppliers/customers/competitors/partners, sector_stats for how a stock follows its "
             "sector, shock for demand-shock revenue at risk, and kb_search for anything else. Before answering, "
             "delegate your draft claims to the `verifier` sub-agent and drop or fix any claim that fails. " + RULES)

# v3 fix from the v2 root cause: v2 read legal and corporate mentions as business relationships
STRICT = (" Only claim a relationship when the quote states the filer's own current commercial relationship "
          "(it buys from, sells to, competes with, or partners with the company). Do NOT count lawsuits or patent claims, "
          "indemnification, spin-off or separation agreements, related-party or acquisition notes, export restrictions, "
          "or statements about what other companies can do. Items in a list introduced as competitors are competitors, "
          "not partners. When unsure, leave the company out.")


JSON_TAIL = (" Your final message must be only a JSON object, no other text: "
             '{"answer": "<short memo>", "claims": [{"company": "...", "relation": "...", "evidence": "<exact quote>", '
             '"number": null, "source_link": "..."}]}')


def _memo_from_text(text: str) -> Optional[Memo]:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        return Memo.model_validate_json(text[start:end + 1])
    except ValueError:
        return None


VERIFIER = {
    "name": "verifier",
    "description": "Checks draft claims: each evidence quote must appear word-for-word in a filing and name the company. "
                   "Send the claims as a JSON list of {company, evidence, number}.",
    "system_prompt": "Run check_claims on the claims you are given and report exactly which pass and which fail, and why.",
    "tools": [check_claims],
}


def build(version: str):
    """rag = plain-RAG baseline; v1 = Ripple with every tool; v2 = v1 plus the fixes found via PRISM Root Cause."""
    model = chat(AGENT_MODEL)
    # Anthropic models via Nicrron reject forced tool calls, which LangChain's structured response uses:
    # ask for the memo as JSON in the final message instead and validate it in ask()
    forced_ok = not AGENT_MODEL.startswith("anthropic/")
    fmt = {"response_format": Memo} if forced_ok else {}
    tail = "" if forced_ok else JSON_TAIL
    if version == "rag":
        return create_deep_agent(model=model, tools=[kb_search], system_prompt=RAG_PROMPT + tail, name="ripple-rag-baseline", **fmt)
    prompt = RIPPLE_PROMPT + (STRICT if version == "v3" else "") + tail
    return create_deep_agent(model=model, tools=[graph_lookup, sector_stats, shock, kb_search], system_prompt=prompt,
                             subagents=[VERIFIER], name=f"ripple-{version}", **fmt)


def ask(version: str, question: str, session: Optional[str] = None, on_step=None, history: Optional[list] = None) -> dict:
    """Run one question. on_step(tool_names) is called as the agent works, for live progress in the UI.
    history: earlier turns as [{"role": "user"|"assistant", "content": str}], so follow-ups keep context."""
    agent = build(version)
    cfg = {"callbacks": callbacks(), "recursion_limit": 60,
           "metadata": {"session_id": session or f"{version}-adhoc", "version": version}, "run_name": f"ripple-{version}"}
    state = None
    for state in agent.stream({"messages": [*(history or []), {"role": "user", "content": question}]}, config=cfg, stream_mode="values"):
        if on_step:
            on_step([tc["name"] for m in state["messages"] if getattr(m, "tool_calls", None) for tc in m.tool_calls])
    memo = state.get("structured_response")
    if memo is None:
        last = state["messages"][-1].content
        memo = _memo_from_text(last if isinstance(last, str) else "".join(b.get("text", "") for b in last if isinstance(b, dict)))
    steps = [m for m in state["messages"] if getattr(m, "tool_calls", None)]
    return {"version": version, "question": question,
            "memo": memo.model_dump() if memo else {"answer": state["messages"][-1].content, "claims": []},
            "tool_calls": [tc["name"] for m in steps for tc in m.tool_calls]}


if __name__ == "__main__":
    import sys
    print(json.dumps(ask(sys.argv[1], sys.argv[2]), indent=1))
