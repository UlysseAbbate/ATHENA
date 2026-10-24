"""
Fetch the Lords Whips' Office Forthcoming Business (published as a PDF) and store it,
day by day, in Supabase (table: whips_business). Also snapshots Today's Lists.

Run by .github/workflows/ingest-whips.yml several times each weekday.
Locally:  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python scripts/ingest_whips.py
Dry run (no database, prints what it parsed):  python scripts/ingest_whips.py --dry-run
"""

import io
import re
import sys
from datetime import date
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from pypdf import PdfReader

from common import http_get, require_env, sb_delete, sb_insert

FB_PAGE = "https://www.lordswhips.org.uk/fb"
TODAY_PAGE = "https://www.lordswhips.org.uk/todays-lists"

MONTHS = ["january", "february", "march", "april", "may", "june", "july",
          "august", "september", "october", "november", "december"]
DAY_RE = re.compile(r"^(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY)\s+(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\b", re.I)
HEADING_RE = re.compile(r"^(oral questions?|private notice question|questions on an (oral statement|urgent question)|main business|"
                        r"dinner break business|lunch break business|estimated rising time|business in the chamber|"
                        r"business in grand committee|grand committee|chamber)\b", re.I)
NOISE_RE = re.compile(r"^(page \d+|\d+\s*$|forthcoming business|the house is expected to rise|the grand committee is expected to rise|"
                      r"\(?\d+ minutes\)?$|timings in italics|items marked|the advertised business|the number of sessions|"
                      r"†\s*indicates|progress remains)", re.I)
DEPT_RE = re.compile(r"[\(,]\s*([A-Za-z]{2,6})\)\s*[‡†]*\s*$")


def classify_kind(text, hint=""):
    t, h = text.lower(), hint.lower()
    if "private notice question" in h or "private notice question" in t:
        return "pnq"
    if "urgent question" in h:
        return "uq"
    if "statement" in h:
        return "statement"
    if "oral question" in h or re.search(r"to ask (his|her) majesty", t):
        return "oq"
    if re.search(r"(regulations|order|rules|scheme|code of practice)( \(no\. ?\d+\))? 20\d\d|approval motion|regret motion", t):
        return "si"
    if re.search(r"\bbill\b", t):
        return "legislation"
    if "question for short debate" in t:
        return "qsd"
    if re.search(r"report (from|of) the|\(\d+(st|nd|rd|th) report", t):
        return "report"
    if re.search(r"motion|to move|take note|debate", t):
        return "motion"
    return "other"


def infer_date(day, month_name, year):
    month = MONTHS.index(month_name.lower()) + 1
    today = date.today()
    if year:
        return date(int(year), month, int(day))
    guess = date(today.year, month, int(day))
    # Forthcoming Business looks ahead: a date well in the past must be next year.
    if (today - guess).days > 60:
        guess = date(today.year + 1, month, int(day))
    return guess


def is_continuation(line, buffer):
    if not buffer:
        return False
    if re.match(r"^[a-z0-9(–\-]", line):
        return True
    # Words that continue a wrapped business title rather than start a new item.
    if re.match(r"^(Motion|Approval|Regret|Committee|Report|Second|Third|Consideration|Stage|Reading|Order|Regulations)\b", line):
        return True
    return bool(re.search(r"(,|\bof|\band|\bthe|\bto|–|-)$", buffer.strip()))


def parse_forthcoming(text):
    """Split Forthcoming Business text into per-day rows."""
    rows, day, section, hint, buffer = [], None, "Chamber", "", ""
    position = 0

    def flush():
        nonlocal buffer, position
        item = re.sub(r"\s+", " ", buffer).strip(" ‡†•*")
        buffer = ""
        if day and item and len(item) > 8 and not NOISE_RE.match(item):
            dept = DEPT_RE.search(item)
            rows.append({
                "source": "fb", "business_date": day.isoformat(), "section": section,
                "position": position, "text": item, "kind": classify_kind(item, hint),
                "dept": dept.group(1).upper() if dept else None,
            })
            position += 1

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            flush()
            continue
        m = DAY_RE.match(line)
        if m and m.group(3).lower() in MONTHS:
            flush()
            day = infer_date(m.group(2), m.group(3), m.group(4))
            section, hint, position = "Chamber", "", 0
            continue
        if day is None:
            continue
        if HEADING_RE.match(line) and len(line) < 90:
            flush()
            if re.search(r"grand committee", line, re.I):
                section = "Grand Committee"
            elif re.search(r"chamber", line, re.I):
                section = "Chamber"
            hint = line
            continue
        if NOISE_RE.match(line):
            continue
        if line[:1] in "•*‡" or not is_continuation(line, buffer):
            flush()
            buffer = line
        else:
            buffer += " " + line
    flush()
    return rows


def find_fb_pdf():
    html = http_get(FB_PAGE)
    if not html:
        raise SystemExit("Could not load the Forthcoming Business page.")
    soup = BeautifulSoup(html, "html.parser")
    pdfs = []
    for a in soup.find_all("a", href=True):
        href = urljoin(FB_PAGE, a["href"])
        label = (a.get_text(" ") + " " + href).lower()
        if ".pdf" in href.lower() or "download" in label:
            pdfs.append((("large" in label), href))
    pdfs.sort()  # standard print before large print
    return pdfs[0][1] if pdfs else None


def pdf_text(url):
    data = http_get(url, binary=True)
    if not data:
        raise SystemExit(f"Could not download {url}")
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def main():
    dry = "--dry-run" in sys.argv
    if not dry:
        require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")

    pdf_url = find_fb_pdf()
    if not pdf_url:
        raise SystemExit("No PDF link found on the Forthcoming Business page — the page layout may have changed.")
    print(f"Forthcoming Business PDF: {pdf_url}")
    text = pdf_text(pdf_url)
    rows = parse_forthcoming(text)
    days = sorted({r["business_date"] for r in rows})
    print(f"Parsed {len(rows)} items across {len(days)} sitting days: {', '.join(days)}")

    if dry:
        for r in rows[:60]:
            print(f"{r['business_date']} [{r['section']}] {r['kind']:<11} {r['text'][:110]}")
        return

    if rows:
        # Replace everything from the first advertised day onwards (keeps history before it).
        sb_delete("whips_business", f"source=eq.fb&business_date=gte.{days[0]}")
        for i in range(0, len(rows), 500):
            sb_insert("whips_business", rows[i:i + 500])
    sb_insert("whips_snapshots", [{"source": "fb", "source_url": pdf_url, "raw_text": text}])

    today_html = http_get(TODAY_PAGE)
    if today_html:
        today_text = BeautifulSoup(today_html, "html.parser").get_text("\n")
        sb_insert("whips_snapshots", [{"source": "todays_list", "source_url": TODAY_PAGE, "raw_text": today_text}])
    print("Done.")


if __name__ == "__main__":
    main()
