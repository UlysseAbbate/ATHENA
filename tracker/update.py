"""Collector for the policy tracker.

Gathers: select committee publications, think tank outputs, Lib Dem media
coverage and polling. Writes JSON into site/data/ for the static front end.

Run:  python tracker/update.py
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote_plus, urljoin, urlparse

import feedparser
import requests
import yaml
from bs4 import BeautifulSoup
from dateutil import parser as dtparse

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "data"
CONFIG = yaml.safe_load((ROOT / "config" / "sources.yml").read_text())
NOW = datetime.now(timezone.utc)
KEEP_DAYS = 180

UA = {"User-Agent": "Mozilla/5.0 (compatible; PolicyTracker/1.0; personal research tool)"}
S = requests.Session()
S.headers.update(UA)

health: list[dict] = []


# ----------------------------------------------------------------- helpers
def get(url: str, **kw) -> requests.Response:
    last = None
    for attempt in range(2):
        try:
            r = S.get(url, timeout=25, **kw)
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5)
    raise last  # type: ignore[misc]


def parse_date(v) -> datetime | None:
    if not v:
        return None
    try:
        d = v if isinstance(v, datetime) else dtparse.parse(str(v))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.astimezone(timezone.utc)
    except Exception:  # noqa: BLE001
        return None


def clean(s: str | None, n: int = 400) -> str:
    if not s:
        return ""
    s = BeautifulSoup(s, "lxml").get_text(" ", strip=True)
    s = re.sub(r"\s+", " ", s)
    return s[:n]


def make_item(category, source, title, url, published, summary="", tags=None):
    return {
        "id": hashlib.sha1(url.encode()).hexdigest()[:16],
        "category": category,
        "source": source,
        "title": clean(title, 300),
        "url": url,
        "published": published.isoformat() if published else None,
        "summary": clean(summary),
        "tags": tags or [],
    }


def record(group, name, ok, n, err=""):
    health.append({"group": group, "name": name, "ok": ok, "items": n, "error": str(err)[:200]})


# ------------------------------------------------------------- committees
def collect_committees() -> list[dict]:
    cfg = CONFIG["committees"]
    start = (NOW - timedelta(days=cfg["lookback_days"])).strftime("%Y-%m-%d")
    items: list[dict] = []
    try:
        skip, take = 0, 100
        while skip < 600:
            r = get(cfg["api"], params={"StartDate": start, "Take": take, "Skip": skip})
            js = r.json()
            rows = js.get("items") or js.get("results") or (js if isinstance(js, list) else [])
            if not rows:
                break
            for row in rows:
                it = _committee_row(row, cfg["keep_types"])
                if it:
                    items.append(it)
            if len(rows) < take:
                break
            skip += take
        record("committees", "Parliament Committees API", True, len(items))
    except Exception as e:  # noqa: BLE001
        record("committees", "Parliament Committees API", False, 0, e)
    return items


def _first(d: dict, *keys):
    for k in keys:
        v = d.get(k)
        if v not in (None, "", []):
            return v
    return None


def _committee_row(row: dict, keep_types: list[str]) -> dict | None:
    """The API's exact field names are not guaranteed, so read defensively."""
    pid = _first(row, "id", "publicationId")
    ptype = _first(row, "publicationType", "type") or {}
    ptype_name = ptype.get("name") if isinstance(ptype, dict) else str(ptype)
    if keep_types and not any(k in (ptype_name or "").lower() for k in keep_types):
        return None
    title = _first(row, "description", "title", "name") or "Untitled publication"
    date = parse_date(_first(row, "publicationStartDate", "publicationDate", "startDate", "date"))
    committees = row.get("committee") or row.get("committees") or []
    if isinstance(committees, dict):
        committees = [committees]
    names = [c.get("name") for c in committees if isinstance(c, dict) and c.get("name")]
    inquiry = row.get("businesses") or row.get("inquiry") or []
    url = f"https://committees.parliament.uk/publications/{pid}/" if pid else None
    if not url:
        return None
    house = ""
    for c in committees:
        h = (c.get("house") if isinstance(c, dict) else "") or ""
        if h:
            house = h if isinstance(h, str) else str(h)
    tags = [t for t in [ptype_name, house] if t]
    return make_item("committee", ", ".join(names) or "Parliamentary committee", title, url, date,
                     summary="", tags=tags)


