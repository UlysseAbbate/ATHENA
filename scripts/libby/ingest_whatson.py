"""
Load the Lords calendar into Supabase (table: whatson_events) from the UK Parliament What's On API
(https://whatson-api.parliament.uk/): every event in the chamber, Grand Committee and the committees, with the members named,
the Bill an item is about, its location and whether it has a speakers list. This replaces reading the whatson.parliament.uk web
pages; the API says what each field is, so nothing has to be guessed from page text.

Run by .github/workflows/libby-ingest-whatson.yml (part of "Refresh data").
Locally:  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python ingest_whatson.py
Dry run (no database, prints what it read):  python ingest_whatson.py --dry-run --days 3
"""

import sys
from datetime import date, datetime, timedelta, timezone

from common import require_env, sb_delete, sb_insert
from parliament_api import WHATSON, api_json, whatson_rows

DEFAULT_DAYS = 42   # about 6 weeks ahead
BATCH_DAYS = 14     # one request per fortnight keeps each reply small


def fetch(start, end):
    """Rows for the Lords events from `start` to `end`, grouped by date; None if the API could not be read."""
    events = api_json(f"{WHATSON}/calendar/events/list.json", {
        "queryParameters.house": "Lords", "queryParameters.startDate": start.isoformat(), "queryParameters.endDate": end.isoformat()})
    return None if events is None else whatson_rows(events)


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    days = int(args[args.index("--days") + 1]) if "--days" in args else DEFAULT_DAYS
    if not dry:
        require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")

    today = date.today()
    total, failures, looked_at = 0, [], []   # looked_at: weekdays read successfully, including ones with no business
    for first in range(0, days, BATCH_DAYS):
        start = today + timedelta(days=first)
        end = today + timedelta(days=min(first + BATCH_DAYS, days) - 1)
        by_date = fetch(start, end)
        if by_date is None:
            failures.append(f"{start} to {end}")
            continue
        d = start
        while d <= end:
            iso = d.isoformat()
            if d.weekday() < 5 or iso in by_date:   # the Lords rarely sits at weekends, but a weekend sitting is kept when there is one
                rows = by_date.get(iso, [])
                looked_at.append(iso)
                total += len(rows)
                print(f"{iso}: {len(rows)} items")
                if dry:
                    for r in rows:
                        who = ", ".join(f"{m['name']} ({m['party']})" for m in r["members"]) or "-"
                        print(f"   [{r['section']}] {r['start_time'] or ''} ({r['category']}) {r['title']}  |  {who}"
                              + (f" | Bill {r['bill_id']}" if r["bill_id"] else "") + (" | SPEAKERS" if r["speakers"] else ""))
                else:
                    sb_delete("whatson_events", f"house=eq.Lords&event_date=eq.{iso}")
                    sb_insert("whatson_events", rows)
            d += timedelta(days=1)

    if not dry and looked_at:
        # lib/libby/parliament.js whatsOn() reads this: a day listed here with no rows means "no business", not "not loaded yet".
        sb_insert("api_snapshots", [{
            "key": "whatson:ingested",
            "payload": {"days": looked_at, "at": datetime.now(timezone.utc).isoformat()},
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }], upsert_on="key")

    print(f"\nDone. {total} items across {days} days.")
    if failures:
        print(f"Could not load: {', '.join(failures)} (left untouched in the database).")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
