"""Offline tests for the Stats calendar collector (tracker/statscal.py), using real API responses recorded in tests/fixtures/release-calendar/."""
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tracker"))
import statscal as S  # noqa: E402

FX = Path(__file__).resolve().parent / "fixtures" / "release-calendar"
CFG = S.load_config()
NOW = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)


def fx(name):
    return json.loads((FX / name).read_text())


def test_ons_upcoming_is_mapped_with_london_date_and_time():
    r = S.ons_record(fx("ons-upcoming.json")["releases"][0], "upcoming")
    assert r["kind"] == "upcoming" and r["date_status"] == "confirmed" and r["tier"] == "ons"
    assert r["date"] == "2026-11-10" and r["datetime"].startswith("2026-11-10T09:30:00")
    assert r["url"].startswith("https://www.ons.gov.uk/releases/")


def test_ons_summer_time_is_converted_not_read_as_utc():
    rec = {"uri": "/releases/x", "date_changes": None, "description": {"title": "T", "release_date": "2027-07-23T06:00:00.000Z", "finalised": True, "cancelled": False, "published": False}}
    r = S.ons_record(rec, "upcoming")
    assert r["datetime"].startswith("2027-07-23T07:00:00") and r["datetime"].endswith("+01:00")
    late = {**rec, "description": {**rec["description"], "release_date": "2027-07-22T23:30:00.000Z"}}
    assert S.ons_record(late, "upcoming")["date"] == "2027-07-23"   # 00:30 BST is the next London day


def test_ons_provisional_and_date_changes():
    changed, provisional = fx("ons-upcoming-date-changed-and-provisional.json")["releases"]
    c = S.ons_record(changed, "upcoming")
    assert len(c["previous_dates"]) >= 1 and c["previous_dates"][0]["change_notice"] and c["previous_dates"][0]["date"]
    p = S.ons_record(provisional, "upcoming")
    assert p["date_status"] == "provisional" and p["date_precision"] == "day"


def test_ons_cancelled_and_published():
    assert S.ons_record(fx("ons-cancelled.json")["releases"][0], "cancelled")["kind"] == "cancelled"
    assert S.ons_record(fx("ons-published.json")["releases"][0], "published")["kind"] == "published"


def test_precision_from_text():
    assert S.precision_from_text("23 July 2027 7:00am") == "day"
    assert S.precision_from_text("November 2026") == "month"
    assert S.precision_from_text("Q2 2027") == "quarter" and S.precision_from_text("Autumn 2027") == "quarter"


def test_govuk_announcements_and_month_only_dates():
    org = {"slug": "hm-revenue-customs", "tier": "national"}
    rows = fx("govuk-upcoming-announcements.json")["results"]
    r = S.gov_announcement(rows[0], org, CFG, date(2026, 11, 9))
    assert r["kind"] == "upcoming" and r["date"] == "2026-11-10" and r["date_precision"] == "day" and r["url"].startswith("https://www.gov.uk/")
    month = {**rows[0], "statistics_announcement_state": "provisional", "release_timestamp": "2027-05-31T23:59:59.000+01:00"}
    m = S.gov_announcement(month, org, CFG, date(2026, 11, 9))
    assert m["date_precision"] == "month" and m["datetime"] is None and m["date_status"] == "provisional"
    assert S.gov_announcement({**rows[0], "release_timestamp": "0020-04-19T09:30:00.000-00:01"}, org, CFG, date(2026, 11, 9)) is None   # corrupt old date
    canc = fx("govuk-cancelled-announcements.json")["results"][0]
    assert S.gov_announcement(canc, org, CFG, date(2026, 11, 9))["kind"] == "cancelled"


def test_govuk_published():
    r = S.gov_published(fx("govuk-published-statistics.json")["results"][0], {"slug": "x", "tier": "alb"})
    assert r["kind"] == "published" and r["date"] and r["tier"] == "alb"


def test_devolved_bodies_and_ons_copies_are_excluded():
    assert S.org_excluded("the-scottish-government", CFG) and S.org_excluded("welsh-government", CFG)
    assert S.org_excluded("department-of-health-northern-ireland", CFG) and S.org_excluded("office-for-national-statistics", CFG)
    assert not S.org_excluded("home-office", CFG)
    assert not any(S.org_excluded(o["slug"], CFG) for o in CFG["govuk"]["organisations"])


