"""Builds site/lucien/fiscal-system.json: the rulebook behind LUCIEN > Economic policy > How the system works.

Every number comes from an official GOV.UK page, read now through the GOV.UK content API (open, no key), and is recorded with the page it came from and the date it was read:
  - the benefit and pension amounts are read straight from the DWP's table "Benefit and pension rates 2026 to 2027" (no number is typed in here for those);
  - the tax rules are written in below as short statements, and each one lists the exact words that must appear on its source page ("verify"). If GOV.UK changes a number, the
    check fails and the build stops, instead of publishing a rule that is out of date.
Run:  python3 scripts/lucien/build_fiscal_system.py     (needs the internet; writes site/lucien/fiscal-system.json)
Nothing here is a costing, and it says what it does not yet cover (see GAPS).
"""
from __future__ import annotations

import html
import json
import re
import sys
from datetime import date
from pathlib import Path

import requests

OUT = Path(__file__).resolve().parents[2] / "site" / "lucien" / "fiscal-system.json"
API = "https://www.gov.uk/api/content/"
UA = {"User-Agent": "Mozilla/5.0 (compatible; PolicyTracker/1.0; personal research tool)"}
TAX_YEAR = "2026-27"

SOURCES = {
    "it": ("Income Tax rates and Personal Allowances", "income-tax-rates"),
    "sit": ("Income Tax in Scotland", "scottish-income-tax"),
    "ni": ("National Insurance rates and categories", "national-insurance-rates-letters"),
    "sene": ("Self-employed National Insurance rates", "self-employed-national-insurance-rates"),
    "emp": ("Rates and thresholds for employers 2026 to 2027", "guidance/rates-and-thresholds-for-employers-2026-to-2027"),
    "div": ("Tax on dividends", "tax-on-dividends"),
    "cgt": ("Capital Gains Tax: rates and allowances", "capital-gains-tax/rates"),
    "ct": ("Corporation Tax rates", "corporation-tax-rates"),
    "vat": ("VAT rates", "vat-rates"),
    "iht": ("Inheritance Tax thresholds and rules", "inheritance-tax"),
    "sdlt": ("Stamp Duty Land Tax: residential property rates", "stamp-duty-land-tax/residential-property-rates"),
    "hicbc": ("High Income Child Benefit Charge", "child-benefit-tax-charge"),
    "marr": ("Marriage Allowance", "marriage-allowance"),
    "isa": ("Individual Savings Accounts", "individual-savings-accounts"),
    "sl": ("Repaying your student loan", "repaying-your-student-loan/what-you-pay"),
    "pen": ("Tax on your private pension contributions", "tax-on-your-private-pension/annual-allowance"),
    "uc": ("Universal Credit: how your earnings affect your payments", "universal-credit/how-your-earnings-affect-your-payments"),
    "cb": ("Child Benefit: what you'll get", "child-benefit/what-youll-get"),
    "tfc": ("Tax-Free Childcare", "tax-free-childcare"),
    "pc": ("Pension Credit: what you'll get", "pension-credit/what-youll-get"),
    "wfp": ("Winter Fuel Payment: how much you'll get", "winter-fuel-payment/how-much-youll-get"),
    "bcap": ("Benefit cap", "benefit-cap/benefit-cap-amounts"),
    "dwp": ("DWP: Benefit and pension rates 2026 to 2027", "government/publications/benefit-and-pension-rates-2026-to-2027/proposed-benefit-and-pension-rates-2026-to-2027"),
}


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(str(s)).replace(" ", " ")).strip()


def strip_html(h: str) -> str:
    h = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", h, flags=re.S)
    h = re.sub(r"</(p|li|tr|h\d|div|table|caption)>", "\n", h)
    h = re.sub(r"</t[dh]>", " | ", h)
    return norm(re.sub(r"<[^>]+>", " ", h))


_cache: dict[str, dict] = {}


def page(src: str) -> dict:
    if src not in _cache:
        r = requests.get(API + SOURCES[src][1], headers=UA, timeout=60, allow_redirects=True)
        r.raise_for_status()
        j = r.json()
        d = j.get("details", {})
        chunks = [d.get("body", "")] + [p.get("body", "") for p in d.get("parts", []) or []]
        _cache[src] = {"json": j, "html": "\n".join(chunks), "text": strip_html("\n".join(chunks)), "title": j.get("title", SOURCES[src][0])}
    return _cache[src]


