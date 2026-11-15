"""Collector for the policy tracker.

Gathers: select committee publications, think tank outputs, Lib Dem media
coverage, polling and Sarah Olney's coverage. Respects robots.txt and spaces out requests to each site.
State (first-seen times) lives in the private database and is read back through the ingest function each run;
data/ulysse/ is a local working copy only.

Run:  python tracker/update.py
"""
from __future__ import annotations

import collections
import hashlib
import json
import re
import os
import sys
import threading
import time
import urllib.robotparser
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import urljoin, urlparse

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
ROBOTS_AGENT = "PolicyTracker"     # the token matched against robots.txt User-agent lines
MIN_INTERVAL = 1.0                 # seconds between requests to the same host (raised by a site's Crawl-delay)
_robots: dict = {}
_host_next: dict = {}
_host_lock = threading.Lock()
_robots_lock = threading.Lock()
_robots_locks: dict = {}


class RobotsDisallowed(Exception):
    """The site's robots.txt does not allow this URL: never fetched."""


def _robots_for(url: str) -> urllib.robotparser.RobotFileParser:
    """robots.txt per scheme+host, fetched once per run. 401/403 (the site refuses bots outright) and unreachable or
    5xx robots.txt mean "do not crawl"; a missing robots.txt (404) means everything is allowed (RFC 9309).
    The parser's `why` says which, for Source health."""
    p = urlparse(url)
    key = f"{p.scheme}://{p.netloc}"
    if key in _robots:
        return _robots[key]
    with _robots_lock:                      # one lock per site, so a slow site does not hold up the others
        lock = _robots_locks.setdefault(key, threading.Lock())
    with lock:
        if key in _robots:
            return _robots[key]
        rp = urllib.robotparser.RobotFileParser(key + "/robots.txt")
        rp.why = "blocked by robots.txt"
        try:
            r = S.get(key + "/robots.txt", timeout=(6, 15))
            if r.status_code in (401, 403):
                rp.disallow_all, rp.why = True, f"site refuses bots (robots.txt HTTP {r.status_code})"
            elif r.status_code >= 500:
                rp.disallow_all, rp.why = True, f"robots.txt unavailable (HTTP {r.status_code}), not fetched"
            elif r.status_code >= 400:
                rp.allow_all = True
            else:
                rp.parse(r.text.splitlines())
        except Exception as e:  # noqa: BLE001
            rp.disallow_all, rp.why = True, f"site unreachable ({type(e).__name__})"
        _robots[key] = rp
        return rp


def allowed(url: str) -> bool:
    if any(url.startswith(e["prefix"]) for e in (CONFIG.get("robots_exceptions") or [])):   # an open API that invites programs (config/sources.yml says which and why)
        return True
    return _robots_for(url).can_fetch(ROBOTS_AGENT, url)


def _wait_turn(url: str) -> None:
    """At most one request per host every MIN_INTERVAL seconds (or the site's Crawl-delay, up to 30s), across threads."""
    host = urlparse(url).netloc
    delay = MIN_INTERVAL
    try:
        cd = _robots_for(url).crawl_delay(ROBOTS_AGENT)
        if cd:
            delay = min(max(float(cd), MIN_INTERVAL), 30.0)
    except Exception:  # noqa: BLE001
        pass
    with _host_lock:
        now = time.monotonic()
        start = max(now, _host_next.get(host, 0.0))
        _host_next[host] = start + delay
    if start > now:
        time.sleep(start - now)


def fetch(url: str, timeout=(6, 20), **kw) -> requests.Response:
    """Every request goes through here: robots.txt is checked first and requests to one host are spaced out."""
    if kw.get("params"):
        url = requests.Request("GET", url, params=kw.pop("params")).prepare().url
    if not allowed(url):
        raise RobotsDisallowed(_robots_for(url).why)
    _wait_turn(url)
    return S.get(url, timeout=timeout, **kw)


def get(url: str, **kw) -> requests.Response:
    """GET with one retry for 5xx / 429 / read timeouts. No retry for permanent 4xx (403 blocked, 404 wrong URL),
    robots.txt refusals, or hosts that cannot be reached at all (connect timeout, DNS, TLS): retrying those only burns minutes."""
    last = None
    for attempt in range(2):
        try:
            r = fetch(url, **kw)
            r.raise_for_status()
            return r
        except RobotsDisallowed:
            raise
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
        r = fetch(feed_url, timeout=(6, 15))
        if r.status_code != 200:
            return [], f"HTTP {r.status_code}"
        head = r.content[:600].lstrip().lower()
        if not (head.startswith((b"<?xml", b"<rss", b"<feed", b"<rdf")) or b"<rss" in head or b"<feed" in head):
            return [], "not a feed"
        d = feedparser.parse(r.content)
        return (d.entries, "ok") if d.entries else ([], "empty feed")
    except RobotsDisallowed as e:
        return [], str(e)
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


SITEMAP_HINT = re.compile(r"post|publication|research|report|paper|insight|analysis|briefing|blog|news|article|comment", re.I)
SITEMAP_LISTING = re.compile(r"^/(collections?|series|projects?|programmes?|regions?|countries|topics?|themes?|issues?|"
                             r"sectors?|search|page|people|experts?|about|events?|podcasts?|videos?|media|press|jobs)(/|$)", re.I)
SITEMAP_SKIP = re.compile(r"author|tag|categor|page-sitemap|product|event|people|staff|team|job|vacanc|attachment|image|video", re.I)


def _scope(url: str) -> str:
    """Path prefix an organisation's pages live under. University-hosted centres share a domain, so keep their path;
    a stand-alone site is scoped to its whole host."""
    p = urlparse(url)
    host = p.netloc.removeprefix("www.")
    if host.endswith((".ac.uk", ".edu")):
        segs = [x for x in p.path.split("/") if x]
        if segs and segs[-1].lower() in ("publications", "research", "reports", "blog", "research-analysis", "library"):
            segs = segs[:-1]
        return "/" + "/".join(segs[:3]) if segs else "/"
    return "/"


def _slug_title(url: str) -> str:
    slug = [x for x in urlparse(url).path.split("/") if x][-1]
    slug = re.sub(r"\.(html?|aspx|php)$", "", slug)
    slug = re.sub(r"^\d{4,}[-_]|[-_]\d{5,}$", "", slug)
    words = re.sub(r"[-_]+", " ", slug).strip()
    return words[:1].upper() + words[1:]


