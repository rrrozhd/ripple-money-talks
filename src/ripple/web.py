"""API for the Ripple demo UI.

    uv run uvicorn ripple.web:app --port 8000     (the UI in web/ proxies /api here)
"""

import json
import threading
import time
import uuid

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .agent import ask
from .llm import ROOT
from .runs import check, questions

app = FastAPI(title="Ripple")
RUNS = ROOT / "data" / "runs"
JOBS: dict[str, dict] = {}
LABEL = {"rag": "Plain RAG", "v1": "Ripple v1"}


def _annotate(run: dict) -> dict:
    """Add a verified flag to every claim, using the same check as the evaluator."""
    memo = run.get("memo") or {"answer": "", "claims": []}
    claims = [{**c, "verified": check(c)} for c in memo["claims"]]
    return {**run, "memo": {**memo, "claims": claims},
            "verified": sum(c["verified"] for c in claims), "total": len(claims)}


def _saved() -> dict:
    out = {}
    # the UI's "Ripple" replays the newest Ripple runs (Sonnet 5.5 + all-mention graph)
    files = {"rag": "rag", "v1": "v3"}
    for v in LABEL:
        path = RUNS / f"{files[v]}.jsonl"
        if path.exists():
            out[v] = {r["id"]: r for r in map(json.loads, path.read_text().splitlines()) if "error" not in r}
    return out


@app.get("/api/samples")
def samples():
    saved = _saved()
    out = []
    for q in questions():
        have = [v for v in LABEL if q["id"] in saved.get(v, {})]
        share = {v: (lambda r: r["verified"] / r["total"] if r["total"] else None)(_annotate(saved[v][q["id"]])) for v in have}
        # how much better Ripple's claims check out than plain RAG's on this question (used to pick the opening example)
        gap = share["v1"] - share["rag"] if len(have) == 2 and None not in share.values() else None
        out.append({"id": q["id"], "question": q["q"], "saved": have, "verified_gap": gap})
    return out


@app.get("/api/saved/{qid}/{version}")
def saved_run(qid: str, version: str):
    run = _saved().get(version, {}).get(qid)
    if not run:
        raise HTTPException(404, "no saved run for this question and version")
    return _annotate(run)


class AskBody(BaseModel):
    question: str
    version: str
    history: list[dict[str, str]] = []


@app.post("/api/ask")
def start(body: AskBody):
    if body.version not in LABEL:
        raise HTTPException(400, f"version must be one of {list(LABEL)}")
    job = uuid.uuid4().hex[:10]
    JOBS[job] = {"status": "running", "started": time.time()}

    def work():
        try:
            agent_version = "v3" if body.version == "v1" else body.version  # the UI's "Ripple" is the latest version
            r = ask(agent_version, body.question, session=f"ui-{agent_version}-{job}",
                    on_step=lambda steps: JOBS[job].__setitem__("steps", steps),
                    history=[{"role": m["role"], "content": m.get("content", "")} for m in body.history[-8:] if m.get("role") in ("user", "assistant")])
            JOBS[job] |= {"status": "done", "result": _annotate({**r, "seconds": round(time.time() - JOBS[job]["started"], 1)})}
        except Exception as e:
            JOBS[job] |= {"status": "error", "error": f"{type(e).__name__}: {e}"[:400]}

    threading.Thread(target=work, daemon=True).start()
    return {"job": job}


@app.get("/api/job/{job}")
def job_status(job: str):
    if job not in JOBS:
        raise HTTPException(404, "unknown job")
    j = JOBS[job]
    return {k: v for k, v in j.items() if k != "started"} | {"elapsed": round(time.time() - j["started"])}


# ---------- graph audit: blind human review of a random sample ----------

import math
import random

AUDIT = ROOT / "data" / "coverage"
SAMPLE_N = 40