def test_london_datastore_publisher_comes_from_the_maintainer():
    assert S.lds_publisher("MPS", "", CFG) == "Metropolitan Police Service"
    assert S.lds_publisher("Someone", "MOPAC", CFG) == "Mayor's Office for Policing and Crime"
    assert S.lds_publisher("A person", "", CFG) == "Greater London Authority"


def test_london_datastore_fetch_maps_recent_datasets(monkeypatch):
    pkgs = fx("london-datastore-package-search.json")["result"]["result"]
    for i, p in enumerate(pkgs):
        p["metadata_modified"] = "2026-11-06T14:25:46.794Z" if i == 0 else "2026-01-01T00:00:00.000Z"
    monkeypatch.setattr(S, "get_json", lambda url, params=None: {"result": {"result": pkgs}})
    got = S.fetch_london(NOW, CFG)
    assert len(got) == 1 and got[0]["kind"] == "published" and got[0]["tier"] == "london" and got[0]["date"] == "2026-11-06" and got[0]["date_status"] == "confirmed"


def test_police_emits_the_newest_month_as_published(monkeypatch):
    def fake(url, params=None):
        return fx("policeuk-crime-last-updated.json") if url.endswith("crime-last-updated") else fx("policeuk-crimes-street-dates.json")
    monkeypatch.setattr(S, "get_json", fake)
    got = S.fetch_police(NOW, CFG)
    assert len(got) == 1 and got[0]["id"] == "police:2026-09" and got[0]["kind"] == "published" and "September 2026" in got[0]["title"]


def test_manual_file_ignores_examples_and_validates(monkeypatch, tmp_path):
    assert S.fetch_manual(NOW, CFG) == []   # the shipped file holds only examples
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "statscal_manual.yml").write_text(
        "releases:\n  - {title: TfL report, publisher: Transport for London, date: 2026-11-20, date_status: provisional, time: '09:30'}\n"
        "  - {title: Old, publisher: X, date: 2026-01-01}\n")
    monkeypatch.setattr(S, "ROOT", tmp_path)
    got = S.fetch_manual(NOW, CFG)
    assert len(got) == 1 and got[0]["source_system"] == "manual" and got[0]["datetime"].startswith("2026-11-20T09:30") and got[0]["date_status"] == "provisional"
    (tmp_path / "config" / "statscal_manual.yml").write_text("releases:\n  - {title: Bad, publisher: X, date: 2026-11-20, date_status: estimated}\n")
    with pytest.raises(RuntimeError):
        S.fetch_manual(NOW, CFG)


def rec(id, date_, kind="upcoming", src="ons_api", **kw):
    return S.release(id=id, title="T " + id, publisher="P", publisher_slug="p", tier="ons", source_system=src, kind=kind, date=date_, **kw)


def test_merge_logs_new_date_change_cancellation_and_publication():
    first, ch1 = S.merge([], {"ons_api": [rec("a", "2026-11-20"), rec("b", "2026-11-21"), rec("c", "2026-11-22")]}, NOW, CFG)
    assert sorted(c["type"] for c in ch1) == ["new", "new", "new"]
    later = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
    second, ch2 = S.merge(first, {"ons_api": [rec("a", "2026-11-27"), rec("b", "2026-11-21", kind="cancelled", cancelled=True), rec("c", "2026-11-10", kind="published")]}, later, CFG)
    types = {c["id"]: c for c in ch2}
    assert types["a"]["type"] == "date_changed" and types["a"]["old_date"] == "2026-11-20" and types["a"]["new_date"] == "2026-11-27"
    assert types["b"]["type"] == "cancelled" and types["c"]["type"] == "published"
    a = next(r for r in second if r["id"] == "a")
    assert a["previous_dates"][-1]["date"] == "2026-11-20" and a["first_seen"] == first[0]["first_seen"] and a["last_changed"] != a["first_seen"]


