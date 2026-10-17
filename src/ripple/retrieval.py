"""Plain RAG over the 15 cached 10-Ks: hybrid search (BM25 + embeddings, merged by reciprocal rank fusion),
then an LLM reranker. All model calls go through Nicrron.

    uv run python -m ripple.retrieval "who manufactures NVIDIA's wafers"
"""

import json
import re
from functools import lru_cache

import duckdb
import numpy as np
from openai import OpenAI
from pydantic import BaseModel, Field
from rank_bm25 import BM25Okapi

from .graph import sentences, text_fragment_link
from .llm import CFG, NICRRON_URL, ROOT, callbacks, chat

DATA = ROOT / "data"
EMBED_MODEL = "openai/text-embedding-3-small"
RERANK_MODEL = "openai/gpt-4.1-mini"  # ~1s; gpt-5-nano ranked well but took ~48s
CHUNK_CHARS = 1200
TOKEN = re.compile(r"[a-z0-9]+")


def chunk_filings() -> list[dict]:
    """Sentence-aligned chunks of ~1200 chars, one sentence of overlap, with char offsets for citations."""
    con = duckdb.connect(str(DATA / "ripple.duckdb"), read_only=True)
    chunks = []
    for ticker, acc, url in con.execute("SELECT ticker, accession, url FROM filing ORDER BY ticker").fetchall():
        text = (DATA / "raw" / "text" / f"{acc}.txt").read_text()
        spans = list(sentences(text))
        i = 0
        while i < len(spans):
            j, start = i, spans[i][0]
            while j < len(spans) and spans[j][1] - start < CHUNK_CHARS:
                j += 1
            j = max(j, i + 1)
            end = spans[j - 1][1]
            body = text[start:end]
            chunks.append({"id": len(chunks), "ticker": ticker, "accession": acc, "char_start": start, "char_end": end,
                           "text": body, "link": text_fragment_link(url, body)})
            i = j - 1 if j - 1 > i else j  # overlap one sentence
    return chunks


def _client() -> OpenAI:
    return OpenAI(base_url=NICRRON_URL, api_key=CFG["NICRRON_API_KEY"])


@lru_cache
def index():
    """(chunks, bm25, embedding matrix). Embeddings are cached in data/chunk_embeddings.npy."""
    path_c, path_e = DATA / "chunks.json", DATA / "chunk_embeddings.npy"
    if path_c.exists() and path_e.exists():
        chunks = json.loads(path_c.read_text())
        emb = np.load(path_e)
    else:
        chunks = chunk_filings()
        vecs, client = [], _client()
        for k in range(0, len(chunks), 256):
            r = client.embeddings.create(model=EMBED_MODEL, input=[c["text"] for c in chunks[k:k + 256]])
            vecs += [d.embedding for d in r.data]
        emb = np.array(vecs, dtype=np.float32)
        emb /= np.linalg.norm(emb, axis=1, keepdims=True)
        path_c.write_text(json.dumps(chunks))
        np.save(path_e, emb)
    bm25 = BM25Okapi([TOKEN.findall(c["text"].lower()) for c in chunks])
    return chunks, bm25, emb


def hybrid(query: str, k: int = 20, ticker: str | None = None) -> list[dict]:
    """Top-k candidates by reciprocal rank fusion of BM25 and cosine similarity."""
    chunks, bm25, emb = index()
    lex = bm25.get_scores(TOKEN.findall(query.lower()))
    q = np.array(_client().embeddings.create(model=EMBED_MODEL, input=[query]).data[0].embedding, dtype=np.float32)
    dense = emb @ (q / np.linalg.norm(q))
    if ticker:
        mask = np.array([c["ticker"] == ticker for c in chunks])
        lex, dense = np.where(mask, lex, -np.inf), np.where(mask, dense, -np.inf)
    rrf = np.zeros(len(chunks))
    for scores in (lex, dense):
        order = np.argsort(-scores)[:200]
        rrf[order] += 1.0 / (60 + np.arange(1, len(order) + 1))  # RRF, k=60
    return [chunks[i] for i in np.argsort(-rrf)[:k] if rrf[i] > 0]


class Ranked(BaseModel):
    scores: list[int] = Field(description="Relevance 0-3 for each passage, in the given order")


def rerank(query: str, cands: list[dict], top: int = 6) -> list[dict]:
    """LLM listwise rerank: one call scores all candidates 0-3."""
    if not cands:
        return []
    listing = "\n\n".join(f"[{i}] ({c['ticker']} 10-K) " + c["text"] for i, c in enumerate(cands))
    llm = chat(RERANK_MODEL).with_structured_output(Ranked)
    out = llm.invoke(f"Question: {query}\n\nScore how directly each passage helps answer the question "
                     f"(3 = directly answers, 0 = irrelevant). Return exactly {len(cands)} scores.\n\n{listing}",
                     config={"callbacks": callbacks(), "run_name": "rerank"})
    scores = (out.scores + [0] * len(cands))[:len(cands)]
    order = sorted(range(len(cands)), key=lambda i: (-scores[i], i))
    return [{**cands[i], "rerank": scores[i]} for i in order[:top]]  # ties keep hybrid order


def search(query: str, ticker: str | None = None, top: int = 6) -> list[dict]:
    return rerank(query, hybrid(query, ticker=ticker), top)


if __name__ == "__main__":
    import sys
    for c in search(sys.argv[1]):
        print(f"[{c['rerank']}] {c['ticker']}: {c['text'][:220]}…\n   {c['link'][:120]}")
