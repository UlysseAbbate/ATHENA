"""
Scrape whatson.parliament.uk day by day and store clean, structured business in Supabase
(table: whatson_events). This replaces guessing at line-by-line converted text with a real
HTML parser, which can strip hidden accessibility text (screen-reader-only labels like
"View more information about X") by its actual markup rather than by matching phrases —
much more reliable, and the root fix for the "junk text in titles" problem.

Run by .github/workflows/ingest-whatson.yml several times a day (near-term business changes).
Locally:  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python scripts/ingest_whatson.py
Dry run (no database, prints what it parsed):  python scripts/ingest_whatson.py --dry-run --days 3
"""

import re
import sys
from datetime import date, datetime, timedelta, timezone

from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup, NavigableString

from common import http_get, require_env, sb_delete, sb_insert

DEFAULT_DAYS = 42  # about 6 weeks ahead, comfortably past the Forthcoming Business PDF's own 3-week horizon

# Any of these substrings appearing in a tag's class or id marks it as screen-reader-only
# content — hidden from sighted users but present in the HTML, which is exactly the "View
# more information about..." / "Download a file which will set up reminders..." text that
# was leaking through the old text-based approach. Broad on purpose: several different
# frameworks/conventions are covered so this keeps working even if the exact one in use here
# isn't among them.
HIDDEN_CLASS_RE = re.compile(r"(visually-?hidden|sr-only|screen-?reader|govuk-visually-hidden)", re.I)

KNOWN_SECTIONS = {"chamber": "Chamber", "grand committee": "Grand Committee", "committees": "Committees"}
KNOWN_CATEGORIES = {
    "oral questions", "introduction(s)", "introductions", "legislation", "statement", "debate", "motion",
    "statutory instrument", "orders and regulations", "report stage", "committee stage", "third reading",
    "second reading", "question for short debate", "committee", "report", "private notice question",
    "urgent question", "petitions", "delegated legislation", "business questions", "topical questions",
    "adjournment debate", "backbench business", "opposition day", "estimates day", "general debate",
    "ministerial statement",
}
PARTY_RE = re.compile(r",\s*(life peer|hereditary peer|excepted hereditary)\b", re.I)
BISHOP_RE = re.compile(r"^(the\s+)?(lord\s+)?bishop\s+of\s+", re.I)
TIME_RE = re.compile(r"^\d{1,2}[.:]\d{2}\s*(am|pm)$", re.I)
CHEVRON_RE = re.compile(r"[\s\u2039\u203a\u00bb\u3009>]+$")

# "Speakers list published" is a badge on a card, not a piece of business. It belongs to the card
# above it (the badge follows that card's peers), so it is recorded as a flag, never as text.
SPEAKERS_RE = re.compile(r"speakers list published", re.I)

# Each card links to its own What's On event page (e.g. https://whatson.parliament.uk/event/cal56556).
# Before the page is turned into text, a marker line carrying that address is placed after every such
# link, so the address can be tied to the card it sits in.
LINK_MARK = "\u00a7\u00a7LINK\u00a7\u00a7"
LINK_LINE_RE = re.compile("^" + LINK_MARK + r"(\S+)$")
EVENT_PATH_RE = re.compile(r"^/event/[A-Za-z]*\d+/?$")


def event_url(href):
    """The What's On event address for a link, or '' if the link is not an event page."""
    try:
        u = urlparse(urljoin("https://whatson.parliament.uk/", href))
    except ValueError:
        return ""
    if not (u.hostname or "").endswith("whatson.parliament.uk") or not EVENT_PATH_RE.match(u.path):
        return ""
    return f"https://whatson.parliament.uk{u.path.rstrip('/')}"


def strip_chevron(line):
    return CHEVRON_RE.sub("", line).strip()


def is_known_category(line):
    return strip_chevron(line).lower() in KNOWN_CATEGORIES


def is_category_line(line):
    clean = strip_chevron(line)
    if not clean:
        return False
    if clean.lower() in KNOWN_CATEGORIES:
        return True
    words = clean.split(" ")
    return len(words) <= 4 and not re.search(r"[.:;]", clean) and not PARTY_RE.search(clean) and not TIME_RE.match(clean)


