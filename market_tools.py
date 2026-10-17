"""Market tools for the Ripple agent: sector correlation, beta, and a demand-shock calculator.

Pure pandas/numpy. Every function returns a JSON-serializable dict that includes its inputs,
sample size and assumptions, so the verifier and the PRISM evaluator can see where each number came from.
Illustrative analytics only, not investment advice.

Prices: a wide DataFrame (index = date, columns = tickers, values = adjusted close), or a long
DataFrame with columns date, ticker and close/adj_close (load_prices handles both).
Graph edges (from the knowledge graph): {"source": "TSM", "target": "NVDA", "relation": "supplier_of",
"weight": 0.12 (optional: share of the SOURCE's revenue that comes from TARGET), "edge_id": "..."}.
"supplier_of" means source supplies target.
"""
from __future__ import annotations

import math
from typing import Optional

import numpy as np
import pandas as pd

MIN_OBS = 60  # below this, stats are flagged as unreliable


# data helpers
def load_prices(df_or_path) -> pd.DataFrame:
    if df_or_path is None:
        rng = np.random.default_rng(7)
        tick = ["NVDA", "AMD", "TSM", "ASML", "AMAT", "MU", "AVGO", "INTC"]
        n = 252
        sector = rng.normal(0.0004, 0.012, n)
        rets = {t: 1.0 * sector + rng.normal(0, 0.008, n) for t in tick}
        rets["NVDA"] = 1.6 * sector + rng.normal(0, 0.008, n)
        rets["TSM"] = 0.5 * rets["NVDA"] + 0.5 * sector + rng.normal(0, 0.006, n)
        return pd.DataFrame(
            100 * np.cumprod(1 + pd.DataFrame(rets), axis=0).to_numpy(),
            columns=tick,
            index=pd.bdate_range("2025-10-17", periods=n),
        )
    df = pd.read_csv(df_or_path) if isinstance(df_or_path, str) else df_or_path.copy()
    if {"ticker"} <= set(df.columns):  # long format
        col = next(c for c in ("adj_close", "close", "Close", "Adj Close") if c in df.columns)
        date_col = next(c for c in ("date", "Date") if c in df.columns)
        df = df.pivot(index=date_col, columns="ticker", values=col)
    else:
        df = df.set_index(df.columns[0]) if not isinstance(df.index, pd.DatetimeIndex) else df
    df.index = pd.to_datetime(df.index)
    return df.sort_index()


def returns(prices: pd.DataFrame) -> pd.DataFrame:
    return prices.pct_change().dropna(how="all")


def _ols(y: pd.Series, x: pd.Series) -> dict:
    d = pd.concat([y, x], axis=1).dropna()
    n = len(d)
    if n < 3:
        return {"n_obs": n, "beta": None, "alpha_daily": None, "corr": None, "r2": None,
                "beta_stderr": None, "reliable": False}
    yv, xv = d.iloc[:, 0].to_numpy(), d.iloc[:, 1].to_numpy()
    var_x = xv.var(ddof=1)
    beta = float(np.cov(yv, xv, ddof=1)[0, 1] / var_x) if var_x > 0 else float("nan")
    alpha = float(yv.mean() - beta * xv.mean())
    corr = float(np.corrcoef(yv, xv)[0, 1])
    resid = yv - (alpha + beta * xv)
    stderr = float(math.sqrt(resid.var(ddof=2) / ((n - 1) * var_x))) if var_x > 0 else float("nan")
    return {"n_obs": n, "beta": round(beta, 3), "alpha_daily": round(alpha, 6), "corr": round(corr, 3),
            "r2": round(corr ** 2, 3), "beta_stderr": round(stderr, 3), "reliable": n >= MIN_OBS}


# tools
def sector_factor(rets: pd.DataFrame, ticker: str, sector_map: Optional[dict] = None) -> pd.Series:
    """Equal-weight average return of the OTHER companies in the same sector (leave-one-out),
    so a company is never correlated with itself. Falls back to all other companies."""
    peers = [t for t in rets.columns if t != ticker]
    if sector_map and ticker in sector_map:
        same = [t for t in peers if sector_map.get(t) == sector_map[ticker]]
        peers = same or peers
    return rets[peers].mean(axis=1)


def sector_correlation(prices: pd.DataFrame, ticker: str, sector_map: Optional[dict] = None) -> dict:
    """Correlation of a company's daily returns with its sector basket (leave-one-out)."""
    rets = returns(prices)
    fac = sector_factor(rets, ticker, sector_map)
    s = _ols(rets[ticker], fac)
    return {"tool": "sector_correlation", "ticker": ticker, "benchmark": "equal-weight sector basket ex-" + ticker,
            "window": f"{rets.index.min().date()} to {rets.index.max().date()}", **s}


