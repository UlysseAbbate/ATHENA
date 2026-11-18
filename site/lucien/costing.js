/* LUCIEN > Economic policy > Costings: the costing engine (no page, no network; the tests run this file on its own).
 *
 * It takes policy points (typed as words, or built by hand), puts each into a structured object, and gives a range of costings year by year over five fiscal years.
 * Every number comes from costing-data.json (built by scripts/lucien/build_costing_data.py), where each is traced to a named publication or marked UNSOURCED.
 * No assumption is a global: the functions below take the data and the options as arguments.
 *
 *   Sign convention (stated in every output): £ million, Exchequer impact; positive = a gain to the Exchequer, negative = a cost.
 *   It is an estimation aid, not an official, OBR-certified or HM Treasury costing.
 *
 * Method in one paragraph: the central figure for a tax change is HMRC's "direct effects of illustrative tax changes" (the ready reckoner), which already contains HMRC's
 * behavioural responses but no wider economic effects. It is scaled to the size asked for (in a straight line where HMRC say it scales, along the published points where they
 * say it does not). The range comes from a width per uncertainty rating, and from Monte Carlo draws of the uncertain inputs. Benefits are baseline spending x the % change, less an
 * offset. Where a behavioural share is published (tobacco) the static figure is shown beside the post-behavioural one. Nothing is added from memory: see the data file.
 */