def sitemap_items(tt: dict, category: str, limit: int = 25) -> tuple[list[dict], str]:
    """Fallback for sites whose pages cannot be read (blocked, JavaScript-rendered): the XML sitemap, which robots.txt
    points crawlers to. Takes the most recently modified pages under the organisation's scope. Titles come from the
    URL until the page itself is read (enrich_dates replaces them with the real title and publication date)."""
    p = urlparse(tt["url"])
    base = f"{p.scheme}://{p.netloc}"
    scope = _scope(tt["url"])
    if scope == "/" and p.netloc.removeprefix("www.").endswith((".ac.uk", ".edu")):
        return [], "skipped: the sitemap would be the whole university's"
    try:
        maps = list(_robots_for(tt["url"]).site_maps() or [])
    except Exception:  # noqa: BLE001
        maps = []
    queue = maps + [base + "/sitemap.xml", base + "/sitemap_index.xml", base + "/wp-sitemap.xml"]
    seen, urls, undated, relaxed, docs, total = set(), [], [], [], 0, 0
    cutoff = NOW - timedelta(days=int(tt.get("sitemap_days", 120)))
    pattern = re.compile(tt["sitemap_pattern"]) if tt.get("sitemap_pattern") else None
    newest = None
    while queue and docs < 8:
        sm = queue.pop(0)
        if sm in seen:
            continue
        seen.add(sm)
        try:
            r = get(sm)
        except Exception:  # noqa: BLE001
            continue
        docs += 1
        if len(r.content) > 15_000_000:
            continue
        soup = BeautifulSoup(r.content, "lxml-xml")
        if soup.find("sitemapindex"):
            kids = []
            for node in soup.find_all("sitemap"):
                loc = (node.find("loc").text if node.find("loc") else "").strip()
                mod = parse_date(node.find("lastmod").text) if node.find("lastmod") else None
                if loc and not SITEMAP_SKIP.search(loc) and (mod is None or mod >= cutoff):
                    kids.append((bool(SITEMAP_HINT.search(loc)), mod or cutoff, loc))
            queue = [k[2] for k in sorted(kids, reverse=True)[:5]] + queue
            continue
        for node in soup.find_all("url"):
            total += 1
            loc = (node.find("loc").text if node.find("loc") else "").strip()
            mod = parse_date(node.find("lastmod").text) if node.find("lastmod") else None
            if mod and (newest is None or mod > newest):
                newest = mod
            u = urlparse(loc)
            if not loc or (mod and mod < cutoff) or u.netloc.removeprefix("www.") != p.netloc.removeprefix("www."):
                continue
            if pattern:      # this source says which addresses are its publications (e.g. IIED's /12345iied)
                if not pattern.search(u.path):
                    continue
            elif not u.path.startswith(scope) or u.path.rstrip("/") in ("", scope.rstrip("/")) or u.path.count("/") < 2:
                slug = u.path.strip("/")
                if mod and "/" not in slug and slug.count("-") >= 3 and u.path.startswith(scope) and not (NOT_PUBLICATION.search(u.path) or SITEMAP_LISTING.match(u.path)):
                    relaxed.append((mod, loc))
                continue
            if NOT_PUBLICATION.search(u.path) or SITEMAP_LISTING.match(u.path):
                continue
            if mod:
                urls.append((mod, loc))
            else:
                undated.append(loc)
    # prefer pages under the organisation's own listing path (e.g. /report/ for https://www.nesta.org.uk/report/)
    hint = next((x for x in p.path.split("/") if x), "")
    if hint:
        under = [x for x in urls if urlparse(x[1]).path.startswith(f"/{hint}/")]
        if len(under) >= 3:
            urls = under
    if not urls and not undated and relaxed:      # nothing under a listing path: take recent top-level pages with a real slug
        urls = relaxed
    if not urls and undated:      # a sitemap with no dates: assume it lists oldest first, so take the end of it
        urls = [(cutoff, u) for u in reversed(undated[-limit:])]
    urls = sorted(set(urls), reverse=True)[:limit]
    items = []
    for mod, loc in urls:
        # tagged so the site does not flag it NEW until its real publication date is known (a sitemap's lastmod is
        # when the page last changed, which for an old report can be yesterday)
        it = make_item(category, tt["name"], _slug_title(loc), loc, date_from_url(loc), tags=["sitemap"])
        it["slug_title"] = True
        items.append(it)
    return items, f"{docs} sitemap file(s), {total} pages seen, {len(urls) + len(undated)} usable, newest dated {newest.date().isoformat() if newest else 'none'}"


TITLE_KEYS = ("headline", "title", "name", "heading")
URL_KEYS = ("url", "link", "href", "permalink", "uri", "path")
DATE_KEYS = ("datePublished", "date_published", "publishedAt", "published_at", "publishDate", "publication_date", "publicationDate",
             "published", "date", "dateCreated", "created", "createdAt", "pubDate")
NOT_ARTICLE_TYPES = {"organization", "website", "webpage", "breadcrumblist", "listitem", "person", "searchaction", "imageobject", "sitenavigationelement"}


def _walk_json(o, found: list, depth: int = 0) -> None:
    if depth > 12:
        return
    if isinstance(o, dict):
        title = next((o[k] for k in TITLE_KEYS if isinstance(o.get(k), str)), None)
        url = next((o[k] for k in URL_KEYS if isinstance(o.get(k), str)), None)
        if isinstance(o.get("item"), dict):          # schema.org ListItem { item: { name, url } }
            _walk_json(o["item"], found, depth + 1)
        typ = o.get("@type")
        typ = (typ if isinstance(typ, str) else " ".join(typ) if isinstance(typ, list) else "").lower()
        if title and url and typ not in NOT_ARTICLE_TYPES:
            date = next((o[k] for k in DATE_KEYS if isinstance(o.get(k), str)), None)
            found.append((title, url, date))
        for v in o.values():
            _walk_json(v, found, depth + 1)
    elif isinstance(o, list):
        for v in o:
            _walk_json(v, found, depth + 1)


def embedded_json_items(page_url: str, html: str, limit: int = 30):
    """JavaScript-built listing pages usually ship their data inside the page (Next.js/Nuxt state, JSON-LD): read that instead
    of the links that only appear after scripts run."""
    soup = BeautifulSoup(html, "lxml")
    found: list = []
    for sc in soup.find_all("script"):
        t = (sc.get("type") or "").lower()
        if "json" not in t and sc.get("id") not in ("__NEXT_DATA__", "__NUXT_DATA__"):
            continue
        try:
            _walk_json(json.loads(sc.string or sc.get_text() or ""), found)
        except Exception:  # noqa: BLE001
            continue
    host = urlparse(page_url).netloc.removeprefix("www.")
    here = urlparse(page_url).path.rstrip("/")
    rows, seen = [], set()
    for title, url, found_date in found:
        title = re.sub(r"\s+", " ", BeautifulSoup(title, "lxml").get_text(" ", strip=True))
        if len(title) < 25 or len(title.split()) < 4 or not url or url.startswith(("mailto:", "tel:", "#", "javascript:")):
            continue
        href = urljoin(page_url, url)
        u = urlparse(href)
        if u.netloc.removeprefix("www.") != host or u.path.rstrip("/") in ("", here) or u.path.count("/") < 2:
            continue
        if NOT_PUBLICATION.search(u.path) or href in seen:
            continue
        seen.add(href)
        rows.append((title, href, parse_date(found_date) if found_date else None))
        if len(rows) >= limit:
            break
    return rows


WP_BUILTIN = {"post", "page", "attachment", "nav_menu_item", "wp_block", "wp_template", "wp_template_part", "wp_navigation",
              "wp_global_styles", "wp_font_family", "wp_font_face", "revision"}


def wp_items(page_url: str, html: str, limit: int = 30):
    """WordPress sites publish their content through a public REST API even when the RSS feed is switched off.
    Prefers a custom post type that looks like publications/research; falls back to ordinary posts."""
    if not re.search(r"wp-json|wp-content|api\.w\.org", html):
        return [], ""        # not a WordPress site: do not ask it for WordPress things
    soup = BeautifulSoup(html, "lxml")
    link = soup.find("link", attrs={"rel": re.compile(r"api\.w\.org")})
    p = urlparse(page_url)
    root = (urljoin(page_url, link["href"]) if link and link.get("href") else f"{p.scheme}://{p.netloc}/wp-json/").rstrip("/") + "/"
    if "wp-json" not in root and "rest_route" not in root:
        return [], ""
    endpoints = []
    try:
        types = get(root + "wp/v2/types", timeout=(6, 15)).json()
        for t in types.values():
            base = t.get("rest_base")
            if base and t.get("slug") not in WP_BUILTIN and SITEMAP_HINT.search(f"{t.get('slug', '')} {base}"):
                endpoints.append(base)
    except Exception:  # noqa: BLE001
        pass
    for ep in endpoints + ["posts"]:
        try:
            data = get(f"{root}wp/v2/{ep}?per_page=25&orderby=date&order=desc&_fields=title,link,date", timeout=(6, 15)).json()
        except Exception:  # noqa: BLE001
            continue
        rows = []
        for d in data if isinstance(data, list) else []:
            t = BeautifulSoup((d.get("title") or {}).get("rendered", ""), "lxml").get_text(" ", strip=True)
            if t and d.get("link"):
                rows.append((t, d["link"], parse_date(d.get("date"))))
        if len(rows) >= 3:
            return rows[:limit], root + "wp/v2/" + ep
    return [], ""


