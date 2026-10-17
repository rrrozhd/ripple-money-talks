# Ripple: demo checklist (Money Intelligence)

**Pitch:** plain RAG over 10-Ks names the wrong companies as suppliers. Ripple's agent queries a verified
relationship graph, and a verifier refuses any claim whose quote isn't in the filing.

## Before the demo
1. Put the real PRISM key (`pt-sk-…`) in `.env` as `PRISMTRACE_API_KEY`.
2. `uv run python -m ripple.prism_kb upload` uploads the 15 10-Ks to the PRISM Knowledge Base. Then assign them to the agent in PRISM.
3. `uv run python -m ripple.runs run v1 v2` runs 60 questions per version, traced to PRISM (needs 50+ runs).
4. `uv run python -m ripple.runs score` scores both versions with our own evaluator.

## The three PRISM proofs
| Proof | What to show |
|---|---|
| Knowledge Base | A v2 run whose `kb_search` step returned passages from the PRISM Knowledge Base ("source": "PRISM knowledge base") |
| Root Cause | The cluster of failed v1 runs, plus our sentence: *"Plain RAG reads lists of company names (competitors, glossaries, other companies' deals) as relationships, because nothing checks who the sentence says is doing what."* |
| Evaluator | "Every claimed company is backed by a verbatim filing quote that names it" (+ F1 on 24 gold questions), v1 vs v2 on the same 60 questions (`data/runs/score.json`) |

## Live (3 minutes)
1. Ask v1 and v2 the same question: "Who supplies NVIDIA, and how exposed are they?"
2. Show v1's wrong or unbacked claim, then v2's verified claims, each with an SEC link that scrolls to the sentence.
3. PRISM: Root Cause cluster → evaluator score v1 vs v2.
4. Close with the price-based sector links: "Apple barely moves with hardware (corr 0.11)." The graph knows more than the filings.
