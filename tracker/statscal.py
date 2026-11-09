"""Stats calendar: upcoming and recently published data releases from UK public-sector bodies (LUCIEN > Stats calendar).

Sources (all official APIs or machine-readable files; see docs/release-calendar/SOURCES.md for what each returned when probed):
  ONS release calendar API, GOV.UK Search API (statistics announcements + published statistics), London Datastore (CKAN-style API),
  data.police.uk, and a hand-kept file for what has no API (TfL, Met, MOPAC).
Each source runs on its own: one that fails leaves its last good records in place (flagged stale in the source list) and never stops the others.
Output is one JSON body (releases, changes, sources) that update.py stores in the database as "statscal".
Dates are never invented: a source with no forward date gives published items, plus an *estimated* next update only when our own history shows a regular rhythm.
"""
from __future__ import annotations

import hashlib
import html as htmllib
import re
import statistics
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib import robotparser
from urllib.parse import quote, urljoin, urlparse
from zoneinfo import ZoneInfo

import requests
import yaml
from dateutil import parser as dtparse

LONDON = ZoneInfo("Europe/London")
ROOT = Path(__file__).resolve().parent.parent
UA = "athena-stats-calendar/1.0 (+https://github.com/UlysseAbbate/ATHENA)"
TIMEOUT = 30
ONS_API = "https://api.beta.ons.gov.uk/v1/search/releases"
GOVUK_SEARCH = "https://www.gov.uk/api/search.json"
LDS_SEARCH = "https://data.london.gov.uk/api/action/package_search"
POLICE = "https://data.police.uk/api"

_session = requests.Session()
_session.headers.update({"User-Agent": UA, "Accept": "application/json"})
_sleep = time.sleep   # replaced in tests


def load_config() -> dict:
    return yaml.safe_load((ROOT / "config" / "statscal.yml").read_text())


