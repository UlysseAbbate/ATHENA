"""
Copy House of Lords divisions from the Lords Votes API into Supabase (table: lords_divisions), with how many
members of each party voted Content and Not Content. The Data page (Voting Data) works everything else out.

Run by .github/workflows/ingest-votes.yml every morning, or by hand.
  python scripts/ingest_votes.py                    new divisions only (re-checks the last 14 days)
  python scripts/ingest_votes.py --since 2024-07-09 everything from that date
  python scripts/ingest_votes.py --dry-run          print what it found, no database
  python scripts/ingest_votes.py --probe            print the shape of the API's replies (for diagnosis), no database

The Lords Votes API (https://lordsvotes-api.parliament.uk/index.html) has three read routes used here:
  /data/Divisions/search            the divisions (and, normally, who voted)
  /data/Divisions/groupedbyparty    the divisions with Content / Not Content counts for each party
  /data/Divisions/{divisionId}      one division in full
Its documentation names the filters StartDate, EndDate, Skip and Take; the older "queryParameters." spelling is sent
too, so either style is understood.
"""

import sys
import json
from datetime import date, timedelta
from urllib.parse import urlencode

from common import SESSION, require_env, sb_insert, sb_select

API = "https://lordsvotes-api.parliament.uk/data"
PARLIAMENT_START = "2024-07-09"  # first sitting of the 2024 Parliament
PAGE = 25


def get(url):
    res = SESSION.get(url, timeout=60, headers={"Accept": "application/json"})
    res.raise_for_status()
    return res.json()


def pick(obj, *keys):
    """Parliament APIs mix camelCase and PascalCase: read either."""
    if not isinstance(obj, dict):
        return None
    lower = {k.lower(): v for k, v in obj.items()}
    for k in keys:
        if k in obj:
            return obj[k]
        if k.lower() in lower:
            return lower[k.lower()]
    return None


def query(**params):
    """Each filter is sent twice, as StartDate and as queryParameters.startDate, so either spelling works."""
    both = {}
    for k, v in params.items():
        both[k] = v
        both[f"queryParameters.{k[0].lower()}{k[1:]}"] = v
    return urlencode(both)


def items_of(page):
    return page if isinstance(page, list) else (pick(page, "items", "results", "divisions") or [])


def party_name(m):
    """A voter's party. The API gives a name, or sometimes an object with a name inside."""
    p = pick(m, "party", "partyName", "memberParty")
    if isinstance(p, dict):
        p = pick(p, "name", "partyName", "title")
    return (str(p).strip() if p else "") or "Unknown"


def party_counts(contents, not_contents):
    out = {}
    for side, members in (("c", contents), ("nc", not_contents)):
        for m in members or []:
            out.setdefault(party_name(m), {"c": 0, "nc": 0})[side] += 1
    return out


def _count(obj, *keys):
    v = pick(obj, *keys)
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def parties_from_grouped(item):
    """Party counts from one record of /Divisions/groupedbyparty. The exact layout is not documented in a form
    this script can read, so both likely layouts are understood: a list of party records inside the division,
    or one record per party. Returns {party: {c, nc}} or None if neither is found."""
    out = {}
    # The layout the API actually uses: "content" and "notContent" lists of {partyName, voteCount}.
    for side, key in (("c", "content"), ("nc", "notContent")):
        for rec in (pick(item, key) if isinstance(pick(item, key), list) else []):
            name = pick(rec, "partyName", "party", "name")
            if name and pick(rec, "voteCount") is not None:
                out.setdefault(str(name).strip(), {"c": 0, "nc": 0})[side] += _count(rec, "voteCount")
    if out:
        return out
    for key, value in (item.items() if isinstance(item, dict) else []):
        if isinstance(value, list) and value and all(isinstance(v, dict) for v in value):
            for rec in value:
                name = pick(rec, "party", "partyName", "name")
                if isinstance(name, dict):
                    name = pick(name, "name", "partyName")
                c = pick(rec, "contentCount", "contents", "content")
                nc = pick(rec, "notContentCount", "notContents", "notContent")
                if name and (c is not None or nc is not None):
                    cur = out.setdefault(str(name).strip(), {"c": 0, "nc": 0})
                    cur["c"] += _count({"v": c}, "v")
                    cur["nc"] += _count({"v": nc}, "v")
    if out:
        return out
    name = pick(item, "party", "partyName")
    if isinstance(name, dict):
        name = pick(name, "name", "partyName")
    if name and (pick(item, "contentCount") is not None or pick(item, "notContentCount") is not None):
        return {str(name).strip(): {"c": _count(item, "contentCount"), "nc": _count(item, "notContentCount")}}
    return None


def grouped_by_division(since, skip, take):
    """{divisionId: {party: {c, nc}}} for one page of /Divisions/groupedbyparty (empty if the route is unavailable)."""
    try:
        page = get(f"{API}/Divisions/groupedbyparty?{query(StartDate=since, Skip=skip, Take=take)}")
    except Exception as exc:  # a missing or changed route must not stop the run
        print(f"  ! groupedbyparty not usable ({exc}); reading each division instead")
        return {}
    out = {}
    for rec in items_of(page):
        div_id = pick(rec, "divisionId", "id")
        parts = parties_from_grouped(rec)
        if div_id and parts:
            merged = out.setdefault(int(div_id), {})
            for name, v in parts.items():  # one record per party: add them up
                cur = merged.setdefault(name, {"c": 0, "nc": 0})
                cur["c"] += v["c"]
                cur["nc"] += v["nc"]
    return out