def _audit_sample() -> list[dict]:
    """40 graph links + 40 reference relationships, shuffled; fixed once created so the metric is reproducible."""
    path = AUDIT / "review_sample.json"
    if path.exists():
        return json.loads(path.read_text())
    from .agent import _db, graph_v2
    from .coverage import reference
    _, names, _ = _db()
    rng = random.Random(17)
    graph = []
    for e in graph_v2():
        filer = e["filer"]
        other = e["dst"] if e["src"] == filer else e["src"]
        rel = ("supplier" if e["dst"] == filer else "customer") if e["type"] == "SUPPLIES" else \
              ("competitor" if e["type"] == "COMPETES_WITH" else "partner")
        graph.append({"source": "graph", "filer": filer, "entity": other, "company": names[other], "relation": rel,
                      "quote": e["quote"], "link": e["source_link"]})
    graph = list({(g["filer"], g["entity"], g["relation"]): g for g in graph}.values())
    ref = [{"source": "reference", "filer": x["filer"], "entity": x["entity"], "company": x["company"],
            "relation": x["relation"], "quote": x["quote"], "link": x["url"]} for x in reference()]
    # stratified so recall among known companies gets enough data points (unknown companies dominate the reference)
    known, unknown = [x for x in ref if x["entity"]], [x for x in ref if not x["entity"]]
    items = (rng.sample(graph, min(SAMPLE_N, len(graph))) + rng.sample(known, min(25, len(known)))
             + rng.sample(unknown, min(15, len(unknown))))
    rng.shuffle(items)
    for i, it in enumerate(items):
        it["id"] = i
        it["filer_name"] = names.get(it["filer"], it["filer"])
    path.write_text(json.dumps(items, indent=1))
    return items


def _verdicts() -> dict:
    path = AUDIT / "human.jsonl"
    out = {}
    if path.exists():
        for d in map(json.loads, path.read_text().splitlines()):
            out[d["id"]] = d["verdict"]  # last verdict wins
    return out


@app.get("/api/audit/items")
def audit_items():
    v = _verdicts()
    # blind: the reviewer never sees which list an item came from
    return [{k: it[k] for k in ("id", "filer_name", "company", "relation", "quote", "link")} | {"verdict": v.get(it["id"])}
            for it in _audit_sample()]


class Verdict(BaseModel):
    verdict: str


@app.post("/api/audit/{item_id}")
def audit_verdict(item_id: int, body: Verdict):
    if body.verdict not in ("correct", "wrong", "unsure"):
        raise HTTPException(400, "verdict must be correct, wrong or unsure")
    with (AUDIT / "human.jsonl").open("a") as f:
        f.write(json.dumps({"id": item_id, "verdict": body.verdict, "at": time.time()}) + "\n")
    return {"ok": True}


def _wilson(k: int, n: int) -> list[float] | None:
    if n == 0:
        return None
    z, p = 1.96, k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(c - h, 3), round(c + h, 3)]


@app.get("/api/audit/metrics")
def audit_metrics():
    from .coverage import _graph_keys
    items, v, graph = _audit_sample(), _verdicts(), _graph_keys()
    judged = [it for it in items if v.get(it["id"]) in ("correct", "wrong")]
    g = [it for it in judged if it["source"] == "graph"]
    r = [it for it in judged if it["source"] == "reference"]
    g_ok = sum(v[it["id"]] == "correct" for it in g)
    r_true = [it for it in r if v[it["id"]] == "correct"]
    found = sum(1 for it in r_true if it["entity"] and (it["filer"], it["entity"], it["relation"]) in graph)
    return {
        "reviewed": len([i for i in items if i["id"] in v]), "total": len(items),
        "graph_precision": {"value": g_ok / len(g) if g else None, "ci95": _wilson(g_ok, len(g)), "n": len(g)},
        "reference_precision": {"value": len(r_true) / len(r) if r else None, "ci95": _wilson(len(r_true), len(r)), "n": len(r)},
        "recall": {"value": found / len(r_true) if r_true else None, "ci95": _wilson(found, len(r_true)), "n": len(r_true)},
        # same, restricted to companies on Ripple's name list: separates "unknown company" misses from pipeline misses
        "recall_known_companies": (lambda known: {"value": found / len(known) if known else None,
                                                  "ci95": _wilson(found, len(known)), "n": len(known)})(
            [it for it in r_true if it["entity"]]),
    }


# ---------- graph, proofs and voice for the demo UI ----------

from fastapi import File, UploadFile
from fastapi.responses import Response


