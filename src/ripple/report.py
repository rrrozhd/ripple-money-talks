"""Self-contained HTML report: the graph picture, the truth scorecard, and every edge with its source link."""

import html
import json
import math
import re
from pathlib import Path

import duckdb
import lxml.html
import pandas as pd

from . import graph as g
from . import sources as s
from .universe import SECTORS

ROOT_DATA = s.RAW.parent
COLORS = {"SUPPLIES": "#2563eb", "COMPETES_WITH": "#dc2626", "PARTNERS": "#16a34a"}
HUB_LABEL = {"semis": "Semis", "equipment": "Equipment", "hardware": "Hardware"}
SECTOR_COLORS = {"semis": "#7c3aed", "equipment": "#d97706", "hardware": "#0891b2"}


def _e(x) -> str:
    return html.escape("" if x is None else str(x))


def _squash(t: str) -> str:
    return re.sub(r"\s+", "", t)


def independent_text(raw_html: bytes) -> str:
    """The filing's text via a second, unrelated parser (lxml, not BeautifulSoup), whitespace removed.
    Quotes are compared whitespace-free because the two parsers space tag boundaries differently."""
    return _squash(lxml.html.fromstring(raw_html).text_content().replace("\xa0", " "))


def check_claim(stored_text: str, indep_text: str, c: dict) -> dict:
    q = c["quote"]
    return {"at_offsets": stored_text[c["char_start"]:c["char_end"]] == q,  # storage integrity
            "independent": _squash(q) in indep_text,  # the raw SEC document really contains it
            "mention_in_quote": c["mention"] in q,
            "value_in_quote": pd.isna(c["value_text"]) or c["value_text"] in q}


def quote_checks(con) -> list[dict]:
    """Re-verify every claim against the raw SEC document and the stored text."""
    out, cache = [], {}
    rows = con.execute("SELECT accession, char_start, char_end, quote, mention, value_text FROM claim").df()
    paths = dict(con.execute("SELECT accession, cik FROM filing").fetchall())
    for c in rows.to_dict("records"):
        acc = c["accession"]
        if acc not in cache:
            raw = (s.RAW / "filings" / str(paths[acc]) / f"{acc}.htm").read_bytes()
            cache[acc] = ((s.RAW / "text" / f"{acc}.txt").read_text(), independent_text(raw))
        out.append(check_claim(*cache[acc], c))
    return out


def plain_sector_stats(prices: pd.DataFrame, ticker: str, sector: str) -> tuple[float, float]:
    """Beta and correlation written out with plain pandas, separate from graph.sector_edges."""
    r = prices.sort_index().pct_change().iloc[1:]
    peers = r[[t for t in SECTORS[sector]["tickers"] if t != ticker]].mean(axis=1)
    return r[ticker].cov(peers) / peers.var(), r[ticker].corr(peers)


