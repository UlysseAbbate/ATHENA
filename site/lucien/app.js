/* LUCIEN (formerly Ulysse) front end. Data comes from Supabase tables readable only by the admin (and any role the admin opens LUCIEN to);
 * nothing here is a security boundary. */
const { sb, esc } = Athena;
const $ = id => document.getElementById(id);
const safeUrl = u => Athena.safeUrl(u) || "#";

const COLORS = { Con: "#2563eb", Lab: "#e11d48", Reform: "#0ea5e9", LD: "#f59e0b", Green: "#16a34a", SNP: "#a1a1aa" };
const SECTION = { committee: ["Select committee", "var(--c-committee)"], thinktank: ["Think tank", "var(--c-thinktank)"],
  media: ["Media", "var(--c-media)"], polling: ["Polling", "var(--c-polling)"] };
const NEW_HOURS = 48, PAGE = 150;
const TZ = "Europe/London";
const SAVED = "ulysse.view.v1";
const state = { tab: "all", items: [], polls: [], health: [], statscal: null, read: new Set(), shown: PAGE, pollRange: "all", hidden: new Set(),
  f: { q: "", area: "", geo: "", kind: "", source: "", house: "", range: "7", status: "", onlyNew: false, sinceLast: false } };

function saveView() { try { localStorage.setItem(SAVED, JSON.stringify({ tab: state.tab, f: state.f, pollRange: state.pollRange })); } catch (e) { /* private mode */ } }
function restoreView() {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED) || "null");
    if (!v) return;
    Object.assign(state.f, v.f || {}, { q: "" });
    if (v.tab) state.tab = v.tab;
    if (v.pollRange) state.pollRange = v.pollRange;
  } catch (e) { /* ignore */ }
}

/* ---------------------------------------------------------------- data */
async function load(name) {
  const { data, error } = await sb.from("ulysse_data").select("body").eq("name", name).maybeSingle();
  return error ? null : data?.body ?? null;
}
async function loadRead() {
  const ids = new Set(); let from = 0;
  for (;;) {
    const { data, error } = await sb.from("ulysse_read").select("item_id").range(from, from + 999);
    if (error || !data) break;
    data.forEach(r => ids.add(r.item_id));
    if (data.length < 1000) break;
    from += 1000;
  }
  return ids;
}
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }
async function setRead(ids, read) {
  ids.forEach(id => read ? state.read.add(id) : state.read.delete(id));
  render(true);
  const { error } = read
    ? await sb.from("ulysse_read").upsert(ids.map(item_id => ({ user_id: state.uid, item_id })), { onConflict: "user_id,item_id", ignoreDuplicates: true })
    : await sb.from("ulysse_read").delete().in("item_id", ids);
  if (error) { ids.forEach(id => read ? state.read.delete(id) : state.read.add(id)); render(true); toast("Couldn't save: " + error.message); }
}

