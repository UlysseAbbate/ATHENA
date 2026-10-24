"""Shared helpers for the ingestion scripts run by GitHub Actions."""

import json
import os
import re
import time
from pathlib import Path

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
})

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


def require_env(*names):
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        raise SystemExit(f"Missing environment variables: {', '.join(missing)}")


def http_get(url, *, binary=False, retries=3, delay=1.0):
    """GET with retries and a polite pause between requests."""
    for attempt in range(retries):
        try:
            res = SESSION.get(url, timeout=60)
            if res.status_code == 200:
                time.sleep(delay)
                return res.content if binary else res.text
            if res.status_code in (401, 403, 404):
                print(f"  ! {res.status_code} for {url}")
                return None
        except requests.RequestException as exc:
            print(f"  ! {exc} (attempt {attempt + 1})")
        time.sleep(2 * (attempt + 1))
    return None


def _headers(extra=None):
    h = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    h.update(extra or {})
    return h


def sb_select(table, query=""):
    res = SESSION.get(f"{SUPABASE_URL}/rest/v1/{table}?{query}", headers=_headers(), timeout=60)
    res.raise_for_status()
    return res.json()


def sb_insert(table, rows, *, upsert_on=None, returning=False):
    if not rows:
        return []
    prefer = ["return=representation" if returning else "return=minimal"]
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if upsert_on:
        prefer.append("resolution=merge-duplicates")
        url += f"?on_conflict={upsert_on}"
    res = SESSION.post(url, headers=_headers({"Prefer": ",".join(prefer)}), json=rows, timeout=120)
    if res.status_code >= 300:
        raise RuntimeError(f"Supabase insert into {table} failed: {res.status_code} {res.text[:500]}")
    return res.json() if returning else []


def sb_update(table, query, values):
    res = SESSION.patch(f"{SUPABASE_URL}/rest/v1/{table}?{query}", headers=_headers({"Prefer": "return=minimal"}), json=values, timeout=60)
    if res.status_code >= 300:
        raise RuntimeError(f"Supabase update of {table} failed: {res.status_code} {res.text[:500]}")


def sb_delete(table, query):
    res = SESSION.delete(f"{SUPABASE_URL}/rest/v1/{table}?{query}", headers=_headers(), timeout=60)
    if res.status_code >= 300:
        raise RuntimeError(f"Supabase delete from {table} failed: {res.status_code} {res.text[:500]}")


# The portfolios live in lib/libby/portfolios-data.js, shared with the website (lib/libby/portfolios.js): edit the keywords there, once.
# The file is "export default" followed by plain JSON, so it is read here by cutting off the JavaScript wrapper.
def _load_js_data(path):
    text = Path(path).read_text(encoding="utf-8")
    marker = "\nexport default "  # at the start of a line: the comments above also use these words
    return json.loads(text[text.index(marker) + len(marker):].strip().rstrip(";"))


_PORTFOLIOS = _load_js_data(Path(__file__).resolve().parents[2] / "lib" / "libby" / "portfolios-data.js")
PORTFOLIO_KEYWORDS = {p["code"]: [k.strip().lower() for k in p["keywords"]] for p in _PORTFOLIOS["portfolios"]}
PORTFOLIO_CODES = list(PORTFOLIO_KEYWORDS)
CATCH_ALL = _PORTFOLIOS["catchAll"]  # where something that matches nothing goes, so a document is never left without a portfolio


def _scores(text):
    t = " " + re.sub(r"\s+", " ", text.lower()) + " "
    scores = {}
    for code, words in PORTFOLIO_KEYWORDS.items():
        s = sum(t.count(" " + w) for w in words)
        if s:
            scores[code] = s
    return scores


def keyword_portfolios(text, max_n=3, title=""):
    """Up to max_n portfolio codes by keyword, best first. The title counts three times (it is always readable, which
    the text of a scanned PDF often is not). Never empty: a document that matches nothing gets the catch-all."""
    scores = _scores(text)
    for code, n in _scores(title).items():
        scores[code] = scores.get(code, 0) + 3 * n
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    top = ranked[0][1] if ranked else 0
    # Keep portfolios scoring at least a third of the best match.
    chosen = [c for c, s in ranked[:max_n] if s >= max(2, top / 3)] or [c for c, _ in ranked[:1]]
    return chosen or [CATCH_ALL]