def dwp_tables() -> list[dict]:
    """Every table on the DWP page: { section, sub, title, rows: [[label, 2025/26, 2026/27]] }."""
    body = page("dwp")["html"]
    out, sec, sub = [], "", ""
    for t in re.split(r"(<h[23][^>]*>.*?</h[23]>|<table.*?</table>)", body, flags=re.S):
        m = re.match(r"<h([23])[^>]*>(.*?)</h\1>", t, re.S)
        if m:
            txt = norm(re.sub("<[^>]+>", "", m.group(2)))
            if m.group(1) == "2":
                sec, sub = txt, ""
            else:
                sub = txt
        elif t.startswith("<table"):
            rows = [[norm(re.sub("<[^>]+>", "", c)) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S)] for r in re.findall(r"<tr.*?</tr>", t, re.S)]
            if rows and len(rows[0]) >= 3:
                out.append({"section": sec, "sub": sub, "title": rows[0][0], "rows": [r for r in rows[1:] if len(r) >= 3]})
    return out


DWP = None
MISSING: list[str] = []


def dwp(section: str, label: str, table: str | None = None, sub: str | None = None) -> tuple[str, str]:
    """(2025/26, 2026/27) for a row of the DWP table, found by section heading, row label and (to tell two apart) the table's own title or sub-heading."""
    global DWP
    DWP = DWP or dwp_tables()
    for t in DWP:
        if section.lower() not in t["section"].lower():
            continue
        if table and table.lower() not in t["title"].lower():
            continue
        if sub and sub.lower() not in t["sub"].lower():
            continue
        for r in t["rows"]:
            if label.lower() in r[0].lower():
                return r[1], r[2]
    raise KeyError(f"DWP table row not found: {section} / {table} / {label}")


def money(v: str) -> str:
    v = v.strip()
    if re.fullmatch(r"[\d,]+(\.\d+)?", v):
        n = float(v.replace(",", ""))
        return f"£{n:,.2f}" if n != int(n) or "." in v and n < 1000 else f"£{n:,.0f}"
    return v


def P(label, value, src, verify=None, note=""):
    """A rule: label, value as GOV.UK words it, the page it is from, and the words that must be on that page."""
    return {"label": label, "value": value, "source": src, "verify": verify if verify is not None else [], "note": note}


def D(label, section, row, table=None, sub=None, per="a week", note=""):
    """A benefit amount read from the DWP table (2026/27, and last year's for comparison)."""
    try:
        a, b = dwp(section, row, table, sub)
    except KeyError as e:
        MISSING.append(str(e))
        a = b = "?"
    return {"label": label, "value": f"{money(b)} {per}".strip(), "previous": f"{money(a)} {per}".strip() if a and a != b else "", "source": "dwp", "verify": [], "note": note}


def item(id_, name, kind, summary, parts, who="", admin="", interactions=None):
    return {"id": id_, "name": name, "kind": kind, "summary": summary, "who": who, "admin": admin, "parts": parts, "interactions": interactions or []}


