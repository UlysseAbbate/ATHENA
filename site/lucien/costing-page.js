/* LUCIEN > Economic policy > Costings: the page. Words (or a list built by hand) in; a confirmation step (nothing is costed until the person has checked how each point was read); a range of costings out,
 * year by year, for each policy and for the package, with the assumptions, sources and warnings. The engine is costing.js; the numbers are costing-data.json. */
const CostingPage = (() => {
  const { esc } = Athena;
  const Y = () => Costing.YEARS;
  const cs = { text: "", rows: [], pkg: null, indirect: false, data: null, ix: null, error: "", loading: false, note: "" };
  const EXAMPLES = ["raise the basic rate of income tax by 1p", "cut employer NICs by 1pp", "increase the Universal Credit standard allowance by 5%", "raise VAT by 1pp from 2027", "put up tobacco duty by 2%", "cut departmental spending by £2bn from 2028"];
  const BENEFITS = [["universal_credit", "Universal Credit"], ["state_pension", "State pension"], ["pensioner_benefits", "All pensioner benefits"], ["disability_benefits", "Disability benefits"], ["child_benefit", "Child Benefit (use the per-child lines for £ changes)"]];
  const UNIT = { p: "p", pp: "pp", pct: "%", gbp: "£", gbp_week: "£ a week", gbp_year: "£ a year" };

  async function load() {
    if (cs.data || cs.loading) return;
    cs.loading = true;
    try { const r = await fetch("costing-data.json", { cache: "no-cache" }); if (!r.ok) throw new Error(`HTTP ${r.status}`); cs.data = await r.json(); cs.ix = Costing.index(cs.data); } catch (e) { cs.error = `The costing data could not be loaded: ${e.message || e}`; }
    cs.loading = false;
  }

  /* ---------------------------------------------------------------- formatting */
  const m = v => (v == null ? "n/a" : `${v < -0.5 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString("en-GB")}`);
  const bn = v => `${v < 0 ? "−" : v > 0 ? "+" : ""}£${(Math.abs(v) / 1000).toFixed(1)}bn`;
  const cls = v => (v < -0.5 ? "cost-neg" : v > 0.5 ? "cost-pos" : "");
  const cell = v => `<td class="num ${cls(v)}">${m(v)}</td>`;

  /* ---------------------------------------------------------------- rows (one per structured policy) */
  const rowFromPolicy = (p, text, ask) => ({ text, kind: p.kind, item: p.item || "", benefit: p.benefit || "universal_credit", direction: p.direction >= 0 ? 1 : -1, size: p.size, amountM: p.amountM || 2000, start: p.start || Y()[0], ask: ask || [] });
  function readText() {
    const parsed = Costing.parseText(cs.ix, cs.text);
    cs.rows = []; cs.pkg = null;
    for (const r of parsed) {
      const ps = r.policies && r.policies.length ? r.policies : (r.policy ? [r.policy] : []);
      if (!ps.length) cs.rows.push({ text: r.text, kind: "tax", item: "", benefit: "universal_credit", direction: 1, size: 1, amountM: 2000, start: Y()[0], ask: r.ask });
      ps.forEach((p, i) => cs.rows.push(rowFromPolicy(p, i ? `${r.text} (part ${i + 1})` : r.text, i ? [] : r.ask)));
    }
  }
  const policyOf = r => r.kind === "tax" ? { kind: "tax", item: r.item, direction: r.direction, size: Number(r.size), start: r.start, label: r.text } : r.kind === "benefit" ? { kind: "benefit", benefit: r.benefit, direction: r.direction, size: Number(r.size), start: r.start, label: r.text }
    : { kind: "spending", direction: r.direction, amountM: Number(r.amountM), start: r.start, label: r.text };
  const itemOptions = sel => { const by = {}; for (const i of cs.data.items) (by[i.taxName] ||= []).push(i); return `<option value="">Choose…</option>` + Object.entries(by).map(([t, l]) => `<optgroup label="${esc(t)}">${l.map(i => `<option value="${esc(i.id)}" ${i.id === sel ? "selected" : ""}>${esc(i.label)}</option>`).join("")}</optgroup>`).join(""); };

  function confirmHtml() {
    if (!cs.rows.length) return "";
    const body = cs.rows.map((r, i) => {
      const what = r.kind === "tax" ? `<select data-f="item">${itemOptions(r.item)}</select>` : r.kind === "benefit" ? `<select data-f="benefit">${BENEFITS.map(b => `<option value="${b[0]}" ${b[0] === r.benefit ? "selected" : ""}>${esc(b[1])}</option>`).join("")}</select>` : `<span>Departmental spending</span>`;
      const kindSel = `<select data-f="kind"><option value="tax" ${r.kind === "tax" ? "selected" : ""}>A tax or duty</option><option value="benefit" ${r.kind === "benefit" ? "selected" : ""}>A benefit (% change)</option><option value="spending" ${r.kind === "spending" ? "selected" : ""}>Departmental spending (£ a year)</option></select>`;
      const unit = r.kind === "tax" && r.item && cs.ix.byId.get(r.item) ? UNIT[cs.ix.byId.get(r.item).unit] || "" : r.kind === "benefit" ? "%" : "£m a year";
      const size = r.kind === "spending" ? `<input type="number" data-f="amountM" value="${esc(r.amountM)}" step="100" min="0" aria-label="£ million a year"> £m a year` : `<input type="number" data-f="size" value="${esc(r.size)}" step="any" min="0" aria-label="Size of the change"> ${esc(unit)}`;
      const ask = r.ask.length ? `<div class="cost-ask" role="status">${r.ask.map(q => `<div>${esc(q)}</div>`).join("")}</div>` : "";
      return `<tr data-i="${i}"><td class="cost-said">${esc(r.text)}${ask}</td><td>${kindSel}<br>${what}</td><td><select data-f="direction"><option value="1" ${r.direction > 0 ? "selected" : ""}>Raise / increase</option><option value="-1" ${r.direction < 0 ? "selected" : ""}>Cut / decrease</option></select></td>
        <td>${size}</td><td><select data-f="start">${Y().map(y => `<option ${y === r.start ? "selected" : ""}>${y}</option>`).join("")}</select></td><td><button type="button" class="ghost" data-remove title="Remove this point">Remove</button></td></tr>`;
    }).join("");
    const unsure = cs.rows.some(r => r.ask.length || (r.kind === "tax" && !r.item));
    return `<div class="panel"><div class="panel-head"><h2>Check how I read these</h2><span class="muted">nothing is costed until you have checked</span></div>
      <p class="muted arc-note">Each point is turned into a structured policy. Change anything that is wrong; where I could not tell, I have asked rather than guessed.</p>
      <div class="tablewrap"><table class="grid"><thead><tr><th>Your words</th><th>Read as</th><th>Direction</th><th>Size</th><th>From</th><th></th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="arc-form" style="margin-top:8px"><label class="arc-d"><input type="checkbox" id="cost-indirect" ${cs.indirect ? "checked" : ""}> Show wider (indirect) effects separately (off by default; not in the headline)</label>
      <button class="ghost" id="cost-run" ${unsure ? "" : ""}>Cost these</button>${unsure ? '<span class="muted small">Some points still have a question above; answer it (or remove the point) first.</span>' : ""}</div></div>`;
  }

  /* ---------------------------------------------------------------- results */
  function yearTable(res, mc) {
    const rows = [["Low", "low"], ["Central (after behaviour)", "central"], ["High", "high"]];
    let h = `<thead><tr><th></th>${Y().map(y => `<th class="num">${y}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>`;
    for (const [lab, k] of rows) h += `<tr class="${k === "central" ? "cost-mid" : ""}"><td>${lab}</td>${res.years.map(y => cell(y[k])).join("")}${cell(res.total[k])}</tr>`;
    if (res.years[0].static != null) h += `<tr><td>Static (before behaviour)</td>${res.years.map(y => cell(y.static)).join("")}${cell(res.total.static)}</tr>`;
    if (mc) { const t = mc.years.reduce((s, y) => [s[0] + y.p10, s[1] + y.p50, s[2] + y.p90], [0, 0, 0]);
      h += `<tr class="muted"><td>Monte Carlo 10th percentile</td>${mc.years.map(y => cell(y.p10)).join("")}${cell(t[0])}</tr><tr class="muted"><td>Monte Carlo median</td>${mc.years.map(y => cell(y.p50)).join("")}${cell(t[1])}</tr><tr class="muted"><td>Monte Carlo 90th percentile</td>${mc.years.map(y => cell(y.p90)).join("")}${cell(t[2])}</tr>`; }
    return `<div class="tablewrap"><table class="grid cost-table">${h}</tbody></table></div>`;
  }
  const assumptionsHtml = list => `<ul class="cost-as">${list.map(a => `<li>${esc(a.what)} <span class="cost-tag ${/^SOURCED/.test(a.status) && !/UNSOURCED/.test(a.status) ? "ok" : "un"}">${esc(a.status)}</span>${a.source ? ` <a href="${esc(Athena.safeUrl(a.source))}" target="_blank" rel="noopener noreferrer">source</a>` : ""}</li>`).join("")}</ul>`;
  function resultHtml() {
    const p = cs.pkg;
    if (!p) return "";
    const one = p.results.map((r, i) => {
      const mc = p.mc && p.mc.perPolicy[i];
      const t = mc ? mc.years.reduce((s, y) => [s[0] + y.p10, s[1] + y.p90], [0, 0]) : null;
      return `<div class="panel cost-res"><div class="panel-head"><h2>${i + 1}. ${esc(r.label)}</h2><span class="cost-rating cost-r-${r.rating.replace(" ", "")}">Uncertainty: ${esc(r.rating)}</span></div>
        <p class="cost-head">Five years: <b class="${cls(r.total.central)}">${bn(r.total.central)}</b> <span class="muted">(range ${bn(r.total.low)} to ${bn(r.total.high)}${t ? `; Monte Carlo 10th to 90th percentile ${bn(t[0])} to ${bn(t[1])}` : ""})</span></p>
        ${yearTable(r, mc)}${r.warnings.map(w => `<div class="cost-warn">${esc(w)}</div>`).join("")}
        <details><summary>Methodology, assumptions and sources</summary><p class="muted small">Rated ${esc(r.rating)}: ${esc(r.ratingWhy)}.</p>${assumptionsHtml(r.assumptions)}</details></div>`;
    }).join("");
    const pk = p.results.length > 1 || p.interactions.length ? "" : "";
    const sumRow = (lab, k, tot) => `<tr><td>${lab}</td>${p.years.map(y => cell(y[k])).join("")}${cell(tot)}</tr>`;
    const tot = k => p.years.reduce((s, y) => s + y[k], 0);
    const maxSwing = Math.max(1, ...p.sensitivity.map(s => s.swing));
    const pkg = `<div class="panel cost-res"><div class="panel-head"><h2>The package${p.results.length > 1 ? "" : " (one policy)"}</h2><span class="muted">costed together, not just added</span></div>
      <p class="cost-head">Five years: <b class="${cls(p.total.central)}">${bn(p.total.central)}</b> <span class="muted">(range ${bn(p.total.low)} to ${bn(p.total.high)}${p.mc ? `; Monte Carlo 10th to 90th percentile ${bn(p.mc.total.p10)} to ${bn(p.mc.total.p90)}, median ${bn(p.mc.total.p50)}` : ""})</span></p>
      <div class="tablewrap"><table class="grid cost-table"><thead><tr><th></th>${Y().map(y => `<th class="num">${y}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
        ${sumRow("Sum of the parts", "sumOfParts", tot("sumOfParts"))}${sumRow("Interaction effect", "interaction", tot("interaction"))}<tr class="cost-mid"><td>Package, central</td>${p.years.map(y => cell(y.central)).join("")}${cell(p.total.central)}</tr>
        ${sumRow("Low", "low", p.total.low)}${sumRow("High", "high", p.total.high)}${p.years[0].static != null ? sumRow("Static (before behaviour)", "static", p.total.static) : ""}</tbody></table></div>
      ${p.interactions.map(x => `<p class="muted small">Interaction: ${esc(x.note)}: ${x.perYear.map(v => m(v)).join(", ")}.</p>`).join("")}
      ${p.notModelled.length ? `<div class="cost-warn">Interactions not modelled: ${p.notModelled.map(esc).join("; ")}.</div>` : ""}
      ${p.indirect ? `<h3>Wider (indirect) effects, kept apart from the headline</h3>${p.indirect.lines.length ? p.indirect.lines.map(l => `<p class="small">${esc(l.label)}: ${l.perYear.map(m).join(", ")}. ${esc(l.note)}</p>`).join("") : '<p class="muted small">None of these policies has a wider-effects layer.</p>'}` : ""}
      <h3>The assumptions that matter most</h3><p class="muted small">How much the five-year total moves when each input goes from its low to its high, the others held at central.</p>
      ${p.sensitivity.map(s => `<div class="cost-bar"><div class="cost-bar-l">${esc(s.policy)}: ${esc(s.input)} <span class="cost-tag ${/^SOURCED/.test(s.status) && !/UNSOURCED/.test(s.status) ? "ok" : "un"}">${esc(s.status)}</span></div><div class="cost-bar-t"><div class="cost-bar-f" style="width:${Math.max(2, Math.round(s.swing / maxSwing * 100))}%"></div></div><div class="cost-bar-v">${m(s.low)} to ${m(s.high)}</div></div>`).join("")}
      <div class="arc-form" style="margin-top:10px"><button class="ghost" data-dl="md">Download report (Markdown)</button><button class="ghost" data-dl="csv">Download (CSV)</button><button class="ghost" data-dl="json">Download (JSON)</button></div></div>`;
    return `${one}${pkg}`;
  }

  function pageHtml() {
    if (cs.error) return `<div class="panel"><h2>Costings</h2><p class="err">${esc(cs.error)}</p></div>`;
    if (!cs.data) return `<div class="panel"><div class="panel-head"><h2>Costings</h2></div><p class="muted">Loading the costing data…</p></div>`;
    const d = cs.data, s = Costing.staleness(d), rr = d.meta.ready_reckoner;
    return `<div class="panel"><div class="panel-head"><h2>Costings</h2><span class="muted">${esc(Costing.SIGN)}</span></div>
      <p class="cost-disc"><b>${esc(Costing.DISCLAIMER)}</b></p>
      <p class="muted arc-note">Type policy points, one per line, for example <i>raise the basic rate of income tax by 1p</i>. You will see how each was read and can correct it before anything is costed. Each policy and the package are costed for five fiscal years (2026-27 to 2030-31) as a low, central and high figure, with a Monte Carlo range, the static figure beside the post-behavioural one where a source allows it, and every assumption with its source (or the word UNSOURCED).</p>
      ${s.stale ? `<div class="cost-warn cost-stale"><b>Out of date.</b> The tax figures are HMRC's ready reckoner as at ${esc(rr.as_at)} (${s.months} months old), on the OBR's ${esc(rr.baseline)} baseline. ${esc(d.meta.newer_baseline_exists)} Treat every figure here as indicative.</div>` : ""}
      <form id="cost-form"><textarea id="cost-text" rows="5" placeholder="One policy point per line, for example:&#10;raise the basic rate of income tax by 1p&#10;cut employer NICs by 1pp&#10;increase the Universal Credit standard allowance by 5%" aria-label="Policy points">${esc(cs.text)}</textarea>
      <div class="arc-form" style="margin-top:6px"><button class="ghost" type="submit" id="cost-read">Read these</button><span class="muted small">Examples:</span>${EXAMPLES.map(e => `<button type="button" class="ghost cost-ex" data-ex="${esc(e)}">${esc(e)}</button>`).join("")}</div></form></div>
      <div id="cost-confirm">${confirmHtml()}</div><div id="cost-result">${resultHtml()}</div>
      <div class="panel"><details><summary>Data, method and limits</summary>
        <p class="muted small">Tax figures: ${esc(rr.name)} (${esc(rr.as_at)}; ${esc(rr.basis)}). Baseline spending: the OBR's Tax by tax, spend by spend pages. The tool data version is ${esc(d.meta.version)}. Years 4 and 5 are extrapolated and are shown as less certain.</p>
        <ul class="cost-as">${d.references.map(r => `<li><a href="${esc(Athena.safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">${esc(r.name)}</a></li>`).join("")}</ul>
        <p class="muted small"><b>Limits.</b> First-order effects only. HMRC's figures are for a 1-unit change; larger changes are scaled (in a straight line where HMRC say that is fair), so very large changes are less reliable. Wider economic effects are off by default. Benefit changes use baseline spending and a placeholder offset; take-up and work responses are not modelled. The ranges' widths come from a rating by tax and are the tool's convention (UNSOURCED). The OBR's own ready reckoner and uncertainty ratings are not used because the OBR does not allow automated downloads. Everything marked UNSOURCED is a gap, not a finding.</p></details></div>`;
  }

  /* ---------------------------------------------------------------- wiring */
  function download(name, type, text) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  function wire(host, redraw) {
    const q = s => host.querySelector(s);
    const text = q("#cost-text");
    if (!text) return;
    text.oninput = () => { cs.text = text.value; };
    q("#cost-form").onsubmit = e => { e.preventDefault(); cs.text = text.value; readText(); redraw(); };
    host.querySelectorAll(".cost-ex").forEach(b => { b.onclick = () => { cs.text = (cs.text.trim() ? cs.text.trim() + "\n" : "") + b.dataset.ex; redraw(); }; });
    const conf = q("#cost-confirm");
    if (conf) {
      conf.onchange = e => {
        const tr = e.target.closest("tr[data-i]"), f = e.target.dataset.f;
        if (e.target.id === "cost-indirect") { cs.indirect = e.target.checked; return; }
        if (!tr || !f) return;
        const r = cs.rows[+tr.dataset.i];
        r[f] = ["direction"].includes(f) ? Number(e.target.value) : e.target.value;
        if (f === "kind" && r.kind === "tax" && !r.item) r.item = "";
        r.ask = []; cs.pkg = null; redraw();
      };
      conf.onclick = e => {
        const rm = e.target.closest("[data-remove]");
        if (rm) { cs.rows.splice(+rm.closest("tr").dataset.i, 1); cs.pkg = null; redraw(); return; }
        if (e.target.id === "cost-run") run(redraw);
      };
    }
    host.querySelectorAll("[data-dl]").forEach(b => { b.onclick = () => { const k = b.dataset.dl; if (!cs.pkg) return;
      if (k === "md") download("costing.md", "text/markdown", Costing.toMarkdown(cs.pkg)); else if (k === "csv") download("costing.csv", "text/csv", Costing.toCsv(cs.pkg)); else download("costing.json", "application/json", JSON.stringify(cs.pkg, null, 1)); }; });
  }
  function run(redraw) {
    const bad = cs.rows.filter(r => r.ask.length || (r.kind === "tax" && !r.item));
    if (bad.length || !cs.rows.length) { cs.note = "Answer the questions first."; redraw(); return; }
    try { cs.pkg = Costing.costPackage(cs.ix, cs.rows.map(policyOf), { indirect: cs.indirect }); cs.error = ""; } catch (e) { cs.error = `Could not cost this: ${e.message || e}`; }
    redraw();
    const res = document.getElementById("cost-result"); if (res && res.scrollIntoView) res.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return { load, html: pageHtml, wire };
})();