@app.get("/api/graph")
def graph_data():
    from .agent import _db, graph_v2
    con, names, _ = _db()
    sectors = con.cursor().execute("SELECT ticker, sector, beta, corr FROM sector_edge").fetchall()
    sector_of = {t: s for t, s, _, _ in sectors}
    edges, seen = [], set()
    for e in graph_v2():
        key = (e["src"], e["dst"], e["type"])
        if key in seen:
            continue
        seen.add(key)
        edges.append({"src": e["src"], "dst": e["dst"], "type": e["type"], "stated_by": e["stated_by"],
                      "quote": e["quote"][:400], "link": e["source_link"]})
    used = {n for e in edges for n in (e["src"], e["dst"])} | set(sector_of)
    nodes = [{"id": n, "name": names.get(n, n), "sector": sector_of.get(n)} for n in sorted(used)]
    return {"nodes": nodes, "edges": edges,
            "sector_links": [{"ticker": t, "sector": s, "beta": round(b, 2), "corr": round(c, 2)} for t, s, b, c in sectors]}


@app.get("/api/proofs")
def proofs():
    import httpx
    from .compare import mean, score
    from .llm import CFG
    from .prism_kb import client
    versions = [("rag", "Plain RAG"), ("v1", "Ripple v1 (gpt-5-mini)"), ("v1-sonnet", "Ripple v2 (Sonnet 5.5, new graph)"),
                ("v3", "Ripple v3 (v2 + strict relationship rule)")]
    table = []
    for f, label in versions:
        if not (RUNS / f"{f}.jsonl").exists():
            continue
        s = list(score(f).values())
        table.append({"version": label, "runs": len(s), "precision": mean([x["p"] for x in s]),
                      "recall": mean([x["r"] for x in s]), "grounded": mean([x["grounded"] for x in s]),
                      "seconds": mean([x["seconds"] for x in s])})
    cov = json.loads((AUDIT / "score.json").read_text()) if (AUDIT / "score.json").exists() else None
    prism = {}
    try:
        h = {"X-PRISMtrace-Key": CFG["PRISMTRACE_API_KEY"]}
        d = httpx.get(f"{CFG['PRISMTRACE_HOST']}/api/setup-doctor", params={"project_id": CFG["PRISMTRACE_PROJECT_ID"]},
                      headers=h, timeout=20).json()
        docs = client().kb_list_documents()
        prism = {"connected": d.get("overall"), "traces": d.get("live_trace_count"),
                 "steps": {s["id"]: s["detail"] for s in d.get("steps", [])},
                 "kb_documents": len(docs), "kb_assigned_to_ripple": sum(1 for x in docs if x.get("agent_id") == "ripple")}
    except Exception as e:  # PRISM unreachable: show that rather than fail the page
        prism = {"error": f"{type(e).__name__}: {e}"[:200]}
    return {"table": table, "coverage": cov, "prism": prism}


ELEVEN = "https://api.elevenlabs.io/v1"
VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"  # George, a default voice the free ElevenLabs plan can use via the API


def _eleven_key() -> str:
    from .llm import CFG
    key = CFG.get("ELEVENLABS_API_KEY") or ""
    if not key:
        raise HTTPException(503, "Voice needs ELEVENLABS_API_KEY in ripple/.env")
    return key


@app.post("/api/voice/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    import httpx
    key = _eleven_key()
    data = await audio.read()
    r = httpx.post(f"{ELEVEN}/speech-to-text", headers={"xi-api-key": key}, timeout=60,
                   data={"model_id": "scribe_v1"}, files={"file": (audio.filename or "q.webm", data, audio.content_type or "audio/webm")})
    if not r.is_success:
        raise HTTPException(502, f"ElevenLabs speech-to-text failed: {r.text[:200]}")
    return {"text": r.json().get("text", "").strip()}


class SpeakBody(BaseModel):
    text: str


@app.post("/api/voice/speak")
def speak(body: SpeakBody):
    import httpx
    key = _eleven_key()
    r = httpx.post(f"{ELEVEN}/text-to-speech/{VOICE_ID}", headers={"xi-api-key": key, "accept": "audio/mpeg"}, timeout=60,
                   json={"text": body.text[:1500], "model_id": "eleven_turbo_v2_5"})
    if not r.is_success:
        raise HTTPException(502, f"ElevenLabs text-to-speech failed: {r.text[:200]}")
    return Response(content=r.content, media_type="audio/mpeg")
