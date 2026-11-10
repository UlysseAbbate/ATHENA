"""Offline test for the Commons votes ingest (scripts/libby/ingest_commons_votes.py): a division from the Commons Votes API's groupedbyparty route becomes a row."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts" / "libby"))
import ingest_commons_votes as I  # noqa: E402

DIVISION = {  # shaped like the recorded reply (DivisionId 1827, 22 July 2024)
    "DivisionId": 1827, "Number": 1, "Title": "King's Speech (Motion for an Address): Amendment (h)", "Date": "2024-07-22T21:59:00", "AyeCount": 111, "NoCount": 390,
    "Ayes": [{"PartyName": "Conservative", "VoteCount": 106}, {"PartyName": "Democratic Unionist Party", "VoteCount": 3}, {"PartyName": "Independent", "VoteCount": 1}],
    "Noes": [{"PartyName": "Labour", "VoteCount": 377}, {"PartyName": "Independent", "VoteCount": 4}, {"PartyName": "Liberal Democrat", "VoteCount": 1}],
}


def test_a_division_becomes_a_row_with_ayes_as_content():
    r = I.to_row(DIVISION)
    assert r["division_id"] == 1827 and r["division_date"] == "2024-07-22" and r["content"] == 111 and r["not_content"] == 390
    assert r["parties"]["Conservative"] == {"c": 106, "nc": 0} and r["parties"]["Labour"] == {"c": 0, "nc": 377}
    assert r["parties"]["Independent"] == {"c": 1, "nc": 4}   # the same party on both sides is added up per side


def test_fetch_since_keeps_one_row_per_division(monkeypatch):
    monkeypatch.setattr(I, "get", lambda url: [DIVISION, DIVISION, {"Title": "no id"}])
    rows = I.fetch_since("2024-07-09")
    assert len(rows) == 1 and rows[0]["division_id"] == 1827