def page_fingerprint(page_url: str, html: str) -> str:
    """A few facts about a page the scraper could not read, so Source health says why (script-built? which framework?)."""
    soup = BeautifulSoup(html, "lxml")
    host = urlparse(page_url).netloc.removeprefix("www.")
    hrefs = [urlparse(urljoin(page_url, a["href"])) for a in soup.find_all("a", href=True)]
    same = [u for u in hrefs if u.netloc.removeprefix("www.") == host and u.path.count("/") >= 2]
    marks = [m for m, rx in (("next", "__NEXT_DATA__"), ("nuxt", "__NUXT"), ("wp", "wp-content|wp-json"), ("wix", "wix\\.com|wixstatic"),
                             ("squarespace", "squarespace"), ("webflow", "webflow"), ("react", "data-reactroot|id=\"root\"|id=\"app\"")) if re.search(rx, html, re.I)]
    jsons = len(soup.find_all("script", type=re.compile("json", re.I)))
    sample = ",".join(sorted({u.path[:34] for u in same})[:4])
    return f"{len(hrefs)} links, {len(same)} deep; {'/'.join(marks) or 'no framework seen'}; {jsons} json blocks; e.g. {sample}"


def squarespace_items(page_url: str, html: str, limit: int = 30):
    """Squarespace sites give any collection page as JSON by adding ?format=json."""
    if "squarespace" not in html.lower():
        return []
    data = get(page_url + ("&" if "?" in page_url else "?") + "format=json", timeout=(6, 15)).json()
    rows = []
    for it in (data.get("items") or data.get("collection", {}).get("items") or []):
        title, url = it.get("title"), it.get("fullUrl") or it.get("urlId")
        if title and url:
            ts = it.get("publishOn") or it.get("addedOn")
            rows.append((re.sub(r"\s+", " ", title).strip(), urljoin(page_url, url), datetime.fromtimestamp(ts / 1000, timezone.utc) if ts else None))
    return rows[:limit]


def _entries_to_items(name: str, entries, category: str = "thinktank") -> list[dict]:
    items = []
    for e in entries[:40]:
        link = e.get("link")
        if link:
            items.append(make_item(category, name, e.get("title", ""), link,
                                   parse_date(e.get("published") or e.get("updated")), e.get("summary", "")))
    return items


def collect_source(tt: dict, category: str = "thinktank", group: str = "thinktanks") -> tuple[list[dict], dict]:
    """Self-healing: explicit feeds -> the main page (feeds it advertises, links, data built into it, WordPress API) -> the XML
    sitemap -> alternate pages if any are listed. Every request respects robots.txt and nothing is done to get past a block.
    Returns (items, health record). Never raises."""
    name = tt["name"]
    explicit_feeds = ([tt["feed"]] if tt.get("feed") else []) + list(tt.get("feeds", []))
    no_feed = tt.get("feed") is False
    notes: list[str] = []
    seen_pages: set[str] = set()
    tried_feeds: set[str] = set()
    probes: collections.Counter = collections.Counter()
    t0 = time.time()
    over = lambda: time.time() - t0 > 120    # per-organisation budget for page work; the sitemap always gets its turn

    def try_feeds(feeds: list[str]):
        for f in feeds:
            if f in tried_feeds or over():
                continue
            tried_feeds.add(f)
            entries, why = _feed_entries(f)
            if len(entries) >= 3:    # a 1-2 item feed is usually a site's "promoted" feed, not its publications
                return f, entries
            probes[f"{len(entries)} items" if entries else why] += 1
        return None, []

    def feed_result(f, entries, notes):
        return _done(t0, group, name, _entries_to_items(name, entries, category), "feed", f, notes)

    def try_page(page: str):
        """One page through every method. Returns (result, reached): result is a finished (items, record) or None;
        reached says the site answered (even with a 404), so its www/bare twin need not be tried."""
        if page in seen_pages or over():
            return None, False
        seen_pages.add(page)
        where = f"{urlparse(page).netloc}{urlparse(page).path}"
        try:
            html = get(page).text
        except RobotsDisallowed as e:
            notes.append(f"{where}: {e}")
            return None, True
        except Exception as e:  # noqa: BLE001
            m = re.search(r"\b(40\d|50\d)\b", str(e))
            hdr = getattr(getattr(e, "response", None), "headers", None) or {}
            who = "/".join(x for x in (("Cloudflare challenge" if hdr.get("cf-mitigated") else ""), (hdr.get("server") or "")[:20]) if x)
            notes.append(f"{where}: {'HTTP ' + m.group(1) if m else type(e).__name__}{' (' + who + ')' if who and m and m.group(1) in ('401', '403') else ''}")
            if not no_feed and m and m.group(1) in ("401", "403", "404"):   # even if the page is blocked, common feed paths often are not
                base = f"{urlparse(page).scheme}://{urlparse(page).netloc}/"
                f, entries = try_feeds([urljoin(base, x) for x in FEED_SUFFIXES[:4]])
                if entries:
                    return feed_result(f, entries, notes), True
            return None, bool(m)
        if not no_feed:
            f, entries = try_feeds(discover_feeds(page, html))
            if entries:
                return feed_result(f, entries, notes), True
        rows = scrape_links(page, html)
        if rows:
            return _done(t0, group, name, [make_item(category, name, t, h, d) for t, h, d in rows], "html", page, notes), True
        for finder, method in ((embedded_json_items, "json"), (None, "wp-api"), (squarespace_items, "squarespace")):
            if over():
                break
            try:
                rows, via = (finder(page, html), page) if finder else wp_items(page, html)
            except Exception:  # noqa: BLE001
                rows, via = [], ""
            if rows:
                return _done(t0, group, name, [make_item(category, name, t, h, d) for t, h, d in rows], method, via, notes), True
        title = (BeautifulSoup(html, "lxml").title.string or "").strip()[:40] if BeautifulSoup(html, "lxml").title else ""
        if len(html) < 800:
            notes.append(f"{urlparse(page).netloc}: answers with an empty page (a bot check: respected, not worked around)")
        else:
            notes.append(f"{urlparse(page).netloc}: page loads ({len(html) // 1000}KB, title '{title}') but lists no publication links [{page_fingerprint(page, html)}]")
        return None, True

    def try_pages(urls: list[str]):
        for u in urls:
            for page in _variants(u):
                res, reached = try_page(page)
                if res:
                    return res
                if reached:
                    break      # the site answered: its www/bare twin would say the same
        return None

    try:
        # explicit feeds first: they need no page at all (works even when the site 403s the HTML pages)
        f, entries = try_feeds(explicit_feeds)
        if entries:
            return feed_result(f, entries, notes)
        res = try_pages([tt["url"]])
        if res:
            return res
        # the site's XML sitemap (made for crawlers, and usually allowed even when pages are not)
        if tt.get("sitemap") is not False:
            items, via = sitemap_items(tt, category)
            if items:
                return _done(t0, group, name, items, "sitemap", via, notes)
            notes.append(f"no recent pages in its sitemap ({via})")
        res = try_pages(list(tt.get("urls", [])))     # other addresses listed for this source, only if the main one gave nothing
        if res:
            return res
        if probes:
            notes.append("feed probes: " + ", ".join(f"{n}x {w}" for w, n in probes.most_common(4)))
    except Exception as e:  # noqa: BLE001
        notes.append(f"unexpected: {e}")
    if probes and not any(n.startswith("feed probes") for n in notes):
        notes.append("feed probes: " + ", ".join(f"{n}x {w}" for w, n in probes.most_common(4)))
    return [], {"group": group, "name": name, "ok": False, "items": 0, "seconds": round(time.time() - t0),
                "error": "; ".join(dict.fromkeys(notes))[:900]}


def _done(t0, group, name, items, method, via, notes):
    items = [i for i in items if i["url"]]
    rec = {"group": group, "name": name, "ok": bool(items), "items": len(items), "method": method, "via": via, "seconds": round(time.time() - t0),
           "error": ("; ".join(dict.fromkeys(notes))[:900] if notes else "")}
    return items, rec




def collect_thinktank(tt: dict) -> tuple[list[dict], dict]:
    return collect_source(tt, "thinktank", "thinktanks")


