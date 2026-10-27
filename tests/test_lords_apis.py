"""Offline tests for how the What's On and Lords Business API replies become stored rows. Run: python -m pytest -q"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "libby"))
import parliament_api as P  # noqa: E402

FIX = ROOT / "scripts" / "libby" / "fixtures"
load = lambda name: json.loads((FIX / name).read_text())  # noqa: E731


def test_whatson_events_become_rows():
    by_date = P.whatson_rows(load("whatson-events-2026-11-03.json"))
    assert list(by_date) == ["2026-11-03"]
    rows = by_date["2026-11-03"]
    sections = {r["section"] for r in rows}
    assert sections == {"Chamber", "Grand Committee", "Committees"}
    assert [r["position"] for r in rows] == list(range(len(rows)))
    leg = next(r for r in rows if r["category"] == "Legislation")
    assert leg["bill_id"] and leg["bill_name"] and leg["members"][0]["party"] and leg["event_url"].startswith("https://whatson.parliament.uk/event/cal")
    committee = next(r for r in rows if r["section"] == "Committees")
    assert committee["title"] == committee["committee"] and committee["location"]


def test_whatson_leaves_out_cancelled_and_other_houses():
    ev = load("whatson-events-2026-11-03.json")
    cancelled = dict(ev[0], CancelledDate="2026-11-01T00:00:00")
    commons = dict(ev[1], House="Commons")
    assert P.whatson_rows([cancelled, commons]) == {}


def test_order_paper_rows():
    doc = load("lords-order-paper-2026-10-28.json")
    rows = P.business_rows(doc, "todays_list", "2026-10-28")
    chamber = [r for r in rows if r["section"] == "Chamber"]
    gc = [r for r in rows if r["section"] == "Grand Committee"]
    assert chamber[0]["kind"] == "oq" and chamber[0]["member_id"] == 57 and chamber[0]["text"].startswith("Lord Young of Cookham to ask")
    assert not any(r["text"].startswith(("*", "†", "Oral questions")) for r in rows)    # marks and headings are not part of an item
    assert [r["position"] for r in chamber] == list(range(len(chamber)))
    assert any("Health Bill" in r["text"] and r["kind"] == "legislation" for r in chamber)
    assert gc and all(r["kind"] == "si" for r in gc if "Regulations" in r["text"] or "Order" in r["text"])
    assert all(r["source"] == "todays_list" and r["business_date"] == "2026-10-28" and " " not in r["text"] for r in rows)


def test_future_business_days():
    days = P.future_business_days(load("lords-future-business.json"))
    assert [d for d, _ in days] == ["2026-10-29", "2026-11-02", "2026-11-03"]
    rows = P.business_rows(days[0][1], "fb", days[0][0])
    assert rows and all(r["source"] == "fb" and r["business_date"] == "2026-10-29" for r in rows)


def test_stored_row_fixtures_match_the_mapping():
    """scripts/libby/check-business.mjs reads these two files; they must be what the mapping produces."""
    assert load("order-paper-rows-2026-10-28.json") == P.business_rows(load("lords-order-paper-2026-10-28.json"), "todays_list", "2026-10-28")
    assert load("whatson-rows-2026-11-03.json") == P.whatson_rows(load("whatson-events-2026-11-03.json"))["2026-11-03"]


def test_kinds_come_from_the_wording_not_from_a_heading_far_above():
    rows = P.business_rows(load("lords-order-paper-2026-10-28.json"), "todays_list", "2026-10-28")
    kinds = [r["kind"] for r in rows if r["section"] == "Chamber"]
    assert kinds[:4] == ["oq"] * 4 and "introduction" not in kinds      # "the introduction of vocational GCSEs" is a question, not an Introduction
    assert kinds[6] == "motion"                                          # a motion after the questions is not an Oral Question
    assert P.kind_of("The Lord Bishop of Bath and Wells will be introduced.", "") == "introduction"