def test_unchanged_records_keep_their_timestamps_and_output_is_ordered():
    first, _ = S.merge([], {"ons_api": [rec("b", "2026-11-21"), rec("a", "2026-11-20")]}, NOW, CFG)
    again, ch = S.merge(first, {"ons_api": [rec("b", "2026-11-21"), rec("a", "2026-11-20")]}, datetime(2026, 11, 9, 18, tzinfo=timezone.utc), CFG)
    assert ch == [] and [r["id"] for r in again] == ["a", "b"]
    assert all(x["last_changed"] == y["last_changed"] and x["first_seen"] == y["first_seen"] for x, y in zip(first, again))


def test_a_failed_source_keeps_its_last_good_records_and_others_still_update():
    first, _ = S.merge([], {"ons_api": [rec("a", "2026-11-20")], "govuk_search": [rec("g", "2026-11-20", src="govuk_search")]}, NOW, CFG)
    after, ch = S.merge(first, {"ons_api": None, "govuk_search": [rec("g", "2026-11-25", src="govuk_search")]}, datetime(2026, 11, 10, tzinfo=timezone.utc), CFG)
    ids = {r["id"] for r in after}
    assert "a" in ids and "g" in ids
    assert [c["type"] for c in ch] == ["date_changed"]


def test_upcoming_item_that_vanishes_is_removed_or_treated_as_published():
    first, _ = S.merge([], {"govuk_search": [rec("future", "2026-12-20", src="govuk_search"), rec("past", "2026-11-09", src="govuk_search")]}, NOW, CFG)
    _, ch = S.merge(first, {"govuk_search": []}, datetime(2026, 11, 10, tzinfo=timezone.utc), CFG)
    assert {c["id"]: c["type"] for c in ch} == {"future": "removed", "past": "published"}


def test_old_records_age_out():
    first, _ = S.merge([], {"ons_api": [rec("old", "2026-09-01", kind="published"), rec("recent", "2026-11-01", kind="published")]}, NOW, CFG)
    assert [r["id"] for r in first] == ["recent"]


def test_estimates_need_a_regular_history_and_are_labelled():
    t = date(2026, 11, 9)
    assert S.estimate_next(["2026-09-01", "2026-10-01"], t) is None   # two updates is not a rhythm
    assert S.estimate_next(["2026-08-01", "2026-09-20", "2026-10-01"], t) is None   # irregular
    nxt = S.estimate_next(["2026-08-02", "2026-09-01", "2026-10-01"], t)
    assert nxt and nxt >= t
    ds = rec("lds:x", "2026-10-01", kind="published", src="london_datastore", update_dates=["2026-08-02", "2026-09-01", "2026-10-01"], url="u")
    ds["tier"] = "london"
    est = S.estimates({ds["id"]: ds}, t)
    assert len(est) == 1 and est[0]["date_status"] == "estimated" and est[0]["kind"] == "upcoming" and est[0]["id"].startswith("est:")


def test_run_isolates_a_failing_source(monkeypatch):
    def boom(now, cfg):
        raise RuntimeError("down")
    monkeypatch.setitem(S.FETCHERS, "ons", ("ons_api", boom))
    for k in ("govuk", "london_datastore", "police_uk"):
        monkeypatch.setitem(S.FETCHERS, k, (S.FETCHERS[k][0], lambda now, cfg: []))
    prev = {"releases": [rec("a", "2026-11-20")], "changes": []}
    body, health = S.run(prev, NOW, CFG)
    assert any(r["id"] == "a" for r in body["releases"])
    ons = next(s for s in body["sources"] if s["source"] == "ons")
    assert ons["ok"] is False and ons["stale"] is True and "down" in ons["error"]
    assert next(h for h in health if "ons" in h["name"])["ok"] is False and any(h["ok"] for h in health)


def test_retry_honours_retry_after(monkeypatch):
    calls, sleeps = [], []

    class R:
        def __init__(self, code, headers=None):
            self.status_code, self.headers = code, headers or {}

        def raise_for_status(self):
            pass

        def json(self):
            return {"ok": 1}
    seq = [R(429, {"Retry-After": "7"}), R(200)]
    monkeypatch.setattr(S._session, "get", lambda *a, **k: calls.append(1) or seq.pop(0))
    monkeypatch.setattr(S, "_sleep", sleeps.append)
    assert S.get_json("http://x") == {"ok": 1} and 7 in sleeps
