# Costing tool: methodology (kept in step with `site/lucien/costing.js`)

LUCIEN > Economic policy > Costings. **Indicative estimate produced by a modelling tool. Not an official, OBR-certified or HM Treasury costing.** Units: £ million, Exchequer impact; positive = a gain to the Exchequer, negative = a cost. Fiscal years `2026-27` to `2030-31`.

## What it does
1. **Policy points in words** (one per line) are turned into structured policies (`kind`, line, direction, size, start year) by `parseLine`. A person confirms each one on the page before anything is costed. Ambiguous input is **asked about, never costed silently** (for example "raise VAT" with no size, "to 21p" with no current level, "freeze fuel duty" with no size for the rise foregone).
2. **Each policy is costed** (`costOne`), then **the package jointly** (`costPackage`), reporting sum of parts, the interaction effect, and the package result.
3. **A range** for each policy and the package: a scenario range (low / central / high) and a **Monte Carlo** (5,000 draws, fixed seed 20261118, triangular distributions, one shared draw for growth so the economy moves for all policies together). A **tornado** ranks the five inputs that move the five-year total most.
4. **Output**: on the page, and as Markdown, CSV and JSON.

## Policy types and their models
| Type | Base | Static / central figure | Behavioural | Sources | Known limits |
|---|---|---|---|---|---|
| Taxes and duties (Income Tax, NICs, VAT, duties, corporation tax, CGT, IHT, SDLT, VED, APD, IPT, Child Benefit) | HMRC ready reckoner, 75 lines | HMRC's figure for the published size, scaled in a straight line where HMRC say it scales; piecewise linear along HMRC's published sizes for CGT rates and Income Tax allowances/limits (HMRC say these do not scale); one-direction lines are mirrored and flagged | Already inside HMRC's figure (taxable income elasticities, incorporation, a CGT elasticity, vaping substitution). Where a share is published (tobacco: the OBR assumed about three-quarters of the static yield lost) the static figure is shown beside it | HMRC, *Direct effects of illustrative tax changes* (June 2025), baseline OBR March 2025 | Years 1-3 only: years 4-5 are year 3 grown at the line's own growth (0-5%), UNSOURCED. Large sizes are less reliable. Employer NICs excludes pass-through (HMRC say so) |
| Benefits (% change) | OBR baseline spending for UC, state pension, pensioner benefits, disability benefits, Child Benefit | baseline x % change | An offset for knock-on effects: UNSOURCED placeholder (UC 10%, range 0-25%) | OBR *Tax by tax, spend by spend* pages (the vintage each page carries) | Take-up, other benefits, tax and work responses are not modelled; the baselines are not the October 2026 forecast |
| Departmental spending | the amount you give | the amount | none | OBR (£592.3bn in 2025-26, for scale) | delivery risk is in the range |

## The range
`{ central, low, high, distribution, source, confidence, status }` for each uncertain input. The **width of the published figure** comes from a rating by tax (Low ±5%, Medium ±15%, High ±30%, Very High ±60%; ×1.5 if mirrored, ×1.5 if outside the published sizes; wider in years 4 and 5). **That width is the tool's own convention and is UNSOURCED**: the OBR's uncertainty-ratings database could not be read (obr.uk answers automated downloads with an access page, which is not worked around). The other uncertain inputs are growth in years 4-5 (0-5%, UNSOURCED) and the behavioural offset (tobacco: central sourced, range UNSOURCED; benefits: UNSOURCED).

## Interactions in the package
HMRC: changes can broadly be added, except an allowance or band change combined with a rate change in Income Tax. For those pairs the tool computes the interaction from HMRC's own numbers: the income a rate applies to is the 1p yield divided by 0.01; an allowance or limit change removes (cost / marginal rate) of that income; the rate change's yield changes in proportion. Example: +1p basic rate (£6.9bn) with +10% personal allowance (£10bn cost at 20%) gives about -£0.5bn in 2026-27. **Not modelled** (listed in every output where it applies): duties and the VAT on them; Income Tax with NICs; Corporation tax with employer NICs; tax with benefits; Universal Credit with Income Tax.

## Wider (indirect) effects: off by default, kept apart from the headline
Only employer NICs has this layer: a share of the headline lost to lower earnings and profits elsewhere (UNSOURCED, central 25%, range 10-40%), with the OBR's incidence split (61% pay, 15% prices, 24% profits; 76% through real wages, from the OBR October 2024 EFO as reported by the IFS) as sourced context.

## Data, versions, staleness
`site/lucien/costing-data.json` is built by `scripts/lucien/build_costing_data.py` from the HMRC .ods kept in `scripts/lucien/source/`. It carries the as-at date (2025-06-24) and the baseline. **The page says "Out of date" when the data is more than 12 months old (it is)**: it is never used silently. A newer HMRC ready reckoner replaces the .ods and the script is re-run. The OBR's October 2026 Economic and fiscal outlook and its own ready reckoner exist but cannot be fetched automatically.

## Validation (`node scripts/lucien/check-costing.mjs`, run in CI)
| Case in the brief | What the tool shows | Status |
|---|---|---|
| Fuel duty: static cost = base x rate change, partly offset by the consumption response | A 1% cut costs £100m (petrol) + £140m (diesel) in 2026-27 (HMRC, post-behaviour). A freeze is not costed without the size of the rise foregone. A separate static figure for fuel is **not published** and is not guessed | Partly: the static/behavioural split for fuel is UNSOURCED |
| Tobacco: about 80% of static yield lost to behaviour (OBR, Oct 2021) | The OBR text found (EFO October 2021, corrected text) says **about three-quarters**; the tool uses 75% (range 60-90%, which contains 80%) | Passes with the corrected figure |
| Top rate 50p to 45p (2012): static about £3.8bn, central about £0.1bn | HMRC's Budget 2012 costings give a static cost of about **£3.3bn to £3.6bn** (not £3.8bn). The OBR used a taxable income elasticity of 0.45 and called it reasonable and central (0.35 in the March 2010 costing). The tool's `topRateBehaviour` reproduces a cost of about £0.1bn with TIE 0.45 only if total taxable income is about 2.5 times the income above the threshold: that ratio is UNSOURCED (needs the microdata), so this is a consistency check, not an independent validation | **Not independently validated** |
| Benefit cap (2013): behaviour about halves the cost | **Not confirmed in any source found** (the searches did not surface it). No benefit-cap model is built | UNSOURCED, not built |
| Property tests | A rise never loses money and a cut never gains it on every simple rate line; a stronger behavioural response never increases the cost of a top-rate cut; the Monte Carlo is reproducible from its seed; the range always contains the central figure | Pass |

## Reuse before building
PolicyEngine UK (open-source, built on OpenFisca; HM Treasury lists it among models it is looking at) and UKMOD (Essex) were considered for a household-level engine. Neither runs in the page (they are Python / need data access), and I could not check licence terms (the licence file and the UKMOD access conditions were not reachable). So this version is a ready-reckoner-based engine in JavaScript, as decided with the owner. A household microsimulation for Income Tax, NICs and benefits is the next stage if wanted: PolicyEngine's open API is the first thing to evaluate (check licence and coverage).
