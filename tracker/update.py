"""Collector for the policy tracker.

Gathers: select committee publications, think tank outputs, Lib Dem media
coverage and polling. Writes JSON into site/ulysse/data/ for the static front end.

Run:  python tracker/update.py
"""
from __future__ import annotations

import collections
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
DATA = ROOT / "data" / "ulysse"   # not under site/: the site is public, this is uploaded to the private database
CONFIG = yaml.safe_load((ROOT / "config" / "sources.yml").read_text())
NOW = datetime.now(timezone.utc)
KEEP_DAYS = 180
ENRICH = True   # fetch article pages for missing publication dates (capped per run)
LONDON = ZoneInfo("Europe/London")

UA = {"User-Agent": "Mozilla/5.0 (compatible; PolicyTracker/1.0; personal research tool)"}
S = requests.Session()
S.headers.update(UA)

health: list[dict] = []


# ----------------------------------------------------------------- helpers
def get(url: str, **kw) -> requests.Response:
    """GET with one retry for 5xx / 429 / read timeouts. No retry for permanent 4xx (403 blocked, 404 wrong URL) or for
    hosts that cannot be reached at all (connect timeout, DNS, TLS): retrying those only burns minutes."""
    last = None
    for attempt in range(2):
        try:
            r = S.get(url, timeout=(6, 20), **kw)
            r.raise_for_status()
            return r
        except requests.HTTPError as e:
            last = e
            code = e.response.status_code if e.response is not None else 0
            if 400 <= code < 500 and code != 429:
                break
        except (requests.ConnectionError, requests.ConnectTimeout, requests.exceptions.SSLError) as e:
            last = e
            break
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
    """Fetch a feed with a timeout and parse it. Returns (entries, reason). HTML answers (some sites reply to feed
    URLs with their home page), errors and empty feeds give no entries."""
    try:
        r = S.get(feed_url, timeout=(6, 15))
        if r.status_code != 200:
            return [], f"HTTP {r.status_code}"
        head = r.content[:600].lstrip().lower()
        if not (head.startswith((b"<?xml", b"<rss", b"<feed", b"<rdf")) or b"<rss" in head or b"<feed" in head):
            return [], "not a feed"
        d = feedparser.parse(r.content)
        return (d.entries, "ok") if d.entries else ([], "empty feed")
    except Exception as e:  # noqa: BLE001
        return [], type(e).__name__


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


def _variants(url: str) -> list[str]:
    """The URL plus its www/bare-host twin (some sites only serve one of them, or have a cert for one)."""
    p = urlparse(url)
    host = p.netloc
    twin = host[4:] if host.startswith("www.") else "www." + host
    return [url, p._replace(netloc=twin).geturl()]


def _news_site(url: str) -> str:
    """site: scope for the Google News fallback. University-hosted centres share a domain, so keep their path."""
    p = urlparse(url)
    host = p.netloc.removeprefix("www.")
    if host.endswith((".ac.uk", ".edu")):
        segs = [x for x in p.path.split("/") if x]
        if segs and segs[-1].lower() in ("publications", "research", "reports", "blog", "research-analysis", "library"):
            segs = segs[:-1]
        return host + ("/" + "/".join(segs[:2]) if segs else "")
    return host


def _entries_to_items(name: str, entries) -> list[dict]:
    items = []
    for e in entries[:40]:
        link = e.get("link")
        if link:
            items.append(make_item("thinktank", name, e.get("title", ""), link,
                                   parse_date(e.get("published") or e.get("updated")), e.get("summary", "")))
    return items