# -------------------------------------------------------------- think tanks
FEED_SUFFIXES = ["feed", "feed/", "rss", "rss.xml", "feed.xml", "atom.xml"]


def _feed_entries(feed_url: str):
    d = feedparser.parse(feed_url, request_headers=UA)
    return d.entries if d.entries else []


def discover_feeds(page_url: str, html: str) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    out = []
    for link in soup.find_all("link", attrs={"rel": "alternate"}):
        t = (link.get("type") or "").lower()
        if "rss" in t or "atom" in t:
            out.append(urljoin(page_url, link.get("href", "")))
    base = f"{urlparse(page_url).scheme}://{urlparse(page_url).netloc}/"
    out += [urljoin(page_url.rstrip("/") + "/", s) for s in FEED_SUFFIXES]
    out += [urljoin(base, s) for s in FEED_SUFFIXES]
    seen, uniq = set(), []
    for u in out:
        if u and u not in seen:
            seen.add(u)
            uniq.append(u)
    return uniq


def scrape_links(page_url: str, html: str, limit: int = 30):
    """Fallback: pull plausible publication links from a listing page."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["nav", "footer", "header", "script", "style", "aside"]):
        tag.decompose()
    host = urlparse(page_url).netloc.replace("www.", "")
    seen, rows = set(), []
    for a in soup.find_all("a", href=True):
        text = re.sub(r"\s+", " ", a.get_text(" ", strip=True))
        href = urljoin(page_url, a["href"])
        p = urlparse(href)
        if len(text) < 25 or len(text.split()) < 4:
            continue
        if host not in p.netloc.replace("www.", "") and not p.netloc.endswith(host.split(".", 1)[-1]):
            continue
        if p.path.rstrip("/") == urlparse(page_url).path.rstrip("/") or p.path.count("/") < 2:
            continue
        if href in seen:
            continue
        seen.add(href)
        date = None
        container = a.find_parent(["article", "li", "div"])
        if container:
            t = container.find("time")
            if t:
                date = parse_date(t.get("datetime") or t.get_text())
        rows.append((text, href, date))
        if len(rows) >= limit:
            break
    return rows


def collect_thinktank(tt: dict) -> list[dict]:
    name, url = tt["name"], tt["url"]
    items: list[dict] = []
    try:
        feeds = [tt["feed"]] if tt.get("feed") else []
        html = ""
        try:
            html = get(url).text
        except Exception as e:  # noqa: BLE001
            if not feeds:
                raise e
        if not feeds and html:
            feeds = discover_feeds(url, html)
        method = ""
        for f in feeds:
            try:
                entries = _feed_entries(f)
            except Exception:  # noqa: BLE001
                continue
            if entries:
                for e in entries[:40]:
                    link = e.get("link")
                    if not link:
                        continue
                    d = parse_date(e.get("published") or e.get("updated"))
                    items.append(make_item("thinktank", name, e.get("title", ""), link, d,
                                           e.get("summary", "")))
                method = "feed"
                break
        if not items and html:
            for text, href, d in scrape_links(url, html):
                items.append(make_item("thinktank", name, text, href, d))
            method = "html"
        record("thinktanks", name, bool(items), len(items),
               "" if items else "no feed or listing links found")
        if items:
            health[-1]["method"] = method
    except Exception as e:  # noqa: BLE001
        record("thinktanks", name, False, 0, e)
    return items


# ------------------------------------------------------------------- media
def google_news(query: str, lookback: str):
    q = f"{query} when:{lookback}"
    url = ("https://news.google.com/rss/search?q=" + quote_plus(q) +
           "&hl=en-GB&gl=GB&ceid=GB:en")
    return feedparser.parse(url, request_headers=UA).entries


def collect_media() -> list[dict]:
    cfg = CONFIG["media"]
    kw = "(" + " OR ".join(cfg["keywords"]) + ")"
    items = []
    for o in cfg["outlets"]:
        try:
            entries = google_news(f"{kw} site:{o['domain']}", cfg["lookback"])
            n = 0
            for e in entries[:25]:
                title = re.sub(r"\s+-\s+[^-]+$", "", e.get("title", ""))
                items.append(make_item("media", o["name"], title, e.get("link", ""),
                                       parse_date(e.get("published")), ""))
                n += 1
            record("media", o["name"], n > 0, n, "" if n else "no results")
        except Exception as e:  # noqa: BLE001
            record("media", o["name"], False, 0, e)
    return items


# ----------------------------------------------------------------- polling
TAG_RULES = [
    ("voting-intention", r"voting intention|vote intention|westminster|would vote|general election poll|poll of polls"),
    ("party-support", r"support for|favourab|approval|leader rating|best prime minister|trust|party"),
    ("news-cycle", r"news tracker|news stories|memorable|noticed|in the news|salience|top issues|important issues"),
]


def poll_tags(text: str) -> list[str]:
    t = text.lower()
    return [tag for tag, pat in TAG_RULES if re.search(pat, t)]


def collect_poll_articles() -> list[dict]:
    cfg = CONFIG["polling"]
    terms = "(" + " OR ".join(cfg["search_terms"]) + ")"
    items = []
    for f in cfg["firms"]:
        try:
            entries = google_news(f"{terms} site:{f['domain']}", cfg["lookback"])
            n = 0
            for e in entries[:20]:
                title = re.sub(r"\s+-\s+[^-]+$", "", e.get("title", ""))
                tags = poll_tags(title) or ["poll"]
                items.append(make_item("polling", f["name"], title, e.get("link", ""),
                                       parse_date(e.get("published")), "", tags))
                n += 1
            record("polling", f["name"], n > 0, n, "" if n else "no results")
        except Exception as e:  # noqa: BLE001
            record("polling", f["name"], False, 0, e)
    for d in cfg.get("direct", []):
        try:
            html = get(d["url"]).text
            rows = [r for r in scrape_links(d["url"], html, 40) if poll_tags(r[0]) or "poll" in r[0].lower()]
            for text, href, date in rows:
                items.append(make_item("polling", d["name"], text, href, date, "", poll_tags(text) or ["poll"]))
            record("polling", f"{d['name']} (direct)", bool(rows), len(rows), "" if rows else "no matching links")
        except Exception as e:  # noqa: BLE001
            record("polling", f"{d['name']} (direct)", False, 0, e)
    return items


PARTY_ALIASES = {
    "con": "Con", "conservative": "Con", "conservatives": "Con",
    "lab": "Lab", "labour": "Lab",
    "ref": "Reform", "reform": "Reform", "reform uk": "Reform",
    "ld": "LD", "lib dem": "LD", "lib dems": "LD", "liberal democrats": "LD",
    "grn": "Green", "green": "Green", "greens": "Green",
    "snp": "SNP",
}


def collect_vi_table() -> list[dict]:
    """Voting intention from the Wikipedia polling table (structured, BPC-firm rows)."""
    import pandas as pd
    from io import StringIO

    url = CONFIG["polling"]["wikipedia_page"]
    try:
        html = get(url).text
        tables = pd.read_html(StringIO(html), match="Pollster")
        df = tables[0]
        df.columns = [" ".join(str(c) for c in (col if isinstance(col, tuple) else (col,))
                               if not str(c).startswith("Unnamed")).strip().lower()
                      if True else col for col in df.columns]
        # collapse duplicated multi-index labels like "con con"
        df.columns = [" ".join(dict.fromkeys(c.split())) for c in df.columns]
        col_of = {}
        for c in df.columns:
            if "pollster" in c:
                col_of["pollster"] = c
            elif "date" in c:
                col_of["dates"] = c
            elif "sample" in c:
                col_of["sample"] = c
            else:
                key = PARTY_ALIASES.get(c.split()[0]) or PARTY_ALIASES.get(c)
                if key and key not in col_of:
                    col_of[key] = c
        rows = []
        for _, r in df.iterrows():
            dates = str(r.get(col_of.get("dates"), ""))
            m = re.findall(r"\d{1,2}\s+\w+\s+\d{4}|\d{1,2}\s*[–-]\s*\d{1,2}\s+\w+(?:\s+\d{4})?|\d{1,2}\s+\w+", dates)
            end = None
            if dates:
                tail = re.sub(r"\[.*?\]", "", dates).split("–")[-1].split("-")[-1].strip()
                end = parse_date(tail) or parse_date(re.sub(r"\[.*?\]", "", dates))
            row = {"pollster": re.sub(r"\[.*?\]", "", str(r.get(col_of.get("pollster"), ""))).strip(),
                   "dates": re.sub(r"\[.*?\]", "", dates).strip(),
                   "end": end.date().isoformat() if end else None,
                   "sample": str(r.get(col_of.get("sample"), ""))}
            for p in ["Con", "Lab", "Reform", "LD", "Green", "SNP"]:
                v = r.get(col_of.get(p))
                try:
                    row[p] = float(str(v).replace("%", ""))
                except (TypeError, ValueError):
                    row[p] = None
            if row["pollster"] and any(row[p] is not None for p in ["Con", "Lab", "Reform", "LD"]):
                rows.append(row)
        rows = rows[:300]
        record("polling", "Wikipedia VI table", bool(rows), len(rows), "" if rows else "table not parsed")
        return rows
    except Exception as e:  # noqa: BLE001
        record("polling", "Wikipedia VI table", False, 0, e)
        return []


# -------------------------------------------------------------------- main
def merge(new_items: list[dict]) -> list[dict]:
    path = DATA / "feed.json"
    old = {}
    if path.exists():
        try:
            old = {i["id"]: i for i in json.loads(path.read_text()).get("items", [])}
        except Exception:  # noqa: BLE001
            old = {}
    now_iso = NOW.isoformat()
    for it in new_items:
        if not it["url"]:
            continue
        prev = old.get(it["id"])
        it["first_seen"] = prev["first_seen"] if prev else now_iso
        old[it["id"]] = {**(prev or {}), **it}
    cutoff = NOW - timedelta(days=KEEP_DAYS)
    kept = []
    for it in old.values():
        d = parse_date(it.get("published")) or parse_date(it.get("first_seen")) or NOW
        if d >= cutoff:
            kept.append(it)
    kept.sort(key=lambda i: i.get("published") or i["first_seen"], reverse=True)
    return kept


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])  # e.g. `update.py media polling`
    run = lambda k: not only or k in only  # noqa: E731
    items: list[dict] = []
    if run("committees"):
        items += collect_committees()
    if run("thinktanks"):
        for tt in CONFIG["thinktanks"]:
            items += collect_thinktank(tt)
    if run("media"):
        items += collect_media()
    if run("polling"):
        items += collect_poll_articles()
        (DATA / "polls.json").write_text(json.dumps(
            {"updated": NOW.isoformat(), "rows": collect_vi_table()}, indent=1))
    feed = merge(items)
    (DATA / "feed.json").write_text(json.dumps({"updated": NOW.isoformat(), "items": feed}, indent=1))
    (DATA / "health.json").write_text(json.dumps({"updated": NOW.isoformat(), "sources": health}, indent=1))
    ok = sum(h["ok"] for h in health)
    print(f"{len(feed)} items stored; {ok}/{len(health)} sources returned data")
    return 0


if __name__ == "__main__":
    sys.exit(main())
