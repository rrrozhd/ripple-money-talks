# PRISM: what's wired, and the UI steps left

Status (from `/api/setup-doctor`, 17 Oct 17:21): connected · 1,735 traces · 213 runs assembled · 200 traces auto-scored.
The daily auto-scoring limit (200, Builder plan) is used up until 00:00 UTC; evaluator runs are billed separately (1 credit per trace).

## Already wired in code
- Every model call is traced with the LangChain handler, one session per question.
- From now on every trace carries **agent_id `ripple`**. One run with it has been sent, so the agent exists in PRISM.
- The 15 10-Ks are in the Knowledge Base (first 200 KB of each). `kb_search` queries the documents assigned to agent `ripple`, falling back to the whole project.

Trace labels: `ripple-v1` = plain-RAG baseline · `ripple-v2` = old Ripple v1 (gpt-5-mini) · `ripple-v1-sonnet` = new Ripple v1 (Sonnet 5.5, new graph).

## UI steps (you, signed in at prism.blockconvey.com)

### 1. Knowledge Base proof
1. Knowledge Base → assign all 15 documents (`AAPL-10K-…` … `TER-10K-…`) to agent **ripple**.
2. Ask any question in the Ripple app (Ripple v1, live run). Its trace shows a `kb_search` step that returned Knowledge Base passages.
3. Screenshot: the run's Steps view with the retrieval step.

### 2. Evaluator proof
Evaluators Hub → new evaluator, name **"Every company is in the source"**, rubric:

```
You are checking a research answer about company relationships.
Answer: {output}
Retrieved evidence (tool and retrieval results): {context}

List every company the answer names as a supplier, customer, competitor or partner.
For each one, check whether the retrieved evidence contains a sentence that names that company
and states that relationship.

Score 1.0 if every named company is supported by the evidence, 0.0 if none are,
otherwise the fraction that are supported. Briefly list any unsupported companies.
```

Run it on the **same questions** for both versions. Filter traces by run name or session:
- v1 = `ripple-v2` traces (old Ripple v1)
- v2 = `ripple-v1-sonnet` traces (new Ripple v1)

Pick about 20 sessions per version (the 24 gold questions, ids `q01`–`q24`, appear in the session names). That costs about 40 credits.
Screenshot: the evaluator scores side by side.

Our own run of the same check, for reference: v1 84% of claims backed → v2 100% (60 questions each).

### 3. Root Cause proof
1. Root Cause → open the largest cluster with 3+ failed runs (most likely in `ripple-v1` / `ripple-v2`).
2. Our one-sentence cause:
   > Plain retrieval reads lists of company names (competitor lists, glossaries, other companies' deals) as relationships, because nothing checks who the sentence says is doing what; and the old graph missed relationships stated without a keyword ("We purchase memory from SK Hynix").
3. Screenshot the cluster and its cause.
