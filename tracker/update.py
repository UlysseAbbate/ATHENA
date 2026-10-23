"""Collector for the policy tracker.

Gathers: select committee publications, think tank outputs, Lib Dem media
coverage and polling. Writes JSON into site/ulysse/data/ for the static front end.

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
from zoneinfo import ZoneInfo
from urllib.parse import quote_plus, urljoin, urlparse

import feedparser
import requests
import yaml
from bs4 import BeautifulSoup
from dateutil import parser as dtparse

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "ulysse" / "data"
CONFIG = yaml.safe_load((ROOT / "config" / "sources.yml").read_text())
NOW = datetime.now(timezone.utc)
KEEP_DAYS = 180
LONDON = ZoneInfo("Europe/London")

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
    # drop tracking parameters so the same page keeps one id across feeds
    p = urlparse(url)
    if p.query:
        q = "&".join(x for x in p.query.split("&") if not x.lower().startswith(("utm_", "fbclid")))
        url = p._replace(query=q).geturl()
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
        while skip < 3000:
            r = get(cfg["api"], params={"StartDate": start, "Take": take, "Skip": skip})
            js = r.json()
            rows = js.get("items") or []
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
    """Fields verified against the live API (Oct 2026): `type.name` is the
    publication type, `committee` is a single object with `name` and `house`
    (Commons / Lords / Joint), `description` is the title and
    `publicationStartDate` is naive UK local time."""
    pid = row.get("id")
    ptype_name = (row.get("type") or {}).get("name") or ""
    if keep_types and not any(k in ptype_name.lower() for k in keep_types):
        return None
    if not pid:
        return None
    title = (row.get("description") or "").strip() or "Untitled publication"
    raw = row.get("publicationStartDate")
    date = None
    if raw:
        try:
            date = dtparse.parse(raw).replace(tzinfo=LONDON).astimezone(timezone.utc)
        except Exception:  # noqa: BLE001
            date = parse_date(raw)
    committee = row.get("committee") or {}
    name = committee.get("name") or "Parliamentary committee"
    tags = [t for t in [ptype_name, committee.get("house")] if t]
    return make_item("committee", name, title, f"https://committees.parliament.uk/publications/{pid}/",
                     date, summary="", tags=tags)


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


NOT_PUBLICATION = re.compile(r"/(category|categories|tag|tags|topic|topics|theme|themes|author|authors|people|"
                             r"team|about|contact|events?|jobs|careers|privacy|cookies?|terms)(/|$)", re.I)


def scrape_links(page_url: str, html: str, limit: int = 30):
    """Fallback: pull plausible publication links from a listing page."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style"]):
        tag.decompose()
    # Remove site chrome, but not a <header> inside an <article>: some sites (Demos) put the
    # headline link there.
    for tag in soup(["nav", "footer", "header", "aside"]):
        if not tag.find_parent("article"):
            tag.decompose()
    host = urlparse(page_url).netloc.replace("www.", "")
    seen, rows = set(), []
    for a in soup.find_all("a", href=True):
        raw = re.sub(r"\s+", " ", a.get_text(" ", strip=True))
        heading = a.find(["h1", "h2", "h3", "h4", "h5"])
        text = re.sub(r"\s+", " ", heading.get_text(" ", strip=True)) if heading else raw
        href = urljoin(page_url, a["href"])
        p = urlparse(href)
        if len(text) < 25 or len(text.split()) < 4:
            continue
        if host not in p.netloc.replace("www.", "") and not p.netloc.endswith(host.split(".", 1)[-1]):
            continue
        if p.path.rstrip("/") == urlparse(page_url).path.rstrip("/") or p.path.count("/") < 2:
            continue
        if NOT_PUBLICATION.search(p.path) or "filter" in p.query:
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
        if not date:
            m = re.search(r"\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+20\d\d\b", raw)
            date = parse_date(m.group(0)) if m else None
        rows.append((text, href, date))
        if len(rows) >= limit:
            break
    return rows