def build() -> dict:
    UCs = "Universal Credit (UC) (monthly rates)"
    groups = []

    groups.append({"id": "earnings", "title": "Taxes on earnings and income", "intro": "What comes off pay and other income before it reaches the person.", "items": [
        item("income-tax", "Income Tax (England, Wales and Northern Ireland)", "tax",
             "Tax on earnings, pensions and most other income above a tax-free Personal Allowance, charged in bands. Scotland sets its own rates on earnings and pensions (next entry); dividends and savings are taxed the same across the UK.",
             [P("Personal Allowance", "£12,570 a year", "it", ["standard Personal Allowance is £12,570"]),
              P("Basic rate", "20% on £12,571 to £50,270", "it", ["£12,571 to £50,270", "20%"]),
              P("Higher rate", "40% on £50,271 to £125,140", "it", ["£50,271 to £125,140", "40%"]),
              P("Additional rate", "45% over £125,140", "it", ["over £125,140", "45%"]),
              P("Personal Allowance taper", "£1 lost for every £2 of adjusted net income over £100,000; gone completely at £125,140", "it", ["£1 for every £2", "£100,000", "£125,140"],
                "Worked out from this: between £100,000 and £125,140 each extra £1 earned is taxed at 40% and also costs 50p of allowance, an effective 60% rate."),
              P("Trading and property allowances", "£1,000 each of income, tax-free", "it", ["£1,000"]),
              P("Marriage Allowance", "transfer £1,260 of Personal Allowance to a spouse or civil partner, saving them up to £252", "marr", ["£1,260", "£252"])],
             who="Anyone with taxable income above the allowance.", admin="HMRC",
             interactions=["The 60% effective rate between £100,000 and £125,140 sits on top of National Insurance (2%), and for some people the High Income Child Benefit Charge, student loan repayments and the loss of Tax-Free Childcare (all at £100,000 for the childcare).",
                           "Pension contributions made through the employer or with tax relief can bring adjusted net income back down below a threshold."]),
        item("income-tax-scotland", "Income Tax (Scotland)", "tax", "Scottish residents pay Scottish rates and bands on earnings, pensions and most other non-savings, non-dividend income; the Personal Allowance is the same.",
             [P("Starter rate", "19% on £12,571 to £16,537", "sit", ["£12,571 to £16,537", "19%"]), P("Basic rate", "20% on £16,538 to £29,526", "sit", ["£16,538 to £29,526", "20%"]),
              P("Intermediate rate", "21% on £29,527 to £43,662", "sit", ["£29,527 to £43,662", "21%"]), P("Higher rate", "42% on £43,663 to £75,000", "sit", ["£43,663 to £75,000", "42%"]),
              P("Advanced rate", "45% on £75,001 to £125,140", "sit", ["£75,001 to £125,140", "45%"]), P("Top rate", "48% over £125,140", "sit", ["over £125,140", "48%"])],
             who="People resident in Scotland.", admin="HMRC collects it for the Scottish Government"),
        item("employee-ni", "National Insurance: employees (Class 1)", "tax", "Paid by employees on weekly (or monthly) earnings between two thresholds, at a low rate above the upper one. It also builds entitlement to the State Pension and some benefits.",
             [P("Nothing on earnings up to", "£242 a week (£12,570 a year)", "ni", ["£129 to £242", "£1,048"], "Between £129 and £242 a week nothing is paid but the year counts towards benefits."),
              P("Main rate (category A)", "8% on earnings from £242.01 to £967 a week (£50,270 a year)", "ni", ["£242.01 to £967", "8%"]),
              P("Above the upper limit", "2% on earnings over £967 a week", "ni", ["Over £967", "2%"]),
              P("Who stops paying", "at State Pension age for employees", "ni", [], "Employees stop paying Class 1 when they reach State Pension age.")],
             who="Employees aged 16 to State Pension age.", admin="HMRC"),
        item("employer-ni", "National Insurance: employers (Class 1 secondary)", "tax", "Paid by the employer on each employee's earnings above a low threshold, not deducted from pay; on benefits in kind the employer pays Class 1A.",
             [P("Rate", "15%", "ni", ["15%"]), P("Starts above", "£96 a week (£5,000 a year) for most employees", "emp", ["£96 per week", "£5,000 per year"]),
              P("Upper secondary threshold", "£967 a week for under-21s, apprentices under 25 and veterans: nothing is paid between the secondary and upper thresholds for them", "emp", ["£967 per week"]),
              P("Class 1A (expenses and benefits)", "15%", "ni", ["Class 1A", "15%"])],
             who="Employers.", admin="HMRC", interactions=["Economists generally expect much of this to fall on wages and profits rather than on the employer alone: a costing has to say what it assumes (see the costing specification)."]),
        item("self-employed-ni", "National Insurance: self-employed (Classes 2 and 4)", "tax", "Class 4 is a percentage of profits between two thresholds; Class 2 is no longer compulsory.",
             [P("Class 4, main rate", "6% on profits from £12,570 to £50,270", "sene", ["6% on profits over £12,570 up to £50,270"]), P("Class 4, above", "2% on profits over £50,270", "sene", ["2% on profits over £50,270"]),
              P("Class 2", "no payment needed from £7,105 of profits (counts as paid); £3.65 a week if paid voluntarily below that", "sene", ["£7,105", "£3.65 a week"])],
             who="Self-employed people.", admin="HMRC"),
        item("student-loan", "Student loan repayments", "tax", "Not a tax, but collected through payroll like one: a share of income above a threshold, in addition to tax and National Insurance, until the loan is repaid or written off.",
             [P("Plan 1", "9% of income over £26,900 a year", "sl", ["£26,900", "9% of your income over the threshold"]), P("Plan 2", "9% of income over £29,385 a year", "sl", ["£29,385"]),
              P("Plan 4", "9% of income over £33,795 a year", "sl", ["£33,795"]), P("Plan 5", "9% of income over £25,000 a year", "sl", ["£25,000"]),
              P("Postgraduate Loan", "6% of income over £21,000 a year", "sl", ["£21,000", "6% of your income over the threshold"])],
             who="Anyone with a student loan in repayment.", admin="Student Loans Company / HMRC",
             interactions=["Repayments run alongside income tax and National Insurance, so a Plan 2 borrower in the basic-rate band faces 20% + 8% + 9% = 37% on each extra £1 (worked out from the rules shown here)."]),
        item("hicbc", "High Income Child Benefit Charge", "tax", "A tax charge that claws back Child Benefit from households where one person has a high income.",
             [P("Starts at", "individual income over £60,000", "hicbc", ["over £60,000"]), P("Rate", "1% of the Child Benefit for every £200 over £60,000", "hicbc", ["1% of your Child Benefit for every £200"]),
              P("Fully repaid at", "£80,000", "hicbc", ["£80,000"])],
             who="Anyone with Child Benefit in the household, where the higher earner has income over £60,000.", admin="HMRC",
             interactions=["Between £60,000 and £80,000 the clawback behaves like an extra marginal rate on top of 40% income tax and 2% National Insurance; the size depends on the number of children."]),
        item("pensions-tax", "Tax relief on pensions", "tax", "Contributions to a private pension get tax relief, up to limits.",
             [P("Relief limit", "contributions up to 100% of earnings in a year get relief", "pen", ["100% of your earnings"]), P("Annual allowance", "£60,000 a year", "pen", ["£60,000"]),
              P("Relief at source", "the provider claims 20%; higher-rate payers claim the rest through tax", "pen", ["20%"])], who="Anyone paying into a private pension.", admin="HMRC"),
        item("isas", "ISAs", "tax", "Savings and investment accounts whose returns are tax-free.",
             [P("Annual limit", "£20,000 across all ISAs in the year", "isa", ["£20,000"]), P("Lifetime ISA", "up to £4,000 a year within the limit", "isa", ["£4,000"])], who="Adults saving.", admin="HMRC"),
        item("dividend-tax", "Tax on dividends", "tax", "Dividends above an allowance are taxed at rates that depend on the income tax band they fall in.",
             [P("Dividend allowance", "£500 a year", "div", ["£500"]), P("Basic rate", "10.75%", "div", ["10.75%"]), P("Higher rate", "35.75%", "div", ["35.75%"]), P("Additional rate", "39.35%", "div", ["39.35%"])],
             who="Shareholders outside ISAs and pensions.", admin="HMRC"),
    ]})

    groups.append({"id": "spending", "title": "Taxes on spending", "intro": "Charged when things are bought.", "items": [
        item("vat", "Value Added Tax", "tax", "A tax on most goods and services sold by VAT-registered businesses, which pass it on to the buyer.",
             [P("Standard rate", "20%", "vat", ["20%"]), P("Reduced rate", "5%", "vat", ["5%"]), P("Zero rate", "0% (the sale is covered by VAT, but nothing is charged)", "vat", ["0%"])],
             who="Buyers of goods and services; collected by VAT-registered businesses.", admin="HMRC"),
    ]})

    groups.append({"id": "wealth", "title": "Taxes on wealth, property and gains", "intro": "Charged on gains, on property bought, and on estates.", "items": [
        item("cgt", "Capital Gains Tax", "tax", "A tax on the profit from selling assets such as shares and second homes.",
             [P("Annual tax-free allowance", "£3,000 (£1,500 for most trusts)", "cgt", ["£3,000", "£1,500"]), P("Basic-rate taxpayers", "18% on gains", "cgt", ["18%"]), P("Higher and additional-rate taxpayers", "24% on gains", "cgt", ["24%"]),
              P("Basic rate band for the calculation", "£37,700: gains within it (after taxable income) are at 18%", "cgt", ["£37,700"])], who="People and trustees selling assets at a gain.", admin="HMRC"),
        item("iht", "Inheritance Tax", "tax", "A tax on estates (and some lifetime gifts) above a threshold.",
             [P("Threshold", "£325,000 per person", "iht", ["£325,000"]), P("Home to children or grandchildren", "threshold can rise to £500,000", "iht", ["£500,000"]), P("Rate", "40% on the value above the threshold", "iht", ["40%"]),
              P("Charity", "36% if 10% or more of the net estate goes to charity", "iht", ["36%"]), P("Gifts", "£3,000 a year exempt; gifts within seven years of death may be taxed", "iht", ["£3,000", "7 years"])],
             who="Estates above the threshold.", admin="HMRC"),
        item("sdlt", "Stamp Duty Land Tax (England and Northern Ireland)", "tax", "A tax on buying property, charged in bands on the part of the price in each band.",
             [P("Up to £125,000", "0%", "sdlt", ["Up to £125,000"]), P("£125,001 to £250,000", "2%", "sdlt", ["£125,001 to £250,000", "2%"]), P("£250,001 to £925,000", "5%", "sdlt", ["£250,001 to £925,000", "5%"]),
              P("£925,001 to £1.5 million", "10%", "sdlt", ["£925,001 to £1.5 million", "10%"]), P("Above £1.5 million", "12%", "sdlt", ["12%"]),
              P("First-time buyers", "nothing up to £300,000, then 5% to £500,000; no relief on homes over £500,000", "sdlt", ["£300,000", "£500,000"]), P("Additional homes", "5% on top of these rates", "sdlt", ["5% on top of these rates"])],
             who="Buyers of property in England and Northern Ireland (Scotland and Wales have their own taxes).", admin="HMRC"),
    ]})

    groups.append({"id": "business", "title": "Taxes on business", "intro": "Charged on company profits.", "items": [
        item("corp-tax", "Corporation Tax", "tax", "A tax on company profits, with a lower rate for small companies and marginal relief in between.",
             [P("Main rate", "25% on profits over £250,000", "ct", ["25%", "£250,000"]), P("Small profits rate", "19% on profits of £50,000 or less", "ct", ["19%", "£50,000"]),
              P("Between the two", "marginal relief: an effective rate between 19% and 25% on profits from £50,000 to £250,000", "ct", ["Marginal Relief"])], who="Companies.", admin="HMRC"),
    ]})

    # ---- benefits: amounts read from the DWP table
    uc_parts = [
        D("Standard allowance: single under 25", UCs, "Single under 25", per="a month"), D("Standard allowance: single 25 or over", UCs, "Single 25 or over", per="a month"),
        D("Standard allowance: couple, both under 25", UCs, "Joint claimants both under 25", per="a month"), D("Standard allowance: couple, one or both 25 or over", UCs, "one or both 25 or over", table="Couple", per="a month"),
        D("Child element: first child (born before 6 April 2017)", UCs, "First child (born prior", per="a month"), D("Child element: first child born from 6 April 2017, and other children", UCs, "First child (born on or after", per="a month"),
        D("Disabled child addition: lower", UCs, "Lower rate addition", per="a month"), D("Disabled child addition: higher", UCs, "Higher rate addition", per="a month"),
        D("Limited capability for work", UCs, "Limited Capability for Work amount", per="a month"),
        D("Limited capability for work and work-related activity (new claims)", UCs, "Limited Capability for Work and Work-Related Activity amount", per="a month",
          note="The amount for people who claimed before 2026, and for severe conditions and terminal illness, is higher: see the DWP table."),
        D("Carer amount", UCs, "Carer amount", per="a month"), D("Childcare: one child (up to 85% of costs)", UCs, "Maximum for one child", per="a month"), D("Childcare: two or more children", UCs, "Maximum for two or more children", per="a month"),
        D("Work allowance (no housing element)", UCs, "Higher work allowance", per="a month"), D("Work allowance (with a housing element)", UCs, "Lower work allowance", per="a month"),
        P("Taper", "payment falls by 55p for every £1 earned above the work allowance", "uc", ["goes down by 55p"],
          "Earnings are taxed first, so the 55p applies to take-home pay: see the marginal rates explorer for the combined effect with tax and National Insurance."),
        D("Capital limit: no UC above", UCs, "Upper limit", sub="Capital limit - Universal Credit", per=""),
        D("Savings between £6,000 and the limit count as income of", UCs, "Assumed income from capital", sub="Capital limit - Universal Credit", per="a month for every £250"),
    ]
    groups.append({"id": "benefits-working-age", "title": "Welfare: working-age and families", "intro": "Amounts for 2026-27 (and, where different, last year's) read from the DWP's published rates.", "items": [
        item("universal-credit", "Universal Credit", "benefit", "The main means-tested benefit for people of working age on a low income, in or out of work. It combines the support that used to be in several benefits and is reduced as earnings rise.",
             uc_parts, who="Working-age people and families on a low income.", admin="DWP",
             interactions=["Because UC is reduced by 55p for each £1 of earnings above the work allowance, it adds to the marginal rate of tax and National Insurance: the combined effect is shown in the marginal rates explorer.",
                           "The benefit cap limits the total of UC and other benefits a household can receive (see Benefit cap).",
                           "Student loan repayments and the High Income Child Benefit Charge are separate and do not reduce UC."]),
        item("benefit-cap", "Benefit cap", "benefit", "A limit on the total benefit income of a working-age household. It is waived for households with earnings of £881 a month or more after tax and National Insurance, and for several disability and caring groups.",
             [D("Couples, or single parents (Greater London), a year", "Benefit Cap", "Couples (with or without children)", sub=None, table="Annual level of benefit cap (Greater London)", per="a year"),
              D("Single adults, no children (Greater London), a year", "Benefit Cap", "Single adult households without children", table="Annual level of benefit cap (Greater London)", per="a year"),
              D("Couples, or single parents (rest of Great Britain), a year", "Benefit Cap", "Couples (with or without children)", table="Annual level of Benefit Cap (Rest of Great Britain)", per="a year"),
              D("Single adults, no children (rest of Great Britain), a year", "Benefit Cap", "Single adult households without children", table="Annual level of Benefit Cap (Rest of Great Britain)", per="a year"),
              P("Earnings exemption", "£881 a month combined, after tax and National Insurance (from 1 April 2026)", "bcap", ["£881"])], who="Working-age households not exempt.", admin="DWP"),
        item("child-benefit", "Child Benefit", "benefit", "A payment for each child, not means-tested, but clawed back through tax from households where someone has a high income (the High Income Child Benefit Charge, above).",
             [P("Eldest or only child", "£27.05 a week", "cb", ["£27.05"]), P("Each other child", "£17.90 a week", "cb", ["£17.90"])], who="Anyone responsible for a child.", admin="HMRC",
             interactions=["The High Income Child Benefit Charge claws it back between £60,000 and £80,000 of individual income."]),
        item("tfc", "Tax-Free Childcare", "benefit", "The government tops up money paid into a childcare account.",
             [P("Top-up", "£2 for every £8 paid in, up to £2,000 a year per child (£4,000 if the child is disabled)", "tfc", ["£2", "£2,000", "£4,000"]),
              P("Income limit", "no support if either partner's expected adjusted net income is over £100,000", "tfc", ["£100,000"])], who="Working parents.", admin="HMRC"),
        item("jsa-esa", "Jobseeker's Allowance and Employment and Support Allowance", "benefit", "Older, 'legacy' benefits that Universal Credit is replacing; the new-style versions are paid on National Insurance contributions.",
             [D("JSA (contribution-based) personal rate: 25 or over", "Jobseeker", "25 or over", sub="Contribution based JSA"), D("JSA (contribution-based) personal rate: under 25", "Jobseeker", "Under 25", sub="Contribution based JSA"),
              D("ESA (contributory and new style): 25 or over", "Employment and Support Allowance", "25 or over", sub="Contributory and New Style ESA", table="Single"), D("ESA (contributory and new style): work-related activity component", "Employment and Support Allowance", "Work-related activity", sub="Contributory and New Style ESA"), D("ESA (contributory and new style): support component", "Employment and Support Allowance", "Support", sub="Contributory and New Style ESA", table="Components")],
             who="Jobseekers and people with limited capability for work.", admin="DWP"),
        item("statutory-pay", "Statutory sick, maternity and other family pay", "benefit", "Paid by employers (and reclaimed in part), at a flat rate or a share of earnings.",
             [D("Statutory Sick Pay: standard rate (or 80% of average earnings if lower)", "Statutory Sick Pay", "Standard rate"), D("Statutory Maternity Pay: flat rate", "Statutory Maternity Pay", "Standard rate"), D("Maternity Allowance: standard rate", "Maternity Allowance", "Standard rate")],
             who="Employees (and some self-employed people for Maternity Allowance).", admin="Employers; DWP for Maternity Allowance"),
    ]})

    groups.append({"id": "benefits-disability", "title": "Welfare: disability, health and caring", "intro": "Not means-tested, apart from the additions in other benefits.", "items": [
        item("pip", "Personal Independence Payment", "benefit", "Help with the extra costs of a long-term illness or disability, in two parts; people of working age.",
             [D("Daily living: standard", "Personal Independence Payment", "Standard", table="Daily living component"), D("Daily living: enhanced", "Personal Independence Payment", "Enhanced", table="Daily living component"),
              D("Mobility: standard", "Personal Independence Payment", "Standard", table="Mobility component"), D("Mobility: enhanced", "Personal Independence Payment", "Enhanced", table="Mobility component")],
             who="People with a long-term condition, assessed on how it affects daily life.", admin="DWP"),
        item("aa", "Attendance Allowance", "benefit", "The equivalent for people over State Pension age who need care.", [D("Lower rate", "Attendance Allowance", "Lower rate"), D("Higher rate", "Attendance Allowance", "Higher rate")], who="Over State Pension age, with care needs.", admin="DWP"),
        item("carers", "Carer's Allowance", "benefit", "For people who spend at least 35 hours a week caring for someone getting a disability benefit, with an earnings limit.",
             [D("Weekly rate", "Carer", "Carer’s Allowance", table=""), D("Earnings limit", "Earning rules", "Carer’s Allowance")], who="Carers.", admin="DWP"),
    ]})

    groups.append({"id": "benefits-pensioners", "title": "Welfare: pensioners", "intro": "State Pension and the top-ups for pensioners on low incomes.", "items": [
        item("state-pension", "State Pension", "benefit", "The new State Pension is paid to people reaching State Pension age since April 2016; the old basic pension to those before.",
             [D("New State Pension: full rate", "State Pension", "Full rate", table="New State Pension"), D("Old basic State Pension (category A or B)", "State Pension", "Category A or B basic pension", table="Old State Pension"),
              ],
             who="People over State Pension age with enough National Insurance years.", admin="DWP"),
        item("pension-credit", "Pension Credit", "benefit", "Tops a pensioner's income up to a minimum level (the Guarantee Credit), with a small extra for savings (Savings Credit).",
             [P("Guarantee Credit: single", "tops weekly income up to £238", "pc", ["£238"]), P("Guarantee Credit: couple", "tops joint weekly income up to £363.25", "pc", ["£363.25"]),
              P("Savings", "the first £10,000 is ignored; each £500 above it counts as £1 a week of income", "pc", ["£10,000", "£500"])],
             who="People over the Pension Credit age on a low income.", admin="DWP", interactions=["Getting Pension Credit opens up other help (for example Warm Home Discount and the Winter Fuel Payment in full)."]),
        item("winter-fuel", "Winter Fuel Payment", "benefit", "A payment to pensioners for heating costs, which HMRC takes back through tax from people with a higher income.",
             [P("Amount", "£100 to £300, by age and household", "wfp", ["£100", "£300"]), P("Clawback", "taken back if the person's total income is over £35,000", "wfp", ["£35,000"])], who="Pensioners.", admin="DWP; HMRC for the clawback"),
    ]})

    return {"groups": groups}



