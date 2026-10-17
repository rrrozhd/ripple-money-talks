"""Offline test on SYNTHETIC prices with a known beta. Run: python test_market_tools.py"""
import numpy as np
import pandas as pd

import market_tools as M

rng = np.random.default_rng(7)
tick = ["NVDA", "AMD", "TSM", "ASML", "AMAT", "MU", "AVGO", "INTC"]
n = 252
sector = rng.normal(0.0004, 0.012, n)
rets = {t: 1.0 * sector + rng.normal(0, 0.008, n) for t in tick}
rets["NVDA"] = 1.6 * sector + rng.normal(0, 0.008, n)  # known beta ~1.6 vs the sector
# TSM is partly driven by NVDA (supplier link) so the pair beta is visible
rets["TSM"] = 0.5 * rets["NVDA"] + 0.5 * sector + rng.normal(0, 0.006, n)
prices = pd.DataFrame(100 * np.cumprod(1 + pd.DataFrame(rets), axis=0).to_numpy(), columns=tick,
                      index=pd.bdate_range("2025-10-17", periods=n))

b = M.beta_vs_sector(prices, "NVDA")
print(b["reading"])
assert 1.3 < b["beta"] < 1.9, b  # leave-one-out basket dilutes slightly, so a wide band
c = M.sector_correlation(prices, "NVDA")
assert c["corr"] > 0.5 and c["reliable"]

edges = [
    {"source": "TSM", "target": "NVDA", "relation": "supplier_of", "weight": 0.20, "edge_id": "E1"},
    {"source": "ASML", "target": "TSM", "relation": "supplier_of", "edge_id": "E2"},
    {"source": "AMAT", "target": "TSM", "relation": "supplier_of", "weight": 0.15, "edge_id": "E3"},
]
out = M.demand_shock(prices, edges, "NVDA", -20, default_weight=0.10)
for r in out["impacts"]:
    print(r["supplier"], r["hops"], r["revenue_impact_pct"], "assumed" if r["weight_assumed"] else "filing",
          r["market_cross_check"]["implied_price_move_pct"])
tsm = next(r for r in out["impacts"] if r["supplier"] == "TSM")
assert tsm["revenue_impact_pct"] == -4.0  # -20 * 0.20, hop 1
asml = next(r for r in out["impacts"] if r["supplier"] == "ASML")
assert asml["revenue_impact_pct"] == round(-20 * 0.20 * 0.10 * 0.5, 2) and asml["weight_assumed"]
print("all tests passed")
