# R5: report with source links and reviewed precision

- data/report.html built 2026-10-16; checked in the browser: scorecard, graph SVG, tables render.
- Source links tested in fresh tabs: prose (Lam Research → Micron customers), table (Entegris → TSMC 16%, scrollY 17553),
  bullet list (NVIDIA competitor list, scrollY 12868). A start,end range failed on the table, so links are now start-only.
  Re-navigating within the same document did not scroll, so links open in a new tab.
- review.csv: all 89 links reviewed by Claude (model, not human) against their first quote.
  65 correct, 23 incorrect, 1 unclear → 73% precision, in-sample (rules tuned on the same links).
  By type: competes 40/45, supplies 24/37, partners 1/7.