def clean_lines_from_html(html):
    """Strip hidden/accessibility-only elements, then return the page's real visible text as lines."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all(True):
        attrs = getattr(tag, "attrs", None) or {}
        classes = " ".join(attrs.get("class") or [])
        tag_id = attrs.get("id") or ""
        if HIDDEN_CLASS_RE.search(classes) or HIDDEN_CLASS_RE.search(tag_id):
            tag.decompose()
        elif attrs.get("aria-hidden") == "true" or "hidden" in attrs:
            tag.decompose()
    for tag in soup(["script", "style", "noscript", "svg", "head", "nav", "footer"]):
        tag.decompose()
    for a in soup.find_all("a", href=True):
        url = event_url(a["href"])
        if url:
            a.insert_after(NavigableString(f"\n{LINK_MARK}{url}\n"))
    text = soup.get_text("\n")
    return [re.sub(r"\s+", " ", l).strip() for l in text.split("\n")]


def events_from_section_lines(heading_text, lines, event_date):
    """Turn one section's lines into events, one per card.

    A card reads: its text (category and title), then one or more peers (each a name line followed by a
    party/peerage line), then optionally "Speakers list published". A card ends when the next card's text
    begins. A name line is recognised by the party line that follows it, so a second peer on the same
    card (e.g. the regret-motion peer on a statutory instrument) is added to that card, not made a new item.
    """
    section = KNOWN_SECTIONS.get(heading_text.lower(), heading_text)
    start_time = None

    # Step 1: label every line.
    toks = []
    for raw in lines:
        m = LINK_LINE_RE.match(raw)
        if m:
            toks.append(("link", m.group(1)))
            continue
        if TIME_RE.match(raw):
            if not start_time:
                start_time = raw  # only the first time-only line is kept, as the section's start time
            continue
        if SPEAKERS_RE.search(raw):
            toks.append(("speakers", ""))
            raw = re.sub(r"\s+", " ", SPEAKERS_RE.sub(" ", raw)).strip()
            if not raw:
                continue
        if PARTY_RE.search(raw) or BISHOP_RE.match(raw):
            toks.append(("party", raw))
        else:
            toks.append(("text", raw))

    # Step 2: group the labelled lines into cards.
    cards = []
    cur = None
    pending_link = ""

    def new_card():
        nonlocal cur, pending_link
        cur = {"text": [], "members": [], "speakers": False, "link": pending_link, "intro": False}
        pending_link = ""
        cards.append(cur)

    def give_link(url):
        nonlocal pending_link
        if cur is None:
            pending_link = url
        elif not cur["link"]:
            cur["link"] = url
        elif cur["link"] != url:
            pending_link = url  # a different address: it belongs to the next card

    i = 0
    while i < len(toks):
        kind, val = toks[i]
        if kind == "link":
            give_link(val)
            i += 1
            continue
        if kind == "speakers":
            if cur is not None:
                cur["speakers"] = True
            i += 1
            continue
        if kind == "party":
            i += 1  # a party line with no name before it: nothing to attach it to
            continue
        # A text line. Is a party line next (ignoring link markers)? Then this is a peer's name.
        j = i + 1
        while j < len(toks) and toks[j][0] == "link":
            j += 1
        party_next = j < len(toks) and toks[j][0] == "party"
        if cur is not None and cur["intro"] and not party_next:
            # The line after a bare "Introduction(s)" label is the peer being introduced (no party line).
            cur["members"].append({"name": val, "party": ""})
            cur["intro"] = False
            i += 1
            continue
        if party_next:
            if cur is None:
                new_card()
            for k in range(i + 1, j):
                give_link(toks[k][1])
            cur["members"].append({"name": val, "party": toks[j][1]})
            i = j + 1
            continue
        if cur is None or cur["members"] or cur["speakers"]:
            new_card()  # the previous card has its peers, so this line starts the next card
        cur["text"].append(val)
        if len(cur["text"]) == 1 and strip_chevron(val).lower().startswith("introduction"):
            cur["intro"] = True
        i += 1

    # Step 3: one event per card.
    out = []
    for pos, c in enumerate(cards):
        text = list(c["text"])
        category = ""
        for k, ln in enumerate(text):
            if is_known_category(ln):
                category = strip_chevron(ln)
                del text[k]
                break
        if not category and len(text) > 1:
            for k in range(len(text) - 1, -1, -1):
                if is_category_line(text[k]):
                    category = strip_chevron(text[k])
                    del text[k]
                    break
        title = " \u2014 ".join(text).strip() or (c["members"][0]["name"] if c["members"] else "") or category
        if not title:
            continue
        out.append({
            "section": section, "position": pos, "start_time": start_time,
            "category": category, "title": title, "members": c["members"],
            "event_url": c["link"], "speakers": c["speakers"],
        })
    return out


SECTION_BOILERPLATE_RE = re.compile(r"^tap the button to add these events to your calendar\.?$", re.I)
STOP_LINE_RE = re.compile(r"^(links to other uk parliament services|find events|search|advanced search|©\s*uk parliament)", re.I)
SKIP_LINE_RE = re.compile(r"(webcal://|^subscribe:|use this link to subscribe|will automatically update if events change|^add to calendar$|^download:?$)", re.I)


def parse_day(html, event_date):
    lines = clean_lines_from_html(html)
    events = []
    current = None
    buf = []

    def flush():
        nonlocal buf
        if current and buf:
            events.extend(events_from_section_lines(current, buf, event_date))
        buf = []

    for line in lines:
        known = KNOWN_SECTIONS.get(line.lower())
        if known:
            flush()
            current = known
            continue
        if SECTION_BOILERPLATE_RE.match(line):
            continue
        if STOP_LINE_RE.match(line):
            flush()
            current = None
            continue
        if not current or not line or SKIP_LINE_RE.search(line):
            continue
        buf.append(line)
    flush()
    return events


def ingest_day(d, house="Lords"):
    html = http_get(f"https://whatson.parliament.uk/{house.lower()}/{d.isoformat()}/")
    if not html:
        return None  # network/HTTP failure — leave existing rows for this day untouched
    return parse_day(html, d.isoformat())


def save_rows(rows):
    """Insert rows. If the two newer columns (event_url, speakers) have not been added to the table yet,
    save without them rather than failing, and say so."""
    try:
        sb_insert("whatson_events", rows)
    except RuntimeError as exc:
        if "event_url" not in str(exc) and "speakers" not in str(exc):
            raise
        print("  ! The whatson_events table has no event_url / speakers columns yet: run add-whatson-links.sql in Supabase. Saving without them.")
        sb_insert("whatson_events", [{k: v for k, v in r.items() if k not in ("event_url", "speakers")} for r in rows])


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    days = int(args[args.index("--days") + 1]) if "--days" in args else DEFAULT_DAYS
    if not dry:
        require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")

    today = date.today()
    total = 0
    failures = []
    looked_at = []  # weekdays fetched successfully, including ones with no business: the site must not re-scrape these
    for offset in range(days):
        d = today + timedelta(days=offset)
        if d.weekday() >= 5:  # Lords doesn't sit weekends — skip to save requests
            continue
        events = ingest_day(d)
        if events is None:
            failures.append(d.isoformat())
            continue
        looked_at.append(d.isoformat())
        print(f"{d.isoformat()}: {len(events)} items" + (f" — {[e['category'] for e in events]}" if dry else ""))
        total += len(events)
        if dry:
            for e in events:
                members = ", ".join(f"{m['name']} ({m['party']})" for m in e["members"]) or "—"
                extra = (" | SPEAKERS" if e["speakers"] else "") + (f" | {e['event_url']}" if e["event_url"] else " | (no event link found)")
                print(f"   [{e['section']}] {e.get('start_time') or ''} ({e['category']}) {e['title']}  |  {members}{extra}")
            continue
        rows = [{
            "event_date": d.isoformat(), "house": "Lords", "section": e["section"], "position": e["position"],
            "start_time": e["start_time"], "category": e["category"], "title": e["title"], "members": e["members"],
            "event_url": e["event_url"] or None, "speakers": e["speakers"],
        } for e in events]
        sb_delete("whatson_events", f"house=eq.Lords&event_date=eq.{d.isoformat()}")
        if rows:
            save_rows(rows)

    if not dry and looked_at:
        # lib/parliament.js whatsOn() reads this: a day listed here with no rows means "no business", not "not loaded yet".
        sb_insert("api_snapshots", [{
            "key": "whatson:ingested",
            "payload": {"days": looked_at, "at": datetime.now(timezone.utc).isoformat()},
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }], upsert_on="key")

    print(f"\nDone. {total} items across {days} days.")
    if failures:
        print(f"Could not load: {', '.join(failures)} (left untouched in the database).")


if __name__ == "__main__":
    main()
