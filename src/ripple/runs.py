"""Run both agents on the same question set and score them with our own evaluator.

    uv run python -m ripple.runs run v1 v2     # writes data/runs/<version>.jsonl (resumable)
    uv run python -m ripple.runs score         # writes data/runs/score.json

Evaluator (the PRISM "Evaluator" proof): for every run,
  grounded   share of claims whose evidence quote is word-for-word in a filing, names the company,
             and contains any number used
  F1         on the 24 gold questions: claimed companies vs the gold answer set
             (names outside our 30-company list are ignored for F1 but still checked for grounding)
"""

import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from itertools import product

from .agent import _names_company, _resolve, _squash, _filing_texts, ask
from .evaluate import GOLD, rubric
from .llm import ROOT
from .universe import ALIASES, TICKER_SECTOR

RUNS = ROOT / "data" / "runs"
REL_WORD = {"suppliers": "supplies", "customers": "buys from", "competitors": "competes with", "partners": "partners with"}


def questions() -> list[dict]:
    """24 gold questions + templated ones for the remaining company/relation pairs, 60 in total."""
    gold = [json.loads(l) for l in GOLD.read_text().splitlines()]
    seen = {(g["company"], g["rel"]) for g in gold}
    extra = []
    for t, rel in product(TICKER_SECTOR, ["suppliers", "customers", "competitors", "partners"]):
        if (t, rel) not in seen:
            extra.append({"id": f"t{len(extra) + 1:02d}", "company": t, "rel": rel,
                          "q": f"According to {ALIASES[t][0]}'s latest 10-K, which companies does it name as its {rel}?"})
    return gold + extra[:60 - len(gold)]


def run(version: str, workers: int = 6) -> None:
    RUNS.mkdir(parents=True, exist_ok=True)
    out = RUNS / f"{version}.jsonl"
    if out.exists():  # keep finished runs, retry failed ones
        rows = [json.loads(l) for l in out.read_text().splitlines()]
        out.write_text("".join(json.dumps(x) + "\n" for x in rows if "error" not in x))
    done = {json.loads(l)["id"] for l in out.read_text().splitlines()} if out.exists() else set()
    todo = [q for q in questions() if q["id"] not in done]

    def one(q):
        t = time.time()
        try:
            r = ask(version, q["q"], session=f"{version}-{q['id']}-{uuid.uuid4().hex[:6]}")
            return {"id": q["id"], **r, "seconds": round(time.time() - t, 1)}
        except Exception as e:  # a failed run is data too: keep it
            return {"id": q["id"], "version": version, "question": q["q"], "error": f"{type(e).__name__}: {e}"[:500],
                    "seconds": round(time.time() - t, 1)}

    with ThreadPoolExecutor(workers) as pool, out.open("a") as sink:
        for f in as_completed([pool.submit(one, q) for q in todo]):  # save each run as soon as it finishes
            r = f.result()
            sink.write(json.dumps(r) + "\n")
            sink.flush()
            print(version, r["id"], "error" if "error" in r else f"{len(r['memo']['claims'])} claims", r["seconds"], "s", flush=True)


def check(claim: dict) -> bool:
    ev = _squash(claim.get("evidence") or "")
    return (bool(ev) and any(ev in t for t in _filing_texts()) and _names_company(claim.get("company", ""), claim["evidence"])
            and (not claim.get("number") or _squash(str(claim["number"])) in ev))


def score() -> dict:
    gold = {g["id"]: g for g in map(json.loads, GOLD.read_text().splitlines())}
    result = {}
    for path in sorted(RUNS.glob("*.jsonl")):
        runs = [json.loads(l) for l in path.read_text().splitlines()]
        ok = [r for r in runs if "error" not in r]
        claims = [c for r in ok for c in r["memo"]["claims"]]
        per_run, f1s, beams = [], [], []
        for r in ok:
            cs = r["memo"]["claims"]
            g = sum(map(check, cs)) / len(cs) if cs else None
            row = {"id": r["id"], "grounded": g, "claims": len(cs), "tool_calls": len(r["tool_calls"]), "seconds": r["seconds"]}
            if r["id"] in gold:
                pred = {e for c in cs if (e := _resolve(c["company"]))} - {gold[r["id"]]["company"]}
                m = rubric(pred, set(gold[r["id"]]["gold"]))
                row |= {"f1": m["f1"], "beam": m["score"], "precision": m["precision"], "recall": m["recall"]}
                f1s.append(m["f1"]); beams.append(m["score"])
            per_run.append(row)
        result[path.stem] = {
            "runs": len(runs), "errors": len(runs) - len(ok),
            "claims": len(claims), "grounded_rate": sum(map(check, claims)) / max(1, len(claims)),
            "runs_fully_grounded": sum(1 for p in per_run if p["grounded"] == 1.0),
            "gold_questions": len(f1s), "gold_mean_f1": sum(f1s) / max(1, len(f1s)),
            "gold_beam_score": sum(beams) / max(1, len(beams)),
            "mean_seconds": sum(p["seconds"] for p in per_run) / max(1, len(per_run)),
            "mean_tool_calls": sum(p["tool_calls"] for p in per_run) / max(1, len(per_run)),
            "per_run": per_run,
        }
    (RUNS / "score.json").write_text(json.dumps(result, indent=1))
    return result


if __name__ == "__main__":
    import sys
    if sys.argv[1] == "run":
        for v in sys.argv[2:]:
            run(v)
    else:
        for v, s in score().items():
            print(v, {k: (round(x, 3) if isinstance(x, float) else x) for k, x in s.items() if k != "per_run"})
