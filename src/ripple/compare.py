"""Relationship accuracy against the independent reference + paired version comparison.

    uv run python -m ripple.compare rag v1 v1-sonnet v3
"""

import json
import math
import sys

from .agent import _resolve
from .coverage import reference
from .llm import ROOT
from .runs import check, questions

REL = {"suppliers": "supplier", "customers": "customer", "competitors": "competitor", "partners": "partner"}


def score(file: str) -> dict:
    ref = {}
    for x in reference():
        if x["entity"]:
            ref.setdefault((x["filer"], x["relation"]), set()).add(x["entity"])
    qs, out = {q["id"]: q for q in questions()}, {}
    for r in map(json.loads, (ROOT / "data" / "runs" / f"{file}.jsonl").read_text().splitlines()):
        if "error" in r:
            continue
        q = qs[r["id"]]
        truth = ref.get((q["company"], REL[q["rel"]]), set())
        claims = r["memo"]["claims"]
        pred = {e for c in claims if (e := _resolve(c["company"])) and e != q["company"]}
        hit = len(pred & truth)
        p = hit / len(pred) if pred else (1.0 if not truth else 0.0)
        rc = hit / len(truth) if truth else (1.0 if not pred else None)
        f1 = (2 * p * rc / (p + rc) if p + rc else 0.0) if rc is not None else None
        out[r["id"]] = {"p": p, "r": rc, "f1": f1, "grounded": sum(map(check, claims)) / len(claims) if claims else None,
                        "seconds": r["seconds"]}
    return out


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else float("nan")


def paired(a: dict, b: dict, m: str) -> str:
    w = l = 0
    for q in set(a) & set(b):
        x, y = a[q][m], b[q][m]
        if x is None or y is None:
            continue
        w += y > x + 1e-9
        l += y < x - 1e-9
    n = w + l
    p = sum(math.comb(n, k) for k in range(w, n + 1)) / 2 ** n if n else 1.0
    return f"better {w}, worse {l} (sign test p={p:.3f})"


if __name__ == "__main__":
    files = sys.argv[1:] or ["rag", "v1", "v1-sonnet", "v3"]
    res = {f: score(f) for f in files}
    for f, s in res.items():
        v = list(s.values())
        print(f"{f:10s} n={len(v):2d} precision={mean([x['p'] for x in v]):.2f} recall={mean([x['r'] for x in v]):.2f} "
              f"F1={mean([x['f1'] for x in v]):.2f} grounded={mean([x['grounded'] for x in v]):.2f} sec={mean([x['seconds'] for x in v]):.0f}")
    for a, b in zip(files, files[1:]):
        print(f"{b} vs {a}: precision {paired(res[a], res[b], 'p')}; grounded {paired(res[a], res[b], 'grounded')}")
