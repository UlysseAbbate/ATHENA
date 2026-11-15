"""Economic data harvest for LUCIEN > Economic policy.

Reads open official statistics from Nomis (the Office for National Statistics' labour market and census service, https://www.nomisweb.co.uk/api)
and turns them into one long table, so any figure can be cross-referenced by area, age and sex:

  aps_labour    Annual Population Survey: labour market status (employed, unemployed, inactive, self-employed, part-time) by age, sex and region
  claimants     Claimant Count: people claiming unemployment-related benefits, by age, sex and region
  ashe          Annual Survey of Hours and Earnings: pay by sex and region (the resident analysis has no age)
  gdhi          Regional gross disposable household income per head (no age or sex)
  census_econ   Census 2021: economic activity status by age, sex and region

Every row is { dataset, geography_code, geography_name, geography_level, sex, age_from, age_to, age_label, category, measure, unit, value, period, source_url }.
It replaces the old `pyscraper` idea (series from the ONS, the Bank of England and the IMF into pandas): the ONS web pages it read are gone, and Nomis has an
open, stable API for the breakdowns the policy work needs. Nothing here needs a key. Every request goes through update.fetch(): robots.txt is checked and requests are spaced.
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
import sys

NOMIS = "https://www.nomisweb.co.uk/api/v01/dataset"
GEOGRAPHY = "TYPE480,2092957697,2092957699"   # the 12 regions and nations (TYPE480), the United Kingdom and England
TIMEOUT = (10, 90)
OPEN_END = 120   # "65 and over" is stored as 65 to 120

_SEX = {"all persons": "all", "total": "all", "persons": "all", "male": "male", "males": "male", "female": "female", "females": "female"}


def parse_age(name: str) -> tuple[int, int, str]:
    """Age band from the words Nomis uses: 'Age 16 to 24', 'Aged 18-24', 'Aged 65 years and over', 'All ages', 'All categories: Age 16+', 'Aged 15 years and under'."""
    s = re.sub(r"\s+", " ", str(name or "")).strip()
    low = s.lower()
    if low in ("", "total") or low.startswith("all ages"):
        return 0, OPEN_END, "All ages"
    m = re.search(r"(\d+)\s*(?:to|-|–)\s*(\d+)", low)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return a, b, f"{a}-{b}"
    m = re.search(r"(\d+)\s*(?:\+|years? and over|and over|and above)", low)
    if m:
        a = int(m.group(1))
        return a, OPEN_END, f"{a}+"
    m = re.search(r"(\d+)\s*(?:years? and under|and under)", low)
    if m:
        b = int(m.group(1))
        return 0, b, f"0-{b}"
    m = re.search(r"age[d]? (\d+)$", low)
    if m:
        a = int(m.group(1))
        return a, a, str(a)
    return 0, OPEN_END, s[:40]


def sex_of(name: str) -> str:
    return _SEX.get(str(name or "").strip().lower(), "all")


def level_of(code: str, name: str) -> str:
    if code.startswith("K02") or name == "United Kingdom":
        return "uk"
    if code.startswith("K03") or code.startswith("E92") or name in ("England", "Great Britain"):
        return "country"
    return "region"


def row_id(r: dict) -> str:
    key = "|".join(str(r.get(k, "")) for k in ("dataset", "geography_code", "sex", "age_label", "category", "measure", "period"))
    return hashlib.sha1(key.encode()).hexdigest()[:20]


def _rows(fetch, dataset: str, query: str, *, label: str, unit: str, cat, measure, age=None, sex=None, geo=None) -> list[dict]:
    """One Nomis query -> rows. `cat`, `measure`, `age`, `sex` say which CSV columns hold what (a column name, or a function of the CSV row)."""
    url = f"{NOMIS}/{label}.data.csv?{query}&recordlimit=60000"
    text = fetch(url, timeout=TIMEOUT).text.lstrip("﻿")
    out = []
    for r in csv.DictReader(io.StringIO(text)):
        v = (r.get("OBS_VALUE") or "").strip()
        if v == "":
            continue
        try:
            value = float(v)
        except ValueError:
            continue
        code, name = r["GEOGRAPHY_CODE"], r["GEOGRAPHY_NAME"]
        a_from, a_to, a_label = parse_age(r[age]) if age else (None, None, None)
        row = {"dataset": dataset, "geography_code": code, "geography_name": name, "geography_level": level_of(code, name),
               "sex": sex_of(r[sex]) if isinstance(sex, str) else (sex(r) if sex else "all"),
               "age_from": a_from, "age_to": a_to, "age_label": a_label,
               "category": cat(r) if callable(cat) else r[cat], "measure": measure(r) if callable(measure) else (r[measure] if measure in r else measure),
               "unit": unit, "value": value, "period": r["DATE_NAME"],
               "source_url": f"https://www.nomisweb.co.uk/query/construct/summary.asp?mode=construct&version=0&dataset={label.split('_')[1]}"}
        row["id"] = row_id(row)
        out.append(row)
    return out


def aps_labour(fetch) -> list[dict]:
    """Annual Population Survey, regional: labour market status by age (NM_170_1). Counts of people; shares are worked out from them by whoever reads them."""
    ages = "0,21,22,2,3,23,4,5,6,7,8,24,9,10,11,25"
    status = "0,1,2,3,6,12,13,15,16"
    q = f"geography={GEOGRAPHY}&c_sex=0,1,2&c_age={ages}&c_ecopuk11={status}&measure=1&measures=20100&time=latest&select=date_name,geography_name,geography_code,c_sex_name,c_age_name,c_ecopuk11_name,obs_value"
    return _rows(fetch, "aps_labour", q, label="NM_170_1", unit="people", cat="C_ECOPUK11_NAME", measure="Count", age="C_AGE_NAME", sex="C_SEX_NAME")


def claimants(fetch) -> list[dict]:
    """Claimant Count by sex and age (NM_162_1): the count, and claimants as a share of residents."""
    q = f"geography={GEOGRAPHY}&gender=0,1,2&measure=1,2&time=latest&select=date_name,geography_name,geography_code,gender_name,age_name,measure_name,obs_value"
    rows = _rows(fetch, "claimants", q, label="NM_162_1", unit="people", cat=lambda r: "Claimants", measure="MEASURE_NAME", age="AGE_NAME", sex="GENDER_NAME")
    for r in rows:
        if r["measure"].lower().startswith("claimants as a proportion"):
            r["unit"] = "%"
            r["id"] = row_id(r)
    return rows


def ashe(fetch) -> list[dict]:
    """Annual Survey of Hours and Earnings, resident analysis (NM_30_1): median and mean pay and hours, by sex and region. There is no age breakdown in this table."""
    q = f"geography={GEOGRAPHY}&sex=5,6,1,3&item=2,4&pay=1,5,7,9&measures=20100&time=latest&select=date_name,geography_name,geography_code,sex_name,item_name,pay_name,obs_value"

    def sex(r):
        return "female" if r["SEX_NAME"].startswith("Female") else "male"
    rows = _rows(fetch, "ashe", q, label="NM_30_1", unit="£", cat=lambda r: "Full-time workers" if "Full Time" in r["SEX_NAME"] else "All workers",
                 measure=lambda r: f"{r['ITEM_NAME']} {r['PAY_NAME'].lower()}", sex=sex)
    for r in rows:
        if "hours" in r["measure"].lower():
            r["unit"] = "hours"
            r["id"] = row_id(r)
    return rows


def gdhi(fetch) -> list[dict]:
    """Regional gross disposable household income per head (NM_185_1)."""
    q = f"geography={GEOGRAPHY}&component_of_gdhi=0&measure=2,3&time=latest&select=date_name,geography_name,geography_code,measure_name,obs_value"
    rows = _rows(fetch, "gdhi", q, label="NM_185_1", unit="£", cat=lambda r: "GDHI", measure="MEASURE_NAME")
    for r in rows:
        if "index" in r["measure"].lower():
            r["unit"] = "index"
            r["id"] = row_id(r)
    return rows


def census_econ(fetch) -> list[dict]:
    """Census 2021, economic activity status by sex and age (RM024, NM_2124_1)."""
    q = f"geography={GEOGRAPHY}&measures=20100&select=date_name,geography_name,geography_code,c2021_eastat_7_name,c2021_age_7_name,c_sex_name,obs_value"
    return _rows(fetch, "census_econ", q, label="NM_2124_1", unit="people", cat="C2021_EASTAT_7_NAME", measure="Count", age="C2021_AGE_7_NAME", sex="C_SEX_NAME")


DATASETS = [("aps_labour", aps_labour), ("claimants", claimants), ("ashe", ashe), ("gdhi", gdhi), ("census_econ", census_econ)]


def collect(fetch, record=None) -> list[dict]:
    """Every dataset, one at a time; one that fails is skipped (and reported through `record(name, ok, n, error)`), the rest still load."""
    out: list[dict] = []
    for name, fn in DATASETS:
        try:
            got = fn(fetch)
            out += got
            if record:
                record(name, True, len(got), "")
            print(f"economic data {name}: {len(got)} figures")
        except Exception as e:  # noqa: BLE001
            if record:
                record(name, False, 0, e)
            print(f"economic data {name} failed: {e}", file=sys.stderr)
    return out