def _svg(con) -> str:
    W, H = 1100, 760
    hubs = {"semis": (300, 260), "equipment": (800, 260), "hardware": (550, 600)}
    pos = {}
    for sec, (hx, hy) in hubs.items():
        pos[f"sector:{sec}"] = (hx, hy)
        tick = SECTORS[sec]["tickers"]
        for i, t in enumerate(tick):
            a = 2 * math.pi * i / len(tick) - math.pi / 2
            pos[t] = (hx + 120 * math.cos(a), hy + 120 * math.sin(a))
    reviewed = "review" in [r[0] for r in con.execute("SHOW TABLES").fetchall()]
    shown = ("SELECT e.* FROM edge e JOIN review r USING (edge_id) WHERE r.verdict = 'correct'"
             if reviewed else "SELECT * FROM edge")
    ext = [r[0] for r in con.execute(
        f"SELECT DISTINCT x FROM (SELECT src x FROM ({shown}) UNION SELECT dst FROM ({shown})) "
        "WHERE x LIKE 'x:%' ORDER BY 1").fetchall()]
    for i, x in enumerate(ext):
        a = 2 * math.pi * i / max(len(ext), 1)
        pos[x] = (550 + 500 * math.cos(a), 400 + 340 * math.sin(a))
    names = dict(con.execute("SELECT entity_id, name FROM entity").fetchall())
    q = f"SELECT src, dst, edge_type, evidence_count FROM ({shown})"
    parts = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Ripple starter graph">',
             '<defs><marker id="arr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" '
             'orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#2563eb"/></marker></defs>']
    for src, dst, typ, n in con.execute(q).fetchall():
        if src in pos and dst in pos:
            (x1, y1), (x2, y2) = pos[src], pos[dst]
            mk = ' marker-end="url(#arr)"' if typ == "SUPPLIES" else ""
            parts.append(f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{x2:.0f}" y2="{y2:.0f}" stroke="{COLORS[typ]}" '
                         f'stroke-opacity=".55" stroke-width="{1 + min(n, 4) * 0.6:.1f}"{mk}><title>{_e(names.get(src, src))} '
                         f'{typ} {_e(names.get(dst, dst))} ({n} citations)</title></line>')
    for r in con.execute("SELECT ticker, sector, beta, corr FROM sector_edge").fetchall():
        t, sec, beta, corr = r
        (x1, y1), (x2, y2) = pos[t], pos[f"sector:{sec}"]
        parts.append(f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{x2:.0f}" y2="{y2:.0f}" stroke="{SECTOR_COLORS[sec]}" '
                     f'stroke-width="{max(corr, 0) * 9:.1f}" stroke-opacity=".35"><title>{t} → {sec}: '
                     f'beta {beta:.2f}, corr {corr:.2f}</title></line>')
    for sec, (x, y) in hubs.items():
        parts.append(f'<circle cx="{x}" cy="{y}" r="34" fill="{SECTOR_COLORS[sec]}"/>'
                     f'<text x="{x}" y="{y + 4}" text-anchor="middle" class="hub">{HUB_LABEL[sec]}</text>')
    for node, (x, y) in pos.items():
        if node.startswith("sector:"):
            continue
        ext_node = node.startswith("x:")
        parts.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{14 if ext_node else 20}" class="{"ext" if ext_node else "co"}"/>'
                     f'<text x="{x:.0f}" y="{y + 4:.0f}" text-anchor="middle" class="lbl">'
                     f'{_e(names.get(node, node) if ext_node else node)}</text>')
    parts.append("</svg>")
    return "".join(parts)


