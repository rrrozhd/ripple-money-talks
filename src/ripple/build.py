"""Build the starter graph into data/ripple.duckdb and write data/report.html.

    uv run python -m ripple.build            # download what's missing, then build
    uv run python -m ripple.build --offline  # build from data/raw only
"""

import argparse
import hashlib
from pathlib import Path

import duckdb
import pandas as pd

from . import graph as g
from . import sources as s
from .universe import ALIASES, SECTORS, TICKER_SECTOR

DATA = s.RAW.parent
DB = DATA / "ripple.duckdb"
REVIEW = Path(__file__).resolve().parents[2] / "review.csv"


def edge_id(src: str, dst: str, typ: str) -> str:
    return hashlib.sha1(f"{src}|{dst}|{typ}".encode()).hexdigest()[:10]


def build(offline: bool) -> duckdb.DuckDBPyConnection:
    tm = s.ticker_map(offline)
    tickers = list(TICKER_SECTOR)

    entities, filings, revenue, claims, mentions = [], [], [], [], []
    for eid, (name, _) in ALIASES.items():
        entities.append({"entity_id": eid, "name": name, "ticker": None if eid.startswith("x:") else eid,
                         "cik": tm.get(eid), "sector": TICKER_SECTOR.get(eid),
                         "in_universe": eid in TICKER_SECTOR})
    for t in tickers:
        f = s.latest_10k(tm[t])
        filings.append({"ticker": t, **{k: f[k] for k in ("cik", "accession", "form", "url", "period_end", "filed_at")}})
        text = g.filing_text(Path(f["path"]).read_bytes())
        (s.RAW / "text").mkdir(exist_ok=True)
        (s.RAW / "text" / f"{f['accession']}.txt").write_text(text)  # the exact text quotes are checked against
        for c in g.extract_claims(t, text):
            src, dst, typ = g.to_edge(c)
            claims.append({**c, "accession": f["accession"], "filing_url": f["url"],
                           "link": g.text_fragment_link(f["url"], c["quote"]),
                           "src": src, "dst": dst, "edge_type": typ, "edge_id": edge_id(src, dst, typ)})
        # every sentence naming another company, no keyword gate: the LLM labeller decides (ripple.label)
        for c in g.extract_claims(t, text, require_keyword=False):
            mentions.append({**c, "accession": f["accession"], "filing_url": f["url"],
                             "link": g.text_fragment_link(f["url"], c["quote"])})
        r = s.latest_revenue(tm[t])
        if r:
            revenue.append({"ticker": t, **r, "source_url":
                            f"https://www.sec.gov/cgi-bin/viewer?action=view&cik={tm[t]}&accession_number={r['accession']}"})

    px = s.prices(tickers + ["SPY", "SMH"], offline)
    sector_edges = g.sector_edges(px[tickers])
    checks = []
    for t in tickers:
        chk = g.price_crosscheck(px[t], s.prices_nasdaq(t, offline))
        checks.append({"ticker": t, **chk, "yahoo_url": s.yahoo_url(t), "nasdaq_url": s.nasdaq_url(t)})

    con = duckdb.connect(str(DB))
    for name, rows in [("entity", entities), ("filing", filings), ("revenue", revenue), ("claim", claims), ("mention", mentions),
                       ("sector_edge", sector_edges), ("price_check", checks)]:
        df = pd.DataFrame(rows)
        con.register("df", df)
        con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM df")
        con.unregister("df")
    con.register("sec", pd.DataFrame([{"sector_id": k, "name": v["name"]} for k, v in SECTORS.items()]))
    con.execute("CREATE OR REPLACE TABLE sector AS SELECT * FROM sec")
    # edges are derived: one row per (src, dst, type), evidence aggregated from claims
    con.execute("""
        CREATE OR REPLACE TABLE edge AS
        SELECT edge_id, src, dst, edge_type,
               count(*) AS evidence_count,
               count(DISTINCT filer) AS filers,
               max(weight) AS weight,
               arg_max(weight_kind, weight) AS weight_kind,
               list(DISTINCT filer) AS cited_by
        FROM claim GROUP BY ALL
    """)
    if REVIEW.exists():
        con.execute(f"CREATE OR REPLACE TABLE review AS SELECT * FROM read_csv('{REVIEW}', header=true)")
        # the graph users should query: only links whose sentence was judged to state the relationship
        con.execute("CREATE OR REPLACE VIEW verified_edge AS "
                    "SELECT e.*, r.verdict, r.reason FROM edge e JOIN review r USING (edge_id) WHERE r.verdict = 'correct'")
    return con


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()
    con = build(args.offline)
    from .report import write_report
    out = write_report(con, DATA / "report.html")
    n = {t: con.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in ("entity", "claim", "edge", "sector_edge")}
    print(f"built {DB.name}: {n}  report: {out}")


if __name__ == "__main__":
    main()