/* ---------------------------------------------------------------- dates */
const dayKey = d => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ });
const fmtDate = d => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
const fmtDay = k => new Date(k + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const fmtShort = k => new Date(k + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
function ago(iso) {
  if (!iso) return "";
  const h = (Date.now() - new Date(iso)) / 36e5;
  if (h < 1) return "just now"; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = Math.floor(h / 24); return d === 1 ? "yesterday" : `${d}d ago`;
}
const when = i => new Date(i.published || i.first_seen);
function isNew(i) {
  // found through a sitemap and not yet dated: could be an old report, so not "new" until its date is known
  if (!i.published && (i.tags || []).includes("sitemap")) return false;
  const seen = (Date.now() - new Date(i.first_seen)) / 36e5 < NEW_HOURS;
  return seen && (!i.published || (Date.now() - new Date(i.published)) / 864e5 < 14);
}

/* ---------------------------------------------------------------- filtering (faceted: each dropdown's counts ignore its own filter) */
function rowsFor(skip = []) {
  const f = state.f, tab = state.tab, q = f.q.trim().toLowerCase();
  const days = +f.range;
  return state.items.filter(i => {
    if (tab !== "all" && i.category !== tab) return false;
    if (!skip.includes("range") && (Date.now() - when(i)) / 864e5 > days) return false;
    if (!skip.includes("area") && f.area && !(i.areas || []).includes(f.area)) return false;
    if (!skip.includes("geo") && f.geo && !(i.geo || []).includes(f.geo)) return false;
    if (!skip.includes("kind") && f.kind && i.kind !== f.kind) return false;
    if (!skip.includes("source") && f.source && i.source !== f.source) return false;
    if (!skip.includes("house") && f.house && !(i.tags || []).includes(f.house)) return false;
    if (!skip.includes("status") && f.status && (f.status === "read") !== state.read.has(i.id)) return false;
    if (!skip.includes("new") && f.onlyNew && !isNew(i)) return false;
    if (!skip.includes("new") && f.sinceLast && !(state.baseline && new Date(i.first_seen) > state.baseline)) return false;
    if (q && !(i.title + " " + i.source + " " + (i.summary || "") + " " + (i.areas || []).join(" ") + " " + (i.geo || []).join(" ")).toLowerCase().includes(q)) return false;
    return true;
  });
}
const tally = (rows, fn) => { const m = new Map(); rows.forEach(r => [].concat(fn(r) ?? []).forEach(v => v && m.set(v, (m.get(v) || 0) + 1))); return m; };

/* ---------------------------------------------------------------- controls */
const GEO_GROUPS = ["UK", "International"];
function fillSelect(id, label, counts, current, opts = {}) {
  const el = $(id);
  const entries = [...counts.entries()].sort((a, b) => opts.order ? opts.order(a[0], b[0]) : b[1] - a[1] || a[0].localeCompare(b[0]));
  let html = `<option value="">${esc(label)}</option>`;
  if (opts.groups) {
    for (const g of opts.groups) {
      const part = entries.filter(([k]) => opts.groupOf(k) === g);
      if (part.length) html += `<optgroup label="${esc(g === "UK" ? "United Kingdom" : g)}">` + part.map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join("") + "</optgroup>";
    }
  } else html += entries.map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join("");
  if (current && !counts.has(current)) html += `<option value="${esc(current)}">${esc(current)} (0)</option>`;
  el.innerHTML = html; el.value = current || "";
}
const GEO_META = {};
function renderControls() {
  const f = state.f;
  fillSelect("area", "All policy areas", tally(rowsFor(["area"]), r => r.areas), f.area);
  fillSelect("geo", "All geographies", tally(rowsFor(["geo"]), r => r.geo), f.geo,
    { groups: GEO_GROUPS, groupOf: k => GEO_META[k] || "UK", order: (a, b) => (a.startsWith("UK-wide") ? -1 : b.startsWith("UK-wide") ? 1 : 0) });
  fillSelect("kind", "All types", tally(rowsFor(["kind"]), r => r.kind), f.kind);
  fillSelect("source", "All sources", tally(rowsFor(["source"]), r => r.source), f.source, { order: (a, b) => a.localeCompare(b) });
  const hs = $("house"); hs.hidden = state.tab !== "committee";
  if (!hs.hidden) fillSelect("house", "Commons & Lords", tally(rowsFor(["house"]).filter(r => r.category === "committee"), r => (r.tags || []).filter(t => ["Commons", "Lords", "Joint"].includes(t))), f.house);
  $("range").value = f.range; $("status").value = f.status; $("onlyNew").checked = f.onlyNew; $("sinceLast").checked = f.sinceLast;
  $("sinceLastWrap").hidden = !state.baseline;
}

/* ---------------------------------------------------------------- overview */
function stat(n, label, extra = "") { return `<div class="stat"><b>${n}</b><span>${esc(label)}</span>${extra}</div>`; }
function renderOverview(rows) {
  const base = rowsFor(["range", "status"]);
  const unread = rows.filter(r => !state.read.has(r.id)).length;
  const fresh = rows.filter(isNew).length;
  const wk = base.filter(r => (Date.now() - when(r)) / 864e5 <= 7).length;
  const since = state.baseline ? rowsFor(["range", "status", "new"]).filter(r => new Date(r.first_seen) > state.baseline).length : null;
  $("stats").innerHTML = stat(rows.length, "items shown") + stat(unread, "unread") +
    (since != null ? stat(since, `new since your last visit (${Athena.ago(state.baseline.toISOString())})`) : stat(fresh, "new in 48 hours")) + stat(wk, "published this week");
  renderActivity();
  renderAreaBars();
}
function renderActivity() {
  const rows = rowsFor(["range", "status", "new"]).filter(r => r.published);
  const N = +state.f.range <= 7 ? 14 : 30;
  const days = []; for (let i = N - 1; i >= 0; i--) days.push(dayKey(Date.now() - i * 864e5));
  const idx = new Map(days.map((d, i) => [d, i]));
  const secs = ["committee", "thinktank", "media", "polling"];
  const data = days.map(() => ({ committee: 0, thinktank: 0, media: 0, polling: 0 }));
  rows.forEach(r => { const i = idx.get(dayKey(r.published)); if (i !== undefined) data[i][r.category]++; });
  const totals = data.map(d => secs.reduce((a, s) => a + d[s], 0)), max = Math.max(4, ...totals);
  const W = 520, H = 170, L = 24, B = 20, T = 8, bw = (W - L) / N, gap = Math.min(5, bw * .25);
  let out = "";
  [0, Math.round(max / 2), max].forEach(v => { const y = H - B - (v / max) * (H - B - T); out += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="currentColor" opacity=".08"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${v}</text>`; });
  days.forEach((d, i) => {
    let y = H - B; const x = L + i * bw + gap / 2, w = bw - gap;
    secs.forEach(s => { const h = (data[i][s] / max) * (H - B - T); if (h) { y -= h; out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${SECTION[s][1]}"/>`; } });
    if (i % Math.ceil(N / 7) === 0 && N - 1 - i >= 3 || i === N - 1) out += `<text x="${x + w / 2}" y="${H - 5}" text-anchor="middle">${esc(new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }))}</text>`;
    out += `<rect class="hit" data-i="${i}" x="${L + i * bw}" y="0" width="${bw}" height="${H - B}" fill="transparent"/>`;
  });
  const svg = $("activity"); svg.innerHTML = out;
  $("actnote").textContent = `last ${N} days, dated items only`;
  $("alegend").innerHTML = secs.filter(s => data.some(d => d[s])).map(s => `<span><i style="background:${SECTION[s][1]}"></i>${SECTION[s][0]}</span>`).join("");
  const tip = $("atip");
  svg.onpointermove = e => {
    const h = e.target.closest(".hit"); if (!h) { tip.hidden = true; return; }
    const i = +h.dataset.i, box = svg.getBoundingClientRect(), wrap = svg.parentElement.getBoundingClientRect();
    tip.innerHTML = `<b>${esc(fmtShort(days[i]))}</b><br>${totals[i]} item${totals[i] === 1 ? "" : "s"}` + secs.filter(s => data[i][s]).map(s => `<br>${SECTION[s][0]}: ${data[i][s]}`).join("");
    tip.style.left = (box.left - wrap.left + (L + (i + .5) * bw) / W * box.width) + "px"; tip.style.top = (box.top - wrap.top + 20) + "px"; tip.hidden = false;
  };
  svg.onpointerleave = () => tip.hidden = true;
}
function renderAreaBars() {
  const counts = [...tally(rowsFor(["area"]), r => r.areas).entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(1, ...counts.map(c => c[1]));
  $("areabars").innerHTML = counts.map(([k, n]) => `<button class="bar-row ${state.f.area === k ? "on" : ""}" data-area="${esc(k)}"><span class="lbl">${esc(k)}</span><span class="track"><span class="fill" style="width:${n / max * 100}%"></span></span><span class="n">${n}</span></button>`).join("") || '<span class="muted">No items.</span>';
}

/* ---------------------------------------------------------------- list */
function cardHtml(i) {
  const [lbl, col] = SECTION[i.category] || ["", "var(--muted)"], read = state.read.has(i.id);
  const pub = i.published
    ? `<span class="pub">Published <b>${esc(fmtDate(i.published))}</b> · ${esc(ago(i.published))}</span>`
    : `<span class="pub" title="The source page doesn't show a date">Date not shown · first seen ${esc(fmtDate(i.first_seen))}</span>`;
  return `<article class="card ${read ? "read" : ""}" style="--c:${col}">
    <button class="rd" data-read="${esc(i.id)}" aria-pressed="${read}" aria-label="${read ? "Mark as not read" : "Mark as read"}" title="${read ? "Read. Click to mark as not read" : "Mark as read"}">✓</button>
    <div><a class="title" href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener noreferrer" data-open="${esc(i.id)}">${esc(i.title)}</a>
      <div class="meta"><span class="src"><i></i>${esc(i.source)}</span>${pub}<span class="kind">${esc(i.kind || lbl)}</span></div>
      ${i.summary ? `<p class="summary">${esc(i.summary)}</p>` : ""}
      <div class="tags">${(i.areas || []).map(a => `<button class="tag" data-area="${esc(a)}">${esc(a)}</button>`).join("")}${(i.geo || []).map(g => `<button class="tag geo" data-geo="${esc(g)}">${esc(g)}</button>`).join("")}</div></div>
    ${isNew(i) ? '<span class="new">NEW</span>' : ""}</article>`;
}
function renderList(rows) {
  const sorted = rows.slice().sort((a, b) => when(b) - when(a));
  const dated = sorted.filter(r => r.published), undated = sorted.filter(r => !r.published);
  let html = "", last = "", n = 0;
  const shown = [];
  for (const r of dated) { if (n++ >= state.shown) break; shown.push(r); const k = dayKey(r.published); if (k !== last) { html += `<div class="day">${esc(fmtDay(k))}</div>`; last = k; } html += cardHtml(r); }
  if (undated.length && n < state.shown) {
    html += `<div class="day">Date not shown by the source</div>`;
    for (const r of undated) { if (n++ >= state.shown) break; shown.push(r); html += cardHtml(r); }
  }
  state.visible = shown.map(r => r.id);
  if (!rows.length) html = '<div class="empty">Nothing matches. Try widening the date range or clearing a filter.</div>';
  else if (rows.length > shown.length) html += `<button class="ghost more" id="more">Show ${Math.min(PAGE, rows.length - shown.length)} more (${rows.length - shown.length} hidden)</button>`;
  $("list").innerHTML = html;
  $("count").textContent = `${rows.length} item${rows.length === 1 ? "" : "s"}`;
  $("markall").hidden = !rows.some(r => !state.read.has(r.id));
}

/* ---------------------------------------------------------------- polling */
/* Which pollsters have published something specific lately (their own write-ups, MRPs, reports); click one to see its items. */
function renderPolls() {
  const lim = Date.now() - 90 * 864e5, by = new Map();
  state.items.filter(i => i.category === "polling" && i.published && new Date(i.published) >= lim).forEach(i => {
    const e = by.get(i.source) || { n: 0, last: "" }; e.n++; if (i.published > e.last) e.last = i.published; by.set(i.source, e);
  });
  const list = [...by.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last) || b[1].n - a[1].n);
  $("pollsters").innerHTML = `<div class="panel-head"><h2>Who has published lately</h2><span class="muted">${list.length} sources in the last 90 days · polls and reports from their own sites</span></div>` +
    (list.length ? `<div class="chips pollsters">${list.map(([k, v]) => `<button data-q="${esc(k)}" title="Show ${esc(k)} items">${esc(k)} <b>${v.n}</b> <small>${esc(fmtShort(v.last))}</small></button>`).join("")}</div>` : '<p class="muted">Nothing in the last 90 days.</p>');
}