def collect_thinktank(tt: dict) -> list[dict]:
    name, url = tt["name"], tt["url"]
    items: list[dict] = []
    try:
        feeds = [tt["feed"]] if tt.get("feed") else []
        no_feed = tt.get("feed") is False  # `feed: false` = skip autodiscovery, scrape the listing page
        html = ""
        try:
            html = get(url).text
        except Exception as e:  # noqa: BLE001
            if not feeds:
                raise e
        if not feeds and html and not no_feed:
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
    entries = feedparser.parse(url, request_headers=UA).entries
    # Google returns up to 100 results in relevance order; newest first so that any cap keeps recent items
    return sorted(entries, key=lambda e: parse_date(e.get("published")) or NOW - timedelta(days=3650), reverse=True)


def _gn_title(e) -> str:
    """Google News titles end in ' - Outlet'; strip using the feed's own source name."""
    t = e.get("title", "")
    src = (e.get("source") or {}).get("title", "")
    if src and t.endswith(" - " + src):
        t = t[: -len(src) - 3]
    return t.strip()


def collect_media() -> list[dict]:
    cfg = CONFIG["media"]
    kw = "(" + " OR ".join(cfg["keywords"]) + ")"
    relevant = re.compile(cfg["title_pattern"], re.I)
    items, seen = [], set()
    for o in cfg["outlets"]:
        try:
            entries = google_news(f"{kw} site:{o['domain']}", cfg["lookback"])
            n = dropped = 0
            for e in entries[:40]:
                title = _gn_title(e)
                # Google matches the keywords anywhere in the article body, which
                # pulls in stories that merely mention the party; require the
                # headline itself to be relevant (own-party sites are exempt).
                if not o.get("all") and not relevant.search(title):
                    dropped += 1
                    continue
                key = (o["name"], title.lower())
                if len(title) < 8 or key in seen or title.lower() == "liberal democrat voice":
                    continue
                seen.add(key)
                items.append(make_item("media", o["name"], title, e.get("link", ""),
                                       parse_date(e.get("published")), ""))
                n += 1
            # a quiet window is not a failure: only flag outlets whose feed returned nothing at all
            record("media", o["name"], bool(entries), n,
                   "" if n else f"quiet: {dropped} off-topic results dropped" if dropped else "no results from Google News")
        except Exception as e:  # noqa: BLE001
            record("media", o["name"], False, 0, e)
        time.sleep(1)
    return items


# ----------------------------------------------------------------- polling
TAG_RULES = [
    ("voting-intention", r"voting intention|vote intention|westminster|would vote|general election poll|poll of polls"),
    ("party-support", r"support for|favourab|approval|leader rating|best prime minister|party (support|favourab)|trust in (government|politicians)"),
    ("news-cycle", r"news tracker|news stories|memorable|noticed|in the news|salience|top issues|important issues"),
]


def poll_tags(text: str) -> list[str]:
    t = text.lower()
    return [tag for tag, pat in TAG_RULES if re.search(pat, t)]


def date_from_title(title: str) -> datetime | None:
    """YouGov trackers/VI posts carry their fieldwork dates in the title
    ("... 18 - 19 October 2026"); use the end date when the page gives no date."""
    m = re.search(r"(\d{1,2})\s*(?:[-–]\s*(\d{1,2})\s*)?([A-Z][a-z]+)?\s*(?:[-–]\s*)?(\d{1,2})?\s*([A-Z][a-z]+)\s+(20\d\d)", title)
    if not m:
        return None
    day = m.group(4) or m.group(2) or m.group(1)
    return parse_date(f"{day} {m.group(5)} {m.group(6)}")


def harvest_siblings(d: dict, rows, html: str, add) -> int:
    """Series pages (e.g. YouGov News Tracker) link to every earlier edition, but the listing
    page only shows the latest few. Fetch the newest edition found and add the siblings it links to.
    Titles are rebuilt from the URL slug: 'yougov-news-tracker-27-28-september-2026'."""
    pat = re.compile(d["harvest"])
    latest = next((h for _, h, _ in rows if pat.search(h)), None)
    if not latest:
        return 0
    cutoff = NOW - timedelta(days=60)
    soup = BeautifulSoup(get(latest).text, "lxml")
    n = 0
    for a in soup.find_all("a", href=True):
        href = urljoin(latest, a["href"]).split("?")[0]
        m = re.search(r"/articles/\d+-(" + d["harvest"] + r"[\w-]*)$", href)
        if not m:
            continue
        slug = m.group(1)
        dm = re.search(r"(\d{1,2})(?:-+(\d{1,2}))?-([a-z]+)-(20\d\d)$", slug)
        if not dm:
            continue
        day, mon, yr = dm.group(2) or dm.group(1), dm.group(3), dm.group(4)
        title = "YouGov News Tracker: " + (f"{dm.group(1)} - {dm.group(2)}" if dm.group(2) else dm.group(1)) \
            + f" {mon.title()} {yr}"
        date = parse_date(f"{day} {mon} {yr}")
        if date and date >= cutoff:
            n += add(d["name"], title, href, date, True)
    return n


