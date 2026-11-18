# UK fiscal policy costing tool: specification (for LUCIEN > Economic policy > Costings)

This is the brief for the costing tool, kept here so each stage can be built against it. **Stage status:** built (all ten stages, in one go at the owner's request): the engine is `site/lucien/costing.js`, the page `costing-page.js`, the sourced numbers `costing-data.json` (built by `scripts/lucien/build_costing_data.py`), the checks `scripts/lucien/check-costing.mjs`, and the method, validation results and gaps are in **`docs/methodology.md`**. Decisions made with the owner: the engine runs **in the page, in JavaScript** (no servers), figures are looked up and cited (not supplied by the owner). **Where the brief and the sources disagree** (tobacco "about 80%" is about three-quarters in the OBR text found; the 2012 top-rate static cost is £3.3bn-£3.6bn, not £3.8bn; the benefit-cap "about half" was not found), the sources win and the difference is recorded in methodology.md. Not built: a household microsimulation (see "Reuse before building" there).

## 1. Goal
Take a list of policy points (for example "raise the basic rate of income tax by 1p", "cut employer NICs by 1pp", "increase the Universal Credit standard allowance by 5%") and return a **range of costings** for each policy and for the package.

Per policy: a **low / central / high** Exchequer impact, year by year over a 5-year window; a **static** estimate and a **post-behavioural** estimate shown separately; an **uncertainty rating**; and the **methodology, data sources and assumptions** used so the result can be audited.

It is an estimation aid, **not** an official or OBR-certified costing, and every output must say so: *"Indicative estimate produced by a modelling tool. Not an official, OBR-certified or HM Treasury costing."*

## 2. Principles (non-negotiable)
1. Follow the UK official method: measured against a baseline, built up as static, then behavioural, then indirect (macro), year by year on a National Accounts (accruals) basis.
2. Always show the counterfactual (the baseline, for example thresholds indexed with CPI versus frozen).
3. Ranges, not point estimates; name the sources of uncertainty.
4. Separate static from behavioural; never merge them without also showing the pieces.
5. Transparency: every number traces to a data source, parameter or assumption, with a citation. No hidden constants.
6. Never hardcode current policy parameters (rates, thresholds, benefit rates, forecasts change at every fiscal event). Load them from a versioned data file with an "as at" date, and fail loudly if out of date.
7. Do not invent evidence. If an elasticity or base figure is not sourced, mark it `UNSOURCED` and flag it in the output. Do not fill elasticities with remembered numbers: look up and cite them (OBR, HMRC, IFS, academic literature).

## 3. How UK costing works
Bodies: HM Treasury, HMRC and DWP produce the official costings (the "scorecard"); the OBR scrutinises and certifies them as "reasonable and central" and builds them into its forecast; the IFS and other think tanks produce independent estimates (mainly microsimulation); the ONS produces the outturn statistics; the Scottish Fiscal Commission costs Scottish measures the same way.

Pipeline, for each policy, in order:
1. **Baseline:** the OBR's latest pre-measures forecast; the tax base grows with OBR economic determinants. Policies already announced are in the baseline.
2. **Static (first-round) costing:** old and new rules on the *same* base, no behaviour change. Simple taxes: `base × change in rate`. Personal tax and benefits: microsimulation over a household or person dataset, scaled up, including knock-on effects on means-tested benefits.
3. **Behavioural (first-round) effects:** consumption responses to price (tobacco, alcohol, fuel); avoidance, planning, income shifting and forestalling; labour supply; take-up and knock-ons between benefits. These can be very large and must be modelled explicitly.
4. **Indirect (second-round) effects:** demand (fiscal multipliers) and supply-side effects; best at package level; an *optional* layer, off by default, kept separate from the headline.
5. **Timing:** National Accounts (accruals) basis, spread over 5 fiscal years; implementation lags, phasing, cash versus accruals (for example self-assessment).
6. **Uncertainty:** a rating from data quality, model complexity and the size and uncertainty of the behavioural response.

Why organisations differ (the tool should report these and let the user toggle each): the baseline; static versus behavioural scope; data source (survey versus administrative); behavioural elasticities; timing; whether wider economic feedback is included.

## 4. Design
- **Structured policy objects.** Free text is parsed into a typed object (`PolicyChange(tax="income_tax", parameter="basic_rate", old=0.20, new=0.21, start="2027-04-06")`); the user confirms the parsed object before costing. Never cost an ambiguous input silently; ask.
- **Pluggable cost models:** each policy type has a model with `static()`, `behavioural()`, `uncertainty()`.
- **Reuse before building.** Evaluate existing open-source UK tax-benefit models (PolicyEngine UK, UKMOD) for the household-level engine; check licence, coverage and maintenance first.
- **Deterministic and reproducible:** fixed random seeds; every run records the data versions used.
- Data in versioned files with as-at dates: baseline (OBR forecast tables), parameters (rates, thresholds, benefit rates by tax year), `elasticities` (each with source, range, confidence, status).

## 5. The range
Two complementary methods, both reported:
- **Scenario range:** low (lower end of every elasticity and base), central, high.
- **Monte Carlo:** sample each uncertain input from its distribution (triangular or lognormal), N ≥ 5,000, report median and 10th/90th percentiles, and a sensitivity (tornado) ranking of which inputs drive the variance.

Every uncertain parameter is stored as `{ central, low, high, distribution, source, confidence: low|medium|high, status: SOURCED|UNSOURCED }`.

Uncertainty rating: Low / Medium / High / Very High, from data quality, model complexity and the width of the behavioural range. Policies where behaviour is a large share of the static yield (tobacco, capital taxes, mobile tax bases) score higher.

## 6. Policy types, in build order
| Policy type | Base | Static method | Main behavioural effects |
|---|---|---|---|
| Income tax rates and thresholds | SPI or household microdata, uprated | Microsimulation, old versus new rules | Labour supply, taxable income response (strongest at the top), avoidance, incorporation |
| National Insurance (employee, employer, self-employed) | Earnings distribution, employment | Microsimulation or earnings-band aggregation | Wage pass-through, hours, avoidance, incorporation |
| VAT rates and reliefs | Household spending, VAT receipts by category | spending in category × rate change | Consumption response, evasion |
| Fuel, alcohol, tobacco duties | Clearances or receipts forecast | base × rate change | Price elasticity, illicit trade, cross-border shopping |
| Corporation tax | Profits by size and sector | Rate × profits | Investment, profit shifting, timing |
| Capital gains and inheritance tax | Realisations and estates | Rate × gains or estates | Strong realisation and timing response, forestalling, emigration |
| Benefit rates and eligibility (UC, pensions, child benefit) | Caseloads, DWP simulation data | Caseload × rate change; microsimulation for interactions | Take-up, labour supply, knock-ons |
| Departmental spending | Departmental expenditure limits | Direct line-item change | Often none; implementation uncertainty, optional multiplier |

For each: document the base, source, formula, behavioural assumptions, known limits and the validation cases it passes.

## 7. Output
Per policy and for the package: (1) years × (low, central, high) table, static versus post-behavioural; (2) the headline range with the uncertainty rating; (3) decomposition static → behavioural → optional indirect; (4) the top 5 assumptions by effect; (5) assumptions and sources (data versions, parameter as-at dates, citations); (6) warnings (anything `UNSOURCED`, baseline mismatch, interactions not modelled); (7) **package-level result: do not just sum the parts**; run the package jointly and report the interaction effect (package minus sum of parts).

Formats: JSON, Markdown report, optionally CSV. Money in £ million, fiscal years as `2027-28`, negative numbers for costs to the Exchequer (state the sign convention in every output).

## 8. Validation (build these tests first)
| Case | Expected |
|---|---|
| Top income tax rate cut 50p to 45p (2012 Budget) | Static cost about £3.8bn by 2015-16, falling to a central estimate of about £0.1bn after behavioural response |
| Tobacco duty increase | About 80 per cent of the static yield lost to behavioural response (OBR, October 2021) |
| Benefit cap (2013) | Behavioural responses lowered the cost by around half |
| Fuel duty freeze or cancelled increase | Static cost = base × rate change, partly offset by the consumption response |

Also: back-test against OBR evaluations and outturn; cross-check with IFS or Resolution Foundation estimates (differences explained by the six reasons in section 3); unit tests for every formula; property tests (a rate cut can never raise static yield). The OBR policy costings databases publish a breakdown for every measure (tax back to 1970, spending to 2010) for more regression cases.

## 9. Data sources
OBR (EFO and supplementary tables, policy costings databases and uncertainty ratings, Briefing Paper No. 6 *Policy costings and our forecast*, the dynamic scoring article, the fiscal multipliers box); HM Treasury (policy costings documents for each fiscal event); HMRC (receipts and statistics, Survey of Personal Incomes, tax information and impact notes); DWP (caseload and expenditure statistics, Family Resources Survey); ONS (public sector finances, national accounts, Living Costs and Food Survey, earnings and employment); IFS (TAXBEN documentation, reform analyses); Scottish Fiscal Commission (*Approach to Policy Costings*). Check each one's availability and licence first. Cache data locally with a download date; never silently fall back to stale data.

## 10. Limitations the tool must state
First-order effects only; survey data under-captures top incomes and some benefits (anchor to administrative totals); microsimulation models entitlement not receipt (take-up is separate); capital and business taxes are poorly captured by household surveys; elasticities are judgemental with wide ranges; macro effects are highly uncertain and off by default; results depend on the baseline, which changes at each fiscal event.

## 11. Build stages (pause for review after each)
1. Scaffold and data-versioning (no policy logic).
2. Validation tests (section 8) as failing tests.
3. Static engine for simple taxes (duties, VAT): passes the fuel duty test.
4. Behavioural layer with the elasticities file: passes tobacco and top-rate tests.
5. Income tax and NI (decide: reuse an existing model or build one).
6. Benefits module: passes the benefit cap test.
7. Uncertainty engine (scenarios, Monte Carlo, sensitivity).
8. Policy-point parser with a confirmation step.
9. Package-level joint costing with interaction effects.
10. Report generation and the disclaimer.

At the start of each stage say what will be built and the evidence used; at the end report what passes and what remains `UNSOURCED`. If any input, source or design choice is ambiguous, ask.

## 12. Conventions
Type hints / typed schemas; every function that uses an assumption takes it as an argument, never a global; no network calls at import time (data loading explicit and logged); keep `docs/methodology.md` in sync with the code.

## References
OBR *Briefing Paper No. 6: Policy costings and our forecast*; OBR *Dynamic scoring of policy measures in OBR forecasts*; OBR policy costings pages and databases; HM Treasury policy costings documents (for example Spring Statement 2025, Autumn Statement 2023); IFS *TAXBEN: the IFS tax and benefit microsimulation model* (guide, 2021 update); ONS public sector finances methodology and QMI; Scottish Fiscal Commission *Approach to Policy Costings*.