/* ---------------------------------------------------------------- health */
function renderHealth() {
  const groups = {}; state.health.forEach(h => (groups[h.group] ||= []).push(h));
  const failing = state.health.filter(h => !h.ok).length, total = state.health.length;
  $("healthpanel").innerHTML = `<div class="stats">${stat(total - failing, "sources returning data")}${stat(failing, "not returning data")}${stat(total, "sources in total")}</div>` +
    Object.entries(groups).map(([g, rows]) => `<div class="panel hgroup"><div class="panel-head"><h2>${esc(g)}</h2><span class="muted">${rows.filter(r => r.ok).length} of ${rows.length} OK</span></div>` +
      rows.map(h => `<div class="hrow"><i class="st ${h.ok ? "ok" : "bad"}"></i><span>${esc(h.name)}${h.error ? `<small class="why">${esc(h.error)}</small>` : ""}</span><span class="n">${h.items} item${h.items === 1 ? "" : "s"}${h.method ? " · " + esc(h.method) : ""}${h.seconds != null ? ` · ${h.seconds}s` : ""}</span></div>`).join("") + "</div>").join("");
}

/* ---------------------------------------------------------------- render + events */
function render(keepControls) {
  const tab = state.tab, team = tab === "team", health = tab === "health", poll = tab === "polling", stats = tab === "statscal", arch = tab === "archive", eco = tab === "economy", other = health || team || stats || arch || eco;
  saveView();
  { const b = document.querySelector(`#tabs button[data-tab="${tab}"]`); $("pt").querySelector("h1").textContent = tab === "team" ? "Team & access" : (b ? b.textContent : "Everything"); }
  $("healthpanel").hidden = !health; $("teampanel").hidden = !team; $("list").hidden = other; $("controls").hidden = other; $("overview").hidden = other || poll;
  $("pollpanel").hidden = !poll; document.querySelector(".listhead").hidden = other; $("statspanel").hidden = !stats; $("archivepanel").hidden = !arch; $("economypanel").hidden = !eco;
  if (!stats && location.hash.startsWith("#stats")) { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* ignore */ } }
  if (!arch) delete $("archivepanel").dataset.on;
  if (!eco) delete $("economypanel").dataset.on;
  if (eco) { if (!$("economypanel").dataset.on) { $("economypanel").dataset.on = "1"; Economy.render($("economypanel")); } return; }   // drawn once per visit, like the archive
  if (arch) { if (!$("archivepanel").dataset.on) { $("archivepanel").dataset.on = "1"; Archive.render($("archivepanel"), cardHtml); } return; }   // drawn once per visit: a redraw would lose the page and search
  if (stats) return StatsCal.render($("statspanel"), state.statscal);
  if (team) return TeamPage.render($("teampanel"), { program: "lucien", name: "LUCIEN" });
  if (health) return renderHealth();
  if (!keepControls) renderControls();
  const rows = rowsFor();
  if (!poll) renderOverview(rows);
  else renderPolls();
  renderList(rows);
}
function bind() {
  $("tabs").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("on", x === b));
    state.tab = b.dataset.tab; Object.assign(state.f, { area: "", geo: "", kind: "", source: "", house: "" }); state.shown = PAGE; render();
  });
  let qt;
  $("q").addEventListener("input", e => { clearTimeout(qt); qt = setTimeout(() => { state.f.q = e.target.value; state.shown = PAGE; render(true); renderControls(); }, 120); });
  document.addEventListener("keydown", e => { if (e.key === "/" && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); $("q").focus(); } });
  [["area", "area"], ["geo", "geo"], ["kind", "kind"], ["source", "source"], ["house", "house"], ["range", "range"], ["status", "status"]].forEach(([id, k]) =>
    $(id).addEventListener("change", e => { state.f[k] = e.target.value; state.shown = PAGE; render(); }));
  $("onlyNew").addEventListener("change", e => { state.f.onlyNew = e.target.checked; state.shown = PAGE; render(); });
  $("sinceLast").addEventListener("change", e => { state.f.sinceLast = e.target.checked; state.shown = PAGE; render(); });
  $("reset").onclick = () => { Object.assign(state.f, { q: "", area: "", geo: "", kind: "", source: "", house: "", range: "7", status: "", onlyNew: false, sinceLast: false }); $("q").value = ""; state.shown = PAGE; render(); };
  $("markall").onclick = () => { const ids = rowsFor().filter(r => !state.read.has(r.id)).map(r => r.id); if (ids.length && confirm(`Mark ${ids.length} item${ids.length === 1 ? "" : "s"} as read?`)) setRead(ids, true); };
  document.body.addEventListener("click", e => {
    const rd = e.target.closest("[data-read]"); if (rd) return setRead([rd.dataset.read], !state.read.has(rd.dataset.read));
    const a = e.target.closest("[data-area]"); if (a) { state.f.area = state.f.area === a.dataset.area ? "" : a.dataset.area; state.shown = PAGE; return render(); }
    const g = e.target.closest("[data-geo]"); if (g) { state.f.geo = g.dataset.geo; state.shown = PAGE; return render(); }
    if (e.target.closest("#more")) { state.shown += PAGE; return render(true); }
    const pq = e.target.closest("[data-q]"); if (pq) { $("q").value = pq.dataset.q; state.f.q = pq.dataset.q; state.f.range = "30"; state.shown = PAGE; return render(); }
    const pr = e.target.closest("[data-pr]"); if (pr) { state.pollRange = pr.dataset.pr; return renderPolls(); }
    const pp = e.target.closest("[data-pp]"); if (pp) { const p = pp.dataset.pp; state.hidden.has(p) ? state.hidden.delete(p) : state.hidden.add(p); return renderPolls(); }
  });
}