def write_report(con: duckdb.DuckDBPyConnection, out: Path) -> Path:
    checks = quote_checks(con)
    n_claims = len(checks)
    indep_ok = sum(c["independent"] and c["mention_in_quote"] and c["value_in_quote"] for c in checks)
    stored_ok = sum(c["at_offsets"] for c in checks)
    edges = con.execute("SELECT count(*) FROM edge").fetchone()[0]
    has_review = "review" in [r[0] for r in con.execute("SHOW TABLES").fetchall()]
    if has_review:
        v = dict(con.execute("SELECT verdict, count(*) FROM edge JOIN review USING (edge_id) GROUP BY 1").fetchall())
        reviewed = sum(v.values())
        precision = v.get("correct", 0) / reviewed if reviewed else None
        by_type = con.execute("""SELECT edge_type, count(*) n, sum((verdict='correct')::int) ok
                                 FROM edge JOIN review USING (edge_id) GROUP BY 1 ORDER BY 1""").fetchall()
    se = con.execute("SELECT * FROM sector_edge ORDER BY sector, ticker").df()
    own_best = sum(row[f"corr_{row['sector']}"] >= max(row[f"corr_{k}"] for k in SECTORS) for _, row in se.iterrows())
    pc = con.execute("SELECT * FROM price_check ORDER BY ticker").df()
    pc_ok = pc[pc.status == "OK"]

    # recompute every sector link with separate plain-pandas code, from the cached price file
    px = s.prices(list(se.ticker), offline=True)
    max_dev = max(max(abs(b - r.beta), abs(c - r["corr"]))
                  for _, r in se.iterrows() for b, c in [plain_sector_stats(px, r.ticker, r.sector)])

    h = [f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Ripple Starter Graph</title><style>
:root{{--bg:#fff;--fg:#111827;--mut:#6b7280;--line:#e5e7eb;--card:#f9fafb;--ok:#15803d;--bad:#b91c1c}}
@media (prefers-color-scheme: dark){{:root{{--bg:#0b0f17;--fg:#e5e7eb;--mut:#9ca3af;--line:#1f2937;--card:#111827;--ok:#4ade80;--bad:#f87171}}}}
body{{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1150px;padding:16px}}
h1{{margin:.2em 0}} h2{{margin-top:2em;border-bottom:1px solid var(--line)}} .mut{{color:var(--mut)}}
.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}}
.big{{font-size:28px;font-weight:700}} table{{border-collapse:collapse;width:100%;font-size:13px}}
td,th{{border-bottom:1px solid var(--line);padding:6px;text-align:left;vertical-align:top}}
.scroll{{overflow-x:auto}} svg{{width:100%;height:auto;background:var(--card);border-radius:10px}}
svg .co{{fill:var(--bg);stroke:var(--fg);stroke-width:1.5}} svg .ext{{fill:var(--card);stroke:var(--mut);stroke-dasharray:3 2}}
svg .lbl{{font-size:11px;fill:var(--fg)}} svg .hub{{font-size:12px;fill:#fff;font-weight:700}}
.ok{{color:var(--ok);font-weight:600}} .bad{{color:var(--bad);font-weight:600}} q{{font-style:italic}}
a{{color:#2563eb}} .legend span{{margin-right:14px}}
</style></head><body>
<h1>Ripple: starter graph</h1>
<p class="mut">3 sectors × 5 companies. Company↔company links come only from each company's latest 10-K, with the exact sentence.
Company→sector links come only from one year of daily prices. Every row links back to its source.</p>

<h2>Truth scorecard</h2><div class="cards">
<div class="card"><div class="big">{indep_ok}/{n_claims}</div>filing quotes found in the original SEC document by a second, independent parser, with the company name (and any %) inside the quote.
<span class="mut">Storage check: {stored_ok}/{n_claims} quotes sit exactly at their stored position.</span></div>"""]
    if has_review:
        h.append(f"""<div class="card"><div class="big">{precision:.0%}</div>of {reviewed} filing links judged correct on review
(the sentence really states that relationship). <b>In-sample and not independent:</b> the extraction rules were tuned on these same links, and the same model built and reviewed them. Re-check any row via its link.</div>""")
    h.append(f"""<div class="card"><div class="big">{max_dev:.1e}</div>max difference between stored sector beta/corr and a recomputation by separate plain-pandas code from the cached price file</div>
<div class="card"><div class="big">{own_best}/{len(se)}</div>companies that correlate more with their own sector than with either other sector</div>
<div class="card"><div class="big">{pc_ok.agree_share.mean():.0%}</div>of trading days where Yahoo and Nasdaq daily returns agree within 0.1pp ({len(pc_ok)}/{len(pc)} tickers checked; differences are dividend days, since Nasdaq is unadjusted)</div>
</div>""")
    if has_review:
        h.append("<p>Precision by link type: " + "; ".join(f"{t}: {ok}/{n}" for t, n, ok in by_type) + "</p>")

    evals = [(name, ROOT_DATA / f) for name, f in [("Jev, quote only", "eval_jev_labels.json"),
                                                    ("Jev, quote + 500 chars before", "eval_jev_labels_ctx500.json")]]
    evals = [(n, json.loads(f.read_text())) for n, f in evals if f.exists()]
    if evals:
        base = evals[-1][1]
        h.append(f"""<h2>Question benchmark (BEAM-style)</h2>
<p class="mut">{base['questions']} questions like "According to Lam's 10-K, who are its most significant customers?", each with a gold answer set
(<a href="../eval/gold.jsonl">eval/gold.jsonl</a>). Score per question: 1 = exactly right, 0.5 = partly right, 0 = nothing right.
<b>Caveat:</b> the gold answers were written by Claude from the cited passages, so the "reviewed" row is not independent and its precision is circular.
Some gold answers (UMC, Meta, "Global Foundries", "Hewlett-Packard Enterprise") use names the extractor can't match yet, which caps recall.</p>
<div class="scroll"><table><tr><th>Graph</th><th>BEAM score</th><th>Mean F1</th><th>Precision</th><th>Recall</th></tr>""")
        rows = [("Keyword links (raw)", base["variants"]["raw"])] + [(n, e["variants"]["jev"]) for n, e in evals] + \
               [("Reviewed links", base["variants"]["reviewed"])]
        for n, v in rows:
            h.append(f"<tr><td>{n}</td><td>{v['beam_score']:.2f}</td><td>{v['mean_f1']:.2f}</td>"
                     f"<td>{v['micro_precision']:.2f}</td><td>{v['micro_recall']:.2f}</td></tr>")
        h.append("</table></div><p>Jev as a judge of the keyword links, against the review: " + "; ".join(
            f"{n}: agreement {e['jev_vs_review']['agreement']:.0%}, Brier {e['jev_vs_review']['brier']:.2f}, "
            f"ECE {e['jev_vs_review']['ece']:.2f}" for n, e in evals) + ".</p>")

    h.append(f"""<h2>The graph</h2><p class="legend mut"><span style="color:{COLORS['SUPPLIES']}">→ supplies</span>
<span style="color:{COLORS['COMPETES_WITH']}">— competes</span><span style="color:{COLORS['PARTNERS']}">— partners</span>
<span>thick translucent spokes = company→sector (width = price correlation)</span><span>dashed = outside the universe</span>
{"<span>only links judged correct are drawn</span>" if has_review else ""}</p>{_svg(con)}""")

    h.append("""<h2>Company → sector links (from prices)</h2>
<p class="mut">Sector return = equal-weight average of the other 4 members (the company itself is left out).
Beta = how much the company moves per 1% sector move. Corr = how consistently it follows. 250 trading days.<br>
Verify yourself: the exact prices used are in <a href="raw/prices_yahoo.csv">raw/prices_yahoo.csv</a>.
<code>r = prices.pct_change(); peers = r[other 4 tickers].mean(axis=1); beta = r[t].cov(peers) / peers.var(); corr = r[t].corr(peers)</code></p>
<div class="scroll"><table><tr><th>Company</th><th>Sector</th><th>Beta</th><th>Corr</th><th>Corr: semis</th><th>Corr: equipment</th>
<th>Corr: hardware</th><th>Days</th><th>Price sources</th><th>Cross-check</th></tr>""")
    for _, r in se.iterrows():
        best = max(SECTORS, key=lambda k: r[f"corr_{k}"])
        p = pc[pc.ticker == r.ticker].iloc[0]
        cc = (f'<span class="{"ok" if p.agree_share > .9 else "bad"}">{p.agree_share:.0%} days agree</span>'
              if p.status == "OK" else "NOT_RUN")
        h.append(f"<tr><td>{r.ticker}</td><td>{_e(SECTORS[r.sector]['name'])}</td><td>{r.beta:.2f}</td><td>{r['corr']:.2f}</td>" +
                 "".join(f"<td{' class=ok' if k == best else ''}>{r[f'corr_{k}']:.2f}</td>" for k in SECTORS) +
                 f"<td>{r.n_days}</td><td><a href='{p.yahoo_url}'>Yahoo</a> · <a href='{p.nasdaq_url}'>Nasdaq</a></td><td>{cc}</td></tr>")
    h.append("</table></div>")

    h.append("""<h2>Company ↔ company links (from 10-K filings)</h2>
<p class="mut">“Open at quote” opens the SEC filing in a new tab, scrolled to the quote's first words (Chrome/Edge/Safari text fragments; tested on a prose sentence, a table and a bullet list). If it doesn't scroll, use Ctrl/Cmd+F with the quote.</p>
<div class="scroll"><table><tr><th>Link</th><th>Type</th><th>Cited</th><th>Revenue share</th><th>Review</th><th>Evidence (first quote)</th><th>Source</th></tr>""")
    names = dict(con.execute("SELECT entity_id, name FROM entity").fetchall())
    rows = con.execute(f"""
        SELECT e.edge_id, e.src, e.dst, e.edge_type, e.evidence_count, e.weight, e.weight_kind, {"r.verdict, r.reason" if has_review else "NULL, NULL"},
               c.quote, c.link, c.filing_url, c.filer
        FROM edge e {"LEFT JOIN review r USING (edge_id)" if has_review else ""}
        JOIN (SELECT *, row_number() OVER (PARTITION BY edge_id ORDER BY char_start) rn FROM claim) c
          ON c.edge_id = e.edge_id AND c.rn = 1
        ORDER BY e.edge_type, e.src, e.dst""").fetchall()
    for eid, src, dst, typ, n, w, wk, verdict, reason, quote, link, furl, filer in rows:
        arrow = "→" if typ == "SUPPLIES" else "↔"
        vcls = "ok" if verdict == "correct" else "bad" if verdict else "mut"
        h.append(f"<tr><td>{_e(names.get(src, src))} {arrow} {_e(names.get(dst, dst))}</td><td>{typ}</td><td>{n}</td><td>{"" if w is None else ("≥" if wk == "lower_bound" else "") + f"{w:.0%}"}</td>"
                 f"<td class='{vcls}'>{_e(verdict or 'unreviewed')}<div class='mut'>{_e(reason)}</div></td>"
                 f"<td><q>{_e(quote[:400])}{'…' if len(quote) > 400 else ''}</q></td>"
                 f"<td><a href='{_e(link)}' target='_blank' rel='noopener'>Open at quote</a><br><a href='{_e(furl)}'>{_e(filer)} 10-K</a></td></tr>")
    h.append("</table></div>")

    h.append("<h2>Filings and revenue (SEC XBRL)</h2><div class='scroll'><table><tr><th>Company</th><th>10-K period</th><th>Revenue</th><th>XBRL concept</th><th>Links found</th><th>Sources</th></tr>")
    for t, period, url, val, concept, rurl, nlinks in con.execute(
            "SELECT f.ticker, f.period_end, f.url, r.value, r.concept, r.source_url, "
            "(SELECT count(DISTINCT edge_id) FROM claim c WHERE c.filer = f.ticker) FROM filing f "
            "LEFT JOIN revenue r USING (ticker) ORDER BY f.ticker").fetchall():
        h.append(f"<tr><td>{t}</td><td>{period}</td><td>${(val or 0) / 1e9:,.1f}B</td><td>{_e(concept)}</td><td>{nlinks}</td>"
                 f"<td><a href='{url}'>10-K</a> · <a href='{_e(rurl)}'>XBRL filing</a></td></tr>")
    h.append("</table></div>")

    h.append("""<h2>Known limits</h2><ul>
<li>Extraction is keyword-and-name matching, with no LLM: it finds sentences, then guesses the link type from the nearest keyword. The review column measures how often that guess is right.</li>
<li>Recall (relationships that exist but were missed) is not measured yet. Companies that only say "Customer A" can't be linked by name.</li>
<li>Revenue-share sizes exist for only a few links. Nearly all concentration disclosures are for unnamed customers ("two customers accounted for 19% and 15%"); only Entegris→TSMC (16%), KLA→TSMC (&gt;10%) and Qualcomm→Apple/Samsung (≥10%) are named.</li>
<li>Some companies contributed no links from their own filing (0 in the "Links found" column below): their 10-Ks name few counterparties, or name them in ways the matcher doesn't catch.</li>
<li>Sector membership is hand-assigned; prices only measure how strongly each company follows it.</li></ul>
</body></html>""")
    out.write_text("".join(h))
    return out