# ------------------------------------------------------------------- media
def collect_media() -> tuple[list[dict], list[dict]]:
    """Each outlet's own RSS feeds (politics sections, Lib Dem tag pages), filtered to Lib Dem stories.
    Also returns Sarah Olney's coverage (any story naming her, in any of the feeds) for the Mall's Coverage page.
    Outlets without an open feed, or whose robots.txt refuses it, show in Source health; nothing is searched for
    them elsewhere."""
    cfg = CONFIG["media"]
    relevant = re.compile(cfg["title_pattern"], re.I)
    olney = re.compile(CONFIG.get("coverage", {}).get("pattern", r"Sarah Olney|\bOlney\b"), re.I)
    since = NOW - timedelta(days=int(cfg.get("lookback_days", 14)))
    items, coverage, seen, seen_cov = [], [], set(), set()
    body_days = float(CONFIG.get("coverage", {}).get("article_days", 2))
    unread: list[tuple[str, str, str, datetime | None]] = []   # recent stories whose headline does not name her: read the article itself
    for o in cfg["outlets"]:
        feeds = o.get("feeds", [])
        if not feeds and not o.get("url"):
            record("media", o["name"], False, 0, "no open RSS feed configured (Google News is not used: its robots.txt forbids bots)")
            continue
        n, got, why = 0, 0, []
        results = [(f, *_feed_entries(f)) for f in feeds]
        if o.get("url") and not any(e for _, e, _ in results):
            # the configured feeds moved: look for the feeds the outlet's own page advertises
            try:
                for f in [x for x in discover_feeds(o["url"], get(o["url"]).text) if x not in feeds][:6]:
                    entries, reason = _feed_entries(f)
                    results.append((f, entries, reason))
                    if len(entries) >= 3:
                        why.append(f"configured feed failed; found {f}")
                        break
            except Exception as e:  # noqa: BLE001
                why.append(f"{urlparse(o['url']).path or '/'}: {getattr(e, 'args', [e])[0]}")
        for f, entries, reason in results:
            if not entries:
                why.append(f"{urlparse(f).path or '/'}: {reason}")
                continue
            got += len(entries)
            for e in entries:
                title, summary = clean(e.get("title", ""), 300), clean(e.get("summary", ""))
                link = e.get("link", "")
                date = parse_date(e.get("published") or e.get("updated"))
                if not link or len(title) < 8 or (date and date < since):
                    continue
                if olney.search(title + " " + summary):
                    if link not in seen_cov:
                        seen_cov.add(link)
                        coverage.append({"covered_on": (date or NOW).astimezone(LONDON).date().isoformat(),
                                         "outlet": o["name"], "headline": title, "url": link})
                elif link not in seen_cov and (not date or date >= NOW - timedelta(days=body_days)):
                    seen_cov.add(link)
                    unread.append((o["name"], title, link, date))
                # headline or standfirst must be about the party (own-party sites are exempt)
                if not o.get("all") and not relevant.search(title + " " + summary):
                    continue
                key = (o["name"], title.lower())
                if key in seen or title.lower() == "liberal democrat voice":
                    continue
                seen.add(key)
                items.append(make_item("media", o["name"], title, link, date, summary))
                n += 1
        ok = got > 0     # a quiet fortnight is not a failure: only flag outlets whose feeds returned nothing at all
        found = [w for w in why if w.startswith("configured feed failed")]
        record("media", o["name"], ok, n, "; ".join(why) if not ok else "; ".join(found + ([] if n else [f"quiet: {got} recent stories, none about the Lib Dems"])))
    found = scan_articles(unread, olney, int(CONFIG.get("coverage", {}).get("max_articles", 150)))
    coverage += found
    print(f"media: {len(items)} items; Sarah Olney coverage: {len(coverage)} stories ({len(found)} found inside articles)")
    return items, coverage


def mentions(html: str, pattern: re.Pattern) -> bool:
    """Does the article's own text (not its menus, scripts or styles) name her?"""
    soup = BeautifulSoup(html, "lxml")
    for t in soup(["script", "style", "noscript", "nav", "header", "footer", "aside", "form"]):
        t.decompose()
    return bool(pattern.search(soup.get_text(" ", strip=True)))


def scan_articles(unread, pattern, limit: int) -> list[dict]:
    """Rolling check for ANY mention of Sarah Olney: open each recent story from the feeds that did not name her in its
    headline or standfirst and look in the article text. Pages go through get(): robots.txt is respected, hosts are spaced out."""
    from concurrent.futures import ThreadPoolExecutor
    todo = unread[:limit]

    def one(u):
        outlet, title, link, date = u
        try:
            if not mentions(get(link, timeout=(6, 15)).text, pattern):
                return None
        except Exception:  # noqa: BLE001
            return "skipped"
        return {"covered_on": (date or NOW).astimezone(LONDON).date().isoformat(), "outlet": outlet, "headline": title,
                "url": link, "notes": "Mentioned in the article text"}
    with ThreadPoolExecutor(max_workers=6) as ex:
        res = list(ex.map(one, todo))
    hits = [r for r in res if isinstance(r, dict)]
    skipped = sum(r == "skipped" for r in res)
    record("media", "Article scan (any mention of Sarah Olney)", bool(todo) and skipped < len(todo), len(hits),
           f"{len(todo)} articles read, {skipped} could not be opened (robots.txt, paywall or error)" + (f"; {len(unread) - len(todo)} left for the next run" if len(unread) > len(todo) else ""))
    return hits


# ------------------------------------------------------------ social media
SOCIAL_LOOKBACK_DAYS = 14


def first_line(text: str, n: int = 110) -> str:
    """The first line or so of a caption: enough to give the overall idea."""
    t = re.sub(r"\s+", " ", (text or "")).strip()
    if len(t) <= n:
        return t
    cut = t[:n].rsplit(" ", 1)[0]
    return cut.rstrip(" ,;:-") + "…"


def bsky_rows(org: str, handle: str, data: dict, since: datetime) -> list[dict]:
    rows = []
    for f in data.get("feed", []):
        post = f.get("post", {})
        if f.get("reason") or post.get("author", {}).get("handle", "").lower() != handle.lower():
            continue    # reposts are someone else's words
        rec = post.get("record", {})
        text, date = rec.get("text", ""), parse_date(rec.get("createdAt"))
        rkey = (post.get("uri") or "").rsplit("/", 1)[-1]
        if not text.strip() or not rkey or (date and date < since):
            continue
        rows.append({"organisation": org, "platform": "BlueSky", "posted_on": (date or NOW).astimezone(LONDON).date().isoformat(),
                     "summary": first_line(text), "url": f"https://bsky.app/profile/{handle}/post/{rkey}"})
    return rows


def feed_post_rows(org: str, platform: str, entries: list, since: datetime) -> list[dict]:
    """Posts from an open feed (Substack, YouTube, Mastodon), as rows for the Social Media Channels Tracker: { organisation, platform, posted_on, summary, url }."""
    rows = []
    for e in entries:
        date = parse_date(e.get("published") or e.get("updated"))
        text, link = clean(e.get("title", "") or e.get("summary", ""), 300), e.get("link", "")
        if not text or not link or (date and date < since):
            continue
        rows.append({"organisation": org, "platform": platform, "posted_on": (date or NOW).astimezone(LONDON).date().isoformat(),
                     "summary": first_line(text), "url": link})
    return rows


def substack_rows(org: str, entries: list, since: datetime) -> list[dict]:
    return feed_post_rows(org, "Substack", entries, since)


YOUTUBE_FEED = "https://www.youtube.com/feeds/videos.xml?channel_id="


def youtube_feed_url(handle: str) -> str | None:
    """The channel's own video feed (YouTube publishes one for every channel). A channel id (UC...) gives it directly; a @handle, /user/ or /c/ name is
    looked up on the channel's public page (robots.txt respected), which names the channel id."""
    h = handle.strip()
    m = re.search(r"(UC[\w-]{22})", h)
    if m:
        return YOUTUBE_FEED + m.group(1)
    path = h.removeprefix("https://www.youtube.com/").removeprefix("youtube.com/")
    path = path if path.startswith(("@", "user/", "c/", "channel/")) else "@" + path.lstrip("@")
    page = fetch(f"https://www.youtube.com/{path}", timeout=(6, 15))
    m = re.search(r'"(?:channelId|externalId)":"(UC[\w-]{22})"|youtube\.com/channel/(UC[\w-]{22})', page.text)
    return YOUTUBE_FEED + (m.group(1) or m.group(2)) if m else None


