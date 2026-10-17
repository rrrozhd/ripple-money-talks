"""Measure the graph: BEAM-style questions (gold answer + 1 / 0.5 / 0 rubric), link precision against review,
and how well Jev's confidence predicts a correct link.

    uv run python -m ripple.evaluate      # writes data/eval.json

Three versions of the graph are compared:
  raw       every link the keyword extractor produced
  jev       links re-typed by Jev's label for each claim ("none" drops the claim)
  reviewed  raw links whose sentence was judged correct on review
"""

import json
from pathlib import Path

import duckdb
import numpy as np

from .graph import to_edge
from .jev import OUT as JEV_OUT, claim_key

ROOT = Path(__file__).resolve().parents[2]
GOLD = ROOT / "eval" / "gold.jsonl"
JEV_MIN_P = 0.5
REL_FROM_EDGE = {"SUPPLIES": ("suppliers", "customers"), "COMPETES_WITH": ("competitors",) * 2,
                 "PARTNERS": ("partners",) * 2}


def rubric(pred: set, gold: set) -> dict:
    """BEAM-style: 1 = complete and nothing wrong, 0.5 = partly right, 0 = nothing right."""
    hit = len(pred & gold)
    p = hit / len(pred) if pred else 0.0
    r = hit / len(gold) if gold else 0.0
    f1 = 2 * p * r / (p + r) if p + r else 0.0
    score = 1.0 if pred == gold else 0.5 if hit else 0.0
    return {"precision": p, "recall": r, "f1": f1, "score": score, "hit": hit, "pred_n": len(pred), "gold_n": len(gold)}


def answers(links: list[tuple]) -> dict:
    """(filer, src, dst, type) links -> {(company, relation): set(entities)} as stated in that company's own 10-K."""
    out: dict = {}
    for filer, src, dst, typ in links:
        fwd, back = REL_FROM_EDGE[typ]
        if filer == dst:      # src supplies the filer -> a supplier of the filer
            out.setdefault((filer, fwd), set()).add(src)
        elif filer == src:
            out.setdefault((filer, back if typ == "SUPPLIES" else fwd), set()).add(dst)
    return out


def calibration(p: np.ndarray, y: np.ndarray, bins: int = 5) -> dict:
    edges = np.linspace(0, 1, bins + 1)
    ece = sum(abs(p[m].mean() - y[m].mean()) * m.mean()
              for i in range(bins) if (m := (p >= edges[i]) & (p < edges[i + 1] + (i == bins - 1) * 1e-9)).any())
    return {"brier": float(np.mean((p - y) ** 2)), "ece": float(ece), "n": int(len(p))}


def evaluate(jev_file: Path = JEV_OUT) -> dict:
    con = duckdb.connect(str(ROOT / "data" / "ripple.duckdb"), read_only=True)
    claims = con.execute("SELECT * FROM claim").df().to_dict("records")
    review = dict(con.execute("SELECT edge_id, verdict FROM review").fetchall())
    jev = {d["key"]: d for d in map(json.loads, jev_file.read_text().splitlines())}

    raw = [(c["filer"], c["src"], c["dst"], c["edge_type"]) for c in claims]
    reviewed = [(c["filer"], c["src"], c["dst"], c["edge_type"]) for c in claims if review[c["edge_id"]] == "correct"]
    jev_links, jev_keep = [], {}
    for c in claims:
        j = jev[claim_key(c)]
        keeps_original = False
        if j["choice"] != "none" and j["p"] >= JEV_MIN_P:
            link = (c["filer"], *to_edge({**c, "relation": j["choice"]}))
            jev_links.append(link)
            keeps_original = link[1:] == (c["src"], c["dst"], c["edge_type"])
        # Jev's support for this claim's original link, used to judge Jev against the review
        jev_keep.setdefault(c["edge_id"], []).append((keeps_original, j["probs"]))

    gold = [json.loads(l) for l in GOLD.read_text().splitlines()]
    result = {"questions": len(gold), "variants": {}}
    for name, links in [("raw", raw), ("jev", jev_links), ("reviewed", reviewed)]:
        ans = answers(links)
        per_q = {g["id"]: rubric(ans.get((g["company"], g["rel"]), set()), set(g["gold"])) for g in gold}
        hits = sum(v["hit"] for v in per_q.values())
        result["variants"][name] = {
            "beam_score": float(np.mean([v["score"] for v in per_q.values()])),
            "mean_f1": float(np.mean([v["f1"] for v in per_q.values()])),
            "micro_precision": hits / max(1, sum(v["pred_n"] for v in per_q.values())),
            "micro_recall": hits / sum(v["gold_n"] for v in per_q.values()),
            "per_question": per_q,
        }

    # Jev as a judge of the keyword links: does "Jev keeps it" agree with the review verdict?
    y, p, agree = [], [], 0
    for eid, verdict in review.items():
        if verdict == "unclear":
            continue
        votes = jev_keep[eid]
        keep = any(k for k, _ in votes)
        y.append(verdict == "correct")
        # probability Jev assigns to "this link is real" = 1 - P(none), best claim
        p.append(max(1 - probs["none"] for _, probs in votes))
        agree += keep == (verdict == "correct")
    y, p = np.array(y, float), np.array(p, float)
    result["jev_vs_review"] = {"edges": len(y), "agreement": agree / len(y), **calibration(p, y)}
    out = ROOT / "data" / f"eval_{jev_file.stem}.json"
    out.write_text(json.dumps(result, indent=1))
    return result


def main() -> None:
    import sys
    r = evaluate(Path(sys.argv[1]) if len(sys.argv) > 1 else JEV_OUT)
    print(f"{'graph':10s} {'BEAM score':>10s} {'mean F1':>8s} {'precision':>9s} {'recall':>7s}")
    for k, v in r["variants"].items():
        print(f"{k:10s} {v['beam_score']:10.2f} {v['mean_f1']:8.2f} {v['micro_precision']:9.2f} {v['micro_recall']:7.2f}")
    print("Jev vs review:", {k: round(v, 3) if isinstance(v, float) else v for k, v in r["jev_vs_review"].items()})


if __name__ == "__main__":
    main()