def collect_thinktank(tt: dict) -> tuple[list[dict], dict]:
    """Self-healing: primary page (+ www/bare twin, + alternates) -> feeds -> HTML scrape -> Google News site: search.
    Returns (items, health record). Never raises."""
    name = tt["name"]
    pages = [u for u in [tt["url"], *tt.get("urls", [])] for u in _variants(u)]
    explicit_feeds = ([tt["feed"]] if tt.get("feed") else []) + list(tt.get("feeds", []))
    no_feed = tt.get("feed") is False
    notes: list[str] = []
    seen_pages: set[str] = set()
    tried_feeds: set[str] = set()
    probes: collections.Counter = collections.Counter()
    t0 = time.time()
    over = lambda: time.time() - t0 > 75     # per-organisation budget; then go straight to the Google News fallback

    def try_feeds(feeds: list[str]):
        for f in feeds:
            if f in tried_feeds or over():
                continue
            tried_feeds.add(f)
            time.sleep(0.3)
            entries, why = _feed_entries(f)
            if len(entries) >= 3:    # a 1-2 item feed is usually a site's "promoted" feed, not its publications
                return f, entries
            probes[f"{len(entries)} items" if entries else why] += 1
        return None, []

    try:
        # explicit feeds first: they need no page at all (works even when the site 403s the HTML pages)
        f, entries = try_feeds(explicit_feeds)
        if entries:
            return _done(t0, name, _entries_to_items(name, entries), "feed", f, notes)
        for page in pages:
            if page in seen_pages or over():
                continue
            seen_pages.add(page)
            try:
                html = get(page).text
            except Exception as e:  # noqa: BLE001
                m = re.search(r"\b(40\d|50\d)\b", str(e))
                notes.append(f"{urlparse(page).netloc}{urlparse(page).path}: {'HTTP ' + m.group(1) if m else type(e).__name__}")
                if not no_feed:   # even if the page is blocked, common feed paths often are not
                    base = f"{urlparse(page).scheme}://{urlparse(page).netloc}/"
                    f, entries = try_feeds([urljoin(base, x) for x in FEED_SUFFIXES])
                    if entries:
                        return _done(t0, name, _entries_to_items(name, entries), "feed", f, notes)
                continue
            if not no_feed:
                f, entries = try_feeds(discover_feeds(page, html))
                if entries:
                    return _done(t0, name, _entries_to_items(name, entries), "feed", f, notes)
            rows = scrape_links(page, html)
            if rows:
                return _done(t0, name, [make_item("thinktank", name, t, h, d) for t, h, d in rows], "html", page, notes)
            title = (BeautifulSoup(html, "lxml").title.string or "").strip()[:40] if BeautifulSoup(html, "lxml").title else ""
            notes.append(f"{urlparse(page).netloc}: page loads ({len(html) // 1000}KB, title '{title}') but lists no publication links")
        # last resort: what Google News has indexed for the organisation's own site
        if tt.get("news") is not False:
            q = tt.get("news_query") or f"site:{_news_site(tt['url'])}"
            entries = google_news(q, "90d")
            items = []
            want = (re.search(r"site:([\w.-]+)", q) or [None, ""])[1]   # the organisation's own domain
            for e in entries[:40]:
                title = _gn_title(e).lstrip("-– ").strip()
                src = urlparse((e.get("source") or {}).get("href", "")).netloc.removeprefix("www.")
                if want and not src.endswith(want):
                    continue           # Google's site: filter is loose: keep only the organisation's own pages
                if len(title.split()) < 3 or title.lower() in (name.lower(), "home"):
                    continue           # site chrome, tags, staff pages
                items.append(make_item("thinktank", name, title, e.get("link", ""), parse_date(e.get("published"))))
                if len(items) >= 25:
                    break
            if items:
                return _done(t0, name, items, "google-news", q, notes)
            notes.append("Google News had nothing for it either")
        if probes:
            notes.append("feed probes: " + ", ".join(f"{n}x {w}" for w, n in probes.most_common(4)))
    except Exception as e:  # noqa: BLE001
        notes.append(f"unexpected: {e}")
    if probes and not any(n.startswith("feed probes") for n in notes):
        notes.append("feed probes: " + ", ".join(f"{n}x {w}" for w, n in probes.most_common(4)))
    return [], {"group": "thinktanks", "name": name, "ok": False, "items": 0, "seconds": round(time.time() - t0),
                "error": "; ".join(dict.fromkeys(notes))[:400]}


def _done(t0, name, items, method, via, notes):
    items = [i for i in items if i["url"]]
    rec = {"group": "thinktanks", "name": name, "ok": bool(items), "items": len(items), "method": method, "via": via, "seconds": round(time.time() - t0),
           "error": ("; ".join(dict.fromkeys(notes))[:400] if notes else "")}
    return items, rec


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