def sector_following(prices: pd.DataFrame, ticker: str, sector_map: dict) -> dict:
    """Which sector does this company actually follow? Correlation and beta against each sector's
    equal-weight basket (excluding the company itself). Example: AAPL may barely follow 'hardware'."""
    rets = returns(prices)
    out = {}
    for sector in sorted(set(sector_map.values())):
        peers = [t for t in rets.columns if t != ticker and sector_map.get(t) == sector]
        if not peers:
            continue
        s = _ols(rets[ticker], rets[peers].mean(axis=1))
        out[sector] = {"corr": s["corr"], "beta": s["beta"], "r2": s["r2"], "n_peers": len(peers),
                       "n_obs": s["n_obs"], "reliable": s["reliable"]}
    best = max(out, key=lambda k: out[k]["corr"] if out[k]["corr"] is not None else -2) if out else None
    return {"tool": "sector_following", "ticker": ticker, "own_sector": sector_map.get(ticker),
            "follows_most": best, "by_sector": out}


def beta_vs_sector(prices: pd.DataFrame, ticker: str, sector_map: Optional[dict] = None) -> dict:
    """Beta = how much the stock moves per 1% move in its sector basket. 1.5 means about 1.5% per 1%."""
    r = sector_correlation(prices, ticker, sector_map)
    r["tool"] = "beta_vs_sector"
    r["reading"] = (None if r["beta"] is None else
                    f"{ticker} moved about {r['beta']}% for each 1% move in its sector basket "
                    f"(R2 {r['r2']}, {r['n_obs']} days)")
    return r


def pair_stats(prices: pd.DataFrame, a: str, b: str) -> dict:
    """How A's returns relate to B's: beta of A on B (A move per 1% B move) and correlation."""
    rets = returns(prices)
    return {"tool": "pair_stats", "a": a, "b": b, **_ols(rets[a], rets[b])}


def correlation_matrix(prices: pd.DataFrame) -> dict:
    return {"tool": "correlation_matrix", "corr": returns(prices).corr().round(3).to_dict()}


def demand_shock(prices: pd.DataFrame, edges: list, company: str, shock_pct: float,
                 max_hops: int = 2, hop_decay: float = 0.5, default_weight: Optional[float] = None) -> dict:
    """Propagate a demand shock at `company` (shock_pct, e.g. -20 for a 20% drop in its demand)
    upstream to its suppliers through the filing-backed graph.

    For each supplier path: revenue_impact_pct = shock_pct * product(edge weights) * hop_decay^(hops-1).
      - edge weight = share of the supplier's revenue that comes from the customer, ONLY when a filing
        discloses it. With default_weight=None (recommended: no invented numbers) an edge without a
        disclosed weight gets revenue_impact_pct=None and exposure "not disclosed". If you pass a
        default_weight, that row is marked weight_assumed=True and must be labelled as an assumption.
    Cross-check (market-implied): beta of the supplier's stock on the company's stock times the
    company's implied move, using shock_pct as the company's assumed move. Compare the two columns;
    large gaps are interesting, not errors. Noisy by nature: see n_obs, r2, reliable.
    """
    rets = returns(prices)
    by_customer: dict = {}
    for e in edges:
        if e["relation"] == "supplier_of":
            by_customer.setdefault(e["target"], []).append(e)
    rows, frontier, seen = [], [(company, 1.0, [], 0)], set()
    while frontier:
        node, cum_w, path, hop = frontier.pop(0)
        if hop >= max_hops:
            continue
        for e in by_customer.get(node, []):
            sup = e["source"]
            if sup in seen or sup == company:
                continue
            seen.add(sup)
            w = e.get("weight")
            assumed = w is None
            undisclosed = assumed and default_weight is None
            w = (default_weight if assumed else float(w)) if not undisclosed else None
            new_w = None if (undisclosed or cum_w is None) else cum_w * w
            new_path = path + [e.get("edge_id", f"{sup}->{node}")]
            impact = None if new_w is None else shock_pct * new_w * (hop_decay ** hop)
            mkt = None
            if sup in rets.columns and company in rets.columns:
                st = _ols(rets[sup], rets[company])
                mkt = {"beta_on_company": st["beta"], "corr": st["corr"], "r2": st["r2"],
                       "n_obs": st["n_obs"], "reliable": st["reliable"],
                       "implied_price_move_pct": None if st["beta"] is None else round(st["beta"] * shock_pct, 2)}
            rows.append({"supplier": sup, "sells_to": node, "hops": hop + 1, "evidence_edge_ids": new_path,
                         "weight_used": None if w is None else round(w, 4),
                         "weight_assumed": assumed and not undisclosed,
                         "exposure_disclosed": not assumed,
                         "revenue_impact_pct": None if impact is None else round(impact, 2),
                         "market_cross_check": mkt})
            frontier.append((sup, new_w, new_path, hop + 1))
    rows.sort(key=lambda r: (r["revenue_impact_pct"] is None, -abs(r["revenue_impact_pct"] or 0)))
    return {"tool": "demand_shock", "company": company, "shock_pct": shock_pct,
            "assumptions": {"max_hops": max_hops, "hop_decay": hop_decay, "default_weight": default_weight,
                            "note": "illustrative sensitivity, not a forecast or advice"},
            "impacts": rows}


TOOL_FUNCS = [sector_correlation, beta_vs_sector, pair_stats, correlation_matrix, demand_shock]