def mastodon_feed_url(handle: str) -> str | None:
    """A Mastodon account's own RSS feed: user@instance (or the profile link) gives https://instance/@user.rss."""
    h = handle.strip().removeprefix("https://").removeprefix("http://").lstrip("@")
    m = re.match(r"^([\w.-]+)@([\w.-]+\.[a-z]{2,})$", h, re.I) or re.match(r"^([\w.-]+\.[a-z]{2,})/@([\w.-]+)", h, re.I)
    if not m:
        return None
    user, host = (m.group(1), m.group(2)) if "@" in h.split("/")[0] else (m.group(2), m.group(1))
    return f"https://{host}/@{user}.rss"


def collect_social() -> list[dict]:
    """Posts from the accounts on Lovelace's Tracked accounts page that can be read openly: BlueSky (public API) and Substack (RSS).
    Each row is { organisation, platform, posted_on, summary, url }: the ingest function files it against its account in the Social Media Channels Tracker.
    Also YouTube (the channel's own feed) and Mastodon (the account's RSS feed): all of these are published for exactly this use.
    Instagram, Facebook, X, TikTok and LinkedIn do not offer an open feed and forbid scraping in their terms, so they are not read."""
    if not ingest_configured():
        print("social: INGEST_URL / INGEST_TOKEN not set, skipping")
        return []
    try:
        accounts = _ingest({"action": "social_accounts"}).get("accounts", [])
    except Exception as e:  # noqa: BLE001
        record("media", "Social accounts", False, 0, f"could not read the list of accounts: {e}")
        return []
    since = NOW - timedelta(days=SOCIAL_LOOKBACK_DAYS)
    rows: list[dict] = []
    for a in accounts:
        org, plat, handle = a["organisation"], a["platform"], (a.get("handle") or "").strip().lstrip("@")
        if plat not in ("BlueSky", "Substack", "YouTube", "Mastodon") or not handle:
            continue
        name = f"{org} on {plat}"
        try:
            if plat == "BlueSky":
                r = get("https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed",
                        params={"actor": handle, "limit": 30, "filter": "posts_no_replies"})
                got = bsky_rows(org, handle, r.json(), since)
            else:
                if plat == "Substack":
                    host = handle if "." in handle else f"{handle}.substack.com"
                    feed = f"https://{host}/feed"
                elif plat == "YouTube":
                    feed = youtube_feed_url(handle)
                else:
                    feed = mastodon_feed_url(handle)
                if not feed:
                    raise RuntimeError("could not work out the feed address from the handle")
                entries, why = _feed_entries(feed)
                if not entries:
                    raise RuntimeError(why)
                got = feed_post_rows(org, plat, entries, since)
            rows += got
            record("media", name, True, len(got), "" if got else "no posts in the last fortnight")
        except Exception as e:  # noqa: BLE001
            record("media", name, False, 0, getattr(e, "args", [e])[0])
    print(f"social: {len(rows)} posts from {len(accounts)} accounts with handles")
    return rows


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
    skip = re.compile(cfg["exclude_pattern"], re.I)
    items, seen = [], set()

    def add(source, title, url, date, direct=False):
        title = re.sub(r"\s+Article$", "", title.strip())
        key = re.sub(r"[^a-z0-9]", "", title.lower())
        if len(title) < 8 or skip.search(title) or key in seen:
            return False
        seen.add(key)
        date = date or date_from_title(title)
        items.append(make_item("polling", source, title, url, date, "", poll_kind_tags(title)))
        return True

    # Pages that list a pollster's write-ups directly (YouGov's article list and its News Tracker series).
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
    return items



# ------------------------------------------------------- political polling: relevance
def _rx(key: str) -> "re.Pattern":
    return re.compile(CONFIG["polling"]["political"][key], re.I)


def political_poll(title: str, summary: str = "") -> bool:
    """Only political polling: drops consumer/commercial polls and other countries' politics."""
    pc = CONFIG["polling"]["political"]
    if not hasattr(political_poll, "rx"):
        political_poll.rx = {k: re.compile(v, re.I) for k, v in pc.items()}
    rx = political_poll.rx
    uk = re.search(r"\b(uk|britain|british|westminster|england|scotland|wales)\b", title, re.I)
    if rx["abroad"].search(title) and not uk:
        return False
    if rx["core"].search(title):
        return True
    signal = re.compile(r"\b(polls?|polling|surveys?|voters?|britons|brits|public|support\w*|oppose|attitudes?|views?|opinion|think|believe|back|backed|"
                        r"favour\w*|trust|approve|concern\w*|priorit\w*|do you|would you|who|how (do|would|many)|per cent|%)\b", re.I)
    return bool(rx["policy"].search(title) and signal.search(title) and not rx["consumer"].search(title))


def poll_kind_tags(title: str) -> list[str]:
    """Specific tag first (it picks the type label), then the general ones."""
    t = title.lower()
    tags = []
    if re.search(r"\bmrp\b|seat projection|nowcast", t):
        tags.append("mrp")
    party_nums = re.findall(r"\b(?:lab(?:our)?|con(?:servatives?)?|ref(?:orm)?|ld|lib(?:eral)? dems?|gr(?:ee)?n|greens?|snp)\b\s*(?:at|on|up|down|\+|:)?\s*\d{1,2}\b", t)
    if re.search(r"voting[ -]intention|vote[ -]intention|westminster voting|poll of polls", t) or len(party_nums) >= 2:
        tags.append("voting-intention")
    if re.search(r"leader (rating|approval)|favourab|approval|net rating|popularity of|how do britons see|how (is|are) .* seen|most popular", t):
        tags.append("leader-ratings")
    if re.search(r"preferred prime minister|best prime minister|who would make the best", t):
        tags.append("preferred-pm")
    tags += [x for x in poll_tags(title) if x not in tags]
    if not any(x in tags for x in ("voting-intention", "party-support", "news-cycle", "mrp", "leader-ratings", "preferred-pm")):
        tags.append("policy-opinion")
    return tags


def collect_pollster_sources() -> list[dict]:
    """Pollsters' own sites and polling analysts, through the same self-healing collector as the think tanks
    (feed -> page -> Google News on their domain), then filtered to political polling only."""
    cfg = CONFIG["polling"]
    sources = [(dict(x, _analyst=False)) for x in cfg.get("pollsters", [])] + [(dict(x, _analyst=True)) for x in cfg.get("analysts", [])]
    items: list[dict] = []
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(lambda t: collect_source(t, "polling", "polling"), sources))
    for (got, rec), src in zip(results, sources):
        req = re.compile(src["require"], re.I) if src.get("require") else None
        keep = []
        for it in got:
            t = it["title"]
            if not political_poll(t, it.get("summary", "")) or (req and not req.search(t + " " + it.get("summary", ""))):
                continue
            it["tags"] = poll_kind_tags(t)
            if not it.get("published"):
                it["published"] = (date_from_url(it["url"]) or date_from_title(t) or None) and (date_from_url(it["url"]) or date_from_title(t)).isoformat()
            keep.append(it)
        dropped = len(got) - len(keep)
        rec["items"] = len(keep)
        rec["ok"] = bool(keep) or (rec["ok"] and dropped > 0)
        if dropped:
            rec["error"] = (rec.get("error", "") + f" | {dropped} non-political items dropped").strip(" |")
        health.append(rec)
        items += keep
    return items


def collect_polling() -> tuple[list[dict], list[dict]]:
    """Specific political polls and reports only, from the pollsters' own sites and polling analysts. Generic voting-intention
    averages (Wikipedia's tables) are deliberately not collected."""
    write_ups = collect_poll_articles() + collect_pollster_sources()
    out = [i for i in write_ups if political_poll(i["title"], i.get("summary", ""))]
    stats: dict = {}
    for it in out:
        st = stats.setdefault(it["source"], {"name": it["source"], "polls": 0, "last": None})
        st["polls"] += 1
        d = it.get("published")
        if d and (not st["last"] or d[:10] > st["last"]):
            st["last"] = d[:10]
    pollsters = sorted(stats.values(), key=lambda x: (x["last"] or "", x["polls"]), reverse=True)
    print(f"polling: {len(out)} polls and reports kept from {len(pollsters)} sources")
    return out, pollsters


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


