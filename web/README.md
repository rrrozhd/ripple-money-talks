# Ripple — web

Next.js 16 + Tailwind 4 frontend for Ripple.

```bash
npm install
npm run dev   # http://localhost:3000
```

## Pages

| Route | What it shows |
|---|---|
| `/` | Ask the agent. Streams the plan, tool calls and verifier result, then renders the memo with numbered citations; each citation opens a claim card with the exact 10-K sentence and an EDGAR link. `/?q=…` makes a memo linkable. |
| `/graph` | Force layout of the relationship graph. Filter by relation, click a company for beta / correlation and every filing-backed link, click an edge for its sentence. |
| `/eval` | Plain RAG vs Ripple v1: headline backing rate, all metrics, per-question claim backing. |

## Mock data vs backend

Without configuration the UI runs on mock data (`src/lib/mock/`), and the header shows a **MOCK** badge.
Mock quotes are illustrative paraphrases, not verbatim filing text; mock betas and revenue shares are made up.

To connect the backend, set:

```bash
NEXT_PUBLIC_RIPPLE_API_URL=http://localhost:8000
```

The backend must serve (types in `src/lib/types.ts`):

| Endpoint | Response |
|---|---|
| `POST /ask` `{question}` | NDJSON stream, one `AgentEvent` per line: `plan`, `step`, `tool_call`, `tool_result`, `verifier`, `memo`, `done` (or `error`) |
| `GET /graph` | `Graph` — companies, edges (with `quote`, `mention`, `filing`, optional `revenueShare`), sector stats |
| `GET /eval` | `EvalReport` — metrics and per-question runs |

In a memo, paragraphs reference claims with `[c1]`-style markers, and `**bold**` is supported.
Enable CORS for the frontend origin on the backend.
