"""Truth checks on the built graph. Run `uv run python -m ripple.build` first."""

import duckdb
import pytest

from ripple import graph as g
from ripple import sources as s
from ripple.build import DB
from ripple.report import check_claim, independent_text, plain_sector_stats, quote_checks


@pytest.fixture(scope="module")
def con():
    return duckdb.connect(str(DB), read_only=True)


def test_shape(con):
    assert con.execute("SELECT count(*) FROM sector").fetchone()[0] == 3
    assert con.execute("SELECT count(*) FROM entity WHERE in_universe").fetchone()[0] == 15
    assert con.execute("SELECT count(*), count(DISTINCT ticker) FROM sector_edge").fetchone() == (15, 15)


def test_quote_every_claim_verbatim_with_sec_link(con):
    checks = quote_checks(con)
    assert checks, "no claims to check"
    bad = [c for c in checks if not all(c.values())]
    assert not bad, bad[:5]
    links = con.execute("SELECT filing_url, link FROM claim").fetchall()
    assert all(u.startswith("https://www.sec.gov/Archives/edgar/data/") and l.startswith(u + "#:~:text=")
               for u, l in links)


def test_quote_check_rejects_corrupted_quote(con):
    """Non-vacuity: the checker itself must flag an altered quote, a wrong name and a made-up %."""
    c = con.execute("SELECT c.*, f.cik FROM claim c JOIN filing f USING (accession) "
                    "WHERE value_text IS NOT NULL LIMIT 1").df().iloc[0].to_dict()
    stored = (s.RAW / "text" / f"{c['accession']}.txt").read_text()
    indep = independent_text((s.RAW / "filings" / str(c["cik"]) / f"{c['accession']}.htm").read_bytes())
    assert all(check_claim(stored, indep, c).values())
    words = c["quote"].split()
    bad_quote = {**c, "quote": c["quote"].replace(words[len(words) // 2], "XYZZY", 1)}
    assert not check_claim(stored, indep, bad_quote)["at_offsets"]
    assert not check_claim(stored, indep, bad_quote)["independent"]
    assert not check_claim(stored, indep, {**c, "mention": "Globex Corporation"})["mention_in_quote"]
    assert not check_claim(stored, indep, {**c, "value_text": "73% of revenue"})["value_in_quote"]


def test_recompute_sector_stats_from_cached_prices(con):
    stored = con.execute("SELECT ticker, beta, corr FROM sector_edge ORDER BY ticker").df()
    assert len(stored) == 15
    px = s.prices(list(stored.ticker), offline=True)[list(stored.ticker)]
    fresh = g.sector_edges(px).set_index("ticker").loc[stored.ticker]
    assert (abs(fresh.beta.values - stored.beta.values) < 1e-12).all()
    assert (abs(fresh["corr"].values - stored["corr"].values) < 1e-12).all()
    # and with separately written plain-pandas code
    for t, sec, beta, corr in con.execute("SELECT ticker, sector, beta, corr FROM sector_edge").fetchall():
        b, c = plain_sector_stats(px, t, sec)
        assert abs(b - beta) < 1e-9 and abs(c - corr) < 1e-9, t


def test_recompute_detects_tampered_prices(con):
    """Non-vacuity: shuffling one company's returns must change its stored correlation."""
    stored = con.execute("SELECT ticker, corr FROM sector_edge WHERE ticker = 'AMD'").fetchone()
    tickers = [t for t in g.TICKER_SECTOR]
    px = s.prices(tickers, offline=True)[tickers].copy()
    px["AMD"] = px["AMD"].sample(frac=1, random_state=0).values
    fresh = g.sector_edges(px).set_index("ticker").loc["AMD", "corr"]
    assert abs(fresh - stored[1]) > 0.1


def test_review_covers_every_edge(con):
    assert con.execute("SELECT count(*) FROM edge LEFT JOIN review USING (edge_id) WHERE verdict IS NULL").fetchone()[0] == 0