def page_meta(url: str) -> tuple[datetime | None, str]:
    """Publication date (meta tags, <time>, JSON-LD) and headline (og:title, <h1>, <title>) from the article page."""
    soup = BeautifulSoup(get(url).text, "lxml")
    date = None
    for sel, attr in (('meta[property="article:published_time"]', "content"), ('meta[name="date"]', "content"),
                      ('meta[name="publication_date"]', "content"), ('meta[itemprop="datePublished"]', "content"),
                      ('meta[name="DC.date.issued"]', "content"), ('time[itemprop="datePublished"]', "datetime"),
                      ("time[datetime]", "datetime")):
        el = soup.select_one(sel)
        if el and el.get(attr):
            date = parse_date(el[attr])
            if date:
                break
    if not date:
        for sc in soup.find_all("script", type="application/ld+json"):
            m = re.search(r'"datePublished"\s*:\s*"([^"]+)"', sc.string or "")
            if m and parse_date(m.group(1)):
                date = parse_date(m.group(1))
                break
    title = ""
    og = soup.select_one('meta[property="og:title"]')
    if og and og.get("content"):
        title = og["content"]
    elif soup.h1:
        title = soup.h1.get_text(" ", strip=True)
    elif soup.title and soup.title.string:
        title = soup.title.string
    return date, clean(re.split(r"\s+[|–-]\s+[^|–-]{2,40}$", title.strip())[0], 300)


def enrich_dates(items: list[dict], limit: int = 60) -> None:
    """Fills in missing publication dates (and URL-derived titles from sitemaps) for think tank items: URL first (free),
    then the page itself (capped per run; requests are rate-limited per site)."""
    fetched = 0
    items = sorted(items, key=lambda i: not i.get("slug_title"))   # titles read from URLs are the most visible gap
    for it in items:
        need_title = it.get("slug_title")
        if (it.get("published") and not need_title) or it["category"] not in ("thinktank", "polling") or \
                (it["category"] == "polling" and not need_title):
            continue
        d = None if it.get("published") else (date_from_url(it["url"]) or date_from_title(it["title"]))
        if (not d or need_title) and fetched < limit and not it.get("date_checked") and it.get("date_tries", 0) < 3:
            fetched += 1
            try:
                pd_, title = page_meta(it["url"])
                d = d or pd_
                if title and len(title) > 8:
                    it["title"] = title
                it.pop("slug_title", None)
                if not d:
                    it["date_checked"] = True   # page fetched fine but states no date: do not ask again
            except Exception:  # noqa: BLE001
                it["date_tries"] = it.get("date_tries", 0) + 1   # network problem: retry on later runs, up to 3 times
        if d and not it.get("published"):
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
        if prev:
            # keep what earlier runs learned (a date or title read from the page) over this run's blanks
            for k in ("published", "summary"):
                if not it.get(k) and prev.get(k):
                    it[k] = prev[k]
            if it.get("slug_title") and not prev.get("slug_title"):
                it["title"] = prev["title"]
                it.pop("slug_title")
        old[it["id"]] = {**(prev or {}), **it}
    cutoff = NOW - timedelta(days=KEEP_DAYS)
    kept = []
    for it in list(old.values()):
        if is_noise(it):
            del old[it["id"]]
        elif it["category"] == "polling" and "poll-table" in it.get("tags", []):
            del old[it["id"]]   # rows that came from Wikipedia's generic poll tables: no longer collected, and removed from what is stored
        elif it["category"] == "polling":
            # political polling only, applied retroactively (taxonomy/filter edits clean up what is already stored)
            if not political_poll(it["title"], it.get("summary", "")):
                del old[it["id"]]
            else:
                it["tags"] = poll_kind_tags(it["title"])
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


def _ingest(payload: dict, timeout: int = 90) -> dict:
    url, token = os.environ.get("INGEST_URL"), os.environ.get("INGEST_TOKEN")
    r = requests.post(url, headers={"x-ingest-token": token, "content-type": "application/json"},
                      data=json.dumps(payload, separators=(",", ":")), timeout=timeout)
    r.raise_for_status()
    return r.json()


def ingest_configured() -> bool:
    return bool(os.environ.get("INGEST_URL") and os.environ.get("INGEST_TOKEN"))


def sync_state() -> None:
    """Fetch the previous run's feed/polls/health from the database into data/ulysse/, so first-seen times, dates and
    titles learned earlier carry over. Raises if the database cannot be read: starting from nothing would mark every
    stored item as new, so it is better to fail the run and leave the stored data as it is."""
    if not ingest_configured():
        print("INGEST_URL / INGEST_TOKEN not set: using the local data/ulysse/ files")
        return
    for name in ("feed", "polls", "health", "statscal"):
        js = _ingest({"action": "get", "name": name})
        if js.get("body") is not None:
            (DATA / f"{name}.json").write_text(json.dumps(js["body"]))
        elif name == "feed":
            print("no stored feed yet: starting fresh")


def london_data_rows(body: dict, today: date | None = None) -> list[dict]:
    """What the Stats calendar holds, for Lovelace's Daily Plan (London Politics): the London data drops (London Datastore, police data, items added by hand)
    and the Office for National Statistics releases go to "Data & Statistics"; the GLA's meetings go to "Political Events". The other national releases stay on LUCIEN's calendar.
    One row per item and date: { key, date, title, url, starts, section }."""
    today = today or NOW.astimezone(LONDON).date()
    out = []
    for r in body.get("releases", []):
        tier, system = r.get("tier"), r.get("source_system")
        if r.get("kind") not in ("published", "upcoming") or r.get("cancelled"):
            continue
        if tier == "london" and system in ("london_datastore", "police_uk", "manual"):
            section, lo, hi = "data", today - timedelta(days=30), today + timedelta(days=90)
        elif tier == "london" and system == "gla_meetings":
            section, lo, hi = "political", today - timedelta(days=7), today + timedelta(days=90)
        elif tier == "ons":
            section, lo, hi = "data", today - timedelta(days=7), today + timedelta(days=45)
        else:
            continue
        try:
            when = date.fromisoformat(str(r.get("date"))[:10])
        except ValueError:
            continue
        if not lo <= when <= hi:
            continue
        note = " (published)" if r["kind"] == "published" else (" (date not yet confirmed)" if r.get("date_status") == "estimated" else "")
        starts = None
        if r.get("date_precision") == "time" and r.get("datetime"):
            starts = str(r["datetime"])[11:16] or None
        out.append({"key": f"statscal:{r.get('id')}:{when.isoformat()}", "date": when.isoformat(), "section": section,
                    "title": f"{r.get('publisher', 'London')}: {r.get('title', '')}{note}"[:400], "url": r.get("url") or "", "starts": starts})
    out.sort(key=lambda x: x["date"])
    return out[:600]


LIBDEM_EVENTS_URL = "https://events.libdems.org.uk/"
LIBDEM_EVENTS_PARAMS = {"organiser_group": "london", "date_filter": "", "category_filter": ""}   # the "London" group only
_DT = re.compile(r"(\d{1,2})(?:st|nd|rd|th)\s+([A-Z][a-z]{2})\s+(\d{4})(?:\s+(\d{1,2})(?::(\d\d))?\s*(am|pm))?")