# ------------------------------------------------------------------ http
def get_json(url: str, params=None):
    """GET with a timeout, retries with backoff on 429/5xx (honouring Retry-After), and a small pause so we never hammer one host."""
    last = None
    for attempt in range(4):
        try:
            r = _session.get(url, params=params, timeout=TIMEOUT)
            if r.status_code in (429, 500, 502, 503, 504):
                wait = r.headers.get("Retry-After", "")
                _sleep(min(int(wait), 60) if wait.isdigit() else 2 ** (attempt + 1))
                last = RuntimeError(f"HTTP {r.status_code}")
                continue
            r.raise_for_status()
            _sleep(0.3)
            return r.json()
        except (requests.RequestException, ValueError) as e:
            last = e
            _sleep(2 ** (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def get_text(url: str) -> str:
    """Like get_json for HTML pages (same retries and politeness)."""
    last = None
    for attempt in range(4):
        try:
            r = _session.get(url, timeout=TIMEOUT, headers={"Accept": "text/html"})
            if r.status_code in (429, 500, 502, 503, 504):
                wait = r.headers.get("Retry-After", "")
                _sleep(min(int(wait), 60) if wait.isdigit() else 2 ** (attempt + 1))
                last = RuntimeError(f"HTTP {r.status_code}")
                continue
            r.raise_for_status()
            _sleep(0.3)
            return r.text
        except requests.RequestException as e:
            last = e
            _sleep(2 ** (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


_robots: dict = {}


def robots_allows(url: str) -> bool:
    """Pages are only read where the site's robots.txt allows bots. An unreadable robots.txt counts as not allowed."""
    host = urlparse(url)
    root = f"{host.scheme}://{host.netloc}"
    if root not in _robots:
        rp = robotparser.RobotFileParser()
        try:
            r = _session.get(root + "/robots.txt", timeout=TIMEOUT)
            if r.status_code == 200:
                rp.parse(r.text.splitlines())
            _robots[root] = rp if r.status_code == 200 else None
        except requests.RequestException:
            _robots[root] = None
    rp = _robots[root]
    return bool(rp and rp.can_fetch(UA, url))


# ------------------------------------------------------------------ dates
def london(dt: datetime) -> datetime:
    return dt.astimezone(LONDON)


def parse_ts(s: str) -> datetime | None:
    try:
        d = dtparse.parse(s)
    except (TypeError, ValueError, OverflowError):
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d if d.year >= 2000 else None   # GOV.UK holds a few corrupt old dates (year 0020)


def precision_from_text(text: str) -> str:
    """'23 July 2027 7:00am' -> day; 'November 2026' -> month; 'Q2 2027' / 'Autumn 2027' -> quarter."""
    t = (text or "").strip()
    if re.match(r"^\d{1,2}\s", t):
        return "day"
    if re.search(r"\bQ[1-4]\b|quarter|spring|summer|autumn|winter", t, re.I):
        return "quarter"
    return "month" if t else "day"


def make_id(*parts) -> str:
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


def release(**kw) -> dict:
    base = {"category": "release", "summary": "", "datetime": None, "date_precision": "day", "date_status": "confirmed", "previous_dates": [],
            "cancelled": False, "cancellation_notice": "", "official_status": None, "url": "", "links": []}
    base.update(kw)
    return base


# ------------------------------------------------------------------ ONS
def ons_record(r: dict, kind: str) -> dict | None:
    d = r.get("description") or {}
    when = parse_ts(d.get("release_date"))
    if not when:
        return None
    loc = london(when)
    provisional = not d.get("finalised", True)
    precision = precision_from_text(d.get("provisional_date", "")) if provisional and d.get("provisional_date") else "day"
    cancelled = bool(d.get("cancelled"))
    prev = []
    for ch in r.get("date_changes") or []:
        pd = parse_ts(ch.get("previous_date"))
        if pd:
            prev.append({"date": london(pd).date().isoformat(), "change_notice": (ch.get("change_notice") or "")[:400], "changed_at": None})
    return release(
        id="ons:" + r["uri"], title=d.get("title", ""), summary=(d.get("summary") or "")[:400],
        publisher="Office for National Statistics", publisher_slug="office-for-national-statistics", tier="ons", source_system="ons_api",
        kind="cancelled" if cancelled else ("published" if d.get("published") or kind == "published" else "upcoming"),
        date=loc.date().isoformat(), datetime=loc.isoformat() if precision == "day" else None, date_precision=precision,
        date_status="provisional" if provisional else "confirmed", previous_dates=prev, cancelled=cancelled,
        official_status="Official statistics", url="https://www.ons.gov.uk" + r["uri"])


def fetch_ons(now: datetime, cfg: dict) -> list[dict]:
    today = london(now).date()
    since = (today - timedelta(days=cfg["windows"]["published_days"])).isoformat()
    out: dict[str, dict] = {}
    for kind, release_type, extra in (("upcoming", "type-upcoming", {}),
                                      ("cancelled", "type-cancelled", {"fromDate": today.isoformat()}),
                                      ("published", "type-published", {"fromDate": since, "sort": "release_date_desc"})):
        offset = 0
        while True:
            page = get_json(ONS_API, {"release-type": release_type, "limit": 100, "offset": offset, **extra})
            rows = page.get("releases") or []
            for r in rows:
                rec = ons_record(r, kind)
                if rec and (rec["id"] not in out or kind != "upcoming"):
                    out[rec["id"]] = rec
            offset += 100
            if len(rows) < 100 or offset >= 2000:
                break
    return list(out.values())


# ------------------------------------------------------------------ GOV.UK
GOV_FIELDS = ["title", "link", "release_timestamp", "statistics_announcement_state", "display_type", "organisations", "public_timestamp"]


def govuk_pages(params: list) -> list[dict]:
    """All results of one search, a page at a time (GOV.UK stops at about 1,500 per query, so callers ask per organisation)."""
    out, start = [], 0
    while start < 1500:
        page = get_json(GOVUK_SEARCH, params + [("count", 500), ("start", start)] + [("fields", f) for f in GOV_FIELDS])
        rows = page.get("results") or []
        out += rows
        start += 500
        if len(rows) < 500 or start >= (page.get("total") or 0):
            break
    return out


def org_excluded(slug: str, cfg: dict) -> bool:
    g = cfg["govuk"]
    return slug in g.get("exclude_slugs", []) or slug in g.get("skip_slugs", []) or any(s in slug for s in g.get("exclude_slug_contains", []))


def gov_announcement(r: dict, org: dict, cfg: dict, today: date) -> dict | None:
    ts = parse_ts(r.get("release_timestamp"))
    if not ts:
        return None
    loc = london(ts)
    state = r.get("statistics_announcement_state") or "provisional"
    # a provisional announcement with only a month is dated to the last second of that month
    month_only = state == "provisional" and loc.hour == 23 and loc.minute == 59
    kind = "cancelled" if state == "cancelled" else "upcoming"
    names = [o.get("title") for o in r.get("organisations") or [] if o.get("title")]
    return release(
        id="govuk:" + r["link"], title=r.get("title", ""), publisher=names[0] if names else org["slug"], publisher_slug=org["slug"],
        tier=org["tier"], source_system="govuk_search", kind=kind, date=loc.date().isoformat(),
        datetime=None if month_only else loc.isoformat(), date_precision="month" if month_only else "day",
        date_status="provisional" if state == "provisional" else "confirmed", cancelled=kind == "cancelled",
        official_status=r.get("display_type"), url="https://www.gov.uk" + r["link"])


def gov_published(r: dict, org: dict) -> dict | None:
    ts = parse_ts(r.get("public_timestamp"))
    if not ts:
        return None
    loc = london(ts)
    names = [o.get("title") for o in r.get("organisations") or [] if o.get("title")]
    return release(
        id="govuk:" + r["link"], title=r.get("title", ""), publisher=names[0] if names else org["slug"], publisher_slug=org["slug"],
        tier=org["tier"], source_system="govuk_search", kind="published", date=loc.date().isoformat(), datetime=loc.isoformat(),
        url="https://www.gov.uk" + r["link"])


def fetch_govuk(now: datetime, cfg: dict) -> list[dict]:
    today = london(now).date()
    back = (today - timedelta(days=cfg["windows"]["published_days"])).isoformat()
    out: dict[str, dict] = {}
    failures = []
    for org in cfg["govuk"]["organisations"]:
        if org_excluded(org["slug"], cfg):
            continue
        try:
            for r in govuk_pages([("filter_format", "statistics_announcement"), ("filter_organisations", org["slug"]),
                                  ("filter_release_timestamp", f"from:{today.isoformat()}"), ("order", "release_timestamp")]):
                rec = gov_announcement(r, org, cfg, today)
                if rec:
                    out[rec["id"]] = rec
            for r in govuk_pages([("filter_content_store_document_type", t) for t in ("official_statistics", "national_statistics", "statistical_data_set")]
                                 + [("filter_organisations", org["slug"]), ("filter_public_timestamp", f"from:{back}"), ("order", "-public_timestamp")]):
                rec = gov_published(r, org)
                if rec and rec["id"] not in out:
                    out[rec["id"]] = rec
        except RuntimeError as e:
            failures.append(f"{org['slug']}: {e}")
    if failures and not out:
        raise RuntimeError("; ".join(failures[:3]))
    if failures:
        raise PartialFailure(list(out.values()), failures)
    return list(out.values())


class PartialFailure(Exception):
    """Some of a source's requests failed: its records are used, and the failure is reported."""
    def __init__(self, records, failures):
        super().__init__(f"{len(failures)} request(s) failed, e.g. {failures[0]}")
        self.records = records


# ------------------------------------------------------------------ London Datastore
def lds_publisher(maintainer: str, author: str, cfg: dict) -> str:
    names = cfg["london"]["maintainer_publishers"]
    for who in (maintainer, author):
        if who in names:
            return names[who]
    return cfg["london"]["default_publisher"]


def fetch_london(now: datetime, cfg: dict) -> list[dict]:
    """Datasets changed in the last 14 days, newest first (the API ignores date filters, so we page until we pass the window)."""
    since = now - timedelta(days=cfg["windows"]["published_days"])
    out, start = [], 0
    while start < 1000:
        page = get_json(LDS_SEARCH, {"q": "*:*", "sort": "metadata_modified desc", "rows": 100, "start": start})
        rows = (page.get("result") or {}).get("result") or []
        stop = False
        for p in rows:
            mod = parse_ts(p.get("metadata_modified"))
            if not mod or mod < since:
                stop = True
                break
            loc = london(mod)
            publisher = lds_publisher(p.get("maintainer", ""), p.get("author", ""), cfg)
            out.append(release(
                id="lds:" + p["id"], title=p.get("title", ""), publisher=publisher, publisher_slug=re.sub(r"[^a-z0-9]+", "-", publisher.lower()).strip("-"),
                tier="london", source_system="london_datastore", kind="published", date=loc.date().isoformat(), datetime=loc.isoformat(),
                url=f"https://data.london.gov.uk/dataset/{p.get('name') or p['id']}", update_dates=[loc.date().isoformat()]))
        start += 100
        if stop or len(rows) < 100:
            break
    return out


# ------------------------------------------------------------------ police.uk
def fetch_police(now: datetime, cfg: dict) -> list[dict]:
    last = get_json(f"{POLICE}/crime-last-updated").get("date", "")
    months = get_json(f"{POLICE}/crimes-street-dates")
    avail = sorted({m["date"] for m in months if m.get("date")}, reverse=True)
    newest = avail[0] if avail else last[:7]
    if not newest:
        raise RuntimeError("no months returned")
    label = dtparse.parse(newest + "-01").strftime("%B %Y")
    today = london(now).date().isoformat()
    return [release(id="police:" + newest, title=f"Police.uk street-level crime data, {label}", publisher="data.police.uk (all forces)", publisher_slug="data-police-uk",
                    tier="london", source_system="police_uk", kind="published", date=today, date_precision="day",
                    summary="New month of street-level crime and outcomes data for the forces of England, Wales and Northern Ireland, including the Met.",
                    url="https://data.police.uk/data/")]


# ------------------------------------------------------------------ modern.gov meeting calendars (GLA / London Assembly)
EVENT_RE = re.compile(r"<li>\s*([^<]*?)\s*<a id='M(\d+)'[^>]*?href=\"([^\"]+)\"[^>]*?title=\"([^\"]+)\"(.*?)</li>", re.S)
TITLE_RE = re.compile(r"^(?:Meeting of\s+)?(.*?),\s*(\d{2})/(\d{2})/(\d{4})\s+(\d{1,2})[.:](\d{2})\s*(am|pm)?", re.I)


def tag_text(s: str) -> str:
    text = re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", s))).strip()
    return re.sub(r"\s+(PDF|DOCX?|XLSX?)\s+\d+(\.\d+)?\s*[KMG]B$", "", text)   # the file-size note modern.gov puts after a link


def parse_moderngov_month(page: str, base: str) -> list[dict]:
    """Meetings in one month view: committee, London start time, link to the meeting's documents page, cancelled or not."""
    out = []
    for _time, mid, href, title, rest in EVENT_RE.findall(page):
        m = TITLE_RE.match(htmllib.unescape(title).strip())
        if not m:
            continue
        name, dd, mm, yyyy, hh, mi, ap = m.groups()
        hour = int(hh) % 12 + (12 if (ap or "").lower() == "pm" else 0) if ap else int(hh)
        when = datetime(int(yyyy), int(mm), int(dd), hour, int(mi), tzinfo=LONDON)
        out.append({"mid": mid, "name": name.strip(), "when": when, "url": urljoin(base + "/", htmllib.unescape(href)),
                    "cancelled": bool(re.search(r"cancel|postpone", htmllib.unescape(title) + tag_text(rest), re.I))})
    return out


def parse_moderngov_documents(page: str, url: str) -> tuple[list[str], list[dict]]:
    """The numbered agenda items and the main documents (agenda frontsheet, reports pack, minutes) of one meeting."""
    items = []
    for num, title in re.findall(r'<td\s+class="mgItemNumberCell"[^>]*>(.*?)</td>\s*<td[^>]*>\s*<p\s+class="mgAiTitleTxt"[^>]*>(.*?)</p>', page, re.S):
        t = tag_text(title)
        if t:
            items.append(f"{tag_text(num)} {t}".strip())
    links = []
    box = re.search(r'<div\s+class="mgLinks"[^>]*>(.*?)</div>', page, re.S)
    for href, label in re.findall(r'<li>\s*<a\s+href="([^"]+)"[^>]*>(.*?)</a>', box.group(1) if box else "", re.S):
        h = htmllib.unescape(href)
        if re.search(r"\.pdf(\?|$)", h, re.I):
            links.append({"label": re.sub(r"\s*(PDF|pdf).*$", "", tag_text(label)).strip() or "Document", "url": quote(urljoin(url, h), safe="/:?=&%~")})
    for href, label in re.findall(r'<a\s+class="mgAiTitleLnk"\s+href="([^"]+)"[^>]*>(.*?)</a>', page, re.S):
        if re.search(r"minutes", tag_text(label), re.I) and re.search(r"\.pdf(\?|$)", href, re.I):
            links.append({"label": "Minutes", "url": quote(urljoin(url, htmllib.unescape(href)), safe="/:?=&%~")})
    return items, links


def fetch_moderngov(now: datetime, cfg: dict) -> list[dict]:
    """Meetings of the London Assembly and its committees from the GLA's own democratic-services calendar (modern.gov), with each
    meeting's agenda items and documents for the meetings near today. Months: one back to three ahead."""
    today = london(now).date()
    out, failures = [], []
    for body in cfg.get("meetings", []):
        base = body["base"].rstrip("/")
        if not robots_allows(base + "/mgCalendarMonthView.aspx") or not robots_allows(base + "/ieListDocuments.aspx"):
            failures.append(f"{body['name']}: robots.txt does not allow automated reading, skipped")
            continue
        months = []
        y, m = today.year, today.month
        for k in range(-1, 4):
            yy, mm = divmod(y * 12 + m - 1 + k, 12)
            months.append((yy, mm + 1))
        seen = {}
        for yy, mm in months:
            try:
                page = get_text(f"{base}/mgCalendarMonthView.aspx?M={mm}&DD={yy}&CID=0&OT=&C=-1&MD=-1&Z=0")
            except RuntimeError as e:
                failures.append(f"{body['name']} {yy}-{mm:02d}: {e}")
                continue
            for ev in parse_moderngov_month(page, base):
                seen[ev["mid"]] = ev
        lo, hi = today - timedelta(days=14), today + timedelta(days=cfg["windows"].get("meeting_documents_days", 45))
        for mid, ev in sorted(seen.items()):
            d = ev["when"].date()
            items, links = [], []
            if lo <= d <= hi and not ev["cancelled"]:
                try:
                    items, links = parse_moderngov_documents(get_text(ev["url"]), ev["url"])
                except RuntimeError as e:
                    failures.append(f"{body['name']} meeting {mid}: {e}")
            published = d < today
            summary = ("Agenda: " + "; ".join(items[:10]) + ("; …" if len(items) > 10 else "")) if items else (
                "Agenda not yet published." if lo <= d <= hi and not ev["cancelled"] and d >= today else "")
            out.append(release(
                id=f"meeting:{make_id(body['base'], mid)}", category="meeting", title=ev["name"], summary=summary[:600], publisher=body["publisher"],
                publisher_slug=re.sub(r"[^a-z0-9]+", "-", body["publisher"].lower()).strip("-"), tier="london", source_system="gla_meetings",
                kind="cancelled" if ev["cancelled"] else ("published" if published else "upcoming"), date=d.isoformat(), datetime=ev["when"].isoformat(),
                cancelled=ev["cancelled"], links=links[:4], url=ev["url"]))
    if failures and not out:
        raise RuntimeError("; ".join(failures[:3]))
    if failures:
        raise PartialFailure(out, failures)
    return out


# ------------------------------------------------------------------ manual file
def fetch_manual(now: datetime, cfg: dict) -> list[dict]:
    path = ROOT / "config" / "statscal_manual.yml"
    if not path.exists():
        return []
    today = london(now).date()
    out = []
    for e in (yaml.safe_load(path.read_text()) or {}).get("releases") or []:
        if e.get("example"):
            continue
        if not e.get("title") or not e.get("publisher") or not e.get("date"):
            raise RuntimeError(f"manual entry needs title, publisher and date: {e}")
        d = e["date"] if isinstance(e["date"], date) else dtparse.parse(str(e["date"])).date()
        if d < today - timedelta(days=14):
            continue
        status = e.get("date_status", "provisional")
        if status not in ("confirmed", "provisional"):
            raise RuntimeError(f"manual entry date_status must be confirmed or provisional: {e['title']}")
        when = None
        if e.get("time"):
            h, m = [int(x) for x in str(e["time"]).split(":")]
            when = datetime(d.year, d.month, d.day, h, m, tzinfo=LONDON).isoformat()
        out.append(release(id="manual:" + make_id(e["publisher"], e["title"], d), title=e["title"], summary=e.get("summary", ""), publisher=e["publisher"],
                           publisher_slug=re.sub(r"[^a-z0-9]+", "-", e["publisher"].lower()).strip("-"), tier=e.get("tier", "london"), source_system="manual",
                           kind="upcoming" if d >= today else "published", date=d.isoformat(), datetime=when,
                           date_precision=e.get("date_precision", "day"), date_status=status, url=e.get("url", "")))
    return out


FETCHERS = {"ons": ("ons_api", fetch_ons), "govuk": ("govuk_search", fetch_govuk), "london_datastore": ("london_datastore", fetch_london),
            "police_uk": ("police_uk", fetch_police), "gla_meetings": ("gla_meetings", fetch_moderngov), "manual": ("manual", fetch_manual)}


# ------------------------------------------------------------------ estimates
def estimate_next(dates: list[str], today: date) -> date | None:
    """The next update, only if the history shows a regular rhythm (at least three updates, gaps within 40% of the median, 5 to 120 days apart).
    Otherwise None: we never guess."""
    ds = sorted({date.fromisoformat(d) for d in dates})
    if len(ds) < 3:
        return None
    gaps = [(b - a).days for a, b in zip(ds, ds[1:])]
    med = statistics.median(gaps)
    if not 5 <= med <= 120 or any(abs(g - med) > 0.4 * med for g in gaps):
        return None
    nxt = ds[-1]
    for _ in range(3):
        nxt += timedelta(days=round(med))
        if nxt >= today:
            return nxt
    return None


def estimates(releases: dict[str, dict], today: date) -> list[dict]:
    out = []
    for r in releases.values():
        if r["source_system"] == "london_datastore" and r["kind"] == "published":
            nxt = estimate_next(r.get("update_dates", []), today)
            if nxt:
                out.append({**release(id="est:" + r["id"], title=r["title"] + " (next update, estimated)", publisher=r["publisher"], publisher_slug=r["publisher_slug"],
                                      tier=r["tier"], source_system=r["source_system"], kind="upcoming", date=nxt.isoformat(), date_status="estimated",
                                      url=r["url"], summary="Estimated from how often this dataset has been updated so far; the publisher has not announced a date.")})
    seen = sorted(date.fromisoformat(r["first_seen"][:10]) for r in releases.values() if r["source_system"] == "police_uk" and r.get("first_seen"))
    nxt = estimate_next([d.isoformat() for d in seen], today)
    if nxt:
        out.append(release(id="est:police", title="Police.uk street-level crime data (next month, estimated)", publisher="data.police.uk (all forces)", publisher_slug="data-police-uk",
                           tier="london", source_system="police_uk", kind="upcoming", date=nxt.isoformat(), date_status="estimated", url="https://data.police.uk/data/",
                           summary="Estimated from when earlier months appeared; no date has been announced."))
    return out


# ------------------------------------------------------------------ merge + change tracking
COMPARE = ("title", "date", "datetime", "kind", "date_status", "date_precision", "cancelled")


def merge(prev: list[dict], results: dict[str, list[dict] | None], now: datetime, cfg: dict) -> tuple[list[dict], list[dict]]:
    """results: source_system -> its new records, or None if that source failed (its old records are kept as they were).
    Returns (releases, new change-log entries)."""
    today = london(now).date()
    now_iso = now.astimezone(timezone.utc).isoformat()
    old = {r["id"]: r for r in prev if not r["id"].startswith("est:")}
    merged: dict[str, dict] = {}
    changes: list[dict] = []

    def log(kind, rec, **extra):
        changes.append({"at": now_iso, "type": kind, "id": rec["id"], "title": rec["title"], "publisher": rec["publisher"], "tier": rec["tier"],
                        "date": rec["date"], "url": rec["url"], **extra})

    for src, recs in results.items():
        if recs is None:
            for r in old.values():
                if r["source_system"] == src:
                    merged[r["id"]] = r
            continue
        new = {r["id"]: r for r in recs}
        for rid, r in new.items():
            p = old.get(rid)
            r["first_seen"] = p["first_seen"] if p else now_iso
            r["last_seen"] = now_iso
            if "update_dates" in r and p:
                ud = list(p.get("update_dates", []))
                if r["update_dates"][0] not in ud:
                    ud.append(r["update_dates"][0])
                r["update_dates"] = sorted(ud)[-12:]
            if not p:
                r["last_changed"] = now_iso
                log("new", r)
            else:
                differs = any(p.get(k) != r.get(k) for k in COMPARE)
                r["last_changed"] = now_iso if differs else p.get("last_changed", p["first_seen"])
                if p["kind"] == "upcoming" and r["kind"] == "published":
                    log("published", r)
                elif p["kind"] != "cancelled" and r["kind"] == "cancelled":
                    log("cancelled", r)
                elif r["kind"] == "upcoming" and p["kind"] == "upcoming" and p["date"] != r["date"]:
                    if not any(x["date"] == p["date"] for x in r["previous_dates"]):
                        r["previous_dates"] = [*r["previous_dates"], {"date": p["date"], "change_notice": "", "changed_at": now_iso}]
                    log("date_changed", r, old_date=p["date"], new_date=r["date"])
                if not r["previous_dates"] and p.get("previous_dates"):
                    r["previous_dates"] = p["previous_dates"]
            merged[rid] = r
        for rid, p in old.items():
            if p["source_system"] == src and rid not in new:
                if p["kind"] == "upcoming":
                    log("published" if p["date"] <= today.isoformat() and src != "manual" else "removed", p)
                if p["kind"] == "published" and p["date"] >= (today - timedelta(days=cfg["windows"]["keep_published_days"])).isoformat():
                    merged[rid] = p   # still inside our window: keep it even if the source's own list has moved on
    # drop what has aged out
    w = cfg["windows"]
    keep = {}
    for rid, r in merged.items():
        limit = today - timedelta(days=w["keep_published_days"] if r["kind"] == "published" else w["keep_other_days"])
        if r["date"] >= limit.isoformat():
            keep[rid] = r
    for e in estimates(keep, today):
        e["first_seen"] = e["last_seen"] = e["last_changed"] = now_iso
        keep[e["id"]] = e
    return sorted(keep.values(), key=lambda r: (r["date"], r["publisher"], r["title"], r["id"])), changes


def prune_changes(old: list[dict], new: list[dict], now: datetime, days: int) -> list[dict]:
    cutoff = (now - timedelta(days=days)).astimezone(timezone.utc).isoformat()
    return sorted([c for c in [*old, *new] if c["at"] >= cutoff], key=lambda c: (c["at"], c["id"], c["type"]), reverse=True)


# ------------------------------------------------------------------ run
def run(prev_body: dict | None, now: datetime | None = None, cfg: dict | None = None) -> tuple[dict, list[dict]]:
    """Collect from every source that is on. Returns (the stored body, health records for the Source health tab)."""
    now = now or datetime.now(timezone.utc)
    cfg = cfg or load_config()
    prev_body = prev_body or {}
    results: dict[str, list[dict] | None] = {}
    statuses, health = [], []
    for name, (system, fn) in FETCHERS.items():
        if not (cfg["sources"].get(name) or {}).get("on", True):
            continue
        t0 = time.time()
        err, recs = "", None
        try:
            recs = fn(now, cfg)
        except PartialFailure as e:
            recs, err = e.records, str(e)
        except Exception as e:  # noqa: BLE001  (one source failing must never stop the others)
            err = str(e)
        results[system] = recs
        failed = recs is None
        statuses.append({"source": name, "ok": not failed and not err, "count": len(recs or []), "error": err[:300], "stale": failed,
                         "seconds": round(time.time() - t0, 1), "fetched_at": now.astimezone(timezone.utc).isoformat()})
        health.append({"group": "statscal", "name": f"Stats calendar: {name}", "ok": not failed, "items": len(recs or []), "error": err[:200]})
    releases, new_changes = merge(prev_body.get("releases", []), results, now, cfg)
    return {"updated": now.astimezone(timezone.utc).isoformat(), "releases": releases,
            "changes": prune_changes(prev_body.get("changes", []), new_changes, now, cfg["windows"]["changes_days"]), "sources": statuses}, health
