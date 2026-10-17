# Ripple — Next.js frontend

A second UI for Ripple (Next.js 16 + Tailwind 4), alongside the Vite UI in `web/`. It talks to the same Ripple API
(`src/ripple/web.py`) and does not change it.

```bash
# 1. API, from the repo root (needs .env with NICRRON_API_KEY and PRISMTRACE_*)
uv run uvicorn ripple.web:app --port 8000

# 2. Frontend
cd frontend
npm install
echo "NEXT_PUBLIC_RIPPLE_AGENT_URL=http://localhost:8000" > .env.local
npm run dev   # http://localhost:3000
```

The browser calls `/rapi/*`; `next.config.ts` proxies that to `{NEXT_PUBLIC_RIPPLE_AGENT_URL}/api/*`, so the API needs no CORS.
Without `NEXT_PUBLIC_RIPPLE_AGENT_URL` every page runs on mock data (`src/lib/mock/`) and the header shows a **MOCK** badge.

## Pages

| Route | Data | What it shows |
|---|---|---|
| `/` | `POST /api/ask` + `GET /api/job/{id}` | Ask the agent. Polls the job, shows the tool calls and the verifier's result, then the memo; every claim card has the 10-K sentence, an EDGAR link and a verified / not verified flag. `/?q=…` is linkable. |
| `/graph` | `GET /api/graph` | Force layout of the verified graph. Filter by relation; click a company for beta / correlation and its links, or an edge for its sentence. |
| `/eval` | `GET /api/proofs`, `/api/samples`, `/api/saved/{id}/{version}` | Plain RAG vs the latest Ripple version, every version's scores, PRISM status, and per-question claim backing. |
| `/shock` | `GET /api/shock/buyers`, `POST /api/shock` | Pick a buyer and a purchase cut; suppliers from the verified graph with revenue at risk where their 10-K discloses the customer's share (exact or “≥ 10%” lower bound), plus each supplier's sector β / ρ. Shown only with the live API. |

All API mapping lives in `src/lib/ripple-app.ts`; UI types are in `src/lib/types.ts`.