def libdem_event_rows(html: str, today: date | None = None) -> list[dict]:
    """The Liberal Democrats' London events (events.libdems.org.uk, organiser group London), for Lovelace's Daily Plan (Internal Campaign > Membership Engagement).
    One row per event: { key, date, title, url, starts }. An event that runs for more than a week (a membership year, say) is left out; so are events already over."""
    today = today or NOW.astimezone(LONDON).date()
    out, seen = [], set()
    for card in BeautifulSoup(html, "html.parser").select("article.event"):
        a = card.select_one(".event-title a[href]")
        when = card.select_one(".event-date")
        if not a or not when:
            continue
        spans = [sp.get_text(" ", strip=True) for sp in when.find_all("span") if "event-date-timezone" not in (sp.get("class") or [])]
        m = _DT.search(spans[0]) if spans else None
        if not m:
            continue
        try:
            day = datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%d %b %Y").date()
        except ValueError:
            continue
        if len(spans) > 1:   # "start - end": a long-running event is not a day's event
            e = _DT.search(spans[1])
            try:
                if e and (datetime.strptime(f"{e.group(1)} {e.group(2)} {e.group(3)}", "%d %b %Y").date() - day).days > 7:
                    continue
            except ValueError:
                pass
        if day < today:
            continue
        starts = None
        if m.group(4):
            hour = int(m.group(4)) % 12 + (12 if m.group(6) == "pm" else 0)
            starts = f"{hour:02d}:{m.group(5) or '00'}"
        url = a["href"].strip()
        eid = (re.search(r"/events/(\d+)", url) or [None, hashlib.sha1(url.encode()).hexdigest()[:10]])[1]
        key = f"libdemev:{eid}:{day.isoformat()}"
        title = a.get_text(" ", strip=True)[:400]
        if key in seen or not title or not url.startswith("https://events.libdems.org.uk/"):
            continue
        seen.add(key)
        out.append({"key": key, "date": day.isoformat(), "title": title, "url": url, "starts": starts})
    out.sort(key=lambda x: (x["date"], x["starts"] or ""))
    return out[:600]


def collect_libdem_events() -> list[dict]:
    try:
        rows = libdem_event_rows(get(LIBDEM_EVENTS_URL, params=LIBDEM_EVENTS_PARAMS).text)
        print(f"lib dem london events: {len(rows)} upcoming")
        return rows
    except Exception as e:  # noqa: BLE001
        print(f"lib dem london events failed: {e}", file=sys.stderr)
        return []


WHATSON_API = "https://whatson-api.parliament.uk/calendar/events/list.json"
WHATSON_DAYS = 28
_WO_TYPE = {"main chamber": "Chamber", "select & joint committees": "Committee", "general committee": "General Committee", "grand committee": "Grand Committee",
            "westminster hall": "Westminster Hall"}


def whatson_event_rows(events: list[dict], today: date | None = None) -> list[dict]:
    """The UK Parliament's What's On calendar (both Houses and joint committees), for Lovelace's Daily Plan (London Politics > Political Events).
    Cancelled events and committees' private meetings are left out. One row per event: { key, date, title, url, starts }."""
    today = today or NOW.astimezone(LONDON).date()
    hi = today + timedelta(days=WHATSON_DAYS)
    out = []
    for e in events or []:
        if e.get("CancelledDate") or str(e.get("Category") or "").strip().lower() == "private meeting" or not e.get("Id"):
            continue
        try:
            day = date.fromisoformat(str(e.get("StartDate") or "")[:10])
        except ValueError:
            continue
        if not today <= day <= hi:
            continue
        what = re.sub(r"\s+", " ", str(e.get("Description") or "")).strip() or ((e.get("Committee") or {}).get("Description") or "") or str(e.get("Category") or "").strip()
        cat = str(e.get("Category") or "").strip()
        if cat and cat.lower() not in what.lower():
            what = f"{what} ({cat})"
        house = {"Commons": "Commons", "Lords": "Lords", "Joint": "Joint"}.get(str(e.get("House") or ""), "")
        kind = _WO_TYPE.get(str(e.get("Type") or "").strip().lower(), str(e.get("Type") or "").strip())
        title = f"{' '.join(x for x in (house, kind) if x)}: {what}"[:400]
        starts = str(e.get("StartTime") or "")[:5] or None
        out.append({"key": f"whatson:{e['Id']}", "date": day.isoformat(), "title": title, "starts": starts, "url": f"https://whatson.parliament.uk/event/cal{e['Id']}"})
    out.sort(key=lambda x: (x["date"], x["starts"] or ""))
    return out[:600]


def collect_whatson_events() -> list[dict]:
    today = NOW.astimezone(LONDON).date()
    events: list[dict] = []
    try:
        for first in range(0, WHATSON_DAYS + 1, 14):   # a fortnight at a time keeps each reply small
            start = today + timedelta(days=first)
            end = min(start + timedelta(days=13), today + timedelta(days=WHATSON_DAYS))
            events += get(WHATSON_API, params={"queryParameters.startDate": start.isoformat(), "queryParameters.endDate": end.isoformat()}, headers={"Accept": "application/json"}).json()
        rows = whatson_event_rows({str(e.get("Id")): e for e in events}.values(), today)
        print(f"parliament what's on: {len(rows)} events in the next {WHATSON_DAYS} days")
        return rows
    except Exception as e:  # noqa: BLE001
        print(f"parliament what's on failed: {e}", file=sys.stderr)
        return []


# -------------------------------------------------- the permanent archive (LUCIEN > Archive)
ARCHIVE_FROM_YEAR = 1995   # the earliest year the Parliament Committees API holds publications for (checked: nothing before 1995)
ARCHIVE_CHUNK = 500


def committee_type_ids() -> list[int]:
    """The ids of the publication types the feed keeps (reports, special reports, government responses), read from the API's own list."""
    cfg = CONFIG["committees"]
    url = cfg["api"].rsplit("/", 1)[0] + "/PublicationType"
    rows = get(url).json()
    return [t["id"] for t in rows if any(k in str(t.get("name", "")).lower() for k in cfg["keep_types"])]


HISTORY_BUDGET_S = 20 * 60   # one run loads as many years as fit in this; the next run carries on from where the archive stops


def collect_committee_history(start_year: int | None = None, first_year: int = ARCHIVE_FROM_YEAR) -> list[dict]:
    """Every select committee report and government response from `start_year` back to `first_year`, newest year first, from the Parliament Committees API.
    It stops when the time budget is used up; the archive then holds the newest years and the next run carries on with the older ones."""
    cfg = CONFIG["committees"]
    items: list[dict] = []
    try:
        ids = committee_type_ids()
    except Exception as e:  # noqa: BLE001
        print(f"committee history: could not read the publication types: {e}", file=sys.stderr)
        return items
    began = time.time()
    for year in range((start_year or NOW.year), first_year - 1, -1):
        if time.time() - began > HISTORY_BUDGET_S:
            print(f"committee history: time is up at {year}; the next run carries on")
            break
        try:
            skip = 0
            while skip < 5000:
                js = get(cfg["api"], params={"StartDate": f"{year}-01-01", "EndDate": f"{year}-12-31", "PublicationTypeIds": ids, "Take": 100, "Skip": skip}).json()
                rows = js.get("items") or []
                for row in rows:
                    it = _committee_row(row, cfg["keep_types"])
                    if it:
                        items.append(it)
                if len(rows) < 100:
                    break
                skip += 100
        except Exception as e:  # noqa: BLE001
            print(f"committee history {year} failed: {e}", file=sys.stderr)
    print(f"committee history: {len(items)} reports and government responses")
    return items


def archive_history_start() -> int | None:
    """The year to load committee history from (and back to 2010): this year for a fresh archive, otherwise the oldest year the archive holds so far.
    None when the archive already reaches back to 2010. ARCHIVE_HISTORY=1 loads it all again by hand."""
    if os.environ.get("ARCHIVE_HISTORY"):
        return NOW.year
    if not ingest_configured():
        return None
    try:
        oldest = _ingest({"action": "archive_status"}).get("oldest_committee")
    except Exception as e:  # noqa: BLE001
        print(f"archive status failed: {e}", file=sys.stderr)
        return None
    if not oldest:
        return NOW.year
    year = int(str(oldest)[:4])
    return year if year > ARCHIVE_FROM_YEAR else None


def upload_archive(items: list[dict]) -> bool:
    """Keep every item the collector has (not only the last 180 days) in the permanent archive."""
    if not items or not ingest_configured():
        return True
    ok, stored = True, 0
    for i in range(0, len(items), ARCHIVE_CHUNK):
        try:
            stored += int(_ingest({"action": "archive", "rows": items[i:i + ARCHIVE_CHUNK]}).get("stored", 0))
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"archive upload failed: {e}", file=sys.stderr)
    print(f"archive: {stored} items kept")
    return ok


