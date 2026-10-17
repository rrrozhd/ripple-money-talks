# Ripple

**A research analyst agent that answers "who depends on whom" across US tech companies, and backs every company it names with the exact 10-K sentence.**

Built at **Money Talks 2** (AI × Finance Hackathon, New York, October 17, 2026) · Track: **Money Intelligence**

## The problem

Ask a plain RAG chatbot "Who supplies NVIDIA?" and it reads 10-K text full of company names: competitors, partners, glossary entries, other companies' deals. It can't tell who is doing what to whom, so it confidently names the wrong companies. In a research memo, one wrong supplier ruins the whole thing.

## What Ripple does

- **Relationship graph from filings.** Supplier, customer, competitor and partner links extracted from the latest 10-Ks. Each link is tied to the exact sentence that states it, with a link that opens the SEC filing at that sentence.
- **Market links from prices.** Each company's beta and correlation to its sector, from a year of daily prices (e.g. Apple barely follows the hardware sector: correlation 0.11).
- **A Deep Agent that uses them.** It plans, calls tools, and sends its draft claims to a verifier sub-agent that rejects any claim whose quote isn't word for word in a filing.

Example questions:
- "Who supplies NVIDIA, and how exposed is each supplier?"
- "Who are Lam Research's most significant customers?"
- "If TSMC cuts purchases by 30%, how much revenue is at risk for Entegris?"

## How it works

```
SEC EDGAR 10-Ks ──▶ text + claims (company mentions + relationship keywords)
                        │
                        ▼
              LLM labels each claim (supplier / customer / competitor / partner / none)
                        │
                        ▼
              verified graph  ◀── daily prices → sector beta & correlation
                        │
                        ▼
   LangChain Deep Agent ─ graph_lookup · sector_stats · shock · kb_search
                        └─ verifier sub-agent ─ check_claims
                        │
                        ▼
              memo with cited claims + SEC links
```

| Tool | What it does |
|---|---|
| `graph_lookup(company, relation)` | Suppliers, customers, competitors or partners, each with its filing quote and link |
| `sector_stats(company)` | Beta and correlation to its sector; which sector it actually follows |
| `shock(company, drop_pct)` | Suppliers' revenue at risk if the company cuts purchases (revenue × disclosed revenue share × cut %) |
| `kb_search(query, company?)` | Hybrid search over the filings (BM25 + embeddings, LLM reranking) plus the PRISM Knowledge Base |
| `verifier` → `check_claims` | Each claim's quote must appear word for word in a filing, name the company, and contain any number used |

## Results

Same 60 questions, plain RAG baseline vs Ripple v1, every run traced in PRISM:

| | Plain RAG | Ripple v1 |
|---|---|---|
| Claims backed by an exact filing quote that names the company | 64% | **84%** |
| Runs where every claim is backed | 16 | **25** |
| F1 on 24 gold questions* | 0.81 | **0.90** |
| BEAM-style score* | 0.71 | **0.82** |
| Time per question | 248 s | **175 s** |
| Tool calls per question | 14 | **7** |

\*The gold answers were written by the team's AI assistant, not by independent annotators, so treat F1 as indicative. The quote-backing check needs no answer key.

## Sponsor stack

- **Nicrron:** every model call: agent (`openai/gpt-5-mini`), graph labeller, reranker (`openai/gpt-4.1-mini`), embeddings (`openai/text-embedding-3-small`).
- **PRISM by Block Convey:** run tracing, Knowledge Base (the 15 filings), Root Cause clustering, and our evaluator ("every claimed company is backed by a verbatim filing quote") scoring the baseline against Ripple.
- **LangChain Deep Agents:** planning, tools and the verifier sub-agent.

## Data

- Latest annual reports (10-K) from SEC EDGAR for 15 companies:
  - Semiconductors: NVDA, AMD, INTC, QCOM, MU
  - Semiconductor equipment: AMAT, LRCX, KLAC, TER, ENTG
  - Hardware: AAPL, DELL, HPQ, SMCI, HPE
- Revenue from SEC XBRL company facts.
- One year of daily prices (Yahoo, cross-checked against Nasdaq: 99% of days agree).
- Public filings only; no personal or account data.

## Limits

- 15 companies; annual 10-Ks, up to ~13 months old.
- Most revenue-concentration disclosures name no customer ("Customer A, 19%"), so dollar exposure is quantified for only 4 links.
- Relationships are only as complete as the filings; companies that don't name counterparties contribute few links.
- AI output is a research aid, not investment advice.

## Team

_Add names here._
