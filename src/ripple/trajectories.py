"""Score v1 and v2 runs with PRISM's own trajectory evaluation, on the same questions.

    uv run python -m ripple.trajectories    # writes data/prism_trajectories.json

v1 = old Ripple (gpt-5-mini, keyword graph), v2 = new Ripple (Sonnet 5.5, all-mention graph).
"""

import json
import time

from .evaluate import GOLD
from .llm import ROOT
from .prism_kb import client
from .runs import check

VERSIONS = {"v1": ("v1", "openai/gpt-5-mini"), "v2": ("v1-sonnet", "anthropic/claude-sonnet-5-5")}
OUT = ROOT / "data" / "prism_trajectories.json"
SCORES = ("overall_score", "correctness_score", "efficiency_score", "safety_score", "robustness_score")


def steps_for(run: dict) -> list[dict]:
    steps = [{"step_type": "reasoning", "label": "Plan", "input_summary": run["question"][:500],
              "output_summary": "Look up relationships, then verify every claim against its filing quote", "duration_ms": 500}]
    steps += [{"step_type": "tool_call", "label": t, "tool_name": "verifier" if t == "task" else t,
               "input_summary": run["question"][:300], "output_summary": "", "duration_ms": 1000} for t in run["tool_calls"]]
    claims = run["memo"]["claims"]
    cited = "; ".join(f"{c['company']} ({c['relation']}){'' if check(c) else ' [quote not found in filing]'}" for c in claims)
    steps.append({"step_type": "final_answer", "label": "Memo", "duration_ms": 500,
                  "output_summary": (run["memo"]["answer"][:1200] + f"\nClaims: {cited or 'none'}")[:2000]})
    return steps


def main() -> None:
    pt = client()
    gold = {g["id"] for g in map(json.loads, GOLD.read_text().splitlines())}
    out = json.loads(OUT.read_text()) if OUT.exists() else {}
    for label, (file, model) in VERSIONS.items():
        runs = [r for r in map(json.loads, (ROOT / "data" / "runs" / f"{file}.jsonl").read_text().splitlines())
                if "error" not in r and r["id"] in gold]
        for r in runs:
            key = f"{label}:{r['id']}"
            if key in out and out[key].get("scorecard"):
                continue
            res = pt.submit_trajectory(agent_name=f"ripple-{label}", model=model, steps=steps_for(r))
            out[key] = {"id": res.get("id"), "question": r["question"]}
        OUT.write_text(json.dumps(out, indent=1))
    for _ in range(30):  # evaluation runs async after submission
        pending = [k for k, v in out.items() if not v.get("scorecard")]
        if not pending:
            break
        for k in pending:
            ev = pt.get_trajectory_evaluation(out[k]["id"]) or {}
            if ev.get("status") == "complete" and ev.get("scorecard"):
                out[k]["scorecard"] = {s: ev["scorecard"].get(s) for s in SCORES} | {"passed": ev["scorecard"].get("passed")}
        OUT.write_text(json.dumps(out, indent=1))
        time.sleep(5)
    for label in VERSIONS:
        cards = [v["scorecard"] for k, v in out.items() if k.startswith(label + ":") and v.get("scorecard")]
        avg = {s: round(sum(c[s] or 0 for c in cards) / max(1, len(cards)), 1) for s in SCORES}
        print(label, f"n={len(cards)}", avg)


if __name__ == "__main__":
    main()
