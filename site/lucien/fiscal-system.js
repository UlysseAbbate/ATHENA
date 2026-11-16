/* LUCIEN > Economic policy > How the system works: the marginal rates calculation (no page, no network; the tests run this file on its own).
 * It takes the numbers in fiscal-system.json ("model": every one traced to a GOV.UK page or the DWP's published rates) and works out, for one employee in England, Wales or Northern Ireland,
 * how much of each extra £1 of earnings is lost to income tax, National Insurance, student loan repayments, the High Income Child Benefit Charge and the withdrawal of Universal Credit.
 * What it leaves out is listed on the page (housing costs, the benefit cap, couples, Scotland, pension contributions, the two-child limit): it is an illustration of how the pieces fit, not a costing. */
(function (root) {
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  /** Income Tax on earnings E (England, Wales and Northern Ireland): the Personal Allowance is withdrawn at £1 for every £2 over the taper start; bands are on taxable income. */
  function incomeTax(m, E) {
    const pa = E <= m.pa_taper_start ? m.personal_allowance : Math.max(0, m.personal_allowance - (E - m.pa_taper_start) / 2);
    const taxable = Math.max(0, E - pa), basicBand = m.basic_top - m.personal_allowance;
    return Math.min(taxable, basicBand) * m.rate_basic + Math.max(0, Math.min(taxable, m.additional_from) - basicBand) * m.rate_higher + Math.max(0, taxable - m.additional_from) * m.rate_additional;
  }
  /** Employee National Insurance (category A) on annual earnings. */
  const employeeNI = (m, E) => Math.max(0, Math.min(E, m.ni_upper) - m.ni_threshold) * m.ni_main + Math.max(0, E - m.ni_upper) * m.ni_upper_rate;
  /** Student loan repayment: plan = none | plan1 | plan2 | plan4 | plan5 | postgrad. */
  function studentLoan(m, E, plan) {
    if (plan === "postgrad") return Math.max(0, E - m.postgraduate_threshold) * m.postgraduate_rate;
    const t = m.student_loan_thresholds[plan];
    return t == null ? 0 : Math.max(0, E - t) * m.student_loan_rate;
  }
  /** Child Benefit for n children, a year. */
  const childBenefit = (m, n) => (n > 0 ? (m.child_benefit_week.eldest + m.child_benefit_week.other * (n - 1)) * 52 : 0);
  /** High Income Child Benefit Charge: 1% of the benefit for every £200 of income over the start, all of it by the end. */
  const hicbc = (m, E, n) => childBenefit(m, n) * clamp((E - m.hicbc_start) / (m.hicbc_end - m.hicbc_start), 0, 1);
  /** Universal Credit for a single claimant aged 25+ with n children and no housing costs: the standard allowance and child elements, less 55p for each £1 of take-home pay over the work allowance (which only applies with children). a year. */
  function universalCredit(m, takeHomeYear, n) {
    const u = m.uc_month, wa = n > 0 ? u.work_allowance_children : 0;
    const monthly = Math.max(0, u.standard_single_25 + n * u.child_first - u.taper * Math.max(0, takeHomeYear / 12 - wa));
    return monthly * 12;
  }

  /** Everything for annual earnings E: the deductions, the benefits and the net income. */
  function position(m, E, opts) {
    const n = opts.children || 0, plan = opts.loan || "none";
    const tax = incomeTax(m, E), ni = employeeNI(m, E), sl = studentLoan(m, E, plan), charge = hicbc(m, E, n);
    const uc = universalCredit(m, E - tax - ni, n), cb = childBenefit(m, n);
    return { E, tax, ni, sl, hicbc: charge, uc, childBenefit: cb, net: E - tax - ni - sl - charge + uc + cb };
  }
  /** The share of the next £1 lost, by part, from E to E + h. */
  function marginal(m, E, opts, h = 100) {
    const a = position(m, E, opts), b = position(m, E + h, opts);
    const part = (x, y) => (y - x) / h;
    const parts = { tax: part(a.tax, b.tax), ni: part(a.ni, b.ni), loan: part(a.sl, b.sl), hicbc: part(a.hicbc, b.hicbc), uc: -part(a.uc, b.uc) };
    return { ...parts, total: parts.tax + parts.ni + parts.loan + parts.hicbc + parts.uc, net: a.net };
  }
  /** The curve: marginal parts at each step of earnings. */
  function curve(m, opts, max = 130000, step = 250) {
    const out = [];
    for (let E = 0; E <= max; E += step) out.push({ E, ...marginal(m, E, opts, 100) });
    return out;
  }

  root.FiscalSystem = { incomeTax, employeeNI, studentLoan, childBenefit, hicbc, universalCredit, position, marginal, curve };
})(typeof globalThis !== "undefined" ? globalThis : this);
