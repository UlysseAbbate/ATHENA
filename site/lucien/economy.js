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
      <p class="muted">The data profiles on the other tab are the first part: the statistics it will draw on.</p></div>`;
  }

  function draw() {
    const area = st.area, seg = (id, label) => `<button data-et="${id}" class="${st.tab === id ? "on" : ""}">${label}</button>`;
    host.innerHTML = `<div class="row"><div class="seg" id="eco-tabs">${seg("profiles", "Data profiles")}${seg("costings", "Costings")}</div></div>` + (st.tab === "costings" ? costingsHtml() : `
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
    host.querySelector("#eco-tabs").onclick = e => { const b = e.target.closest("[data-et]"); if (b) { st.tab = b.dataset.et; draw(); } };
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
