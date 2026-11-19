#!/usr/bin/env python3
"""Builds site/lucien/costing-data.json for the costing tool (LUCIEN > Economic policy > Costings).

Everything numeric in the file is either read from a named publication or marked UNSOURCED:
  * the yield of each illustrative tax change: HMRC, "Direct effects of illustrative tax changes" (the ready reckoner, June 2025 edition,
    on the OBR's March 2025 forecast, April 2026 start), read from the .ods published with it (scripts/lucien/source/);
  * the behavioural parameters that have a published source (OBR), each with the page it comes from;
  * baseline spending for benefits and departmental spending: the OBR's "Tax by tax, spend by spend" pages (the vintage each page carries).
Nothing is filled in from memory: a number with no source is written as {"status": "UNSOURCED"} and the page says so.

Run:  python3 scripts/lucien/build_costing_data.py      (reads the .ods next to this script, writes site/lucien/costing-data.json)
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "source" / "hmrc-direct-effects-2025-06.ods"
OUT = HERE.parent.parent / "site" / "lucien" / "costing-data.json"

NS = {"t": "urn:oasis:names:tc:opendocument:xmlns:table:1.0", "x": "urn:oasis:names:tc:opendocument:xmlns:text:1.0", "o": "urn:oasis:names:tc:opendocument:xmlns:office:1.0"}
T = "{%s}" % NS["t"]
HMRC_URL = "https://www.gov.uk/government/statistics/direct-effects-of-illustrative-tax-changes"
HMRC_FILE = "https://assets.publishing.service.gov.uk/media/68552862b46781eacfd71d71/June_2025_TRR_ODS__1_.ods"
OBR_URL = "https://obr.uk/forecasts-in-depth/tax-by-tax-spend-by-spend/"


def read_rows():
    root = ET.fromstring(zipfile.ZipFile(SRC).read("content.xml"))
    rows = []
    for r in root.iter(T + "table-row"):
        cells = []
        for c in r.findall(T + "table-cell"):
            rep = int(c.get(T + "number-columns-repeated", "1"))
            v = c.get("{%s}value" % NS["o"]) or "".join("".join(p.itertext()) for p in c.findall("x:p", NS))
            cells += [v] * min(rep, 4)
        while cells and not cells[-1]:
            cells.pop()
        if cells:
            rows.append(cells)
    return rows


def num(s):
    s = str(s).strip().lower()
    if s in ("neg", "negligible"):
        return 0.0
    return float(s)


# section heading -> (tax, kind) ; kind says how a rise in the parameter moves receipts when the label does not say:
#   'rate'  a rise raises receipts;  'allow' a rise lowers receipts (the published figure is a cost);  'sym' signed already
SECTIONS = {
    "Income Tax rates": ("income_tax", "rate"),
    "Income Tax allowances and reliefs": ("income_tax", "allow"),
    "Income Tax limits": ("income_tax", "allow"),
    "Income Tax allowances, starting and basic rate limits": ("income_tax", "allow"),
    "National Insurance contributions rates": ("nics", "rate"),
    "National Insurance Contribution Limits": ("nics", "allow"),
    "Child Benefit": ("child_benefit", "explicit"),
    "Corporation tax": ("corporation_tax", "rate"),
    "Capital Gains Tax": ("cgt", "sym"),
    "Inheritance tax": ("inheritance_tax", "explicit"),
    "1% change in various duties": ("duties", "rate"),
    "Vehicle excise duty": ("ved", "rate"),
    "Air passenger duty": ("apd", "rate"),
    "VAT": ("vat", "rate"),
    "Insurance premium tax": ("ipt", "rate"),
    "Stamp duty land tax": ("sdlt", "explicit"),
}
# parameters where a RISE raises receipts although the section says 'allow' (the extra income is taxed at a higher rate)
RISE_RAISES = {"Change upper earnings limit by £10 per week", "Change upper profits limit by £520 per year"}
TAX_NAMES = {"income_tax": "Income Tax", "nics": "National Insurance", "child_benefit": "Child Benefit", "corporation_tax": "Corporation tax", "cgt": "Capital Gains Tax",
             "inheritance_tax": "Inheritance tax", "duties": "Duties", "ved": "Vehicle excise duty", "apd": "Air passenger duty", "vat": "VAT", "ipt": "Insurance premium tax", "sdlt": "Stamp duty land tax"}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:70]


def unit_size(label):
    """The size of the illustrative change: (unit, size). Units: p (pence in the £), pp (percentage points), % , gbp, gbp_week, gbp_year."""
    m = re.search(r"by £([\d,]+)(?: for BR.*)? per week", label)
    if m:
        return "gbp_week", float(m.group(1).replace(",", ""))
    m = re.search(r"by £([\d,]+) per year", label)
    if m:
        return "gbp_year", float(m.group(1).replace(",", ""))
    m = re.search(r"by £([\d,]+)", label) or re.search(r"Nil Rate Band by £([\d,]+)", label) or re.search(r"Amount by £([\d,]+)", label)
    if m:
        return "gbp", float(m.group(1).replace(",", ""))
    m = re.search(r"by (\d+(?:\.\d+)?)p\b", label)
    if m:
        return "p", float(m.group(1))
    m = re.search(r"by (\d+(?:\.\d+)?) percentage points?", label)
    if m:
        return "pp", float(m.group(1))
    m = re.search(r"by (\d+(?:\.\d+)?)%", label)
    if m:
        return "pct", float(m.group(1))
    m = re.search(r"(\d+(?:\.\d+)?) percentage point", label)
    if m:
        return "pp", float(m.group(1))
    m = re.search(r"by (\d+(?:\.\d+)?) ?%", label)
    if m:
        return "pct", float(m.group(1))
    return None, 1.0


def main():
    rows = read_rows()
    items, section, tax, kind = [], None, None, None
    for r in rows:
        label = r[0].strip()
        if label in SECTIONS:
            section = label
            tax, kind = SECTIONS[label]
            continue
        if section is None or len(r) < 4:
            continue
        try:
            v = [num(x) for x in r[1:4]]
        except ValueError:
            continue
        sec_tax, sec_kind = tax, kind
        unit, size = unit_size(label)
        low = label.lower()
        if section == "1% change in various duties":
            unit, size, label_full = "pct", 1.0, f"Change {label} by 1%"
        else:
            label_full = label
        # direction of the published change, and what the figure means
        direction = -1 if re.match(r"(decrease|cut|reduce)", low) else (1 if re.match(r"(increase|raise)", low) else 0)
        explicit = "yield" if "(yield)" in low else ("cost" if "(cost)" in low else None)
        if sec_kind == "sym":
            meaning = "signed"          # CGT: the figures are signed impacts on the Exchequer (negative = loss)
        elif explicit == "yield":
            meaning = "yield"           # the figure is a gain to the Exchequer
        elif explicit == "cost":
            meaning = "cost"
        elif sec_kind == "allow" and label_full not in RISE_RAISES:
            meaning = "cost_if_up"      # a rise costs the Exchequer this much
        else:
            meaning = "yield_if_up"     # a rise raises this much
        items.append({
            "id": f"{sec_tax}:{slug(label_full)}", "tax": sec_tax, "taxName": TAX_NAMES[sec_tax], "label": label_full.replace(" (yield)", "").replace(" (cost)", "").replace(" (Cost)", "").replace(" (Yield)", ""),
            "unit": unit, "size": size, "direction": direction, "meaning": meaning, "values": v,
            "years": ["2026-27", "2027-28", "2028-29"],
            "source": {"name": "HMRC, Direct effects of illustrative tax changes (June 2025)", "url": HMRC_URL, "file": HMRC_FILE, "row": r[0].strip()},
        })
    # items that carry a sourced behavioural parameter or a note the page must show
    notes = {
        "duties:change_tobacco_duties_by_1": {"behaviour": {"offset": {"central": 0.75, "low": 0.6, "high": 0.9, "status": "SOURCED (central) / UNSOURCED (range)",
            "source": "OBR, Economic and fiscal outlook October 2021 (corrected text): the costing of the tobacco duty rise assumed about three-quarters of the static yield is lost to behavioural response. The brief said about 80%; the OBR text found says three-quarters.",
            "url": "https://obr.uk/download/economic-and-fiscal-outlook-october-2021"}}},
        "income_tax:increase_additional_rate_by_1p_yield": {"behaviour": {"tie": {"central": 0.45, "low": 0.35, "high": 0.60, "status": "SOURCED (central, low) / UNSOURCED (high)",
            "source": "OBR, 'The additional rate of income tax' (Budget 2012): the costing of the 45p rate assumed a taxable income elasticity of 0.45 (the March 2010 costing used 0.35; Brewer, Saez and Shephard 0.46; the HMRC study pointed higher). The OBR called 0.45 reasonable and central. The upper end of the range is a tool assumption.",
            "url": "https://obr.uk/box/the-additional-rate-of-income-tax/"}}},
        "nics:change_class_1_employer_rate_by_1_percentage_point": {"warning": "HMRC's figure leaves out the effect of employers passing the cost on through lower pay, higher prices and lower profits (it says these are captured in the OBR forecast, not here). The optional 'wider effects' switch applies the OBR's incidence split."},
    }
    for it in items:
        it.update(notes.get(it["id"], {}))
    # extra notes by tax
    for it in items:
        if it["tax"] == "cgt":
            it["nonlinear"] = True
        if it["tax"] == "income_tax" and it["meaning"] == "cost_if_up":
            it["nonlinear_note"] = "HMRC: the cost of raising an allowance or limit does not scale in a straight line; the 1% and 10% estimates are published for that reason."

    out = {
        "meta": {
            "version": "2026-11-18",
            "built_by": "scripts/lucien/build_costing_data.py",
            "unit": "£ million, Exchequer impact; positive = Exchequer gain, negative = cost",
            "ready_reckoner": {"as_at": "2025-06-24", "baseline": "OBR March 2025 forecast, Spring Statement 2025", "start": "April 2026", "years": ["2026-27", "2027-28", "2028-29"],
                               "name": "HMRC, Direct effects of illustrative tax changes", "url": HMRC_URL, "file": HMRC_FILE,
                               "basis": "National Accounts basis; the figures include HMRC's behavioural responses (taxable income elasticities, incorporation, a CGT elasticity, vaping substitution) but no wider economic effects"},
            "stale_after_months": 12,
            "newer_baseline_exists": "The OBR's October 2026 Economic and fiscal outlook is published (obr.uk). Its files cannot be fetched automatically (obr.uk answers automated downloads with an access page, which is not worked around), so this tool uses the HMRC ready reckoner on the March 2025 baseline until a newer one is added.",
        },
        "items": items,
        "uncertainty_scale": {"Low": 0.05, "Medium": 0.15, "High": 0.30, "Very High": 0.60,
                              "status": "UNSOURCED: the tool's own convention for the +/- width of a published figure by rating (the OBR's rating database could not be read, see meta.newer_baseline_exists). Shown on every result."},
        "extrapolation": {"max_growth": 0.05, "note": "HMRC publish three years. Years four and five are the third year grown at the item's own year-2 to year-3 growth (kept between 0% and 5%; held flat when the item is volatile). UNSOURCED assumption, shown on every result."},
        "spending": {
            "universal_credit": {"label": "Universal Credit (with legacy benefits, UC alone shown)", "points": [["2023-24", 51200], ["2028-29", 88100]], "unit": "£ million", "scope": "Great Britain, UC alone",
                                 "source": "OBR, Tax by tax, spend by spend: Welfare spending, Universal Credit (spending on UC alone £51.2bn in 2023-24, forecast £88.1bn in 2028-29)", "url": OBR_URL + "welfare-spending-universal-credit/"},
            "state_pension": {"label": "State pension", "points": [["2023-24", 125000]], "unit": "£ million", "scope": "Great Britain",
                              "source": "OBR, Tax by tax, spend by spend: Welfare spending, Pensioner benefits (state pensions £125bn of £138bn pensioner benefit spending in 2023-24)", "url": OBR_URL + "welfare-spending-pensioner-benefits/"},
            "pensioner_benefits": {"label": "All pensioner benefits", "points": [["2023-24", 138000]], "unit": "£ million", "scope": "Great Britain",
                                   "source": "OBR, Tax by tax, spend by spend: Welfare spending, Pensioner benefits", "url": OBR_URL + "welfare-spending-pensioner-benefits/"},
            "disability_benefits": {"label": "Disability benefits (PIP, DLA, Attendance Allowance)", "points": [["2023-24", 39100], ["2028-29", 58100]], "unit": "£ million", "scope": "Great Britain",
                                    "source": "OBR, Tax by tax, spend by spend: Welfare spending, Disability benefits", "url": OBR_URL + "welfare-spending-disability-benefits/"},
            "child_benefit": {"label": "Child Benefit", "points": [["2023-24", 12500], ["2028-29", 13200]], "unit": "£ million", "scope": "United Kingdom",
                              "source": "OBR, Tax by tax, spend by spend: Welfare spending, Child Benefit", "url": OBR_URL + "welfare-spending-child-benefit/"},
            "departmental": {"label": "Departmental spending (resource and capital)", "points": [["2025-26", 592300]], "unit": "£ million", "scope": "United Kingdom",
                             "source": "OBR, Tax by tax, spend by spend: Departmental expenditure limits (£592.3bn in 2025-26: £481.0bn resource, £111.3bn capital)", "url": OBR_URL + "departmental-expenditure-limits/"},
            "growth_unsourced": {"state_pension": 0.045, "pensioner_benefits": 0.045, "departmental": 0.035,
                                 "status": "UNSOURCED: the OBR pages give one year for these, so growth to other years is a tool assumption (shown, and widened in the range)."},
            "page_vintage_note": "The OBR pages carry the vintage of the forecast they were last updated for (the pages say some have not been updated for the latest forecast), so these are not the October 2026 baseline.",
        },
        "benefit_behaviour": {
            "universal_credit": {"offset": {"central": 0.10, "low": 0.0, "high": 0.25, "status": "UNSOURCED"}, "note": "Knock-on effects on tax, other benefits and work are not modelled; a placeholder range, flagged."},
            "state_pension": {"offset": {"central": 0.0, "low": 0.0, "high": 0.10, "status": "UNSOURCED"}, "note": "A pension rise is partly taxed back; not modelled."},
            "pensioner_benefits": {"offset": {"central": 0.0, "low": 0.0, "high": 0.10, "status": "UNSOURCED"}, "note": "As state pension."},
            "disability_benefits": {"offset": {"central": 0.0, "low": 0.0, "high": 0.10, "status": "UNSOURCED"}, "note": "Take-up and knock-on effects are not modelled."},
            "child_benefit": {"offset": {"central": 0.0, "low": 0.0, "high": 0.05, "status": "UNSOURCED"}, "note": "Use the HMRC ready reckoner rows for per-child changes; they include the High Income Child Benefit Charge."},
        },
        "indirect": {
            "employer_nics": {"leakage": {"central": 0.25, "low": 0.10, "high": 0.40, "status": "UNSOURCED"},
                              "incidence": {"wages": 0.61, "prices": 0.15, "profits": 0.24, "status": "SOURCED",
                                            "source": "OBR October 2024 Economic and fiscal outlook, as reported by the IFS (Tax measures, Autumn Budget 2024): from 2026-27, 61% passed to workers' pay, 15% to prices, 24% absorbed in profits; 76% through real wages",
                                            "url": "https://ifs.org.uk/sites/default/files/2024-10/Tax-measures-Isaac-Delestre_0.pdf"},
                              "note": "The share of the headline yield lost to lower earnings and profits elsewhere in the tax system is a tool placeholder (UNSOURCED); only the incidence split is sourced."}},
        "interactions": {
            "note": "HMRC: changes can broadly be added, except an allowance or band change combined with a rate change in Income Tax, where the rate change is worth less. The tool adjusts those pairs from HMRC's own numbers; other interactions are listed as not modelled.",
            "income_tax_pairs": [
                {"rate_family": "basic_rate", "rate_item": "income_tax:change_basic_rate_by_1p", "changers": [["personal_allowance", 0.20], ["all_main_allowances_starting_and_basic_rate_limits", 0.20]]},
                {"rate_family": "higher_rate", "rate_item": "income_tax:change_higher_rate_by_1p", "changers": [["basic_rate_limit", 0.20]]}],
            "not_modelled": ["fuel, alcohol and tobacco duty changes and the VAT charged on them", "Income Tax and National Insurance changes together (incorporation and income shifting)", "Universal Credit and tax changes together (the interaction through net income)", "Corporation tax and employer National Insurance together (profits)"],
        },
        "references": [
            {"name": "HMRC, Direct effects of illustrative tax changes (June 2025)", "url": HMRC_URL},
            {"name": "OBR, The additional rate of income tax (Budget 2012)", "url": "https://obr.uk/box/the-additional-rate-of-income-tax/"},
            {"name": "OBR, Economic and fiscal outlook October 2021 (tobacco costing assumption)", "url": "https://obr.uk/download/economic-and-fiscal-outlook-october-2021"},
            {"name": "OBR, Tax by tax, spend by spend (welfare and departmental spending baselines)", "url": OBR_URL},
            {"name": "IFS, Tax measures, Autumn Budget 2024 (OBR employer NICs incidence)", "url": "https://ifs.org.uk/sites/default/files/2024-10/Tax-measures-Isaac-Delestre_0.pdf"},
            {"name": "HM Treasury, Budget 2012 policy costings (additional rate, static cost)", "url": "https://www.hrballiance.org.uk/wp-content/uploads/2012/05/budget2012_policy_costings.pdf"},
        ],
    }
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(items)} policy lines -> {OUT}")


if __name__ == "__main__":
    sys.exit(main())
