/* LUCIEN > Economic policy. Two parts:
 *   Data profiles: pick (or type) an area, an age range and a sex, and see the economic figures for those people beside the average. The figures are open official statistics
 *     (Nomis: Annual Population Survey, Claimant Count, ASHE, GDHI, Census 2021) kept in the table econ_data by the collector; the age matching is in econ-profile.js.
 *   Costings: the costing tool (next stage).
 * Nothing here is a security boundary: the table is readable only by people with LUCIEN access. */
const Economy = (() => {
  const { sb, esc } = Athena;
  const AREAS = [["K02000001", "United Kingdom"], ["E92000001", "England"], ["E12000007", "London"], ["E12000001", "North East"], ["E12000002", "North West"], ["E12000003", "Yorkshire and The Humber"],
    ["E12000004", "East Midlands"], ["E12000005", "West Midlands"], ["E12000006", "East"], ["E12000008", "South East"], ["E12000009", "South West"], ["W92000004", "Wales"], ["S92000003", "Scotland"], ["N92000002", "Northern Ireland"]];
  const codeOf = name => (AREAS.find(a => a[1] === name) || AREAS[0])[0];
  const SEXES = [["all", "Everyone"], ["female", "Women"], ["male", "Men"]];
  const SOURCES = { aps_labour: "Annual Population Survey", claimants: "Claimant Count", ashe: "Annual Survey of Hours and Earnings", gdhi: "Regional household income (GDHI)", census_econ: "Census 2021" };
  let fiscal = null, fiscalError = "";
  const sys = { children: 0, loan: "none", q: "" };
  const st = { tab: "profiles", area: "London", from: 18, to: 25, sex: "all", cmp: "K02000001", said: "", result: null, loading: false, error: "" };
  let host = null;

  const fmt = (v, unit) => v == null ? "–" : unit === "%" ? `${v.toFixed(1)}%` : unit === "£" ? `£${Math.round(v).toLocaleString("en-GB")}` : unit === "people" ? Math.round(v).toLocaleString("en-GB") : unit === "hours" ? `${v.toFixed(1)}` : String(Math.round(v * 10) / 10);
  const diffText = l => {
    if (l.diff == null) return "–";
    if (l.unit === "%") return `${l.diff >= 0 ? "+" : "−"}${Math.abs(l.diff).toFixed(1)} points`;
    if (l.unit === "£") return `${l.diff >= 0 ? "+" : "−"}£${Math.abs(Math.round(l.diff)).toLocaleString("en-GB")}${l.rel != null ? ` (${l.rel >= 0 ? "+" : "−"}${Math.abs(l.rel).toFixed(0)}%)` : ""}`;
    return "–";
  };
  const ageText = (a, b) => b >= EconProfile.TOP ? `${a}+` : `${a}-${b}`;

  async function rowsFor(codes) {
    const out = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await sb.from("econ_data").select("dataset,geography_code,geography_name,geography_level,sex,age_from,age_to,age_label,category,measure,unit,value,period").in("geography_code", codes).range(from, from + 999);
      if (error) throw error;
      out.push(...data); if (data.length < 1000) break;
    }
    return out;
  }

  async function run() {
    st.loading = true; st.error = ""; draw();
    try {
      const geo = codeOf(st.area);
      const rows = await rowsFor([...new Set([geo, st.cmp])]);
      if (!rows.length) { st.result = { empty: true }; }
      else {
        const cmpSex = st.sex;   // like with like: women are compared with all women, men with all men
        st.result = { geo, rows, profile: EconProfile.profile(rows, { geo, sex: st.sex, from: st.from, to: st.to }, { geo: st.cmp, sex: cmpSex, from: 16, to: 64 }),
          ask: { area: st.area, from: st.from, to: st.to, sex: st.sex }, cmpName: (AREAS.find(a => a[0] === st.cmp) || [])[1] };
      }
    } catch (e) { st.error = e.message || String(e); st.result = null; }
    st.loading = false; draw();
  }

  function resultHtml() {
    if (st.loading) return '<p class="muted">Working it out…</p>';
    if (st.error) return `<div class="empty">The figures could not be read: ${esc(st.error)}</div>`;
    const r = st.result;
    if (!r) return '<p class="muted">Choose an area and ages (or ask in words above), then press <b>Profile</b>.</p>';
    if (r.empty) return '<div class="empty">No economic data is stored yet. It is loaded from Nomis by the collector (at 6am or 6pm, about weekly), or with <b>Refresh all data</b>.</div>';
    const p = r.profile, ask = r.ask;
    if (!p.lines.length) return '<div class="empty">No figures are stored for that area and sex yet.</div>';
    const survey = p.bands.aps_labour;
    const matchNote = survey
      ? (survey.exact ? `You asked for ages ${esc(ageText(ask.from, ask.to))}; the data has exactly that band.`
        : `You asked for ages <b>${esc(ageText(ask.from, ask.to))}</b>. The data comes in fixed age bands, so the closest it can give is <b>${esc(survey.label)}</b> (${Math.round(survey.score * 100)}% of the same ages). Each line says which band it used.`)
      : "No age-specific figures are stored for that area and sex.";
    const rowsHtml = p.lines.map(l => `<tr><td>${esc(l.label)}${l.note ? `<div class="muted small">${esc(l.note)}</div>` : ""}</td>
      <td class="num"><b>${esc(fmt(l.value, l.unit))}</b>${l.band ? `<div class="muted small">ages ${esc(l.band)}</div>` : ""}</td>
      <td class="num">${esc(fmt(l.compare, l.unit))}${l.compareBand ? `<div class="muted small">ages ${esc(l.compareBand)}</div>` : ""}</td>
      <td class="num">${esc(diffText(l))}</td><td class="muted small">${esc(SOURCES[l.dataset] || l.dataset)}${l.period ? `<br>${esc(l.period)}` : ""}</td></tr>`).join("");
    const sexName = (SEXES.find(s => s[0] === ask.sex) || [])[1].toLowerCase();
    return `<div class="panel"><div class="panel-head"><h2>${esc(ask.area)}: ${esc(sexName)}, ages ${esc(ageText(ask.from, ask.to))}</h2><span class="muted">compared with ${esc(r.cmpName)}, ${ask.sex === "all" ? "everyone" : esc(sexName)} aged 16-64</span></div>
      <p class="muted">${matchNote}</p>
      <div class="tablewrap"><table class="grid"><thead><tr><th>Measure</th><th>${esc(ask.area)}, ${esc(ageText(ask.from, ask.to))}</th><th>Average</th><th>Difference</th><th>Source</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
      <p class="muted small">Official statistics from Nomis (ONS). Survey figures (Annual Population Survey) are estimates with a margin of error, larger for small groups. Pay is not split by age in the source, and household income is for the whole area. This is a data summary, not a costing.</p></div>`;
  }

  function costingsHtml() {
    return `<div class="panel"><div class="panel-head"><h2>Costings</h2><span class="muted">next stage</span></div>
      <p class="muted">The costing tool will take policy ideas (for example "raise the basic rate of income tax by 1p") and give a range of costings, year by year over five years: static and after behavioural change, low, central and high, with the method, data and assumptions shown, following the approach used by the OBR, HM Treasury and the IFS. It will not be an official or OBR-certified costing.</p>
      <p class="muted">The data profiles are the first part (the statistics it will draw on), and How the system works is the second (the rules it will apply).</p></div>`;
  }

  /* ---------------------------------------------------------------- How the system works: the rulebook and the marginal rates explorer */
  const COMP = [["tax", "Income Tax", "var(--c-committee)"], ["ni", "National Insurance", "var(--c-thinktank)"], ["loan", "Student loan", "var(--c-polling)"], ["hicbc", "Child Benefit charge", "var(--c-media)"], ["uc", "Universal Credit withdrawn", "var(--accent)"]];
  const pc = v => `${Math.round(v * 1000) / 10}%`;
  async function loadFiscal() {
    if (fiscal || fiscalError) return;
    try { const r = await fetch("fiscal-system.json", { cache: "no-cache" }); if (!r.ok) throw new Error(`HTTP ${r.status}`); fiscal = await r.json(); } catch (e) { fiscalError = e.message || String(e); }
  }
  function chartSvg(curve) {
    const W = 680, H = 300, L = 44, R = 10, T = 12, B = 34, maxE = curve[curve.length - 1].E, maxY = Math.max(0.7, Math.ceil(Math.max(...curve.map(p => p.total)) * 10) / 10 + 0.05);
    const x = e => L + (e / maxE) * (W - L - R), y = v => H - B - (Math.max(0, v) / maxY) * (H - T - B);
    const areas = COMP.map(([k, label, col], i) => {
      const lower = p => COMP.slice(0, i).reduce((s, [kk]) => s + Math.max(0, p[kk]), 0);
      const top = curve.map(p => `${x(p.E).toFixed(1)},${y(lower(p) + Math.max(0, p[k])).toFixed(1)}`), bot = curve.slice().reverse().map(p => `${x(p.E).toFixed(1)},${y(lower(p)).toFixed(1)}`);
      return `<polygon points="${top.concat(bot).join(" ")}" fill="${col}" opacity=".85"><title>${esc(label)}</title></polygon>`;
    }).join("");
    const grid = [0, 0.2, 0.4, 0.6].filter(v => v <= maxY).map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--rule-strong, #ccc)" stroke-width=".5"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="currentColor">${Math.round(v * 100)}%</text>`).join("");
    const xs = [0, 20000, 40000, 60000, 80000, 100000, 120000].filter(v => v <= maxE).map(v => `<text x="${x(v)}" y="${H - 14}" text-anchor="middle" font-size="11" fill="currentColor">£${v / 1000}k</text>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Share of each extra pound of earnings lost, by earnings, split into income tax, National Insurance, student loan, Child Benefit charge and Universal Credit withdrawn" style="width:100%;height:auto;color:var(--ink)">${grid}${areas}${xs}</svg>`;
  }
  function explorerHtml() {
    const F = FiscalSystem, m = fiscal.model, o = { children: sys.children, loan: sys.loan };
    const curve = F.curve(m, o);
    const marks = [10000, 15000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 100000, 110000, 130000];
    const rows = marks.map(E => { const g = F.marginal(m, E, o), p = F.position(m, E, o);
      return `<tr><td class="num">£${E.toLocaleString("en-GB")}</td>${COMP.map(([k]) => `<td class="num">${g[k] > 0.0005 ? pc(g[k]) : "–"}</td>`).join("")}<td class="num"><b>${pc(g.total)}</b></td><td class="num">£${Math.round(p.net).toLocaleString("en-GB")}</td></tr>`; }).join("");
    return `<div class="panel"><div class="panel-head"><h2>Marginal rates explorer</h2><span class="muted">how much of each extra £1 earned is lost</span></div>
      <p class="muted arc-note">For one employee in England, Wales or Northern Ireland aged 25 or over, with no housing costs. Each coloured band is a part of the system taking a share of the next £1 of earnings; they stack to the <b>effective marginal rate</b>. Where it rises, a pay rise is worth less; the steep places are the allowance taper over £100,000, the Child Benefit charge from £60,000, and Universal Credit's 55% taper at low earnings.</p>
      <form class="arc-form" id="sys-form"><label class="arc-d">Children <select id="sys-kids">${[0, 1, 2, 3].map(n => `<option value="${n}" ${sys.children === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label class="arc-d">Student loan <select id="sys-loan">${[["none", "None"], ["plan1", "Plan 1"], ["plan2", "Plan 2"], ["plan4", "Plan 4"], ["plan5", "Plan 5"], ["postgrad", "Postgraduate"]].map(([v, l]) => `<option value="${v}" ${sys.loan === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></form>
      ${chartSvg(curve)}
      <div class="chips" style="margin:6px 0">${COMP.map(([, l, c]) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:12px;font-size:.85rem"><i style="width:12px;height:12px;background:${c};display:inline-block"></i>${esc(l)}</span>`).join("")}</div>
      <div class="tablewrap"><table class="grid"><thead><tr><th>Earnings a year</th>${COMP.map(([, l]) => `<th>${esc(l)}</th>`).join("")}<th>Total lost</th><th>Net income a year</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small">Left out: housing costs and Housing Benefit, the benefit cap, couples, Scotland's rates, pension contributions, the two-child limit and savings. Net income includes Child Benefit and Universal Credit. It is an illustration of how the pieces fit together, not a costing. The numbers it runs on are the ones in the rulebook below.</p></div>`;
  }
  function ruleRow(p) {
    const src = fiscal.sources[p.source];
    return `<tr><td>${esc(p.label)}${p.note ? `<div class="muted small">${esc(p.note)}</div>` : ""}</td><td><b>${esc(p.value)}</b></td><td class="muted">${esc(p.previous || "")}</td><td class="small">${src ? `<a href="${esc(Athena.safeUrl(src.url) || "#")}" target="_blank" rel="noopener noreferrer">${esc(src.title)}</a>` : ""}</td></tr>`;
  }
  function rulebookHtml() {
    const q = sys.q.trim().toLowerCase();
    const groups = fiscal.groups.map(g => {
      const items = g.items.filter(it => !q || `${it.name} ${it.summary} ${it.parts.map(p => `${p.label} ${p.value}`).join(" ")}`.toLowerCase().includes(q));
      if (!items.length) return "";
      return `<div class="panel"><div class="panel-head"><h2>${esc(g.title)}</h2><span class="muted">${esc(g.intro)}</span></div>${items.map(it => `<details class="rule" ${q ? "open" : ""}><summary><b>${esc(it.name)}</b> <span class="pill">${it.kind === "tax" ? "tax" : "welfare"}</span><span class="muted small"> ${esc(it.summary.split(". ")[0].replace(/\.$/, ""))}</span></summary>
        <p>${esc(it.summary)}</p>${it.who || it.admin ? `<p class="muted small">${it.who ? `<b>Who:</b> ${esc(it.who)} ` : ""}${it.admin ? `<b>Run by:</b> ${esc(it.admin)}` : ""}</p>` : ""}
        <div class="tablewrap"><table class="grid"><thead><tr><th>Rule</th><th>${esc(fiscal.tax_year)}</th><th>Last year</th><th>Source</th></tr></thead><tbody>${it.parts.map(ruleRow).join("")}</tbody></table></div>
        ${it.interactions.length ? `<p class="small"><b>How it interacts</b></p><ul class="small">${it.interactions.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}</details>`).join("")}</div>`;
    }).join("");
    return groups || '<div class="empty">Nothing matches that search.</div>';
  }
  function systemHtml() {
    if (fiscalError) return `<div class="empty">The rulebook could not be loaded: ${esc(fiscalError)}</div>`;
    if (!fiscal) return '<p class="muted">Loading the rulebook…</p>';
    return `<div class="panel"><div class="panel-head"><h2>How the tax and welfare system works</h2><span class="muted">${esc(fiscal.tax_year)}; read from GOV.UK on ${esc(fiscal.retrieved)}</span></div>
      <p class="muted arc-note">Every tax and welfare payment covered so far, with its rates, thresholds, tapers and how it interacts with the others. Benefit amounts are read straight from the DWP's published rates; each tax rule is checked against its GOV.UK page when the rulebook is built, and links to it. ${esc(fiscal.notice)}</p>
      <form class="arc-form" id="sys-search" role="search"><input type="search" id="sys-q" placeholder="Search the rulebook: for example taper, student loan, 40%" value="${esc(sys.q)}" aria-label="Search the rulebook"></form></div>
      ${explorerHtml()}<div id="sys-book">${rulebookHtml()}</div>
      <div class="panel"><div class="panel-head"><h2>Not covered yet</h2></div><ul class="small">${fiscal.gaps.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
  }

  function draw() {
    const area = st.area, seg = (id, label) => `<button data-et="${id}" class="${st.tab === id ? "on" : ""}">${label}</button>`;
    host.innerHTML = `<div class="row"><div class="seg" id="eco-tabs">${seg("profiles", "Data profiles")}${seg("system", "How the system works")}${seg("costings", "Costings")}</div></div>` + (st.tab === "costings" ? costingsHtml() : st.tab === "system" ? systemHtml() : `
      <div class="panel"><div class="panel-head"><h2>Data profile</h2><span class="muted" id="eco-said">${esc(st.said)}</span></div>
      <p class="muted arc-note">Ask in words, for example <i>"create a data profile, compared to the average, of Londoners aged 18-25"</i>, or set the boxes below. The data is held in fixed age bands, so you get the closest bands it has.</p>
      <form class="arc-form" id="eco-ask"><input type="search" id="eco-q" placeholder="Ask: for example women in the North West aged 25-34" aria-label="Ask in words"><button class="ghost" type="submit">Ask</button></form>
      <form class="arc-form" id="eco-form" style="margin-top:8px">
        <label class="arc-d">Area <select id="eco-area">${AREAS.map(a => `<option ${a[1] === area ? "selected" : ""}>${esc(a[1])}</option>`).join("")}</select></label>
        <label class="arc-d">Ages <input type="number" id="eco-from" min="0" max="99" value="${st.from}" style="width:4.5rem" aria-label="Age from"> to <input type="number" id="eco-to" min="0" max="100" value="${st.to >= EconProfile.TOP ? 100 : st.to}" style="width:4.5rem" aria-label="Age to"></label>
        <label class="arc-d">Who <select id="eco-sex">${SEXES.map(s => `<option value="${s[0]}" ${s[0] === st.sex ? "selected" : ""}>${s[1]}</option>`).join("")}</select></label>
        <label class="arc-d">Compare with <select id="eco-cmp">${AREAS.filter(a => ["K02000001", "E92000001"].includes(a[0]) || a[1] === area).map(a => `<option value="${a[0]}" ${a[0] === st.cmp ? "selected" : ""}>${esc(a[1])}</option>`).join("")}</select></label>
        <button class="ghost" type="submit">Profile</button></form></div><div id="eco-result">${resultHtml()}</div>`);
    wire();
  }

  function wire() {
    host.querySelector("#eco-tabs").onclick = async e => { const b = e.target.closest("[data-et]"); if (!b) return; st.tab = b.dataset.et; if (st.tab === "system" && !fiscal && !fiscalError) { draw(); await loadFiscal(); } draw(); };
    if (st.tab === "system") {
      const kids = host.querySelector("#sys-kids"), loan = host.querySelector("#sys-loan");
      if (kids) { kids.onchange = () => { sys.children = +kids.value; sys.loan = loan.value; draw(); }; loan.onchange = () => { sys.loan = loan.value; sys.children = +kids.value; draw(); }; }
      const q = host.querySelector("#sys-q"); if (q) { q.oninput = () => { sys.q = q.value; host.querySelector("#sys-book").innerHTML = rulebookHtml(); }; host.querySelector("#sys-search").onsubmit = e => e.preventDefault(); }
      return;
    }
    const ask = host.querySelector("#eco-ask"), form = host.querySelector("#eco-form");
    if (!ask) return;
    ask.onsubmit = e => {
      e.preventDefault();
      const q = EconProfile.parseQuestion(host.querySelector("#eco-q").value);
      Object.assign(st, { area: q.area, from: q.from, to: q.to, sex: q.sex, cmp: "K02000001", said: q.said.length ? `I read this as: ${q.said.join(", ")}` : "I used the defaults: the UK, ages 16-64" });
      run();
    };
    form.onsubmit = e => {
      e.preventDefault();
      const a = +host.querySelector("#eco-from").value, b = +host.querySelector("#eco-to").value;
      Object.assign(st, { area: host.querySelector("#eco-area").value, from: Math.min(a, b), to: Math.max(a, b), sex: host.querySelector("#eco-sex").value, cmp: host.querySelector("#eco-cmp").value, said: "" });
      run();
    };
    host.querySelector("#eco-area").onchange = e => { st.area = e.target.value; st.from = +host.querySelector("#eco-from").value; st.to = +host.querySelector("#eco-to").value; st.sex = host.querySelector("#eco-sex").value; if (!["K02000001", "E92000001"].includes(st.cmp)) st.cmp = "K02000001"; draw(); };
  }

  function render(el) { host = el; draw(); }
  return { render };
})();
