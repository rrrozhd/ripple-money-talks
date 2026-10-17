"""Turn cached raw data into graph rows: filing edges (company <-> company) and sector edges (company -> sector)."""

import re
import warnings
from urllib.parse import quote as urlquote

import numpy as np
import pandas as pd
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

from .universe import ALIASES, SECTORS, TICKER_SECTOR

# ---------- filing text ----------

def filing_text(html: bytes) -> str:
    """Visible text of a 10-K, whitespace-normalised. Hidden iXBRL header blocks are dropped."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup.find_all(["ix:header", "script", "style"]):
        tag.decompose()
    for tag in soup.find_all(style=re.compile(r"display:\s*none")):
        tag.decompose()
    text = soup.get_text(" ")
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


ABBREV = re.compile(r"\b(?:Inc|Co|Ltd|Corp|Corporation|N\.V|S\.A|L\.P|LLC|plc|U\.S|e\.g|i\.e|No|St)\.$")
# Executive bios ("he served 18 years with KLA-Tencor, a supplier of...") are not company relationships
BIO = re.compile(r"\b(?:he|she) (?:served|held|was|worked|joined)\b|prior to joining|where (?:he|she)\b|"
                 r"served \d+ years|Chief (?:Executive|Financial|Operating|Technology) Officer of", re.IGNORECASE)


def sentences(text: str):
    """Yield (start, end) char spans of sentences; long list-sentences are kept whole."""
    start = 0
    for m in re.finditer(r"(?<=[.!?])\s+(?=[A-Z(“\"])", text):
        if ABBREV.search(text, max(0, m.start() - 6), m.start()):
            continue  # "Inc." / "Co." / "Ltd." inside a company list is not a sentence end
        yield start, m.start()
        start = m.end()
    yield start, len(text)


def _alias_patterns():
    pats = []
    for eid, (_, aliases) in ALIASES.items():
        for alias, cs in aliases:
            flags = 0 if cs else re.IGNORECASE
            pats.append((eid, re.compile(rf"(?<![A-Za-z0-9]){re.escape(alias)}(?![A-Za-z0-9])", flags)))
    return pats


ALIAS_PATTERNS = _alias_patterns()

# Relation keywords. The keyword nearest to the counterparty's mention decides the type.
RELATION_KEYWORDS = {
    "customer": r"customers?|accounted for|sales to|revenues? from|licensees?",
    "supplier": r"suppliers?|foundr(?:y|ies)|manufactur\w*|sole[- ]source|single[- ]source|"
                r"purchase[sd]? from|depend\w* on|rel(?:y|ies|iance) on|wafers?|vendors?",
    "competitor": r"compet\w*",
    "partner": r"partner\w*|collaborat\w*|alliance|joint venture",
}
KW_PATTERNS = {k: re.compile(rf"\b(?:{v})\b", re.IGNORECASE) for k, v in RELATION_KEYWORDS.items()}
PCT = re.compile(r"(\d{1,2}(?:\.\d)?)\s?%\s+of\s+(?:our\s+)?(?:total\s+|net\s+)?(?:revenue|sales|net revenue)",
                 re.IGNORECASE)
# "Apple, Samsung and Xiaomi each comprised 10% or more" / "more than 10% of total revenues"
PCT_FLOOR = re.compile(r"(?:(\d{1,2})\s?%\s+or more|(?:more|greater) than\s+(\d{1,2})\s?%|at least\s+(\d{1,2})\s?%)",
                       re.IGNORECASE)
REVENUE_WORD = re.compile(r"\b(?:revenues?|net sales)\b", re.IGNORECASE)
# table row right after the name: "Taiwan Semiconductor Manufacturing Company (TSMC) 16% 16% 11%"
PCT_AFTER_NAME = re.compile(r"^[^%.;]{0,30}?(\d{1,2}(?:\.\d)?)\s?%")
MAX_QUOTE = 700


def revenue_share(quote: str, mention_end: int) -> tuple[str, float, str] | None:
    """(value_text, weight, kind) for a named customer's share of revenue, if the quote states one.
    kind = 'exact' or 'lower_bound'. value_text is always a substring of the quote."""
    if not REVENUE_WORD.search(quote):
        return None
    m = PCT_FLOOR.search(quote)  # first: "more than 10% of total revenues" also matches the exact pattern
    if m:
        return m.group(0), float(next(g for g in m.groups() if g)) / 100, "lower_bound"
    m = PCT.search(quote)
    if m:
        return m.group(0), float(m.group(1)) / 100, "exact"
    m = PCT_AFTER_NAME.search(quote[mention_end:])
    if m:
        return m.group(0).strip(), float(m.group(1)) / 100, "exact"
    return None


def _quote_span(text, s, e, ms, me):
    """Whole sentence, or a window around the mention when the sentence is very long."""
    if e - s <= MAX_QUOTE:
        return s, e
    lo = max(s, ms - MAX_QUOTE // 2)
    hi = min(e, me + MAX_QUOTE // 2)
    # snap to word boundaries so the quote is readable
    lo = text.rfind(" ", s, lo) + 1 if lo > s else s
    hi_space = text.find(" ", hi, e)
    return lo, (hi_space if hi_space != -1 else e)


def extract_claims(filer: str, text: str, require_keyword: bool = True) -> list[dict]:
    """Candidate company<->company relationships stated in the filer's 10-K, each with its exact quote.
    require_keyword=False keeps every sentence that names another company (relation "unknown" when no keyword
    is near), leaving the decision to the LLM labeller; e.g. "We purchase memory from SK Hynix" has no keyword."""
    claims = []
    for s, e in sentences(text):
        sent = text[s:e]
        if BIO.search(sent):
            continue
        seen = set()
        # keyword hits inside a company name ("Taiwan Semiconductor *Manufacturing*") don't count
        name_spans = [m.span() for _, pat in ALIAS_PATTERNS for m in pat.finditer(sent)]
        inside_name = lambda k: any(a <= k.start() < b for a, b in name_spans)
        # competitor lists ("Our competitors include: suppliers of GPUs ... such as AMD") mention
        # other relationship words; any "compet*" in the sentence makes it a competitor claim
        competitive = KW_PATTERNS["competitor"].search(sent)
        for eid, pat in ALIAS_PATTERNS:
            if eid == filer or eid in seen:
                continue
            for m in pat.finditer(sent):
                ms, me = s + m.start(), s + m.end()
                best = (0, "competitor", competitive.group(0)) if competitive else None
                for rel, kp in ({} if competitive else KW_PATTERNS).items():
                    for k in kp.finditer(sent):
                        if inside_name(k):
                            continue
                        dist = min(abs(k.start() - m.start()), abs(k.end() - m.end()))
                        if best is None or dist < best[0]:
                            best = (dist, rel, k.group(0))
                if best is None or best[0] > 250:
                    if require_keyword:
                        continue
                    best = (0, "unknown", "")
                qs, qe = _quote_span(text, s, e, ms, me)
                quote = text[qs:qe]
                share = revenue_share(quote, me - qs) if best[1] in ("customer", "unknown") else None
                claims.append({
                    "filer": filer, "counterparty": eid, "relation": best[1], "keyword": best[2],
                    "mention": m.group(0), "char_start": qs, "char_end": qe, "quote": quote,
                    "value_text": share[0] if share else None,
                    "weight": share[1] if share else None,
                    "weight_kind": share[2] if share else None,
                })
                seen.add(eid)
                break  # one claim per entity per sentence
    return claims


def to_edge(c: dict) -> tuple[str, str, str]:
    """Canonical (src, dst, type): src supplies dst; competitor/partner are undirected (sorted)."""
    f, x, r = c["filer"], c["counterparty"], c["relation"]
    if r == "customer":
        return f, x, "SUPPLIES"
    if r == "supplier":
        return x, f, "SUPPLIES"
    a, b = sorted([f, x])
    return a, b, "COMPETES_WITH" if r == "competitor" else "PARTNERS"


def text_fragment_link(url: str, quote: str) -> str:
    """Link that scrolls to and highlights the quote in browsers that support text fragments."""
    # start-only: a start,end range fails when the quote spans table cells
    start = " ".join(quote.split()[:8])
    return f"{url}#:~:text={urlquote(start, safe='')}"

# ---------- sector edges from prices ----------

def returns(prices: pd.DataFrame) -> pd.DataFrame:
    return prices.sort_index().pct_change().dropna(how="all")


def sector_edges(prices: pd.DataFrame) -> pd.DataFrame:
    """Company -> own sector: beta and correlation against the leave-one-out equal-weight sector return.
    Also correlation against the other sectors, to check the sector assignment."""
    r = returns(prices)
    rows = []
    for ticker, sector in TICKER_SECTOR.items():
        own = r[ticker]
        row = {"ticker": ticker, "sector": sector}
        for sec, v in SECTORS.items():
            peers = [t for t in v["tickers"] if t != ticker]
            s = r[peers].mean(axis=1)
            both = pd.concat([own, s], axis=1).dropna()
            corr = float(np.corrcoef(both.iloc[:, 0], both.iloc[:, 1])[0, 1])
            if sec == sector:
                beta = float(np.cov(both.iloc[:, 0], both.iloc[:, 1], ddof=1)[0, 1] / both.iloc[:, 1].var(ddof=1))
                row.update(beta=beta, corr=corr, n_days=len(both))
            row[f"corr_{sec}"] = corr
        rows.append(row)
    return pd.DataFrame(rows)


def price_crosscheck(yahoo: pd.Series, nasdaq: pd.Series | None) -> dict:
    """Compare daily returns from two independent sources. Splits/dividends make unadjusted
    Nasdaq returns differ on a few days; we report the share of days that agree within 0.1pp."""
    if nasdaq is None or nasdaq.empty:
        return {"status": "NOT_RUN", "agree_share": None, "max_diff_pp": None, "n": 0}
    a = yahoo.pct_change()
    b = nasdaq.pct_change()
    both = pd.concat([a, b], axis=1, keys=["y", "n"]).dropna()
    diff = (both["y"] - both["n"]).abs() * 100
    return {"status": "OK", "agree_share": float((diff < 0.1).mean()), "max_diff_pp": float(diff.max()),
            "n": len(both)}
