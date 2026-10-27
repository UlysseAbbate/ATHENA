"""
Load the Lords' own business into Supabase (table: whips_business) from the Lords Business API
(https://services.lordsbusiness.parliament.uk/), item by item:

  Future Business   the next few weeks of sitting days (source 'fb')     -> LIBBY's Future calendar and every future day's page
  Order Paper       the Order Paper for each coming sitting day, as soon as it exists (source 'todays_list') -> Today's business

This replaces reading the Whips' Office website and its PDF. Runs from .github/workflows/libby-ingest-business.yml.
Locally:  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python ingest_lordsbusiness.py
Dry run (no database, prints what it read):  python ingest_lordsbusiness.py --dry-run
"""

import sys
from datetime import date, timedelta

from common import require_env, sb_delete, sb_insert
from parliament_api import FUTURE_BUSINESS, LORDS_BUSINESS, ORDER_PAPER, api_json, business_rows, future_business_days

ORDER_PAPER_DAYS = 10   # look this many days ahead for an Order Paper (it is published a few days before the sitting)


def chunks(rows, n=500):
    for i in range(0, len(rows), n):
        yield rows[i:i + n]


def main():
    dry = "--dry-run" in sys.argv
    if not dry:
        require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    today = date.today()

    # Future Business: one document with every advertised sitting day. Replace everything from its first day onwards.
    doc = api_json(f"{LORDS_BUSINESS}/api/v1/GetData.json", {"BusinessPaperDate": today.isoformat(), "SectionId": FUTURE_BUSINESS})
    if doc is None:
        raise SystemExit("Could not load Future Business from the Lords Business API.")
    fb_rows = []
    days = future_business_days(doc)
    for day, block in days:
        fb_rows += business_rows(block, "fb", day)
    print(f"Future Business: {len(fb_rows)} items across {len(days)} sitting days" + (f" ({days[0][0]} to {days[-1][0]})" if days else ""))
    if days and not fb_rows:
        raise SystemExit("Future Business came back with sitting days but no items: not replacing what is stored.")

    # Order Paper: each coming sitting day that has one.
    op_rows, op_days = [], []
    for offset in range(ORDER_PAPER_DAYS):
        d = today + timedelta(days=offset)
        if d.weekday() >= 5:
            continue
        sections = api_json(f"{LORDS_BUSINESS}/api/v1/GetSectionsForDate.json", {"businessPaperDate": d.isoformat()})
        if sections is None or ORDER_PAPER not in sections:
            continue
        block = api_json(f"{LORDS_BUSINESS}/api/v1/GetData.json", {"BusinessPaperDate": d.isoformat(), "SectionId": ORDER_PAPER})
        if block is None:
            continue
        got = business_rows(block, "todays_list", d.isoformat())
        if got:
            op_days.append(d.isoformat())
            op_rows += got
    print(f"Order Paper: {len(op_rows)} items on {len(op_days)} days: {', '.join(op_days) or 'none yet'}")

    if dry:
        for r in (op_rows + fb_rows)[:40]:
            print(f"{r['source']:<11} {r['business_date']} [{r['section']}] {r['kind']:<11} {r['text'][:100]}")
        return

    if fb_rows:
        sb_delete("whips_business", f"source=eq.fb&business_date=gte.{days[0][0]}")
        for part in chunks(fb_rows):
            sb_insert("whips_business", part)
    for d in op_days:
        sb_delete("whips_business", f"source=eq.todays_list&business_date=eq.{d}")
    for part in chunks(op_rows):
        sb_insert("whips_business", part)
    print("Done.")


if __name__ == "__main__":
    main()