# --------------------------------------------------------------- categorisation
TAX = yaml.safe_load((ROOT / "config" / "taxonomy.yml").read_text())
_AREA_RX = {a: [re.compile(p, re.I) for p in pats] for a, pats in TAX["areas"].items()}
_PLACE_RX = {n: (v["group"], re.compile(v["pattern"], re.I)) for n, v in TAX["geography"]["places"].items()}
_DROP_T = re.compile(TAX["drop_title_pattern"], re.I)
_DROP_S = re.compile(TAX["drop_summary_pattern"], re.I)
_COMMITTEE_RX = [(re.compile(p, re.I), a) for p, a in TAX["committee_areas"].items()]
_COMMITTEE_PLACE = [(re.compile(p, re.I), a) for p, a in TAX["geography"]["committee_places"].items()]
_TYPE_RX = [(t[0], re.compile(t[1], re.I)) for t in TAX["types"]["thinktank"] if len(t) == 2 and isinstance(t, list)]
_TYPE_DEFAULT = next(t["default"] for t in TAX["types"]["thinktank"] if isinstance(t, dict))
UK_WIDE = TAX["geography"]["default"]
GEO_ORDER = list(TAX["geography"]["places"])


def is_noise(it: dict) -> bool:
    """Staff bios, job adverts and site housekeeping that the generic scraper picks up."""
    return it["category"] == "thinktank" and bool(_DROP_T.search(it["title"]) or _DROP_S.search(it.get("summary", "")))


def classify(it: dict) -> dict:
    """Adds areas (max 2), geo (max 2) and kind. Deterministic keyword rules from config/taxonomy.yml."""
    title, summ = it["title"], it.get("summary", "")
    score: dict[str, float] = {}
    for area, rxs in _AREA_RX.items():
        t = sum(len(rx.findall(title)) for rx in rxs)
        d = sum(len(rx.findall(summ)) for rx in rxs)
        sc = 2 * min(t, 2) + min(d, 2)
        if sc:
            score[area] = sc
    for key, areas in TAX["source_defaults"].items():
        if key.lower() in it["source"].lower():
            for a in areas:
                score[a] = score.get(a, 0) + 2
    if it["category"] == "committee":
        for rx, a in _COMMITTEE_RX:
            if rx.search(it["source"]):
                score[a] = score.get(a, 0) + 3
    if it["category"] in ("polling", "media") and not score:
        score["Party politics & polling"] = 2
    ranked = sorted(score.items(), key=lambda kv: -kv[1])
    areas = [a for a, sc in ranked[:2] if sc >= 2 and (a == ranked[0][0] or sc >= 0.5 * ranked[0][1])]
    # geography
    hits = []
    for name, (_g, rx) in _PLACE_RX.items():
        t, d = len(rx.findall(title)), len(rx.findall(summ))
        if t or d:
            hits.append((name, 2 * t + d))
    if it["category"] == "committee":
        for rx, name in _COMMITTEE_PLACE:
            if rx.search(it["source"]):
                hits.append((name, 5))
    hits.sort(key=lambda h: (-h[1], GEO_ORDER.index(h[0])))
    geo = [n for n, _ in hits]
    if len(geo) > 1 and "England" in geo and any(_PLACE_RX[g][0] == "UK" and g not in ("England", "London") for g in geo):
        geo.remove("England")
    geo = geo[:2] or [UK_WIDE]
    # kind
    cat = it["category"]
    if cat == "committee":
        kind = TAX["types"]["committee"].get((it["tags"] or [""])[0], "Committee report")
    elif cat == "media":
        kind = TAX["types"]["media"]
    elif cat == "polling":
        pt = TAX["types"]["polling"]
        kind = next((pt[t] for t in it["tags"] if t in pt), pt["default"])
    else:
        kind = next((n for n, rx in _TYPE_RX if rx.search(title)), _TYPE_DEFAULT)
    it["areas"] = areas or [TAX["areas_other"]]
    it["geo"] = geo
    it["kind"] = kind
    return it


_URL_DATE = re.compile(r"/(20\d\d)[/-](\d{1,2})[/-](\d{1,2})(?:/|$|-)")


def date_from_url(url: str) -> datetime | None:
    m = _URL_DATE.search(url)
    if not m:
        return None
    try:
        return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=timezone.utc)
    except ValueError:
        return None


