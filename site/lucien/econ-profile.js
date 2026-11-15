/* LUCIEN > Economic policy: the data profile logic (no page, no network; the page is economy.js and the tests run this file on its own).
 * It works on rows of the table econ_data: { dataset, geography_code, geography_name, geography_level, sex, age_from, age_to, age_label, category, measure, unit, value, period }.
 *
 * A profile answers "what do the figures look like for these people, compared with everyone?" for an area, an age range and a sex. The data come in fixed age bands
 * (16-19, 20-24, 25-29 ... or 16-24, 25-34 ...), so a range such as 18-25 is matched to the closest band or run of bands (here 16-24 or 16-29), and the profile says so.
 * Shares (employment rate and so on) are worked out from counts of people, so any run of bands can be added up. */
(function (root) {
  const TOP = 100;   // an open-ended band ("65+") is treated as running to 100 when bands are compared

  /** Age bands present in `rows` (unique), each { from, to, label }, oldest last. */
  function bandsOf(rows) {
    const seen = new Map();
    for (const r of rows) {
      if (r.age_from == null) continue;
      const k = `${r.age_from}-${r.age_to}`;
      if (!seen.has(k)) seen.set(k, { from: r.age_from, to: r.age_to, label: r.age_label });
    }
    return [...seen.values()].sort((a, b) => a.from - b.from || a.to - b.to);
  }
  const cap = (n) => Math.min(n, TOP);
  const spans = (a) => [a.from, cap(a.to)];

  /** Atomic bands: the finest ones (no other band lies inside them), so adding them up never counts anyone twice. */
  function atomic(bands) {
    return bands.filter((b) => !bands.some((o) => o !== b && o.from >= b.from && cap(o.to) <= cap(b.to) && (o.from > b.from || cap(o.to) < cap(b.to))));
  }

  /** The overlap of two age ranges as a share of their union (1 = the same ages). */
  function jaccard(a0, a1, b0, b1) {
    const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
    const inter = Math.max(0, hi - lo + 1), union = (a1 - a0 + 1) + (b1 - b0 + 1) - inter;
    return union > 0 ? inter / union : 0;
  }

  /** The band, or run of neighbouring bands, whose ages are closest to [from, to]. { bands, from, to, label, score, exact, whole } (null when there are no age bands). */
  function closest(bands, from, to) {
    if (!bands.length) return null;
    const to2 = cap(to), cands = bands.map((b) => ({ bands: [b], from: b.from, to: b.to }));
    const at = atomic(bands);
    for (let i = 0; i < at.length; i++) {
      for (let j = i + 1; j < at.length; j++) {
        if (at[j].from > cap(at[j - 1].to) + 1) break;   // a gap: not a run
        const run = at.slice(i, j + 1);
        cands.push({ bands: run, from: run[0].from, to: run[run.length - 1].to });
      }
    }
    let best = null;
    for (const c of cands) {
      const score = jaccard(from, to2, c.from, cap(c.to));
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && (cap(c.to) - c.from) < (cap(best.to) - best.from))) best = { ...c, score };
    }
    const label = best.bands.length === 1 ? best.bands[0].label : (best.to >= TOP ? `${best.from}+` : `${best.from}-${best.to}`);
    return { ...best, label, exact: best.from === from && cap(best.to) === to2, whole: best.score };
  }

  const sum = (xs) => xs.reduce((s, x) => s + x, 0);
  /** The count for a category, added up over the bands of a match (null if any band is missing). */
  function count(rows, dataset, geo, sex, match, category, measure) {
    const vals = match.bands.map((b) => {
      const r = rows.find((x) => x.dataset === dataset && x.geography_code === geo && x.sex === sex && x.age_from === b.from && x.age_to === b.to && x.category === category && (measure ? x.measure === measure : true));
      return r ? Number(r.value) : null;
    });
    return vals.some((v) => v === null) ? null : sum(vals);
  }
  const pct = (a, b) => (a == null || b == null || b === 0 ? null : (a / b) * 100);
  const period = (rows, dataset) => (rows.find((r) => r.dataset === dataset) || {}).period || "";

  /** Indicators for one area, sex and age range. Returns { indicators: [{ key, label, value, unit, note, dataset, period, band }], bands: { dataset: match } }. */
  function indicators(rows, geo, sex, from, to) {
    const out = [], used = {};
    const mine = rows.filter((r) => r.geography_code === geo);
    const push = (key, label, value, unit, dataset, band, note) => out.push({ key, label, value, unit, dataset, period: period(rows, dataset), band: band ? band.label : "", note: note || "" });

    // Annual Population Survey: counts of people by labour market status
    const apsRows = mine.filter((r) => r.dataset === "aps_labour" && r.sex === sex);
    const apsBands = bandsOf(apsRows).filter((b) => !(b.from === 0 && b.to >= TOP));   // "All ages" includes children
    const m = closest(apsBands, from, to);
    if (m) {
      used.aps_labour = m;
      const g = (c) => count(rows, "aps_labour", geo, sex, m, c);
      const pop = g("All persons"), active = g("Economically Active"), emp = g("Employed"), self = g("Self Employed"), un = g("Unemployed"), inact = g("Economically inactive"), ft = g("Total Full-time"), pt = g("Total Part-time");
      push("employment_rate", "Employment rate", pct(emp, pop), "%", "aps_labour", m);
      push("unemployment_rate", "Unemployment rate (of those economically active)", pct(un, active), "%", "aps_labour", m);
      push("inactivity_rate", "Economic inactivity rate", pct(inact, pop), "%", "aps_labour", m);
      push("self_employed", "Self-employed (share of those in work)", pct(self, emp), "%", "aps_labour", m);
      push("part_time", "Part-time (share of those in work)", pct(pt, ft == null || pt == null ? null : ft + pt), "%", "aps_labour", m);
      push("population", "People in this group (survey estimate)", pop, "people", "aps_labour", m, "rounded to the nearest 100; a survey, so smaller groups are less certain");
    }

    // Claimant Count: claimants as a share of residents aged 16-64, one band
    const clRows = mine.filter((r) => r.dataset === "claimants" && r.sex === sex && /proportion/i.test(r.measure));
    const cb = closest(bandsOf(clRows).filter((b) => !(b.label === "Age unknown (clerical claims)")), from, to);
    if (cb) {
      used.claimants = cb;
      const r = clRows.find((x) => x.age_from === cb.bands[0].from && x.age_to === cb.bands[0].to);
      if (r) push("claimant_rate", "Claimant count (share of residents)", Number(r.value), "%", "claimants", cb, "people claiming unemployment-related benefits");
    }

    // Census 2021: economic activity by age (the 2021 snapshot)
    const ceRows = mine.filter((r) => r.dataset === "census_econ" && r.sex === sex);
    const cm = closest(bandsOf(ceRows).filter((b) => !(b.from === 0 && b.to >= TOP) && b.to > 15), from, to);
    if (cm) {
      used.census_econ = cm;
      const g = (c) => count(rows, "census_econ", geo, sex, cm, c);
      const total = g("Total");
      const inWork = [g("Economically active (excluding full-time students): In employment"), g("Economically active and a full-time student: In employment")];
      const students = [g("Economically active and a full-time student: In employment"), g("Economically active and a full-time student: Unemployed"), g("Economically inactive and a full-time student")];
      if (total != null && !inWork.some((v) => v == null)) push("census_employment", "In employment (Census 2021)", pct(sum(inWork), total), "%", "census_econ", cm, "the 2021 census, for comparison with the survey figures");
      if (total != null && !students.some((v) => v == null)) push("census_students", "Full-time students (Census 2021)", pct(sum(students), total), "%", "census_econ", cm);
    }

    // Pay: not split by age in the source; by sex only (both sexes are shown when no sex is chosen)
    const pays = [["Median weekly pay - gross", "Median weekly pay (all workers)"], ["Median hourly pay - gross", "Median hourly pay (all workers)"], ["Median annual pay - gross", "Median annual pay (all workers)"]];
    const sexes = sex === "all" ? ["female", "male"] : [sex];
    for (const [measure, label] of pays) {
      for (const s of sexes) {
        const r = mine.find((x) => x.dataset === "ashe" && x.sex === s && x.measure === measure && x.category === "All workers");
        if (r) push(`ashe_${measure}_${s}`, sex === "all" ? `${label}: ${s === "male" ? "men" : "women"}` : label, Number(r.value), "£", "ashe", null, "not available by age: this is all ages, by sex");
      }
    }
    // Household income per head: the area only
    const gd = mine.find((x) => x.dataset === "gdhi" && /per head \(/i.test(x.measure));
    if (gd) push("gdhi_per_head", "Household income per head (GDHI)", Number(gd.value), "£", "gdhi", null, "all ages and sexes (the area only)");
    return { indicators: out, bands: used };
  }

  /** A profile: the group's indicators beside the comparison's. `compare` = { geo, sex, from, to } (usually the UK, all working-age adults). */
  function profile(rows, ask, compare) {
    const mine = indicators(rows, ask.geo, ask.sex, ask.from, ask.to);
    const base = indicators(rows, compare.geo, compare.sex, compare.from, compare.to);
    const byKey = new Map(base.indicators.map((i) => [i.key, i]));
    const lines = mine.indicators.map((i) => {
      const c = byKey.get(i.key) || null;
      const diff = c && c.value != null && i.value != null ? i.value - c.value : null;
      const rel = c && c.value ? (i.value / c.value - 1) * 100 : null;
      return { ...i, compare: c ? c.value : null, compareBand: c ? c.band : "", diff, rel };
    });
    return { lines, bands: mine.bands, compareBands: base.bands };
  }

  /* ---------------------------------------------------------------- a question in words -> the profile's inputs */
  const AREAS = [
    ["London", /\b(london(ers?)?)\b/i], ["North East", /\bnorth[- ]east\b/i], ["North West", /\bnorth[- ]west\b/i], ["Yorkshire and The Humber", /\byorkshire\b/i],
    ["East Midlands", /\beast midlands\b/i], ["West Midlands", /\bwest midlands\b/i], ["East", /\b(east of england|eastern england)\b/i], ["South East", /\bsouth[- ]east\b/i],
    ["South West", /\bsouth[- ]west\b/i], ["Wales", /\b(wales|welsh)\b/i], ["Scotland", /\b(scotland|scots|scottish)\b/i], ["Northern Ireland", /\bnorthern ireland\b/i],
    ["England", /\bengland\b/i], ["United Kingdom", /\b(uk|united kingdom|britain|british|national|nationwide)\b/i]];

  /** Reads "create a data profile, compared to the average, of Londoners aged 18-25" into { area, from, to, sex, said }. Anything not mentioned takes a plain default (the UK, working age 16-64, everyone). */
  function parseQuestion(text) {
    const t = String(text || "");
    const said = [];
    let area = "United Kingdom";
    // the first area named wins, but "compared to the UK" must not turn the whole profile into the UK's: look at the part before "compar"
    const head = t.split(/\bcompar/i)[0];
    const found = AREAS.find(([, rx]) => rx.test(head)) || AREAS.find(([, rx]) => rx.test(t));
    if (found) { area = found[0]; said.push(area); }
    let from = 16, to = 64, aged = false, m;
    if ((m = t.match(/\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\b/))) { from = +m[1]; to = +m[2]; aged = true; }
    else if ((m = t.match(/\b(?:under|below|younger than)\s*(\d{1,2})\b/i))) { from = 16; to = +m[1] - 1; aged = true; }
    else if ((m = t.match(/\b(?:over|above|older than)\s*(\d{1,2})\b\s*\+?/i)) || (m = t.match(/\b(\d{1,2})\s*\+/))) { from = +m[1]; to = TOP; aged = true; }
    else if (/\b(young people|young adults|youth|youths|students?)\b/i.test(t)) { from = 18; to = 24; aged = true; }
    else if (/\b(pensioners?|older people|retired|elderly)\b/i.test(t)) { from = 65; to = TOP; aged = true; }
    else if (/\bworking[- ]age\b/i.test(t)) { from = 16; to = 64; aged = true; }
    if (aged) said.push(to >= TOP ? `aged ${from}+` : `aged ${from}-${to}`);
    let sex = "all";
    if (/\b(women|woman|female|females|girls?)\b/i.test(t)) sex = "female"; else if (/\b(men|man|male|males|boys?)\b/i.test(t)) sex = "male";
    if (sex !== "all") said.push(sex === "female" ? "women" : "men");
    return { area, from: Math.min(from, to), to: Math.max(from, to), sex, said };
  }

  root.EconProfile = { bandsOf, atomic, jaccard, closest, indicators, profile, parseQuestion, TOP };
})(typeof globalThis !== "undefined" ? globalThis : this);