(function (root) {
  const YEARS = ["2026-27", "2027-28", "2028-29", "2029-30", "2030-31"];
  const SIGN = "£ million, Exchequer impact: positive = a gain to the Exchequer, negative = a cost";
  const DISCLAIMER = "Indicative estimate produced by a modelling tool. Not an official, OBR-certified or HM Treasury costing.";
  const RATINGS = ["Low", "Medium", "High", "Very High"];

  /* ------------------------------------------------------------------ small helpers */
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const sum = a => a.reduce((s, x) => s + x, 0);
  const round = x => Math.round(x * 10) / 10;
  function rng(seed) { // mulberry32: the same seed gives the same draws, so a run can be repeated exactly
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  /** Inverse of the triangular distribution (low, mode, high) at probability u. */
  function tri(u, lo, mode, hi) {
    if (hi <= lo) return mode;
    const f = (mode - lo) / (hi - lo);
    return u < f ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
  }
  const quantile = (sorted, q) => { const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };
  const fyStart = fy => Number(String(fy).slice(0, 4));

  /* ------------------------------------------------------------------ the data */
  function index(data) {
    const byId = new Map(data.items.map(i => [i.id, i]));
    return { data, byId };
  }
  /** Is the data too old to rely on? (principle 6: fail loudly, never silently use stale data). */
  function staleness(data, today = new Date()) {
    const as = new Date(`${data.meta.ready_reckoner.as_at}T12:00:00Z`);
    const months = (today.getFullYear() - as.getFullYear()) * 12 + today.getMonth() - as.getMonth();
    return { months, stale: months > data.meta.stale_after_months, as_at: data.meta.ready_reckoner.as_at };
  }
  /** The family of a published line: the same tax parameter, whatever the size or direction (used to find a pair or a table). */
  const family = it => it.id.split(":")[1].replace(/_(by_.*)$/, "").replace(/^(increase|decrease|change|raise|cut)_/, "").replace(/_(cost|yield)$/, "");

  /* ------------------------------------------------------------------ one policy: the structured object
   * Policy = { item: id | null, kind: 'tax'|'benefit'|'spending', direction: +1 raise | -1 cut, size: number in the unit of the line,
   *            start: '2026-27'..'2030-31', benefit?: key, amountM?: £m a year (spending), label? } */
  function mkPolicy(p) { return Object.assign({ kind: "tax", direction: 1, size: 1, start: YEARS[0] }, p); }

  /* ------------------------------------------------------------------ baseline spending (benefits, departments) */
  function spendBase(data, key, fy) {
    const s = data.spending[key], pts = s.points.map(([y, v]) => [fyStart(y), v]), y = fyStart(fy);
    if (pts.length >= 2) {
      const [y0, v0] = pts[0], [y1, v1] = pts[pts.length - 1], g = Math.pow(v1 / v0, 1 / (y1 - y0));
      return { value: v0 * Math.pow(g, y - y0), growth: g - 1, status: y >= y0 && y <= y1 ? "SOURCED (interpolated between two OBR figures)" : "UNSOURCED (extrapolated beyond the OBR figures)" };
    }
    const g = data.spending.growth_unsourced[key] ?? 0.035, [y0, v0] = pts[0];
    return { value: v0 * Math.pow(1 + g, y - y0), growth: g, status: y === y0 ? "SOURCED" : "UNSOURCED (growth is a tool assumption)" };
  }

  /* ------------------------------------------------------------------ rating (uncertainty), by the kind of change */
  const RATING_BY_TAX = { vat: "Low", duties: "Medium", income_tax: "Medium", nics: "Medium", corporation_tax: "Medium", child_benefit: "Medium", ved: "Low", apd: "Medium", ipt: "Low", inheritance_tax: "High", sdlt: "High", cgt: "Very High" };
  const bump = r => RATINGS[Math.min(RATINGS.length - 1, RATINGS.indexOf(r) + 1)];
  function ratingFor(it, flags) {
    let r = RATING_BY_TAX[it.tax] || "High";
    if (it.id.includes("additional_rate") || it.id.includes("employer_rate") || it.id.includes("tobacco")) r = bump(r);
    if (flags.mirrored || flags.outOfRange) r = bump(r);
    return r;
  }

  /* ------------------------------------------------------------------ a published line, scaled to the size asked for */
  /** The impact (£m, as an Exchequer impact) of the published figure when the parameter moves the way the row says. */
  function rowImpact(row) {
    const sign = { yield_if_up: 1, cost_if_up: -1, signed: 1, yield: 1, cost: -1 }[row.meaning] ?? 1;
    return row.values.map(v => sign * v);
  }
  /** The rows to use for a policy: those published for the direction asked (a "Change" row is for either direction); if there are none, the other direction's rows, mirrored. */
  function pickRows(ix, it, dir) {
    const fam = family(it);
    const all = ix.data.items.filter(x => family(x) === fam && x.unit === it.unit && x.tax === it.tax);
    const match = all.filter(r => r.direction === 0 || r.direction === dir);
    const rows = (match.length ? match : all).sort((a, b) => a.size - b.size);
    const mirrored = !match.length || (dir < 0 && rows.every(r => r.meaning === "signed"));
    return { rows, mirrored };
  }
  /** A line's published figures (3 years) for a change of `size` units in direction `dir`, with the flags that widen the range. */
  function taxSeries(ix, policy) {
    const it = ix.byId.get(policy.item);
    if (!it) throw new Error(`Unknown policy line: ${policy.item}`);
    const dir = policy.direction >= 0 ? 1 : -1, { rows, mirrored } = pickRows(ix, it, dir);
    const flags = { mirrored, outOfRange: false };
    // for each row: its impact for a move in direction dir. A symmetric ("Change") row is published for a rise; a cut is its negative. A row for the other direction is mirrored.
    const per = rows.map(r => { const base = rowImpact(r); const k = r.direction === 0 ? dir : (r.direction === dir ? 1 : -1); return { size: r.size, vals: base.map(v => v * k) }; });
    const sizeAsked = Math.abs(policy.size), maxSize = per[per.length - 1].size;
    let years3;
    if (per.length > 1) { // several published sizes: straight lines through (0, 0) and the published points
      const pts = [{ size: 0, vals: [0, 0, 0] }, ...per];
      let k = pts.findIndex(p => p.size >= sizeAsked);
      if (k === -1) { k = pts.length - 1; flags.outOfRange = true; }
      const a = pts[Math.max(0, k - 1)], b = pts[k];
      years3 = [0, 1, 2].map(i => (b.size === a.size ? b.vals[i] : a.vals[i] + (b.vals[i] - a.vals[i]) * (sizeAsked - a.size) / (b.size - a.size)));
    } else {
      years3 = per[0].vals.map(v => v * sizeAsked / per[0].size);
      if ((it.nonlinear || it.nonlinear_note) && sizeAsked > 1.5 * per[0].size) flags.outOfRange = true;
    }
    return { it, flags, years3, rows };
  }

  /** Years 4 and 5: the third year grown at the line's own year-2 to year-3 growth, kept between 0 and max_growth, held flat when the line is volatile. */
  function growthOf(data, v3) {
    const [, b, c] = v3;
    return (Math.abs(b) >= 50 && Math.sign(b) === Math.sign(c)) ? clamp(c / b - 1, 0, data.extrapolation.max_growth) : 0;
  }
  const grow3 = (v3, g) => [v3[0], v3[1], v3[2], v3[2] * (1 + g), v3[2] * (1 + g) * (1 + g)];
  const shiftStart = (series, start) => { const k = Math.max(0, YEARS.indexOf(start)); return series.map((_, i) => (i < k ? 0 : series[i - k])); };

  /* ------------------------------------------------------------------ cost one policy */
  function costOne(ix, policy) {
    const data = ix.data, p = mkPolicy(policy), warnings = [], assumptions = [], rr = data.meta.ready_reckoner;
    const start = YEARS.includes(p.start) ? p.start : YEARS[0];
    let rating, label, flags = {}, growth = 0, offset = null, behaviour = null, gen;
    const sources = [];
    if (p.kind === "tax") {
      const t = taxSeries(ix, p), it = t.it;
      flags = t.flags; label = p.label || `${it.taxName}: ${it.label}`;
      growth = growthOf(data, t.years3);
      rating = ratingFor(it, flags);
      sources.push(it.source);
      const off = it.behaviour && it.behaviour.offset ? it.behaviour.offset : null;
      offset = off; behaviour = it.behaviour || null;
      // the 5-year series for a draw: the published 3 years (after behaviour); if a behavioural share is published, the static figure is that divided by (1 - share)
      gen = (m = 1, g = growth, o = off ? off.central : 0, wantStatic = false) => {
        let v3 = t.years3.slice();
        if (off) { const st3 = v3.map(v => v / (1 - off.central)); v3 = wantStatic ? st3 : st3.map(v => v * (1 - o)); }
        return shiftStart(grow3(v3, g), start).map(v => v * m);
      };
      assumptions.push({ what: `The central figure is HMRC's ready reckoner for "${it.label}", scaled to ${Math.abs(p.size)} ${unitName(it.unit)}${t.rows.length > 1 ? " along HMRC's published sizes" : " in a straight line (HMRC say it scales)"}`, status: "SOURCED", source: it.source.url });
      assumptions.push({ what: "Years 4 and 5 are year 3 grown at the line's own recent growth, kept between 0% and 5%", status: "UNSOURCED", source: "" });
      if (flags.mirrored) warnings.push("HMRC publish this change in one direction only; the other direction is taken as its mirror image. HMRC say rate changes can be asymmetrical, so the range is widened.");
      if (flags.outOfRange) warnings.push("The size asked for is outside what HMRC publish; the figure is extended in a straight line and the range is widened (HMRC say large changes are not linear).");
      if (it.warning) warnings.push(it.warning);
      if (it.nonlinear_note && t.rows.length === 1) warnings.push(it.nonlinear_note);
      if (off) assumptions.push({ what: `Behavioural response: the OBR assumed about ${Math.round(off.central * 100)}% of the static yield is lost (range ${Math.round(off.low * 100)}% to ${Math.round(off.high * 100)}%); the static figure shown is the ready reckoner figure divided by ${(1 - off.central).toFixed(2)}`, status: off.status, source: off.url || off.source });
      else warnings.push("HMRC publish only the post-behavioural figure for this line, so a separate static figure is not available (not guessed).");
      if (behaviour && behaviour.tie) assumptions.push({ what: `Taxable income elasticity ${behaviour.tie.central} (range ${behaviour.tie.low} to ${behaviour.tie.high}) is what HMRC and the OBR use for this change; it is already inside HMRC's figure`, status: behaviour.tie.status, source: behaviour.tie.url });
      if (dirOf(p) < 0 && it.meaning === "signed") warnings.push("A cut in a Capital Gains Tax rate: HMRC publish rises only, so the cut is the mirror image of the rise. HMRC say the rate changes are non-linear and asymmetrical.");
    } else if (p.kind === "benefit") {
      const b = data.spending[p.benefit], beh = data.benefit_behaviour[p.benefit];
      if (!b || !beh) throw new Error(`Unknown benefit: ${p.benefit}`);
      label = p.label || `${b.label}: ${dirOf(p) > 0 ? "raise" : "cut"} by ${Math.abs(p.size)}%`;
      const base = YEARS.map(fy => spendBase(data, p.benefit, fy));
      const pct = dirOf(p) * Math.abs(p.size) / 100;
      offset = beh.offset; rating = p.benefit === "universal_credit" ? "High" : "Medium";
      gen = (m = 1, g = 0, o = offset.central, wantStatic = false) => shiftStart(base.map(x => -x.value * pct * (wantStatic ? 1 : 1 - o)), start).map(v => v * m);
      sources.push({ name: b.source, url: b.url });
      assumptions.push({ what: `Baseline: ${b.label}, ${b.scope}, from the OBR page (${b.points.map(x => `${x[0]}: £${(x[1] / 1000).toFixed(1)}bn`).join(", ")}), grown to each year`, status: base[0].status.startsWith("SOURCED") ? "SOURCED, UNSOURCED beyond the published years" : "UNSOURCED", source: b.url });
      assumptions.push({ what: `Offset for knock-on effects: ${Math.round(offset.central * 100)}% (range ${Math.round(offset.low * 100)}% to ${Math.round(offset.high * 100)}%). ${beh.note}`, status: offset.status, source: "" });
      warnings.push(`The baseline is the vintage the OBR page carries (not the October 2026 forecast). ${data.spending.page_vintage_note}`);
      warnings.push("Static means baseline spending x the % change. Take-up, knock-on effects on other benefits and tax, and the effect on work are not modelled (the offset is a placeholder).");
    } else if (p.kind === "spending") {
      const d = data.spending.departmental, amt = Math.abs(p.amountM);
      label = p.label || `Departmental spending: ${dirOf(p) > 0 ? "increase" : "cut"} by £${(amt / 1000).toFixed(1)}bn a year`;
      rating = "Medium";
      gen = (m = 1) => shiftStart(YEARS.map(() => -dirOf(p) * amt), start).map(v => v * m);
      sources.push({ name: d.source, url: d.url });
      assumptions.push({ what: "A direct change to departmental spending: the Exchequer impact is the amount, with no behavioural response (the uncertainty is delivery: whether the saving or spend actually happens)", status: "SOURCED (the amount is yours)", source: d.url });
      warnings.push(`Total departmental spending was £${(d.points[0][1] / 1000).toFixed(1)}bn in ${d.points[0][0]} (OBR), for scale. Delivery risk is in the range, not the central figure.`);
    } else throw new Error(`Unknown policy kind: ${p.kind}`);
    if (p.start && fyStart(p.start) < 2026) warnings.push("HMRC's figures assume an April 2026 start; an earlier start is costed from 2026-27.");
    if (p.kind === "tax" && start !== YEARS[0]) assumptions.push({ what: `Start ${start}: HMRC's first-year figure (an April 2026 start) is applied from the start year, so later years follow HMRC's year 2 and 3 pattern`, status: "tool assumption", source: "" });

    const central = gen(), stat = offset ? gen(1, growth, offset.central, true) : null;
    const scale = data.uncertainty_scale[rating] * (flags.mirrored ? 1.5 : 1) * (flags.outOfRange ? 1.5 : 1);
    const years = central.map((c, i) => {
      const w = Math.abs(c) * scale * (i >= 3 ? 1 + (i - 2) * 0.25 : 1);   // years 4 and 5 are wider (extrapolated)
      return { fy: YEARS[i], central: c, low: c - w, high: c + w, static: stat ? stat[i] : null };
    });
    const res = { policy: p, label, rating, ratingWhy: ratingWhy(p, flags), years, warnings, assumptions, sources, flags, growth, offset, behaviour, scale, gen };
    res.total = totals(years);
    return res;
  }
  const dirOf = p => (p.direction >= 0 ? 1 : -1);
  function ratingWhy(p, flags) {
    const bits = [];
    if (p.kind === "tax") bits.push("how much of the figure is behavioural response and how well the base is measured (the tool's rule by tax)");
    if (flags.mirrored) bits.push("one direction only published");
    if (flags.outOfRange) bits.push("size outside what HMRC publish");
    if (p.kind === "benefit") bits.push("baseline vintage and unmodelled knock-on effects");
    if (p.kind === "spending") bits.push("delivery risk");
    return bits.join("; ");
  }
  const totals = years => ({ low: sum(years.map(y => y.low)), central: sum(years.map(y => y.central)), high: sum(years.map(y => y.high)), static: years[0].static == null ? null : sum(years.map(y => y.static)) });
  const unitName = u => ({ p: "p", pp: "percentage points", pct: "%", gbp: "£", gbp_week: "£ a week", gbp_year: "£ a year" }[u] || "");

  /* ------------------------------------------------------------------ uncertain inputs of one policy (for the tornado) */
  function inputsOf(res) {
    const out = [{ key: "published_figure", name: "The published (ready reckoner / baseline) figure", kind: "mult", low: 1 - res.scale, high: 1 + res.scale, status: "UNSOURCED width (the tool's convention by rating)" }];
    if (res.policy.kind === "tax") out.push({ key: "growth", name: "Growth in years 4 and 5", kind: "growth", low: 0, high: 0.05, status: "UNSOURCED" });
    if (res.offset) out.push({ key: "offset", name: res.policy.kind === "tax" ? "Share of the static yield lost to behaviour" : "Offset for knock-on effects", kind: "offset", low: res.offset.low, high: res.offset.high, status: res.offset.status });
    return out;
  }

  /* ------------------------------------------------------------------ the package: policies costed together, with the interaction between them */
  function interactions(ix, results, draws) {
    const data = ix.data, found = [], per = YEARS.map(() => 0);
    const val = (r, i) => (draws ? draws.get(r)[i] : r.years[i].central);
    for (const pair of data.interactions.income_tax_pairs) {
      const R = results.find(r => r.policy.kind === "tax" && family(ix.byId.get(r.policy.item)) === pair.rate_family && ix.byId.get(r.policy.item).unit === "p");
      if (!R) continue;
      const rateRow = ix.byId.get(pair.rate_item), baseIncome = rateRow.values.map(v => v / (rateRow.size / 100));    // the taxable income the rate applies to, £m
      for (const [cfam, tau] of pair.changers) {
        const C = results.find(r => r.policy.kind === "tax" && family(ix.byId.get(r.policy.item)) === cfam);
        if (!C) continue;
        const delta = YEARS.map((_, i) => { const removed = -val(C, i) / tau; return val(R, i) * (-removed / baseIncome[Math.min(2, i)]); });
        delta.forEach((d, i) => { per[i] += d; });
        found.push({ between: [R.label, C.label], note: `${C.label} changes the income the rate change applies to (worked out from HMRC's own figures, at a ${Math.round(tau * 100)}% rate)`, perYear: delta.map(round) });
      }
    }
    return { per, found };
  }
  function notModelled(ix, results) {
    const taxes = new Set(results.filter(r => r.policy.kind === "tax").map(r => ix.byId.get(r.policy.item).tax)), out = [];
    const has = t => taxes.has(t), kinds = new Set(results.map(r => r.policy.kind));
    if (has("duties") && has("vat")) out.push("duty changes and the VAT charged on them (the tool adds the VAT change and the duty change; it does not add VAT on the extra duty)");
    if (has("income_tax") && has("nics")) out.push("Income Tax and National Insurance together (incorporation and income shifting)");
    if (has("corporation_tax") && has("nics")) out.push("Corporation tax and employer National Insurance together (profits)");
    if (has("income_tax") && kinds.has("benefit")) out.push("tax and benefit changes together (net income and the response of work)");
    return out;
  }
  function costPackage(ix, policies, opts = {}) {
    const results = policies.map(p => costOne(ix, p));
    const inter = interactions(ix, results);
    const years = YEARS.map((fy, i) => {
      const parts = sum(results.map(r => r.years[i].central)), lo = sum(results.map(r => r.years[i].low)), hi = sum(results.map(r => r.years[i].high));
      return { fy, sumOfParts: parts, interaction: inter.per[i], central: parts + inter.per[i], low: lo + inter.per[i], high: hi + inter.per[i], static: results.every(r => r.years[i].static != null) ? sum(results.map(r => r.years[i].static)) : null };
    });
    const mc = opts.monteCarlo === false || !results.length ? null : monteCarlo(ix, results, opts);
    return { results, years, total: totals(years), interactions: inter.found, notModelled: notModelled(ix, results), mc, sensitivity: sensitivity(ix, results), indirect: opts.indirect ? indirectLayer(ix, results) : null,
      warnings: [...new Set(results.flatMap(r => r.warnings))], data: { version: ix.data.meta.version, ready_reckoner: ix.data.meta.ready_reckoner }, sign: SIGN, disclaimer: DISCLAIMER };
  }

  /* ------------------------------------------------------------------ the optional layer for wider (indirect) effects: off by default, kept apart from the headline */
  function indirectLayer(ix, results) {
    const d = ix.data.indirect.employer_nics, lay = [];
    for (const r of results) {
      if (r.policy.kind === "tax" && r.policy.item === "nics:change_class_1_employer_rate_by_1_percentage_point") {
        lay.push({ label: r.label, perYear: r.years.map(y => round(-y.central * d.leakage.central)), source: d.incidence.url,
          note: `A share (${Math.round(d.leakage.central * 100)}%, range ${Math.round(d.leakage.low * 100)}% to ${Math.round(d.leakage.high * 100)}%, UNSOURCED) of the headline is lost to lower earnings and profits elsewhere in the tax system; the OBR's split of who bears the cost (${Math.round(d.incidence.wages * 100)}% pay, ${Math.round(d.incidence.prices * 100)}% prices, ${Math.round(d.incidence.profits * 100)}% profits) is sourced.` });
      }
    }
    return { off_by_default: true, lines: lay, perYear: YEARS.map((_, i) => round(sum(lay.map(l => l.perYear[i])))) };
  }

  /* ------------------------------------------------------------------ the range: Monte Carlo, and which inputs drive it */
  function monteCarlo(ix, results, opts = {}) {
    const N = opts.n || 5000, seed = opts.seed || 20261118, rand = rng(seed);
    const pkgYear = YEARS.map(() => new Float64Array(N)), pkgTotal = new Float64Array(N);
    const per = results.map(() => YEARS.map(() => new Float64Array(N)));
    for (let n = 0; n < N; n++) {
      const macro = rand();   // one draw shared by every policy: the economy grows faster or slower for all of them together
      const draw = new Map();
      results.forEach((r, k) => {
        const m = tri(rand(), 1 - r.scale, 1, 1 + r.scale);
        const g = r.policy.kind === "tax" ? tri(macro, 0, r.growth, 0.05) : r.growth;
        const off = r.offset ? tri(rand(), r.offset.low, r.offset.central, r.offset.high) : 0;
        const s = r.gen(m, g, off);
        draw.set(r, s); s.forEach((v, i) => { per[k][i][n] = v; });
      });
      const inter = interactions(ix, results, draw).per;
      let tot = 0;
      for (let i = 0; i < YEARS.length; i++) { const v = sum(results.map(r => draw.get(r)[i])) + inter[i]; pkgYear[i][n] = v; tot += v; }
      pkgTotal[n] = tot;
    }
    const qs = a => { const s = Array.from(a).sort((x, y) => x - y); return { p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) }; };
    return { n: N, seed, years: YEARS.map((fy, i) => Object.assign({ fy }, qs(pkgYear[i]))), total: qs(pkgTotal),
      perPolicy: results.map((r, k) => ({ label: r.label, years: YEARS.map((fy, i) => Object.assign({ fy }, qs(per[k][i]))) })) };
  }
  /** Tornado: for each uncertain input, the swing in the five-year total when that input moves from its low to its high with the others at central. */
  function sensitivity(ix, results) {
    const out = [];
    results.forEach(r => {
      const total = (m, g, o) => sum(r.gen(m, g, o));
      for (const inp of inputsOf(r)) {
        const f = x => (inp.kind === "mult" ? total(x) : inp.kind === "growth" ? total(1, x) : total(1, r.growth, x));
        const lo = f(inp.low), hi = f(inp.high);
        out.push({ policy: r.label, input: inp.name, status: inp.status, low: Math.min(lo, hi), high: Math.max(lo, hi), swing: Math.abs(hi - lo) });
      }
    });
    return out.sort((a, b) => b.swing - a.swing).slice(0, 5);
  }

  /* ------------------------------------------------------------------ the behavioural layer for a rate change at the top, given its inputs (the HMRC 2012 method)
   * Static: the rate change times the income it applies to (X, the income above the threshold). Behavioural: total taxable income (Y, which includes the part below the
   * threshold) responds with elasticity e to the change in the net-of-tax rate, and the extra income is taxed at the new marginal rate. */
  function topRateBehaviour({ staticCost, rateOld, rateNew, e, ratio }) {
    // ratio = Y / X, total taxable income of the group over the income above the threshold (UNSOURCED: it needs the microdata)
    const X = Math.abs(staticCost) / Math.abs(rateOld - rateNew), Y = ratio * X;
    const dY = Y * (Math.pow((1 - rateNew) / (1 - rateOld), e) - 1);
    const impact = -(rateOld - rateNew) * X * (rateNew < rateOld ? 1 : -1) + rateNew * dY;
    return { staticCost: -(Math.abs(staticCost)), post: impact, offsetShare: 1 - Math.abs(impact) / Math.abs(staticCost) };
  }

  /* ------------------------------------------------------------------ the policy-point parser (words -> structured objects, always confirmed by the person) */
  const ALIASES = [
    // [ids, regexp that names the subject]
    [["income_tax:change_basic_rate_by_1p"], /\bbasic rate\b(?! limit)/],
    [["income_tax:change_higher_rate_by_1p"], /\bhigher rate\b(?! limit)/],
    [["income_tax:increase_additional_rate_by_1p_yield"], /\b(additional|top) rate\b|\b45p\b|\b50p\b/],
    [["income_tax:change_personal_allowance_by_10"], /\bpersonal allowance\b/],
    [["income_tax:change_basic_rate_limit_by_1"], /\bbasic rate (limit|band)\b|\bhigher rate threshold\b|\b50,?270\b/],
    [["income_tax:change_dividend_allowance_by_100"], /\bdividend allowance\b/],
    [["income_tax:change_savings_allowance_by_100_for_br_and_50_for_hr_taxpayer"], /\bsavings allowance\b/],
    [["nics:change_class_1_employer_rate_by_1_percentage_point"], /\bemployer'?s?( national insurance| nics?| ni)?\b|\bemployer (national insurance|nics?)\b/],
    [["nics:change_class_1_employee_main_rate_by_1_percentage_point"], /\bemployee'?s?( national insurance| nics?| ni)?\b|\bnational insurance\b|\bnics?\b/],
    [["nics:change_class_4_main_rate_by_1_percentage_point"], /\bclass 4\b|\bself[- ]employed\b/],
    [["corporation_tax:increase_corporation_tax_by_1_percentage_point"], /\bcorporation tax\b/],
    [["vat:change_standard_rate_by_1_percentage_point"], /\bvat\b|\bvalue added tax\b/],
    [["duties:change_petrol_by_1", "duties:change_diesel_by_1"], /\bfuel duty\b|\bfuel\b|\bpetrol and diesel\b/],
    [["duties:change_petrol_by_1"], /\bpetrol\b/],
    [["duties:change_diesel_by_1"], /\bdiesel\b/],
    [["duties:change_tobacco_duties_by_1"], /\btobacco\b|\bcigarette/],
    [["duties:change_beer_and_cider_duties_by_1", "duties:change_wine_and_other_fermented_product_duties_by_1", "duties:change_spirits_duties_by_1"], /\balcohol\b/],
    [["duties:change_beer_and_cider_duties_by_1"], /\bbeer\b|\bcider\b/],
    [["duties:change_wine_and_other_fermented_product_duties_by_1"], /\bwine\b/],
    [["duties:change_spirits_duties_by_1"], /\bspirits?\b/],
    [["inheritance_tax:increase_standard_rate_for_estates_left_on_death_by_1_pe"], /\binheritance tax\b|\biht\b/],
    [["cgt:increase_higher_capital_gains_tax_rate_by_5_percentage_points"], /\bcapital gains\b|\bcgt\b/],
    [["ved:increase_rates_by_1_for_motorbikes_and_5_for_all_other_vehicles"], /\bvehicle excise\b|\bved\b|\bcar tax\b/],
    [["apd:increase_reduced_rate_by_1"], /\bair passenger\b|\bapd\b/],
    [["ipt:change_standard_rate_by_1_percentage_point"], /\binsurance premium\b/],
    [["sdlt:raise_residential_5_marginal_rate_by_1_percentage_point_yield"], /\bstamp duty\b|\bsdlt\b/],
    [["child_benefit:increase_first_child_rate_by_1_per_week_cost"], /\bchild benefit\b/],
  ];
  const BENEFITS = [["universal_credit", /\buniversal credit\b|\buc\b/], ["state_pension", /\bstate pension\b|\bbasic state pension\b|\btriple lock\b/], ["pensioner_benefits", /\bpension credit\b|\bpensioner benefits?\b|\bwinter fuel\b/],
    ["disability_benefits", /\bpip\b|\bdisability benefits?\b|\battendance allowance\b|\bpersonal independence\b/]];
  function parseLine(ix, text) {
    const raw = text.trim(), t = raw.toLowerCase().replace(/pence/g, "p").replace(/per ?cent/g, "%").replace(/percentage points?/g, "pp").replace(/\s+/g, " ");
    const out = { text: raw, ok: false, ask: [], candidates: [], policy: null };
    if (!t) return out;
    let dir = 0;
    if (/\b(raise|increase|put up|add|hike|introduce|rise|up by)\b/.test(t)) dir = 1;
    if (/\b(cut|reduce|lower|decrease|trim|slash|scrap|abolish|put down|down by)\b/.test(t)) dir = -1;
    const freeze = /\bfreez(e|ing)\b|\bcancel\b|\bscrap(ping)? the (planned )?(rise|increase)\b/.test(t);
    if (freeze && !dir) dir = -1;
    const start = (t.match(/\b(?:from|in|starting|start(?:s)?|effective)\s+(?:april\s+)?(20\d\d)(?:[-–/](\d\d))?\b/) || []);
    let startFy = YEARS[0];
    if (start[1]) { const y = Number(start[1]), fy = `${y}-${String(y + 1).slice(2)}`; startFy = YEARS.includes(fy) ? fy : (y < 2026 ? YEARS[0] : YEARS[YEARS.length - 1]); }
    const tt = t.replace(/\b(from|in|starting|start|starts|effective)\s+(april\s+)?20\d\d([-–/]\d\d)?/g, " ");
    // spending: "cut departmental spending by £2bn"
    let m;
    if (/\b(departmental|public|government) spending\b|\bspending (on|for)\b|\bdepartment\b|\bdel\b/.test(tt) && (m = tt.match(/£\s?([\d.,]+)\s?(bn|billion|b|m|million)\b/))) {
      const amt = Number(m[1].replace(/,/g, "")) * (/^b/.test(m[2]) ? 1000 : 1);
      out.policy = mkPolicy({ kind: "spending", direction: dir || 1, amountM: amt, size: amt, start: startFy, label: raw });
      out.ok = !!dir; if (!dir) out.ask.push("Is this an increase or a cut?");
      return out;
    }
    // benefits: "increase Universal Credit by 5%"
    const ben = BENEFITS.find(b => b[1].test(tt));
    if (ben) {
      const pm = tt.match(/(\d+(?:\.\d+)?)\s?%/);
      out.policy = mkPolicy({ kind: "benefit", benefit: ben[0], direction: dir || 1, size: pm ? Number(pm[1]) : 1, start: startFy, label: raw });
      if (!dir) out.ask.push("Is this an increase or a cut?");
      if (!pm) out.ask.push("By what percentage? (I have put 1% as a placeholder.)");
      out.ok = !!dir && !!pm; return out;
    }
    const hit = ALIASES.find(a => a[1].test(tt));
    if (!hit) { out.ask.push("I could not tell which tax this is about. Choose it from the list."); return out; }
    const ids = hit[0].filter(id => ix.byId.has(id));
    out.candidates = ids;
    // size and unit
    const am = tt.match(/(\d+(?:\.\d+)?)\s?(pp|p|%)(?![a-z])/) || tt.match(/£\s?([\d.,]+)\s?(per week|a week|\/week|pw)?/);
    const first = ix.byId.get(ids[0]);
    let size = null;
    if (am) size = Number(String(am[1]).replace(/,/g, ""));
    if (/\b(45p|50p)\b/.test(tt) && ids[0].includes("additional_rate")) { /* a rate named, not a change */ size = size === 45 || size === 50 ? null : size; }
    if (freeze) { out.ask.push("A freeze or a cancelled rise needs the size of the rise foregone (for example 3%); the tool does not know the planned rise (the baseline assumption is not published in a form it can read)."); size = am ? size : null; }
    if (size == null && !/\bto\s+£?\d/.test(tt)) out.ask.push("How big is the change? Give it as a number with its unit (for example 1p, 1%, or £5 a week).");
    if (!dir) out.ask.push("Is this an increase or a cut?");
    if (/\bto\s+£?\d/.test(tt) && !/\bby\s+£?\d/.test(tt)) { size = null; out.ask.push("A change TO a level (for example 'to 21p') needs the current level; say the change instead (for example 'by 1p')."); }
    out.policies = ids.map(id => mkPolicy({ item: id, kind: "tax", direction: dir || 1, size: size == null ? ix.byId.get(id).size : size, start: startFy, label: raw }));
    out.policy = out.policies[0];
    out.ok = !!dir && size != null && !out.ask.length;
    // unit mismatch note: income tax rate lines are in pence, NIC and VAT in percentage points, duties in %, allowances in £ or %
    if (am && first && first.unit && am[2] && ((first.unit === "pct" && am[2] !== "%") || (["p"].includes(first.unit) && !/^(p|pp)$/.test(am[2])) || (first.unit === "pp" && !/^(p|pp)$/.test(am[2])))) out.ask.push(`HMRC publish this line as a change of ${unitName(first.unit)}; you wrote ${am[1]}${am[2]}. Check the size.`);
    return out;
  }
  function parseText(ix, text) { return String(text || "").split(/\n|;/).map(s => s.trim()).filter(Boolean).map(l => parseLine(ix, l)); }

  /* ------------------------------------------------------------------ output: Markdown, CSV, JSON */
  const fm = v => (v == null ? "n/a" : `${Math.round(v).toLocaleString("en-GB")}`);
  function toMarkdown(pkg) {
    const L = [`# Costing`, ``, `**${DISCLAIMER}**`, ``, `Units: ${SIGN}.`, `Data: HMRC ready reckoner as at ${pkg.data.ready_reckoner.as_at} (baseline: ${pkg.data.ready_reckoner.baseline}); tool data version ${pkg.data.version}.`, ``];
    pkg.results.forEach((r, i) => {
      L.push(`## ${i + 1}. ${r.label}`, ``, `Uncertainty rating: **${r.rating}** (${r.ratingWhy}). Start: ${r.policy.start}.`, ``, `| | ${YEARS.join(" | ")} | Total |`, `|---|${YEARS.map(() => "---:").join("|")}|---:|`);
      L.push(`| Low | ${r.years.map(y => fm(y.low)).join(" | ")} | ${fm(r.total.low)} |`, `| Central (after behaviour) | ${r.years.map(y => fm(y.central)).join(" | ")} | ${fm(r.total.central)} |`, `| High | ${r.years.map(y => fm(y.high)).join(" | ")} | ${fm(r.total.high)} |`);
      if (r.years[0].static != null) L.push(`| Static (before behaviour) | ${r.years.map(y => fm(y.static)).join(" | ")} | ${fm(r.total.static)} |`);
      L.push(``);
      if (pkg.mc) { const p = pkg.mc.perPolicy[i]; L.push(`Monte Carlo (${pkg.mc.n} draws, seed ${pkg.mc.seed}): 10th / median / 90th percentile by year: ${p.years.map(y => `${y.fy}: ${fm(y.p10)} / ${fm(y.p50)} / ${fm(y.p90)}`).join("; ")}.`, ``); }
      if (r.warnings.length) L.push(...r.warnings.map(w => `- Warning: ${w}`), ``);
    });
    L.push(`## Package`, ``, `| | ${YEARS.join(" | ")} | Total |`, `|---|${YEARS.map(() => "---:").join("|")}|---:|`, `| Sum of the parts | ${pkg.years.map(y => fm(y.sumOfParts)).join(" | ")} | ${fm(sum(pkg.years.map(y => y.sumOfParts)))} |`,
      `| Interaction effect | ${pkg.years.map(y => fm(y.interaction)).join(" | ")} | ${fm(sum(pkg.years.map(y => y.interaction)))} |`, `| Package, central | ${pkg.years.map(y => fm(y.central)).join(" | ")} | ${fm(pkg.total.central)} |`,
      `| Low | ${pkg.years.map(y => fm(y.low)).join(" | ")} | ${fm(pkg.total.low)} |`, `| High | ${pkg.years.map(y => fm(y.high)).join(" | ")} | ${fm(pkg.total.high)} |`, ``);
    if (pkg.mc) L.push(`Monte Carlo five-year total: 10th ${fm(pkg.mc.total.p10)}, median ${fm(pkg.mc.total.p50)}, 90th ${fm(pkg.mc.total.p90)}.`, ``);
    if (pkg.sensitivity.length) L.push(`### Top assumptions by effect on the five-year total`, ...pkg.sensitivity.map(s => `- ${s.policy}: ${s.input} (${s.status}): from ${fm(s.low)} to ${fm(s.high)}`), ``);
    if (pkg.notModelled.length) L.push(`### Interactions not modelled`, ...pkg.notModelled.map(s => `- ${s}`), ``);
    if (pkg.indirect) L.push(`### Wider (indirect) effects, kept apart from the headline`, ...(pkg.indirect.lines.length ? pkg.indirect.lines.map(l => `- ${l.label}: ${l.perYear.map(fm).join(", ")}. ${l.note}`) : ["- none apply to these policies"]), ``);
    L.push(`### Assumptions and sources`, ...pkg.results.flatMap(r => r.assumptions.map(a => `- ${a.what} [${a.status}]${a.source ? ` ${a.source}` : ""}`)), ``, `**${DISCLAIMER}**`);
    return L.join("\n");
  }
  function toCsv(pkg) {
    const rows = [["policy", "row", ...YEARS, "total", "units"]];
    pkg.results.forEach(r => { for (const [name, key] of [["low", "low"], ["central", "central"], ["high", "high"], ["static", "static"]]) { if (key === "static" && r.years[0].static == null) continue; rows.push([r.label, name, ...r.years.map(y => round(y[key])), round(r.total[key]), "£m"]); } });
    for (const [name, key] of [["sum of the parts", "sumOfParts"], ["interaction", "interaction"], ["package central", "central"], ["package low", "low"], ["package high", "high"]]) rows.push(["Package", name, ...pkg.years.map(y => round(y[key])), round(sum(pkg.years.map(y => y[key]))), "£m"]);
    return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  }

  root.Costing = { YEARS, SIGN, DISCLAIMER, index, staleness, family, mkPolicy, costOne, costPackage, interactions, monteCarlo, sensitivity, inputsOf, topRateBehaviour, parseLine, parseText, spendBase, toMarkdown, toCsv, tri, rng };
})(typeof globalThis !== "undefined" ? globalThis : this);