def collect_poll_articles() -> list[dict]:
    cfg = CONFIG["polling"]
    terms = "(" + " OR ".join(cfg["search_terms"]) + ")"
    skip = re.compile(cfg["exclude_pattern"], re.I)
    items, seen = [], set()

    def add(source, title, url, date, direct=False):
        title = re.sub(r"\s+Article$", "", title.strip())
        key = re.sub(r"[^a-z0-9]", "", title.lower())
        if len(title) < 8 or skip.search(title) or key in seen:
            return False
        seen.add(key)
        date = date or date_from_title(title)
        items.append(make_item("polling", source, title, url, date, "", poll_tags(title) or ["poll"]))
        return True

    # Direct pages first so that, when the same piece also appears in the Google News
    # search, the item keeps its real YouGov URL rather than a news.google.com redirect.
    for d in cfg.get("direct", []):
        try:
            html = get(d["url"]).text
            rows = [r for r in scrape_links(d["url"], html, 40) if poll_tags(r[0]) or "poll" in r[0].lower()]
            n = sum(add(d["name"], text, href, date, True) for text, href, date in rows)
            if d.get("harvest"):
                n += harvest_siblings(d, rows, html, add)
            record("polling", f"{d['name']} (direct)", n > 0, n, "" if n else "no matching links")
        except Exception as e:  # noqa: BLE001
            record("polling", f"{d['name']} (direct)", False, 0, e)
        time.sleep(1)
    for f in cfg["firms"]:
        try:
            ft = "(" + " OR ".join(f["terms"]) + ")" if f.get("terms") else terms
            entries = google_news(f"{ft} site:{f['domain']}", cfg["lookback"])
            n = sum(add(f["name"], _gn_title(e), e.get("link", ""), parse_date(e.get("published")))
                    for e in entries[:40])
            record("polling", f["name"], n > 0, n, "" if n else "no results")
        except Exception as e:  # noqa: BLE001
            record("polling", f["name"], False, 0, e)
        time.sleep(1)
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
            elif c == "area":
                col_of["area"] = c
            else:
                key = PARTY_ALIASES.get(c.split()[0]) or PARTY_ALIASES.get(c)
                if key and key not in col_of:
                    col_of[key] = c

        def cell(r, k):
            v = r.get(col_of.get(k))
            return None if v is None or (isinstance(v, float) and v != v) else str(v)

        rows = []
        for _, r in df.iterrows():
            # event rows ("by-election", "Prime Minister changes") span the table and carry text in every cell
            if cell(r, "area") not in ("GB", "UK"):
                continue
            pollster = re.sub(r"\[.*?\]", "", cell(r, "pollster") or "").strip()
            dates = re.sub(r"\[.*?\]", "", cell(r, "dates") or "").strip()
            # The table gives no year ("16–19 Oct"); the page lists the current year first,
            # so assume this year and roll back if that would put the poll in the future.
            tail = re.split(r"[–-]", dates)[-1].strip()
            end = parse_date(tail)
            if end and end > NOW + timedelta(days=2):
                end = end.replace(year=end.year - 1)
            sample = re.sub(r"[^\d]", "", cell(r, "sample") or "")
            row = {"pollster": pollster, "dates": dates,
                   "end": end.date().isoformat() if end else None,
                   "sample": int(sample) if sample else None,
                   "mrp": "mrp" in pollster.lower()}
            for p in ["Con", "Lab", "Reform", "LD", "Green", "SNP"]:
                try:
                    row[p] = float(re.sub(r"[^\d.]", "", cell(r, p) or ""))
                except ValueError:
                    row[p] = None
            if pollster and row["end"] and all(row[p] is not None for p in ["Con", "Lab", "Reform", "LD"]):
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
            time.sleep(1)
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