def model() -> tuple[dict, list[tuple[str, str]]]:
    """The numbers the marginal rates explorer runs on, each one traceable: tax numbers with the words that must be on their source page, benefit numbers read from the DWP table."""
    dw = lambda sec, row, **k: float(dwp(sec, row, **k)[1].replace(",", ""))  # noqa: E731
    UCm = "Universal Credit (UC) (monthly rates)"
    m = {
        "tax_year": TAX_YEAR,
        "personal_allowance": 12570, "pa_taper_start": 100000, "pa_taper_end": 125140, "basic_top": 50270, "additional_from": 125140, "rate_basic": 0.20, "rate_higher": 0.40, "rate_additional": 0.45,
        "ni_threshold": 12570, "ni_upper": 50270, "ni_main": 0.08, "ni_upper_rate": 0.02,
        "student_loan_rate": 0.09, "student_loan_thresholds": {"plan1": 26900, "plan2": 29385, "plan4": 33795, "plan5": 25000}, "postgraduate_rate": 0.06, "postgraduate_threshold": 21000,
        "hicbc_start": 60000, "hicbc_end": 80000,
        "child_benefit_week": {"eldest": 27.05, "other": 17.90},
        "uc_month": {"standard_single_25": dw(UCm, "Single 25 or over"), "child_first": dw(UCm, "First child (born on or after"), "child_other": dw(UCm, "First child (born on or after"),
                     "work_allowance_children": dw(UCm, "Higher work allowance"), "taper": 0.55},
    }
    checks = [("it", "£12,570"), ("it", "£1 for every £2"), ("it", "£100,000"), ("it", "£125,140"), ("it", "£50,270"), ("it", "20%"), ("it", "40%"), ("it", "45%"),
              ("ni", "£242.01 to £967"), ("ni", "8%"), ("ni", "2%"), ("sl", "£26,900"), ("sl", "£29,385"), ("sl", "£33,795"), ("sl", "£25,000"), ("sl", "£21,000"), ("sl", "9% of your income over the threshold"),
              ("hicbc", "over £60,000"), ("hicbc", "£80,000"), ("hicbc", "1% of your Child Benefit for every £200"), ("cb", "£27.05"), ("cb", "£17.90"), ("uc", "goes down by 55p")]
    return m, checks