def econ_due() -> bool:
    """The economic statistics change monthly or less, so they are loaded about weekly (ECON_FORCE=1 loads them now)."""
    if os.environ.get("ECON_FORCE"):
        return True
    if not ingest_configured():
        return False
    try:
        last = _ingest({"action": "econ_status"}).get("last_fetched")
    except Exception as e:  # noqa: BLE001
        print(f"economic data status failed: {e}", file=sys.stderr)
        return False
    if not last:
        return True
    return NOW - parse_date(last) > timedelta(days=ECON_EVERY_DAYS)


ECON_EVERY_DAYS = 6


def upload_econ(rows: list[dict]) -> bool:
    if not rows or not ingest_configured():
        return True
    ok, stored = True, 0
    for i in range(0, len(rows), 1000):
        try:
            stored += int(_ingest({"action": "econ_data", "rows": rows[i:i + 1000]}).get("stored", 0))
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"economic data upload failed: {e}", file=sys.stderr)
    print(f"economic data: {stored} figures stored")
    return ok


def upload(coverage: list[dict] | None = None, social_posts: list[dict] | None = None, london_data: list[dict] | None = None, events: list[dict] | None = None, parliament: list[dict] | None = None) -> bool:
    """Push feed/polls/health (and any new Sarah Olney coverage and social posts) through the ingest function."""
    if not ingest_configured():
        print("INGEST_URL / INGEST_TOKEN not set: data written locally only, not uploaded")
        return True
    ok = True
    for name in ("feed", "polls", "health", "statscal"):
        f = DATA / f"{name}.json"
        if not f.exists():
            continue
        try:
            _ingest({"name": name, "body": json.loads(f.read_text())})
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"upload of {name} failed: {e}", file=sys.stderr)
    if coverage:
        try:
            print(f"coverage: {_ingest({'action': 'coverage', 'rows': coverage}).get('added', 0)} new stories added to Lovelace's Media trackers")
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"coverage upload failed: {e}", file=sys.stderr)
    if london_data:
        try:
            print(f"london: {_ingest({'action': 'london_data', 'rows': london_data}).get('added', 0)} new GLA / London data drops added to Lovelace's Daily Plan")
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"london data upload failed: {e}", file=sys.stderr)
    if events:
        try:
            print(f"events: {_ingest({'action': 'membership_events', 'rows': events}).get('added', 0)} new Lib Dem London events added to Membership Engagement")
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"events upload failed: {e}", file=sys.stderr)
    if parliament:
        try:
            print(f"parliament: {_ingest({'action': 'parliament_events', 'rows': parliament}).get('added', 0)} new Parliament events added to London Politics")
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"parliament events upload failed: {e}", file=sys.stderr)
    if social_posts:
        try:
            print(f"social: {_ingest({'action': 'social_posts', 'rows': social_posts}).get('added', 0)} new posts added to the Social Media Channels Tracker")
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"social post upload failed: {e}", file=sys.stderr)
    return ok


def write(name: str, body: dict) -> None:
    (DATA / f"{name}.json").write_text(json.dumps(body, separators=(",", ":")))


UPDATE_HOURS = (6, 18)   # London time: the data is renewed at 6am and 6pm (the same two times as LIBBY's refresh, lib/libby/schedule.js)


def last_slot_start(now: datetime) -> datetime:
    """The start of the update slot we are in: the most recent 6am or 6pm London at or before `now`, in UTC."""
    local = now.astimezone(LONDON)
    slots = [datetime(d.year, d.month, d.day, h, tzinfo=LONDON) for d in (local, local - timedelta(days=1)) for h in UPDATE_HOURS]
    return max(t for t in slots if t <= now).astimezone(timezone.utc)


def update_is_due(last_updated: str | None, now: datetime | None = None) -> bool:
    """True if nothing has been collected since the current slot began. GitHub starts timed runs hours late and sometimes drops one, so the question is
    not "is it 6am?" but "has it been updated since the last 6am or 6pm?". A missing or unreadable time counts as never."""
    now = now or datetime.now(timezone.utc)
    try:
        last = dtparse.parse(last_updated)
    except (TypeError, ValueError, OverflowError):
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return last < last_slot_start(now)


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    global ENRICH
    only = set(sys.argv[1:])  # e.g. `update.py media polling`
    sync_state()
    if os.environ.get("ONLY_IF_DUE") and not only:   # a timed run (the workflow sets this) does nothing if the data was already renewed for this slot
        try:
            last = json.loads((DATA / "feed.json").read_text()).get("updated")
        except (OSError, ValueError):
            last = None
        if not update_is_due(last):
            print(f"already updated for this slot (last update {last}): nothing to do")
            return 0
        print(f"update due (last update {last}): collecting")
    if "reclassify" in only:      # re-apply taxonomy to stored items without collecting
        ENRICH = False
        feed = merge([])
        write("feed", {"updated": NOW.isoformat(), "items": feed})
        print(f"{len(feed)} items re-classified")
        return 0 if upload() else 1
    groups = {"committees", "thinktanks", "media", "polling", "statscal", "events", "parliament", "economic"}
    run = lambda k: not only or k in only  # noqa: E731
    items: list[dict] = []
    coverage: list[dict] = []
    social_posts: list[dict] = []
    london_data: list[dict] = []
    events: list[dict] = []
    parliament: list[dict] = []
    if run("parliament"):
        parliament = collect_whatson_events()
    if run("events"):
        events = collect_libdem_events()
    if run("committees"):
        items += collect_committees()
    if run("thinktanks"):
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=4) as ex:
            for got, rec in ex.map(collect_thinktank, CONFIG["thinktanks"]):
                items += got
                health.append(rec)
    if run("media"):
        got, coverage = collect_media()
        items += got
        social_posts = collect_social()
    if run("polling"):
        poll_items, pollsters = collect_polling()
        items += poll_items
        write("polls", {"updated": NOW.isoformat(), "rows": [], "pollsters": pollsters})
    if run("statscal"):   # the Stats calendar (tracker/statscal.py): its sources fail one by one without stopping anything else
        import statscal
        try:
            prev = json.loads((DATA / "statscal.json").read_text())
        except (OSError, ValueError):
            prev = None
        body, got_health = statscal.run(prev)
        write("statscal", body)
        london_data = london_data_rows(body)
        health.extend(got_health)
        print(f"stats calendar: {len(body['releases'])} releases, {sum(s['ok'] for s in body['sources'])}/{len(body['sources'])} sources ok")
    feed = merge(items)
    write("feed", {"updated": NOW.isoformat(), "items": feed})
    history: list[dict] = []
    econ: list[dict] = []
    if run("economic") and econ_due():   # Nomis: labour market and census figures by age, sex and region (tracker/econdata.py)
        import econdata
        econ = econdata.collect(get, lambda name, ok, n, err: record("economic", f"Nomis: {name}", ok, n, err))
    start_year = archive_history_start() if run("committees") else None
    if start_year:   # a new archive is filled with every committee report since 2010, newest first, a few years per run
        history = collect_committee_history(start_year)
        now_iso = NOW.isoformat()
        for it in history:
            it["first_seen"] = it.get("published") or now_iso
            classify(it)
    if only:   # a partial run keeps the other groups' last known health
        try:
            prev = json.loads((DATA / "health.json").read_text()).get("sources", [])
            ran = {g for g in groups if run(g)}
            health[:0] = [h for h in prev if h.get("group") not in ran]
        except Exception:  # noqa: BLE001
            pass
    write("health", {"updated": NOW.isoformat(), "sources": health})
    ok = sum(h["ok"] for h in health)
    print(f"{len(feed)} items stored; {ok}/{len(health)} sources returned data")
    return 0 if upload(coverage, social_posts, london_data, events, parliament) and upload_archive(list({i["id"]: i for i in history + feed}.values())) and upload_econ(econ) else 1


if __name__ == "__main__":
    sys.exit(main())