def to_row(d, grouped):
    div_id = int(pick(d, "divisionId"))
    contents = pick(d, "contents")
    not_contents = pick(d, "notContents")
    c = pick(d, "authoritativeContentCount", "contentCount")
    nc = pick(d, "authoritativeNotContentCount", "notContentCount")
    parties = None
    if contents is not None or not_contents is not None:
        parties = party_counts(contents, not_contents)
    elif div_id in grouped:
        parties = grouped[div_id]
    else:
        full = get(f"{API}/Divisions/{div_id}")  # last resort: the division on its own
        contents, not_contents = pick(full, "contents"), pick(full, "notContents")
        parties = party_counts(contents, not_contents)
    return {
        "division_id": div_id,
        "number": pick(d, "number"),
        "division_date": str(pick(d, "date") or "")[:10],
        "title": (pick(d, "title") or "").strip(),
        "content": int(c if c is not None else len(contents or [])),
        "not_content": int(nc if nc is not None else len(not_contents or [])),
        "parties": parties,
    }


def fetch_since(since):
    rows, seen, skip = [], set(), 0
    for _ in range(400):  # safety limit: 10,000 divisions
        page = get(f"{API}/Divisions/search?{query(StartDate=since, Skip=skip, Take=PAGE)}")
        items = [d for d in items_of(page) if pick(d, "divisionId")]
        if not items:
            break
        fresh = [d for d in items if int(pick(d, "divisionId")) not in seen]
        if not fresh:
            print("  ! The API returned the same divisions again, so paging is not working; stopping here.")
            break
        grouped = {}
        if any(pick(d, "contents") is None and pick(d, "notContents") is None for d in fresh):
            grouped = grouped_by_division(since, skip, PAGE)
        for d in fresh:
            seen.add(int(pick(d, "divisionId")))
            rows.append(to_row(d, grouped))
        skip += len(items)
        if len(items) < PAGE:
            break
    return rows


def shape(value, depth=0):
    """A compact picture of a JSON reply: field names and kinds, not the data."""
    pad = "    " * depth
    if isinstance(value, dict):
        lines = []
        for k, v in list(value.items())[:40]:
            if isinstance(v, (dict, list)) and depth < 3:
                lines.append(f"{pad}{k}: {type(v).__name__}{f' of {len(v)}' if isinstance(v, list) else ''}")
                lines.append(shape(v, depth + 1))
            else:
                lines.append(f"{pad}{k}: {json.dumps(v)[:60]}")
        return "\n".join(lines)
    if isinstance(value, list) and value:
        return f"{pad}[0] -> \n" + shape(value[0], depth + 1)
    return f"{pad}{json.dumps(value)[:80]}"


def probe():
    since = (date.today() - timedelta(days=45)).isoformat()
    print(f"PROBE: what the Lords Votes API returns (divisions since {since})\n")
    first_id = None
    for label, url in (("search", f"{API}/Divisions/search?{query(StartDate=since, Skip=0, Take=2)}"),
                       ("groupedbyparty", f"{API}/Divisions/groupedbyparty?{query(StartDate=since, Skip=0, Take=2)}")):
        print(f"=== {label}\n{url}")
        try:
            page = get(url)
            items = items_of(page)
            print(f"top level: {type(page).__name__}; {len(items)} item(s)\n{shape(items[0] if items else page)}\n")
            if label == "search" and items:
                first_id = pick(items[0], "divisionId")
        except Exception as exc:
            print(f"  failed: {exc}\n")
    if first_id:
        print(f"=== /Divisions/{first_id}")
        try:
            print(shape(get(f"{API}/Divisions/{first_id}")))
        except Exception as exc:
            print(f"  failed: {exc}")


def main():
    args = sys.argv[1:]
    if "--probe" in args:
        probe()
        return
    dry = "--dry-run" in args
    if not dry:
        require_env("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
    if "--since" in args:
        since = args[args.index("--since") + 1]
    elif dry:
        since = (date.today() - timedelta(days=30)).isoformat()
    else:
        latest = sb_select("lords_divisions", "select=division_date&order=division_date.desc&limit=1")
        since = ((date.fromisoformat(latest[0]["division_date"]) - timedelta(days=14)).isoformat()
                 if latest else PARLIAMENT_START)
    print(f"Fetching Lords divisions since {since}...")
    rows = [r for r in fetch_since(since) if r["division_date"]]
    # The same division can appear twice if the list shifts while paging; keep one of each.
    rows = list({r["division_id"]: r for r in rows}.values())
    print(f"Found {len(rows)} divisions.")
    if dry:
        for r in rows[:40]:
            ld = r["parties"].get("Liberal Democrat", {"c": 0, "nc": 0})
            print(f"  {r['division_date']} #{r['division_id']} {r['content']}-{r['not_content']} LD {ld['c']}/{ld['nc']}  {r['title'][:70]}")
        return
    for i in range(0, len(rows), 200):
        sb_insert("lords_divisions", rows[i:i + 200], upsert_on="division_id")
    print("Done.")


if __name__ == "__main__":
    main()