def page_published_date(url: str) -> datetime | None:
    """Reads the publication date from the article page itself (meta tags, <time>, JSON-LD)."""
    soup = BeautifulSoup(get(url).text, "lxml")
    for sel, attr in (('meta[property="article:published_time"]', "content"), ('meta[name="date"]', "content"),
                      ('meta[name="publication_date"]', "content"), ('meta[itemprop="datePublished"]', "content"),
                      ('meta[name="DC.date.issued"]', "content"), ('time[itemprop="datePublished"]', "datetime"),
                      ("time[datetime]", "datetime")):
        el = soup.select_one(sel)
        if el and el.get(attr):
            d = parse_date(el[attr])
            if d:
                return d
    for sc in soup.find_all("script", type="application/ld+json"):
        m = re.search(r'"datePublished"\s*:\s*"([^"]+)"', sc.string or "")
        if m:
            d = parse_date(m.group(1))
            if d:
                return d
    return None


def enrich_dates(items: list[dict], limit: int = 40) -> None:
    """Fills in missing publication dates for think tank items: URL first (free), then the page (polite, capped per run)."""
    fetched = 0
    for it in items:
        if it.get("published") or it["category"] != "thinktank":
            continue
        d = date_from_url(it["url"]) or date_from_title(it["title"])
        if not d and fetched < limit and not it.get("date_checked") and it.get("date_tries", 0) < 3:
            fetched += 1
            try:
                d = page_published_date(it["url"])
                if not d:
                    it["date_checked"] = True   # page fetched fine but states no date: do not ask again
            except Exception:  # noqa: BLE001
                it["date_tries"] = it.get("date_tries", 0) + 1   # network problem: retry on later runs, up to 3 times
            time.sleep(1)
        if d:
            it["published"] = d.isoformat()


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
    for it in list(old.values()):
        if is_noise(it):
            del old[it["id"]]
    # The same article can arrive twice if a source's method flips between runs (direct feed vs Google News redirect):
    # keep one per (source, title), preferring the direct link.
    by_title: dict = {}
    for it in list(old.values()):
        k = (it["source"], re.sub(r"\W+", " ", it["title"].lower()).strip())
        cur = by_title.get(k)
        if cur is None:
            by_title[k] = it
            continue
        keep, drop = (it, cur) if ("news.google.com" in cur["url"] and "news.google.com" not in it["url"]) else (cur, it)
        keep["first_seen"] = min(keep["first_seen"], drop["first_seen"])
        by_title[k] = keep
        old.pop(drop["id"], None)
    if ENRICH:
        enrich_dates(list(old.values()))
    for it in old.values():
        classify(it)
    for it in old.values():
        d = parse_date(it.get("published")) or parse_date(it.get("first_seen")) or NOW
        if d >= cutoff:
            kept.append(it)
    kept.sort(key=lambda i: i.get("published") or i["first_seen"], reverse=True)
    return kept


def upload() -> bool:
    """Push feed/polls/health to the ulysse-ingest function. Skipped (with a notice) if not configured."""
    import os
    url, token = os.environ.get("INGEST_URL"), os.environ.get("INGEST_TOKEN")
    if not (url and token):
        print("INGEST_URL / INGEST_TOKEN not set: data written locally only, not uploaded")
        return True
    ok = True
    for name in ("feed", "polls", "health"):
        f = DATA / f"{name}.json"
        if not f.exists():
            continue
        try:
            r = requests.post(url, headers={"x-ingest-token": token, "content-type": "application/json"},
                              data=json.dumps({"name": name, "body": json.loads(f.read_text())}), timeout=60)
            r.raise_for_status()
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"upload of {name} failed: {e}", file=sys.stderr)
    return ok


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    global ENRICH
    only = set(sys.argv[1:])  # e.g. `update.py media polling`
    if "reclassify" in only:      # re-apply taxonomy to stored items without collecting
        ENRICH = False
        feed = merge([])
        (DATA / "feed.json").write_text(json.dumps({"updated": NOW.isoformat(), "items": feed}, indent=1))
        print(f"{len(feed)} items re-classified")
        return 0
    run = lambda k: not only or k in only  # noqa: E731
    items: list[dict] = []
    if run("committees"):
        items += collect_committees()
    if run("thinktanks"):
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=4) as ex:
            for got, rec in ex.map(collect_thinktank, CONFIG["thinktanks"]):
                items += got
                health.append(rec)
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
    return 0 if upload() else 1


if __name__ == "__main__":
    sys.exit(main())
