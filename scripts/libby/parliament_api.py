"""
The two official Parliament APIs LIBBY's business pages are built from, and how their data becomes the rows stored in Supabase.

  What's On API         https://whatson-api.parliament.uk/        the calendar: every event in the Lords (chamber, Grand Committee,
                                                                   committees), with members, Bill ids, speakers and locations
  Lords Business API    https://services.lordsbusiness.parliament.uk/   the Lords' own Order Paper and Future Business, item by item

The mapping functions take the API's JSON and return plain rows, so they are tested offline (tests/test_lords_apis.py).
"""

import re
import time

from common import DEPT_RE, SESSION, classify_kind

WHATSON = "https://whatson-api.parliament.uk"
LORDS_BUSINESS = "https://services.lordsbusiness.parliament.uk"
ORDER_PAPER, FUTURE_BUSINESS = 38, 39      # section ids in the Lords Business API (GET /api/v1/GetSections)

# The two Parliament services are public APIs meant for this use; a short pause between calls is still kept.
PAUSE = 0.4


def api_json(url, params=None, retries=3):
    """GET a JSON document from one of the APIs. Returns None if it cannot be had (the caller leaves what is stored as it is)."""
    for attempt in range(retries):
        try:
            res = SESSION.get(url, params=params, timeout=60, headers={"Accept": "application/json"})
            if res.status_code == 200:
                time.sleep(PAUSE)
                return res.json()
            if res.status_code in (400, 401, 403, 404):
                print(f"  ! {res.status_code} for {url} {params or ''}")
                return None
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {exc} (attempt {attempt + 1})")
        time.sleep(2 * (attempt + 1))
    return None



# ------------------------------------------------------------------ What's On: events -> whatson_events rows

SECTION_OF_TYPE = {"main chamber": "Chamber", "grand committee": "Grand Committee"}   # anything else (select and joint committees...) is "Committees"


def whatson_section(event_type):
    return SECTION_OF_TYPE.get(str(event_type or "").strip().lower(), "Committees")


def whatson_title(e):
    """What the business is called. Chamber items carry it in Description; committee meetings have the committee's name instead."""
    desc = re.sub(r"\s+", " ", str(e.get("Description") or "")).strip()
    if desc:
        return desc
    committee = (e.get("Committee") or {}).get("Description") or ""
    return committee or str(e.get("Category") or "").strip()


def whatson_rows(events):
    """whatson_events rows from the API's event list, grouped by date: { 'YYYY-MM-DD': [row, ...] }. Cancelled events are left out."""
    by_date = {}
    for e in sorted(events, key=lambda x: (str(x.get("StartDate")), x.get("SortOrder") or 0, str(x.get("StartTime") or ""))):
        if e.get("CancelledDate"):
            continue
        day = str(e.get("StartDate") or "")[:10]
        if not re.match(r"\d{4}-\d{2}-\d{2}$", day) or str(e.get("House") or "Lords").lower() != "lords":
            continue
        rows = by_date.setdefault(day, [])
        rows.append({
            "event_date": day, "house": "Lords", "section": whatson_section(e.get("Type")), "position": len(rows),
            "start_time": e.get("StartTime") or None, "end_time": e.get("EndTime") or None,
            "category": e.get("Category") or None, "title": whatson_title(e),
            "members": [{"name": m.get("Name"), "party": m.get("Party") or "", "id": m.get("Id")} for m in (e.get("Members") or []) if m.get("Name")],
            "event_url": f"https://whatson.parliament.uk/event/cal{e['Id']}" if e.get("Id") else None,
            "speakers": bool(e.get("HasSpeakers")),
            "event_id": e.get("Id"), "location": e.get("Location") or None,
            "bill_id": e.get("BillId"), "bill_name": e.get("BillName"),
            "committee": (e.get("Committee") or {}).get("Description"),
        })
    return by_date


# ------------------------------------------------------------------ Lords Business: Order Paper / Future Business -> whips_business rows

HEADING_RE = re.compile(r"^(oral questions?|private notice question|questions on an (oral statement|urgent question)|main business|"
                        r"dinner break business|lunch break business|estimated rising time|business in the chamber|"
                        r"business in grand committee|grand committee|chamber)\b", re.I)
LEAD_MARKS = re.compile(r"^[\s*\u2020\u2021\u2022]+")


def plain(text):
    """The API's plain text, without non-breaking spaces, daggers and asterisks that only matter on the printed paper."""
    return re.sub(r"\s+", " ", LEAD_MARKS.sub("", str(text or "").replace("\u00a0", " "))).strip()


def is_note(item):
    """A line in italics alone (a heading such as "Oral questions (40 minutes)" or a note) is not an item of business."""
    f = str(item.get("DisplayTextFormatted") or "").strip()
    return bool(f) and f.startswith("<em>") and f.endswith("</em>") and "<strong>" not in f


def kind_of(text, hint):
    """What the item is. The wording decides; a heading above it ("Private notice question") only settles an item the wording leaves open,
    because the Order Paper has no heading between one kind of business and the next."""
    if re.search(r"\bwill be introduced\b", text, re.I):
        return "introduction"
    kind = classify_kind(text)
    return classify_kind(text, hint) if kind in ("other", "motion") and hint else kind


def business_rows(day, source, business_date):
    """Rows (whips_business) for one sitting day's block from GetData: the chamber's items, then each Grand Committee's.
    `source` is 'fb' (Future Business) or 'todays_list' (the Order Paper for the day)."""
    rows = []

    def add(section, items):
        hint, position = "", 0
        for it in items or []:
            text = plain(it.get("DisplayTextPlain"))
            if not text:
                continue
            if is_note(it):
                if HEADING_RE.match(text):
                    hint = text
                continue
            item_hint, hint = hint, ""      # a heading speaks for the item straight after it only
            dept = DEPT_RE.search(text)
            rows.append({
                "source": source, "business_date": business_date, "section": section, "position": position, "text": text,
                "kind": kind_of(text, item_hint), "dept": dept.group(1).upper() if dept else None,
                "item_id": it.get("ItemOfBusinessId"), "member_id": it.get("MainMemberId"),
            })
            position += 1

    chamber = day.get("ChamberContent") or {}
    add("Chamber", chamber.get("ItemsOfBusiness"))
    for sub in chamber.get("SubSections") or []:
        add("Chamber", (sub or {}).get("ItemsOfBusiness"))
    for gc in day.get("GrandCommitteeContent") or []:
        add("Grand Committee", (gc or {}).get("ItemsOfBusiness"))
    return rows


def future_business_days(doc):
    """[(date, day block)] from the Future Business document (GetData, section 39)."""
    out = []
    for block in (doc or {}).get("Business") or []:
        day = str(block.get("Date") or "")[:10]
        if re.match(r"\d{4}-\d{2}-\d{2}$", day):
            out.append((day, block))
    return out
