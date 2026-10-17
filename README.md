# Ripple: starter graph

3 sectors × 5 companies (semis, semi equipment, hardware) in one DuckDB file, with every link traceable to its source.

- **Company ↔ company links** come only from each company's latest 10-K: the exact sentence, its character offsets, and a link that opens the SEC filing at that sentence.
- **Company → sector links** come only from one year of daily prices: beta and correlation against the average of the *other* sector members.

```bash
uv run python -m ripple.build            # download anything missing (SEC, Yahoo, Nasdaq), build
uv run python -m ripple.build --offline  # rebuild from data/raw only
uv run pytest -q                         # truth checks
open data/report.html
```

Files: `data/ripple.duckdb` (tables: entity, sector, filing, revenue, claim, edge, sector_edge, price_check, review),
`data/raw/` (cached source files), `review.csv` (per-link verdicts with reasons).

Set `SEC_USER_AGENT="Your Name you@example.com"` before downloading; SEC asks for a real contact.
