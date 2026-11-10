"""
Copy House of Commons divisions from the Commons Votes API into Supabase (table: commons_divisions), with how many members of each party
voted Aye and No. The Data page (Voting Data, Commons) works everything else out. The Commons twin of ingest_votes.py (the Lords).

Run by .github/workflows/libby-ingest-votes.yml as part of "Refresh data", or by hand.
  python scripts/libby/ingest_commons_votes.py                    new divisions only (re-checks the last 14 days)
  python scripts/libby/ingest_commons_votes.py --since 2024-07-09 everything from that date
  python scripts/libby/ingest_commons_votes.py --dry-run          print what it found, no database

The Commons Votes API (https://commonsvotes-api.parliament.uk) route used is
  /data/divisions.json/groupedbyparty?queryParameters.startDate=YYYY-MM-DD
which returns EVERY division since that date in one reply (it ignores paging), each with "Ayes" and "Noes" lists of { PartyName, VoteCount }.
It can take about half a minute, so the request is patient.
"""

import sys
from datetime import date, timedelta

from common import SESSION, require_env, sb_insert, sb_select

API = "https://commonsvotes-api.parliament.uk/data"
PARLIAMENT_START = "2024-07-09"  # first sitting of the 2024 Parliament


def get(url):
    res = SESSION.get(url, timeout=180, headers={"Accept": "application/json"})
    res.raise_for_status()
    return res.json()


def party_counts(ayes, noes):
    out = {}
    for side, recs in (("c", ayes), ("nc", noes)):
        for rec in recs or []:
            name = str(rec.get("PartyName") or "Unknown").strip() or "Unknown"
            out.setdefault(name, {"c": 0, "nc": 0})[side] += int(rec.get("VoteCount") or 0)
    return out


def to_row(d):
    return {
        "division_id": int(d["DivisionId"]),
        "number": d.get("Number"),
        "division_date": str(d.get("Date") or "")[:10],
        "title": (d.get("Title") or "").strip(),
        "content": int(d.get("AyeCount") or 0),
        "not_content": int(d.get("NoCount") or 0),
        "parties": party_counts(d.get("Ayes"), d.get("Noes")),
    }


def fetch_since(since):
    data = get(f"{API}/divisions.json/groupedbyparty?queryParameters.startDate={since}")
    if not isinstance(data, list):
        raise SystemExit("The Commons Votes API did not return a list of divisions.")
    rows = [to_row(d) for d in data if d.get("DivisionId")]
    return list({r["division_id"]: r for r in rows if r["division_date"]}.values())


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    if not dry:
        require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    if "--since" in args:
        since = args[args.index("--since") + 1]
    elif dry:
        since = (date.today() - timedelta(days=30)).isoformat()
    else:
        latest = sb_select("commons_divisions", "select=division_date&order=division_date.desc&limit=1")
        since = ((date.fromisoformat(latest[0]["division_date"]) - timedelta(days=14)).isoformat() if latest else PARLIAMENT_START)
    print(f"Fetching Commons divisions since {since}...")
    rows = fetch_since(since)
    print(f"Found {len(rows)} divisions.")
    if dry:
        for r in rows[:40]:
            ld = r["parties"].get("Liberal Democrat", {"c": 0, "nc": 0})
            print(f"  {r['division_date']} #{r['division_id']} {r['content']}-{r['not_content']} LD {ld['c']}/{ld['nc']}  {r['title'][:70]}")
        return
    for i in range(0, len(rows), 200):
        sb_insert("commons_divisions", rows[i:i + 200], upsert_on="division_id")
    print("Done.")


if __name__ == "__main__":
    main()