function signIn() { AuthUI.render(sb, document.body, { title: "LUCIEN" }); }
(async function init() {
  AuthUI.watchRecovery(sb, document.body);
  let acc;
  try { acc = await Athena.access(); } catch (e) { document.body.textContent = e.message; return; }
  if (!acc) return signIn();
  if (!Athena.may(acc, "ulysse")) return Athena.notFound();
  state.uid = acc.session.user.id;
  // Team & access: the administrator's alone, as on LOVELACE and LIBBY
  if (acc.admin) Shell.footLink("team", "Team & access", () => { state.tab = "team"; document.querySelectorAll("#tabs button").forEach(x => x.classList.remove("on")); state.shown = PAGE; render(); window.scrollTo(0, 0); });
  const [feed, polls, health, read, statscal] = await Promise.all([load("feed"), load("polls"), load("health"), loadRead(), load("statscal")]);
  state.statscal = statscal;
  state.items = (feed?.items || []).filter(i => i.title); state.polls = polls?.rows || []; state.health = health?.sources || []; state.read = read;
  state.items.forEach(i => (i.geo || []).forEach(g => { if (/^(Europe|United States|Russia|Middle East|China|Africa|Global)/.test(g)) GEO_META[g] = "International"; }));
  const staleH = feed ? (Date.now() - new Date(feed.updated)) / 36e5 : Infinity;
  $("updated").textContent = feed ? `Updated ${Athena.ago(feed.updated)}` : "No data yet. Run the collector.";
  if (staleH > 15) $("updated").classList.add("stale");
  restoreView();
  if (state.tab === "team" && !acc.admin) state.tab = "all";
  // "since your last visit": the previous visit's time, kept for this whole browser session (reloads do not reset it)
  try {
    let base = sessionStorage.getItem("ulysse.baseline");
    if (base === null) { base = localStorage.getItem("ulysse.lastVisit") || ""; sessionStorage.setItem("ulysse.baseline", base); }
    state.baseline = base ? new Date(base) : null;
    localStorage.setItem("ulysse.lastVisit", new Date().toISOString());
  } catch (e) { state.baseline = null; }
  document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("on", x.dataset.tab === state.tab));
  if (StatsCal.fromHash()) state.tab = "statscal";   // a shared link to the Stats calendar opens it with its filters
  document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("on", x.dataset.tab === state.tab));
  bind(); StatsCal.bind(); render();
})();
