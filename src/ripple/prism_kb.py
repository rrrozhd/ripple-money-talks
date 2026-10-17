"""Upload the 15 filings to the PRISM Knowledge Base (proof 1) and search it.

    uv run python -m ripple.prism_kb upload
    uv run python -m ripple.prism_kb search "who manufactures NVIDIA's wafers"
"""

import json
from functools import lru_cache

import duckdb

from .llm import CFG, ROOT


@lru_cache
def client():
    key = CFG.get("PRISMTRACE_API_KEY") or ""
    if not key.startswith("pt-sk-"):
        return None
    from prismtrace import PRISMtrace
    return PRISMtrace(api_key=key, host=CFG["PRISMTRACE_HOST"], project_id=CFG["PRISMTRACE_PROJECT_ID"])


def upload() -> None:
    pt = client()
    if pt is None:
        raise SystemExit("PRISM key missing or not a pt-sk- key")
    existing = {d.get("name") for d in pt.kb_list_documents()}
    con = duckdb.connect(str(ROOT / "data" / "ripple.duckdb"), read_only=True)
    for ticker, acc, url, period in con.execute("SELECT ticker, accession, url, period_end FROM filing ORDER BY 1").fetchall():
        name = f"{ticker}-10K-{period}.txt"
        if name in existing:
            continue
        text = (ROOT / "data" / "raw" / "text" / f"{acc}.txt").read_text()
        doc = pt.kb_upload(filename=name, content=f"Source: {url}\n\n{text}", content_type="text/plain",
                           description=f"{ticker} annual report (10-K) for the period ending {period}, from SEC EDGAR")
        print(name, doc.get("chunk_count"))


def search(query: str, limit: int = 5) -> list[dict]:
    pt = client()
    if not pt:
        return []
    # documents assigned to the "ripple" agent first (the Knowledge Base proof); whole project if none are assigned yet
    hits = pt.kb_search(query, agent_id="ripple", limit=limit)
    return hits or pt.kb_search(query, limit=limit)  # hits carry doc_name; PRISM keeps the first 200 KB of each filing


if __name__ == "__main__":
    import sys
    if sys.argv[1] == "upload":
        upload()
    else:
        print(json.dumps(search(sys.argv[2]), indent=1)[:3000])
