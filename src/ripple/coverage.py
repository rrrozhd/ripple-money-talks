"""Graph coverage (recall) against an independent reference.

    uv run python -m ripple.coverage extract   # Sonnet 5.5 reads every filing in 30k-char windows -> data/coverage/reference.jsonl
    uv run python -m ripple.coverage score     # recall vs the graph + where misses are lost -> data/coverage/score.json

The reference extractor is deliberately different from the graph pipeline: it reads whole passages, has no
company-name list and no keyword gate. Only items whose quote appears word for word in the filing and names the
company are kept, so the reference itself is grounded.
"""

import json
import re
from concurrent.futures import ThreadPoolExecutor

import duckdb

from .agent import _resolve, _squash, graph_v2
from .graph import ALIAS_PATTERNS
from .label import out_path
from .llm import ROOT, chat

MODEL = "anthropic/claude-sonnet-5-5"
OUT = ROOT / "data" / "coverage"
WINDOW, OVERLAP = 30_000, 1_500
REL_TYPE = {"supplier": "SUPPLIES", "customer": "SUPPLIES", "competitor": "COMPETES_WITH", "partner": "PARTNERS"}

PROMPT = """You are reading part of {filer}'s annual report (10-K). List EVERY other company that {filer} says it
currently has one of these relationships with:
- supplier: the company supplies goods or services to {filer} (foundries, manufacturers, memory, software, etc.)
- customer: the company buys from {filer} or pays it revenue
- competitor: {filer} says it competes with the company
- partner: {filer} states its own partnership, collaboration or joint venture with the company
Do not include: deals between other companies, past or hypothetical arrangements, share purchases or investments,
acquisitions, glossary entries, lawsuits, auditors, governments or regulators.

For each, copy the shortest sentence that states it EXACTLY as written in the text (character for character).
Reply with only a JSON list, no other text:
[{{"company": "<name as written>", "relation": "supplier|customer|competitor|partner", "quote": "<exact sentence>"}}]
Reply [] if there are none.

TEXT:
\"\"\"{text}\"\"\""""


def _windows(text: str):
    i = 0
    while i < len(text):
        yield text[i:i + WINDOW]
        i += WINDOW - OVERLAP


def _parse(reply: str) -> list[dict]:
    start, end = reply.find("["), reply.rfind("]")
    if start == -1 or end <= start:
        return []
    try:
        items = json.loads(reply[start:end + 1], strict=False)
    except json.JSONDecodeError:
        return []
    return [x for x in items if isinstance(x, dict) and {"company", "relation", "quote"} <= x.keys()]


def _names(company: str, quote: str) -> bool:
    eid = _resolve(company)
    if eid and any(p.search(quote) for e, p in ALIAS_PATTERNS if e == eid):
        return True
    # unknown companies: the first distinctive word of the name must appear in the quote
    word = next((w for w in re.findall(r"[A-Za-z][A-Za-z0-9&\-]+", company) if len(w) > 2), company)
    return word.lower() in quote.lower()


def extract() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / "reference.jsonl"
    con = duckdb.connect(str(ROOT / "data" / "ripple.duckdb"), read_only=True)
    filings = con.execute("SELECT ticker, accession, url FROM filing ORDER BY 1").fetchall()
    names = dict(con.execute("SELECT entity_id, name FROM entity").fetchall())
    done = {(d["ticker"], d["window"]) for d in map(json.loads, out.read_text().splitlines())} if out.exists() else set()
    jobs = []
    for ticker, acc, url in filings:
        text = (ROOT / "data" / "raw" / "text" / f"{acc}.txt").read_text()
        for w, chunk in enumerate(_windows(text)):
            if (ticker, w) not in done:
                jobs.append((ticker, acc, url, w, chunk, _squash(text)))
    llm = chat(MODEL)

    def one(job):
        ticker, acc, url, w, chunk, squashed = job
        reply = llm.invoke(PROMPT.format(filer=names[ticker], text=chunk)).content
        items = _parse(reply if isinstance(reply, str) else str(reply))
        kept = []
        for x in items:
            q = x["quote"]
            if x["relation"] in REL_TYPE and _squash(q) in squashed and _names(x["company"], q):
                kept.append({**x, "entity": _resolve(x["company"])})
        return {"ticker": ticker, "accession": acc, "url": url, "window": w, "proposed": len(items), "items": kept}

    with ThreadPoolExecutor(6) as pool, out.open("a") as sink:
        for r in pool.map(one, jobs):
            sink.write(json.dumps(r) + "\n")
            sink.flush()
            print(r["ticker"], r["window"], f"{len(r['items'])}/{r['proposed']} kept", flush=True)


def reference() -> list[dict]:
    """Deduplicated reference relationships: one per (filer, company, relation)."""
    seen, out = set(), []
    for r in map(json.loads, (OUT / "reference.jsonl").read_text().splitlines()):
        for x in r["items"]:
            key = (r["ticker"], x["entity"] or x["company"].lower().strip(), x["relation"])
            if key not in seen:
                seen.add(key)
                out.append({"filer": r["ticker"], "company": x["company"], "entity": x["entity"], "relation": x["relation"],
                            "quote": x["quote"], "url": r["url"]})
    return out


def _graph_keys() -> set:
    keys = set()
    for e in graph_v2():
        filer = e["filer"]
        other = e["dst"] if e["src"] == filer else e["src"]
        if e["type"] == "SUPPLIES":
            keys.add((filer, other, "supplier" if e["dst"] == filer else "customer"))
        else:
            keys.add((filer, other, "competitor" if e["type"] == "COMPETES_WITH" else "partner"))
    return keys


def score() -> dict:
    ref, graph = reference(), _graph_keys()
    con = duckdb.connect(str(ROOT / "data" / "ripple.duckdb"), read_only=True)
    mentions = {(f, c) for f, c in con.execute("SELECT DISTINCT filer, counterparty FROM mention").fetchall()}
    labels = {d["key"]: d["choice"] for d in map(json.loads, out_path(MODEL, "mention").read_text().splitlines())}
    funnel = {"found": 0, "not_on_name_list": 0, "name_known_but_sentence_not_extracted": 0, "extracted_but_labelled_differently": 0}
    misses = []
    for x in ref:
        if x["entity"] and (x["filer"], x["entity"], x["relation"]) in graph:
            funnel["found"] += 1
            continue
        if not x["entity"]:
            cause = "not_on_name_list"
        elif (x["filer"], x["entity"]) not in mentions:
            cause = "name_known_but_sentence_not_extracted"
        else:
            cause = "extracted_but_labelled_differently"
        funnel[cause] += 1
        misses.append({**x, "cause": cause})
    in_list = [x for x in ref if x["entity"]]
    found_in_list = funnel["found"]
    result = {
        "reference_relationships": len(ref),
        "recall_all": funnel["found"] / max(1, len(ref)),
        "recall_known_companies": found_in_list / max(1, len(in_list)),
        "funnel": funnel,
        "graph_links": len(graph),
        "graph_links_confirmed_by_reference": len(graph & {(x["filer"], x["entity"], x["relation"]) for x in in_list}),
        "labels_used": len(labels),
    }
    (OUT / "score.json").write_text(json.dumps(result, indent=1))
    (OUT / "misses.jsonl").write_text("".join(json.dumps(m) + "\n" for m in misses))
    return result


if __name__ == "__main__":
    import sys
    if sys.argv[1] == "extract":
        extract()
    else:
        print(json.dumps(score(), indent=1))
