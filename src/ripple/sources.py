"""Download and cache raw data. Every file under data/raw is written once and reused."""

import io
import json
import os
import time
from pathlib import Path

import httpx
import pandas as pd

RAW = Path(__file__).resolve().parents[2] / "data" / "raw"
SEC_UA = os.environ.get("SEC_USER_AGENT", "Ripple prototype research@ripple-proto.dev")


def _sec_get(url: str) -> bytes:
    for attempt in range(4):
        r = httpx.get(url, headers={"User-Agent": SEC_UA}, timeout=60, follow_redirects=True)
        if r.status_code == 429:
            time.sleep(2 ** attempt)
            continue
        r.raise_for_status()  # 403 = bad User-Agent: fail loudly, it's config
        time.sleep(0.15)  # stay well under SEC's 10 req/s
        return r.content
    raise RuntimeError(f"SEC rate limit persisted: {url}")


def _cached(path: Path, fetch) -> bytes:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(fetch())
        tmp.rename(path)
    return path.read_bytes()


def ticker_map(offline: bool) -> dict[str, int]:
    p = RAW / "company_tickers.json"
    if offline and not p.exists():
        raise FileNotFoundError(p)
    data = json.loads(_cached(p, lambda: _sec_get("https://www.sec.gov/files/company_tickers.json")))
    return {v["ticker"]: int(v["cik_str"]) for v in data.values()}


def latest_10k(cik: int) -> dict:
    """Newest original 10-K (amendments skipped) with its primary document cached."""
    sub = json.loads(_cached(RAW / "submissions" / f"{cik}.json",
                             lambda: _sec_get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")))
    rec = sub["filings"]["recent"]
    for i, form in enumerate(rec["form"]):
        if form == "10-K":
            acc = rec["accessionNumber"][i]
            doc = rec["primaryDocument"][i]
            url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/{doc}"
            path = RAW / "filings" / str(cik) / f"{acc}.htm"
            _cached(path, lambda: _sec_get(url))
            return {"cik": cik, "accession": acc, "form": form, "url": url, "path": str(path),
                    "period_end": rec["reportDate"][i], "filed_at": rec["filingDate"][i]}
    raise LookupError(f"no 10-K for CIK {cik}")


REVENUE_CONCEPTS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"]


def latest_revenue(cik: int) -> dict | None:
    """Latest full-fiscal-year revenue reported in a 10-K, from XBRL companyfacts."""
    facts = json.loads(_cached(RAW / "facts" / f"{cik}.json",
                               lambda: _sec_get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json")))
    best = None
    for rank, concept in enumerate(REVENUE_CONCEPTS):
        for f in facts.get("facts", {}).get("us-gaap", {}).get(concept, {}).get("units", {}).get("USD", []):
            if f.get("form") != "10-K" or "start" not in f:
                continue
            days = (pd.Timestamp(f["end"]) - pd.Timestamp(f["start"])).days
            if not 350 <= days <= 380:
                continue
            key = (f["end"], -rank, f["filed"])
            if best is None or key > best[0]:
                best = (key, {"concept": concept, "value": f["val"], "period_end": f["end"],
                              "accession": f["accn"], "filed": f["filed"]})
    return best[1] if best else None


PRICE_START, PRICE_END = "2025-10-15", "2026-10-15"


def prices(tickers: list[str], offline: bool) -> pd.DataFrame:
    """Daily adjusted closes (Yahoo via yfinance), cached as one CSV."""
    p = RAW / "prices_yahoo.csv"
    if not p.exists():
        if offline:
            raise FileNotFoundError(p)
        import yfinance as yf
        df = yf.download(tickers, start=PRICE_START, end=PRICE_END, auto_adjust=True, progress=False)["Close"]
        p.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(p)
    return pd.read_csv(p, index_col=0, parse_dates=True)


def prices_nasdaq(ticker: str, offline: bool) -> pd.Series | None:
    """Second, independent price source (Nasdaq, unadjusted closes) used only to cross-check Yahoo."""
    p = RAW / "nasdaq" / f"{ticker}.json"
    if not p.exists():
        if offline:
            return None
        url = (f"https://api.nasdaq.com/api/quote/{ticker}/historical?assetclass=stocks"
               f"&fromdate={PRICE_START}&todate={PRICE_END}&limit=400")
        try:
            r = httpx.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
            r.raise_for_status()
            rows = r.json()["data"]["tradesTable"]["rows"]
        except (httpx.HTTPError, KeyError, TypeError, ValueError):
            return None
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(rows))
        time.sleep(0.3)
    rows = json.loads(p.read_text())
    s = pd.Series({pd.Timestamp(r["date"]): float(r["close"].strip("$").replace(",", "")) for r in rows})
    return s.sort_index().loc[PRICE_START:PRICE_END]


def nasdaq_url(ticker: str) -> str:
    return f"https://www.nasdaq.com/market-activity/stocks/{ticker.lower()}/historical"


def yahoo_url(ticker: str) -> str:
    return f"https://finance.yahoo.com/quote/{ticker}/history/"