# what this page does not cover yet, said openly
GAPS = [
    "Fuel, alcohol and tobacco duties, Air Passenger Duty, Insurance Premium Tax and vehicle tax rates (the figures are on GOV.UK; not yet loaded here).",
    "Council Tax and business rates (set by local authorities and the devolved governments), and the Scottish and Welsh property taxes.",
    "Capital allowances, business reliefs, the Apprenticeship Levy and the Employment Allowance, Corporation Tax reliefs, and the levies on banks and digital services.",
    "Housing Benefit and Local Housing Allowance, free school meals, Child Tax Credit and Working Tax Credit (closed to new claims), and devolved benefits.",
    "Eligibility conditions in detail (this page gives rates, thresholds and tapers, not who qualifies in every case).",
]


def verify(data: dict) -> list[str]:
    bad = []
    for g in data["groups"]:
        for it in g["items"]:
            for p in it["parts"]:
                if p["source"] == "dwp":
                    continue
                text = page(p["source"])["text"]
                for v in p["verify"]:
                    if norm(v) not in text:
                        bad.append(f"{it['id']} / {p['label']}: {v!r} not found on {SOURCES[p['source']][1]}")
    return bad


def main() -> int:
    data = build()
    mdl, mchecks = model()
    problems = verify(data) + MISSING + [f"model: {v!r} not found on {SOURCES[src][1]}" for src, v in mchecks if norm(v) not in page(src)["text"]]
    used = sorted({p["source"] for g in data["groups"] for it in g["items"] for p in it["parts"]})
    today = date.today().isoformat()
    out = {"title": "How the UK tax and welfare system works", "tax_year": TAX_YEAR, "retrieved": today, "groups": data["groups"], "gaps": GAPS, "model": mdl,
           "sources": {k: {"title": page(k)["title"], "url": "https://www.gov.uk/" + SOURCES[k][1], "published": (page(k)["json"].get("public_updated_at") or "")[:10]} for k in used},
           "notice": "Rules as published on GOV.UK on the date retrieved. A reference summary for policy work, not tax or benefits advice, and not an official costing."}
    if problems:
        print("The sources no longer say what these rules say; fix or update before publishing:", file=sys.stderr)
        print("\n".join(problems), file=sys.stderr)
        return 1
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    n = sum(len(it["parts"]) for g in out["groups"] for it in g["items"])
    print(f"wrote {OUT.name}: {len(out['groups'])} groups, {sum(len(g['items']) for g in out['groups'])} items, {n} rules, {len(used)} sources")
    return 0


if __name__ == "__main__":
    sys.exit(main())
