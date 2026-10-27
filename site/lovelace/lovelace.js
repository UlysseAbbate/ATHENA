/* Lovelace: London Organisation for Voters, Engagement, Liberalism, Action, Campaigns & Elections (formerly The Mall).
 * Static front end; all data and permissions live in Supabase (row-level security).
 * Nothing in this file is a security boundary: the server decides what each role can read or write. */
const { sb, esc, safeUrl } = Athena;
const $ = (s, el = document) => el.querySelector(s);
const main = $("#main");

const ROLES = { core_team: "Core team", executive: "Executive", local_party_chair: "Local party chair",
  candidate: "Candidate", support_team: "Support team", member: "Member" };
const RESOURCES = {
  plan_full: "Full campaign plan (all rows)", plan_shared: "Shared plan sections (campaigning and constituency activity)", plan_constituency: "Edit the Constituency Activity sections of the plan",
  visits: "Local party visit details and contacts (shown on the Campaign plan)", budget: "Budget & governance",
  volunteers_all: "Full volunteer list (People page)", volunteers_add: "Add volunteers (own entries visible to the adder)", policies: "Policies",
  social: "Tracked social accounts (Media page)", coverage: "Media page: news coverage and social posts",
  stakeholders_all: "Full stakeholder list (People page)", stakeholders_add: "Add stakeholders (own entries visible to the adder)",
  users: "Team & access: see users / change roles", permissions: "Edit this permissions table",
  audit: "Activity log (who changed what)", ulysse: "Lucien policy tracker (only the admin can change this row)" };

const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = s => { const d = parseISO(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const fmtDay = s => parseISO(s).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtShort = s => parseISO(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const gbp = n => "£" + Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const S = { user: null, profile: null, perm: {}, admin: false, tab: null, loadedAt: 0 };
const can = (res, act) => S.admin || !!(S.perm[res] && S.perm[res][act === "read" ? "r" : "w"]);
const CONFLICT = "Someone else changed this while you were editing (or you no longer have permission). The page has been refreshed: check it and try again.";

function notice(msg, kind = "err") { const n = document.createElement("div"); n.className = "notice " + kind; n.textContent = msg; return n; }
function showError(err) { main.prepend(notice(err.message || String(err))); window.scrollTo(0, 0); }

/* ------------------------------------------------------------------ auth */
function renderLogin() {
  $("#tabs").hidden = true; $("#who").textContent = "";
  AuthUI.render(sb, main, { title: "Lovelace" });
}

async function boot() {
  let acc;
  try { acc = await Athena.access(); } catch (e) { return showError(e); }
  if (!acc) return renderLogin();
  S.user = acc.session.user; S.profile = acc.profile; S.admin = !!acc.admin;
  S.perm = Object.fromEntries(Object.entries(acc.perms).map(([k, v]) => [k, { r: v.r, w: v.w }]));
  const prof = acc.profile;
  const expired = prof?.role && !acc.role;
  $("#who").innerHTML = `${esc(S.user.email)} · ${esc(acc.role ? ROLES[acc.role] : expired ? "access ended" : "no role yet")} <button class="btn sm" id="pw">Password</button> <button class="btn sm" id="so">Sign out</button>`;
  $("#so").onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $("#pw").onclick = () => { $("#tabs").hidden = true; AuthUI.changePassword(sb, main); };
  if (!acc.role && !S.admin) {
    $("#tabs").hidden = true;
    main.innerHTML = `<div class="login"><div class="card"><h2 style="margin-top:0">${expired ? "Your access has ended" : "Waiting for access"}</h2>
      <p>You're signed in as <b>${esc(S.user.email)}</b>. ${expired ? `Your access ran until ${esc(fmtDay(prof.access_until))}. Ask the core team to extend it, then refresh this page.`
        : "A core team member hasn't given you a role yet. Ask them to assign you one, then refresh this page."}</p></div></div>`;
    return;
  }
  if (prof?.access_until) $("#who").insertAdjacentHTML("beforeend", ` <span class="pill">access until ${esc(fmtShort(prof.access_until))}</span>`);
  buildTabs();
  // other people edit at the same time: refresh the open page when you come back to it (unless a form is open)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && S.tab && !document.querySelector("dialog[open]") && Date.now() - S.loadedAt > 60e3 &&
        ![...document.querySelectorAll("[data-q]")].some(i => i.value)) go(S.tab, true);
  });
}

const TABS = [
  ["today", "Overview", () => true, renderToday],
  ["plan", "Campaign plan", () => can("plan_full", "read") || can("plan_shared", "read"), renderPlan],
  ["budget", "Budget & governance", () => can("budget", "read"), renderBudget],
  ["people", "Volunteers & stakeholders", () => can("volunteers_all", "read") || can("stakeholders_all", "read") || can("volunteers_add", "write") || can("stakeholders_add", "write"), renderPeople],
  ["policies", "Policies", () => can("policies", "read"), () => crud(POLICIES)],
  ["media", "Media", () => can("coverage", "read") || can("social", "read"), renderMedia],
  ["team", "Team & access", () => can("users", "read"), renderTeam]
];
// old addresses (bookmarks) of the pages that were merged
const ALIAS = { visits: "plan", social: "media", coverage: "media", volunteers: "people", stakeholders: "people" };
function buildTabs() {
  const vis = TABS.filter(t => t[3] && t[2]());
  const nav = $("#tabs"); nav.hidden = false;
  nav.innerHTML = vis.map(t => `<button data-t="${t[0]}">${esc(t[1])}</button>`).join("");
  nav.onclick = e => { const b = e.target.closest("button"); if (b) go(b.dataset.t); };
  const hash = ALIAS[location.hash.slice(1)] || location.hash.slice(1);
  go(vis.some(t => t[0] === hash) ? hash : S.tab && vis.some(t => t[0] === S.tab) ? S.tab : vis[0]?.[0]);
}
async function go(id, quiet) {
  S.tab = id; S.loadedAt = Date.now();
  if (location.hash.slice(1) !== id) history.replaceState(null, "", "#" + id);
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.t === id));
  main.onclick = main.onchange = null;   // handlers belong to the page being left
  if (!quiet) main.innerHTML = '<p class="muted">Loading…</p>';
  const t = TABS.find(x => x[0] === id);
  if (t) { try { await t[3](); } catch (e) { showError(e); } }
}

/* ------------------------------------------------------------------ dialog form */
function openForm({ title, fields, values = {}, submitLabel = "Save", onSubmit, onDelete, meta = "" }) {
  const dlg = document.createElement("dialog");
  dlg.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>${fields.map(f => {
    const v = values[f.k] ?? "", id = "f_" + f.k, req = f.req ? "required" : "";
    let input;
    if (f.type === "textarea") input = `<textarea id="${id}" ${req}>${esc(v)}</textarea>`;
    else if (f.type === "select") input = `<select id="${id}" ${req}><option value=""></option>${(typeof f.options === "function" ? f.options() : f.options).map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(v) === String(ov) ? "selected" : ""}>${esc(ol)}</option>`; }).join("")}</select>`;
    else if (f.type === "bool") input = `<select id="${id}"><option value=""></option><option value="true" ${v === true ? "selected" : ""}>Yes</option><option value="false" ${v === false ? "selected" : ""}>No</option></select>`;
    else input = `<input id="${id}" type="${f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}" ${f.type === "number" ? 'step="0.01"' : ""} value="${esc(f.type === "date" ? String(v).slice(0, 10) : v)}" ${req} ${f.list ? `list="dl_${f.k}"` : ""}>` + (f.list ? `<datalist id="dl_${f.k}">${f.list.map(o => `<option value="${esc(o)}">`).join("")}</datalist>` : "");
    return `<label for="${id}">${esc(f.label)}${f.req ? " *" : ""}</label>${input}`;
  }).join("")}<div class="row"><button class="btn primary" value="ok">${esc(submitLabel)}</button>
    <button class="btn" type="button" id="cx">Cancel</button>${onDelete ? '<button class="btn danger" type="button" id="del" style="margin-left:auto">Delete</button>' : ""}</div><div id="fe"></div>${meta ? `<p class="muted" style="margin:8px 0 0">${esc(meta)}</p>` : ""}</form>`;
  document.body.append(dlg); dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); };
  $("#cx", dlg).onclick = close; dlg.addEventListener("cancel", () => dlg.remove());
  dlg.addEventListener("close", () => dlg.remove());
  $("form", dlg).onsubmit = async e => {
    e.preventDefault();
    const out = {};
    for (const f of fields) {
      const raw = $("#f_" + f.k, dlg).value.trim();
      out[f.k] = raw === "" ? null : f.type === "number" ? Number(raw) : f.type === "bool" ? raw === "true" : raw;
    }
    const btn = $("button[value=ok]", dlg); btn.disabled = true;
    const err = await onSubmit(out);
    btn.disabled = false;
    if (err) $("#fe", dlg).replaceChildren(notice(err.message || String(err))); else close();
  };
  if (onDelete) $("#del", dlg).onclick = async () => {
    if (!confirm("Delete this entry?")) return;
    const err = await onDelete(); if (err) $("#fe", dlg).replaceChildren(notice(err.message)); else close();
  };
}

/* ------------------------------------------------------------------ generic list / add / edit */
function cellHtml(f, v) {
  if (v === null || v === undefined || v === "") return '<span class="muted">—</span>';
  if (f.type === "bool") return v ? "Yes" : "No";
  if (f.type === "number") return esc(gbp(v));
  if (f.type === "date") return esc(fmtShort(v));
  if (f.type === "url") { const u = safeUrl(v); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">link</a>` : esc(v); }
  return esc(v);
}
// cfg: {table, title, fields, order:[col,asc], canEdit(), canAdd(), owned, ownEdit, note, footer, beforeTable}
const sortState = {}, filterState = {};
function csvDownload(name, cols, rows) {
  const cell = v => { const t = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const text = [cols.map(c => cell(c.label)), ...rows.map(r => cols.map(c => cell(c.csv ? c.csv(r) : r[c.k])))].map(l => l.join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" }));
  a.download = `${name}-${iso(new Date())}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Save an edit only if nobody else changed the row since it was loaded (updated_at is set by the database on every edit).
async function guardedUpdate(table, row, vals) {
  let q = sb.from(table).update(vals).eq("id", row.id);
  if (row.updated_at) q = q.eq("updated_at", row.updated_at);
  const { data, error } = await q.select("id");
  if (error) return error;
  return data.length ? null : new Error(CONFLICT);
}
const edited = r => r?.updated_at ? `Last edited ${Athena.ago(r.updated_at)}` : "";
async function crud(cfg, host = main, after) {
  const canAdd = cfg.canAdd ? cfg.canAdd() : cfg.canEdit();
  const canEdit = cfg.canEdit();
  const reload = after || (() => crud(cfg, host, after));
  host.innerHTML = `${cfg.title ? `<h2>${esc(cfg.title)}</h2>` : ""}${cfg.note ? `<p class="muted">${esc(cfg.note)}</p>` : ""}
    <div class="row"><input class="grow" type="search" placeholder="Search…" data-q>${canAdd ? '<button class="btn primary" data-add>+ Add</button>' : ""}<button class="btn" data-csv title="Download what is shown as a spreadsheet">CSV</button></div>
    ${cfg.filters ? `<div class="row"><div class="seg">${cfg.filters.map((f, i) => `<button data-fl="${i}">${esc(f.label)}</button>`).join("")}</div></div>` : ""}
    ${cfg.beforeTable ? cfg.beforeTable : ""}<div class="tablewrap"><table></table></div><div data-foot></div>`;
  const { data, error } = await sb.from(cfg.table).select(cfg.select || "*").order(cfg.order[0], { ascending: cfg.order[1] });
  if (error) return showError(error);
  const cols = cfg.fields.filter(f => !f.hidden);
  const srt = sortState[cfg.table] ||= { k: null, asc: true };
  const fst = filterState[cfg.table] ||= { i: 0 };
  let shown = data;
  const draw = () => {
    const q = $("[data-q]", host).value.toLowerCase();
    host.querySelectorAll("[data-fl]").forEach(b => b.classList.toggle("on", +b.dataset.fl === fst.i));
    shown = data.filter(r => (!cfg.filters || cfg.filters[fst.i].test(r)) && (!q || JSON.stringify(Object.values(r)).toLowerCase().includes(q)));
    if (srt.k) {
      const f = cfg.fields.find(x => x.k === srt.k), num = f?.type === "number";
      shown = shown.slice().sort((a, b) => {
        const x = a[srt.k], y = b[srt.k];
        if (x == null || x === "") return 1; if (y == null || y === "") return -1;
        const c = num ? x - y : String(x).localeCompare(String(y), "en-GB", { numeric: true, sensitivity: "base" });
        return srt.asc ? c : -c;
      });
    }
    const editable = r => cfg.canEditRow ? cfg.canEditRow(r) : canEdit || (cfg.ownEdit && r.created_by === S.user.id);
    $("table", host).innerHTML = `<thead><tr>${cols.map(f => `<th><button class="sort" data-sort="${f.k}" aria-sort="${srt.k === f.k ? (srt.asc ? "ascending" : "descending") : "none"}">${esc(f.label)}${srt.k === f.k ? (srt.asc ? " ▲" : " ▼") : ""}</button></th>`).join("")}${shown.some(editable) ? "<th></th>" : ""}</tr></thead><tbody>` +
      (shown.map(r => `<tr>${cols.map(f => `<td class="${f.type === "textarea" ? "wrapcell" : ""}">${f.render ? f.render(r) : cellHtml(f, r[f.k])}</td>`).join("")}${editable(r) ? `<td><button class="btn sm" data-edit="${r.id}">Edit</button></td>` : ""}</tr>`).join("") ||
        `<tr><td colspan="${cols.length + 1}" class="muted">${data.length ? "Nothing matches the search." : "Nothing here yet."}</td></tr>`) + "</tbody>";
    $("[data-foot]", host).innerHTML = cfg.footer ? cfg.footer(shown) : `<p class="muted">${shown.length} of ${data.length} row${data.length === 1 ? "" : "s"}</p>`;
  };
  const form = (row) => {
    const fields = cfg.fields.filter(f => !f.noForm);
    openForm({
      title: row ? "Edit" : "Add", fields, values: row || {}, meta: edited(row),
      onSubmit: async vals => {
        if (cfg.owned && !row) vals.created_by = S.user.id;
        if (cfg.transform) cfg.transform(vals);
        const e = row ? await guardedUpdate(cfg.table, row, vals) : (await sb.from(cfg.table).insert(vals)).error;
        if (!e || e.message === CONFLICT) reload();
        return e;
      },
      onDelete: row ? async () => { const { error: e } = await sb.from(cfg.table).delete().eq("id", row.id); if (!e) reload(); return e; } : null
    });
  };
  draw();
  $("[data-q]", host).oninput = draw;
  const add = $("[data-add]", host); if (add) add.onclick = () => form(null);
  $("[data-csv]", host).onclick = () => csvDownload(cfg.table, cfg.fields, window.TableTools ? TableTools.visibleOnly($("table", host), shown) : shown);   // (a column filter on the table narrows the download too)
  host.onclick = e => {
    const b = e.target.closest("[data-edit]"); if (b) return form(data.find(r => r.id === b.dataset.edit));
    const fl = e.target.closest("[data-fl]"); if (fl) { fst.i = +fl.dataset.fl; return draw(); }
    const so = e.target.closest("[data-sort]");
    if (so) { srt.asc = srt.k === so.dataset.sort ? !srt.asc : true; srt.k = so.dataset.sort; draw(); }
  };
}

/* ------------------------------------------------------------------ plan */
const planState = { mode: "day", date: iso(new Date()) };
async function renderPlan() {
  const { mode, date } = planState;
  const start = mode === "day" ? date : mondayOf(date), end = mode === "day" ? date : addDays(start, 6);
  const canVisits = can("visits", "read");
  const [cats, ents, vis, allVis] = await Promise.all([
    sb.from("plan_categories").select("*").order("sort"),
    sb.from("plan_entries").select("*").gte("plan_date", start).lte("plan_date", end).order("updated_at"),
    canVisits ? sb.from("local_party_visits").select("*").gte("visit_date", start).lte("visit_date", end).order("visit_date") : Promise.resolve({ data: [] }),
    canVisits ? sb.from("local_party_visits").select("id,visit_date") : Promise.resolve({ data: [] })
  ]);
  if (cats.error || ents.error || vis.error || allVis.error) return showError(cats.error || ents.error || vis.error || allVis.error);
  // visit details (who asked, contact, who is actioning) sit under the plan's Campaigning section on the visit's date
  const vcat = cats.data.find(c => c.name.startsWith("Campaigning"));
  const partyKey = v => String(v.local_party || "").toLowerCase().replace(/ and /g, " ").split(/\s+/)[0];
  const visitDetail = v => [v.request, v.contact_name && `contact ${v.contact_name}${v.contact_phone ? " " + v.contact_phone : ""}`, v.taken_by && `taken by ${v.taken_by}`,
    v.actioning && `actioning ${v.actioning}`, v.notes].filter(Boolean).join(" · ");
  const visitsOn = d => vis.data.filter(v => v.visit_date === d);
  const matched = (v, entries) => entries.some(e => e.content.toLowerCase().includes(partyKey(v)));
  const canCat = c => can("plan_full", "write") || (can("plan_shared", "write") && c.shared) || (c.constituency && can("plan_constituency", "write"));
  const today = iso(new Date());
  main.innerHTML = `<div class="row"><div class="seg"><button data-m="day" class="${mode === "day" ? "on" : ""}">Day</button><button data-m="week" class="${mode === "week" ? "on" : ""}">Week</button></div>
    <button class="btn" data-n="-1">◀</button><button class="btn" data-n="0">Today</button><button class="btn" data-n="1">▶</button>
    <input type="date" value="${esc(date)}" style="width:auto" data-d><b>${esc(mode === "day" ? fmtDay(date) : `${fmtShort(start)} – ${fmtShort(end)}`)}</b></div><div id="pv"></div>`;
  main.onclick = null;
  const move = n => { planState.date = addDays(date, n * (mode === "day" ? 1 : 7)); renderPlan(); };
  main.querySelectorAll("[data-n]").forEach(b => b.onclick = () => b.dataset.n === "0" ? (planState.date = iso(new Date()), renderPlan()) : move(+b.dataset.n));
  main.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { planState.mode = b.dataset.m; renderPlan(); });
  $("[data-d]").onchange = e => { if (e.target.value) { planState.date = e.target.value; renderPlan(); } };
  const byKey = {}; ents.data.forEach(e => (byKey[e.category_id + "|" + e.plan_date] ||= []).push(e));
  const edit = (entry, cat, d) => openForm({
    title: `${cat.name}: ${fmtShort(entry?.plan_date || d)}`, fields: [{ k: "content", label: "Entry", type: "textarea", req: true }, { k: "plan_date", label: "Date", type: "date", req: true }],
    values: entry || { plan_date: d },
    meta: edited(entry),
    onSubmit: async v => { const error = entry ? await guardedUpdate("plan_entries", entry, v)
      : (await sb.from("plan_entries").insert({ ...v, category_id: cat.id })).error; if (!error || error.message === CONFLICT) renderPlan(); return error; },
    onDelete: entry ? async () => { const { error } = await sb.from("plan_entries").delete().eq("id", entry.id); if (!error) renderPlan(); return error; } : null
  });
  const pv = $("#pv");
  if (!cats.data.length) { pv.append(notice("No plan rows are available to your role.", "ok")); return; }
  if (canVisits) {
    const undated = allVis.data.filter(v => !v.visit_date).length;
    main.insertAdjacentHTML("beforeend", `<details class="card" id="vreq" style="margin-top:18px"><summary><b>Local party visit requests</b> <span class="muted">· ${allVis.data.length} on the sheet${undated ? `, ${undated} without a date yet` : ""}</span></summary><div id="vreqb"></div></details>`);
    $("#vreq").ontoggle = e => { if (e.target.open && !$("#vreqb").dataset.on) { $("#vreqb").dataset.on = 1; crud(VISITS, $("#vreqb"), renderPlan); } };
  }
  if (mode === "day") {
    const section = c => {
      const list = byKey[c.id + "|" + date] || [];
      const isV = vcat && c.id === vcat.id, vday = isV ? visitsOn(date) : [];
      const vline = (v, own) => `<div class="${own ? "entry" : "ovline muted"}"><span>${own ? "" : "↳ "}<b>${esc(v.local_party)}</b>${visitDetail(v) ? ": " + esc(visitDetail(v)) : ""}</span>${can("visits", "write") ? `<span class="acts"><button class="btn sm" data-v="${v.id}">Edit visit</button></span>` : ""}</div>`;
      const body = isV ? list.map(e => `<div class="entry"><span>${esc(e.content)}</span>${canCat(c) ? `<span class="acts"><button class="btn sm" data-e="${e.id}">Edit</button></span>` : ""}</div>` +
          vday.filter(v => e.content.toLowerCase().includes(partyKey(v))).map(v => vline(v, false)).join("")).join("") + vday.filter(v => !matched(v, list)).map(v => vline(v, true)).join("") : null;
      return `<div class="sec ${c.shared ? "shared" : ""}"><h3>${esc(c.name.replace(/^Constituency Activity: /, ""))} ${c.shared && !c.constituency && can("plan_full", "read") ? '<span class="pill">visible to all roles</span>' : ""} ${canCat(c) ? `<button class="btn sm" data-add="${c.id}">+ Add</button>` : ""}</h3>
        ${(isV ? body : list.map(e => `<div class="entry"><span>${esc(e.content)}</span>${canCat(c) ? `<span class="acts"><button class="btn sm" data-e="${e.id}">Edit</button></span>` : ""}</div>`).join("")) || '<span class="muted">Nothing planned.</span>'}</div>`;
    };
    // the constituency sections sit together under one heading, open when any of them has something on this day
    const first = cats.data.findIndex(c => c.constituency), cons = cats.data.filter(c => c.constituency);
    pv.innerHTML = cats.data.map((c, i) => !c.constituency ? section(c) : i !== first ? "" :
      `<details class="card cons" ${cons.some(k => (byKey[k.id + "|" + date] || []).length) ? "open" : ""}><summary><b>Constituency Activity</b> <span class="muted">· ${cons.length} sections, one per GLA constituency</span></summary>${cons.map(section).join("")}</details>`).join("");
    pv.onclick = e => {
      const a = e.target.closest("[data-add]"), x = e.target.closest("[data-e]"), vb = e.target.closest("[data-v]");
      if (vb) return visitForm(vis.data.find(v => v.id === vb.dataset.v));
      if (a) edit(null, cats.data.find(c => c.id == a.dataset.add), date);
      if (x) { const en = ents.data.find(z => z.id === x.dataset.e); edit(en, cats.data.find(c => c.id === en.category_id), date); }
    };
  } else {
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    pv.innerHTML = `<div class="tablewrap"><table class="grid"><tr><th>Row</th>${days.map(d => `<th class="${d === today ? "today" : ""}"><a href="#" data-day="${d}">${esc(fmtShort(d))}</a></th>`).join("")}</tr>` +
      cats.data.map(c => `<tr><td>${esc(c.name)}</td>${days.map(d => { const list = byKey[c.id + "|" + d] || [], extra = vcat && c.id === vcat.id ? visitsOn(d).filter(v => !matched(v, list)).map(v => `${v.local_party}${v.request ? ": " + v.request : ""}`) : [];
        return `<td class="${d === today ? "today" : ""}">${[...list.map(e => esc(e.content)), ...extra.map(esc)].join("\n\n")}</td>`; }).join("")}</tr>`).join("") + "</table></div>";
    pv.onclick = e => { const a = e.target.closest("[data-day]"); if (a) { e.preventDefault(); planState.mode = "day"; planState.date = a.dataset.day; renderPlan(); } };
  }
}

/* ------------------------------------------------------------------ entity configs */
const T = (k, label, type = "text", extra = {}) => ({ k, label, type, ...extra });
function visitForm(row) {
  openForm({ title: `Visit: ${row.local_party}`, fields: VISITS.fields.filter(f => !f.noForm), values: row, meta: edited(row),
    onSubmit: async v => { const e = await guardedUpdate("local_party_visits", row, v); if (!e || e.message === CONFLICT) renderPlan(); return e; },
    onDelete: async () => { const { error: e } = await sb.from("local_party_visits").delete().eq("id", row.id); if (!e) renderPlan(); return e; } });
}
const VISITS = { table: "local_party_visits", title: "", order: ["visit_date", true], canEdit: () => can("visits", "write"),
  note: "Requests from local parties and who is handling them. A visit with a date shows its details on the plan for that day, under Campaigning (add a line there too, so everyone who sees the plan sees the visit). Contains contact details.",
  fields: [T("local_party", "Local party", "text", { req: true }), T("request", "Request"), T("taken_by", "Who took it"), T("actioning", "Who actioning"),
    T("happening", "When happening"), T("visit_date", "Date (if fixed)", "date"), T("contact_name", "Contact"), T("contact_phone", "Number"), T("notes", "Notes", "textarea")] };
const POLICIES = { table: "policies", title: "Policies", order: ["theme", true], canEdit: () => can("policies", "write"),
  fields: [T("policy", "Policy", "text", { req: true }), T("theme", "Theme"), T("briefing", "Briefing"), T("actions", "Actions", "textarea"),
    T("interested_parties", "Interested parties", "textarea"), T("comms", "Comms", "textarea"), T("notes", "Notes", "textarea")] };
const PLATFORMS = ["Instagram", "Facebook", "Twitter", "BlueSky", "Substack", "TikTok", "LinkedIn"];
const isSocial = r => r.source === "social" || PLATFORMS.some(p => p.toLowerCase() === String(r.outlet).toLowerCase()) || /^(X|Twitter)\b/i.test(r.outlet);
const MEDIA = { table: "media_coverage", title: "", order: ["covered_on", false], canEdit: () => can("coverage", "write"),
  note: "Sarah Olney in the news (any article that mentions her, found at 6am and 6pm) and what our tracked social accounts post. For a social post the outlet is the platform and the headline is the start of the caption.",
  filters: [{ label: "All", test: () => true }, { label: "News", test: r => !isSocial(r) }, { label: "Social media", test: isSocial }],
  fields: [T("covered_on", "Date", "date", { req: true }), T("outlet", "Outlet / platform", "text", { req: true, list: [...PLATFORMS, "BBC News", "The Guardian", "Evening Standard", "MyLondon"] }),
    T("headline", "Headline / first line of the caption", "text", { req: true, render: r => {
      const u = safeUrl(r.url); return (u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(r.headline)}</a>` : esc(r.headline)) +
        (r.source === "auto" ? ' <span class="pill" title="Found automatically in the outlet\'s news feed or pages">auto</span>' : r.source === "social" ? ' <span class="pill" title="Found automatically on the account">auto</span>' : ""); } }),
    T("url", "URL", "url", { hidden: true }), T("notes", "Notes", "textarea")] };
const BUDGET = { table: "budget_items", title: "Budget", order: ["created_at", true], canEdit: () => can("budget", "write"),
  fields: [T("item", "Item", "text", { req: true }), T("amount", "Amount (£)", "number"), T("category", "Category"), T("notes", "Notes", "textarea")],
  footer: rows => `<div class="total">Total: ${esc(gbp(rows.reduce((s, r) => s + Number(r.amount || 0), 0)))}</div>` };
const GOVERNANCE = { table: "governance_items", title: "Governance (legal, compliance, finance controls)", order: ["due_date", true], canEdit: () => can("budget", "write"),
  fields: [T("title", "Item", "text", { req: true }), T("area", "Area", "select", { options: ["Legal", "Finance", "Compliance", "Data protection", "Other"] }),
    T("status", "Status", "select", { options: ["To do", "In progress", "Done"] }), T("owner", "Owner"), T("due_date", "Due", "date"), T("notes", "Notes", "textarea")] };

/* ------------------------------------------------------------------ budget & governance */
async function renderBudget() {
  main.innerHTML = '<div id="b1"></div><div id="b2"></div>';
  await crud(BUDGET, $("#b1"), renderBudget); await crud(GOVERNANCE, $("#b2"), renderBudget);
}

/* ------------------------------------------------------------------ volunteers & stakeholders: one list */
const SECTORS = ["Lib Dems", "Media", "Think tank", "Campaign", "Donor", "Elected official", "Local party", "Business", "Union / membership body", "Community group", "Other"];
const KIND = { volunteer: "Volunteer", stakeholder: "Stakeholder" };
const mayAdd = k => can(k === "volunteer" ? "volunteers_add" : "stakeholders_add", "write");
const mayEditAll = k => can(k === "volunteer" ? "volunteers_all" : "stakeholders_all", "write");
async function renderPeople() {
  const seeAll = can("volunteers_all", "read") || can("stakeholders_all", "read");
  await crud({ table: "contacts", title: "Volunteers & stakeholders", owned: true, order: ["name", true],
    canEdit: () => can("volunteers_all", "write") || can("stakeholders_all", "write"), canAdd: () => mayAdd("volunteer") || mayAdd("stakeholder"),
    canEditRow: r => r.created_by === S.user.id || mayEditAll(r.kind),
    note: seeAll ? "One list for everyone we work with. Volunteers are filed under Lib Dems. The point of contact is the person on our side who owns the relationship. Anyone can add; you can always see and edit your own entries."
      : "Add a volunteer or stakeholder. You can only see entries you added.",
    filters: [{ label: "Everyone", test: () => true }, { label: "Volunteers", test: r => r.kind === "volunteer" }, { label: "Stakeholders", test: r => r.kind === "stakeholder" }],
    transform: v => { if (v.kind === "volunteer") { v.organisation ||= "Lib Dems"; v.sector ||= "Lib Dems"; } },
    fields: [T("name", "Full name", "text", { req: true }), T("organisation", "Organisation"), T("sector", "Sector", "text", { list: SECTORS }), T("email", "Email"), T("phone", "Phone"),
      T("owner", "Point of contact"), T("notes", "Notes", "textarea"),
      T("kind", "Type", "select", { req: true, hidden: true, options: () => Object.entries(KIND).filter(([k]) => mayAdd(k)) })] });
}

/* ------------------------------------------------------------------ media: news coverage and social posts, plus the tracked accounts */
async function renderMedia() {
  main.innerHTML = `<div id="m1"></div>${can("social", "read") ? '<details class="card" id="m2" style="margin-top:18px"><summary><b>Tracked social accounts</b> <span class="muted">· London Lib Dems, London Young Liberals, Sarah Olney MP, Hina Bokhari AM, City Hall Lib Dems</span></summary><div id="m2b"></div></details>' : ""}`;
  await crud(MEDIA, $("#m1"), renderMedia);
  if (!can("social", "read")) return;
  const open = (id, fn) => { const d = $(id); d.ontoggle = () => { if (d.open && !d.dataset.on) { d.dataset.on = 1; fn(); } }; };
  open("#m2", () => renderAccounts($("#m2b")));
}
async function renderAccounts(host) {
  const w = can("social", "write");
  const { data: accts, error } = await sb.from("social_accounts").select("*").order("organisation");
  if (error) return showError(error);
  const orgs = [...new Set(accts.map(a => a.organisation))];
  host.innerHTML = `<p class="muted">What we follow. <b>BlueSky</b> and <b>Substack</b> accounts are read automatically at 6am and 6pm: put the handle in (for BlueSky, the full handle such as <code>name.bsky.social</code>).
    The other platforms do not allow automated reading without their approved access, so add their posts to the table above by hand. ${w ? "Click a cell to set its handle and link." : ""}</p>
    ${w ? '<div class="row"><button class="btn primary" data-org>+ Add organisation</button></div>' : ""}
    <div class="tablewrap"><table class="grid"><tr><th>Account</th>${PLATFORMS.map(p => `<th>${p}</th>`).join("")}</tr>` +
    orgs.map(o => `<tr><td>${esc(o)}</td>${PLATFORMS.map(p => { const a = accts.find(x => x.organisation === o && x.platform === p);
      const u = a && safeUrl(a.url); const label = a?.handle ? esc(a.handle) : '<span class="muted">—</span>';
      return `<td>${a ? (w ? `<a href="#" data-a="${a.id}">${label}</a>` : label) : ""}${u ? ` <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">↗</a>` : ""}</td>`; }).join("")}</tr>`).join("") + "</table></div>";
  host.onclick = e => {
    const c = e.target.closest("[data-a]"), o = e.target.closest("[data-org]");
    if (c) { e.preventDefault(); const a = accts.find(x => x.id === c.dataset.a);
      openForm({ title: `${a.organisation} · ${a.platform}`, fields: [T("handle", "Handle"), T("url", "Profile URL", "url"), T("notes", "Notes", "textarea")], values: a,
        meta: edited(a), onSubmit: async v => { const er = await guardedUpdate("social_accounts", a, v); if (!er || er.message === CONFLICT) renderAccounts(host); return er; } }); }
    if (o) openForm({ title: "Add organisation", fields: [T("organisation", "Organisation or account owner", "text", { req: true })],
      onSubmit: async v => { const { error: er } = await sb.from("social_accounts").insert(PLATFORMS.map(p => ({ organisation: v.organisation, platform: p }))); if (!er) renderAccounts(host); return er; } });
  };
}

/* ------------------------------------------------------------------ team & access */
const TABLE_LABEL = { plan_entries: "Plan", plan_categories: "Plan rows", local_party_visits: "Visits", budget_items: "Budget", governance_items: "Governance",
  policies: "Policies", social_accounts: "Social accounts", social_posts: "Social outputs", content_items: "Content", media_coverage: "Coverage",
  volunteers: "Volunteers", stakeholders: "Stakeholders", contacts: "Volunteers & stakeholders", profiles: "People", role_permissions: "Permissions" };
const READ_ONLY = new Set(["audit", "ulysse"]);   // only "can see" means anything for these
async function renderTeam() {
  const [{ data: profs, error }, { data: perms, error: pe }, seen, log] = await Promise.all([
    sb.from("profiles").select("*").order("created_at"), sb.from("role_permissions").select("*"), sb.rpc("team_last_seen"),
    can("audit", "read") ? sb.from("audit_log").select("*").order("at", { ascending: false }).limit(60) : Promise.resolve({ data: null })]);
  if (error || pe) return showError(error || pe);
  const last = Object.fromEntries((seen.data || []).map(r => [r.id, r.last_sign_in_at]));
  const canRole = can("users", "write"), canPerm = can("permissions", "write");
  const today = iso(new Date());
  const pending = profs.filter(p => !p.role).length;
  const ended = p => p.access_until && p.access_until < today;
  main.innerHTML = `<h2>People ${pending ? `<span class="pill" style="color:var(--red)">${pending} awaiting a role</span>` : ""}</h2>
    <p class="muted">Give each person a role. "Access until" is optional: after that date they see nothing until it is extended. You cannot change your own role.</p>
    <div class="tablewrap"><table><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Access until</th><th>Last signed in</th></tr></thead><tbody>${profs.map(p => {
      const self = p.id === S.user.id, lock = !canRole || self;
      return `<tr class="${ended(p) ? "ended" : ""}"><td>${esc(p.email)}</td><td>${esc(p.full_name)}</td><td>${!lock ?
        `<select data-u="${p.id}"><option value="">(no access)</option>${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${p.role === k ? "selected" : ""}>${l}</option>`).join("")}</select>` : esc(ROLES[p.role] || "none")}</td>
        <td>${!lock ? `<input type="date" data-until="${p.id}" value="${esc(p.access_until || "")}" style="width:auto">` : esc(p.access_until ? fmtShort(p.access_until) : "no end date")}${ended(p) ? ' <span class="pill">ended</span>' : ""}</td>
        <td class="muted">${esc(last[p.id] ? Athena.ago(last[p.id]) : "never")}</td></tr>`; }).join("")}</tbody></table></div>
    <h2>What each role can do</h2><p class="muted">R = read, W = write. The core team's own "Team &amp; access" rights are locked so nobody can be locked out, and only the admin can open Lucien to a role.</p>
    <div class="tablewrap"><table><thead><tr><th>Area</th>${Object.values(ROLES).map(l => `<th>${l}</th>`).join("")}</tr></thead><tbody>${Object.entries(RESOURCES).map(([res, label]) =>
      `<tr><td>${esc(label)}</td>${Object.keys(ROLES).map(role => { const p = perms.find(x => x.role === role && x.resource === res) || {};
        const locked = !canPerm || (role === "core_team" && (res === "users" || res === "permissions")) || (res === "ulysse" && !S.admin);
        return `<td class="perm">${(READ_ONLY.has(res) ? ["read"] : ["read", "write"]).map(a => `<label><input type="checkbox" data-p="${role}|${res}|${a}" ${p["can_" + a] ? "checked" : ""} ${locked ? "disabled" : ""}> ${a === "read" ? "R" : "W"}</label>`).join("")}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
    ${log.data ? `<h2>Recent activity</h2><p class="muted">Who changed what (values are not stored here). Last 60 changes.</p>
    <div class="tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>${log.data.map(l => `<tr><td>${esc(new Date(l.at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }))}</td>
      <td>${esc(l.user_email || "automatic")}</td><td>${esc(l.action)} · ${esc(TABLE_LABEL[l.table_name] || l.table_name)}${l.label ? ` · <i>${esc(l.label)}</i>` : ""}${l.changed?.length ? ` <span class="muted">(${esc(l.changed.join(", "))})</span>` : ""}</td></tr>`).join("") || '<tr><td colspan="3" class="muted">No changes yet.</td></tr>'}</tbody></table></div>` : ""}`;
  main.onchange = async e => {
    const u = e.target.closest("[data-u]"), d = e.target.closest("[data-until]"), p = e.target.closest("[data-p]");
    if (u || d) {
      const id = (u || d).dataset.u || (u || d).dataset.until;
      const patch = u ? { role: u.value || null } : { access_until: d.value || null };
      const { error: er } = await sb.from("profiles").update(patch).eq("id", id); if (er) showError(er); else renderTeam();
    }
    if (p) { const [role, res, a] = p.dataset.p.split("|");
      const cur = perms.find(x => x.role === role && x.resource === res) || { can_read: false, can_write: false };
      const row = { role, resource: res, can_read: cur.can_read, can_write: cur.can_write, ["can_" + a]: p.checked };
      const { error: er } = await sb.from("role_permissions").upsert(row); if (er) showError(er); else renderTeam(); }
  };
}

/* ------------------------------------------------------------------ overview: what matters now, for this person */
async function renderToday() {
  const today = iso(new Date()), week = addDays(today, 6), fortnight = addDays(today, 13);
  const q = (ok, fn) => ok ? fn().then(r => r.error ? { error: r.error } : r) : Promise.resolve(null);
  const [cats, ents, gov, cov] = await Promise.all([
    q(can("plan_full", "read") || can("plan_shared", "read"), () => sb.from("plan_categories").select("*").order("sort")),
    q(can("plan_full", "read") || can("plan_shared", "read"), () => sb.from("plan_entries").select("*").gte("plan_date", today).lte("plan_date", week).order("plan_date")),
    q(can("budget", "read"), () => sb.from("governance_items").select("*").neq("status", "Done").lte("due_date", fortnight).order("due_date")),
    q(can("coverage", "read"), () => sb.from("media_coverage").select("*").order("covered_on", { ascending: false }).limit(6))]);
  const firstError = [cats, ents, gov, cov].find(r => r?.error);
  if (firstError) return showError(firstError.error);
  const card = (title, body, tab) => `<section class="card ov"><h3>${esc(title)}${tab ? ` <a href="#${tab}" data-go="${tab}" class="muted">open ›</a>` : ""}</h3>${body}</section>`;
  const none = t => `<p class="muted">${esc(t)}</p>`;
  const parts = [];
  if (cats) {
    const byDay = {}; ents.data.forEach(e => (byDay[e.plan_date] ||= []).push(e));
    const name = Object.fromEntries(cats.data.map(c => [c.id, c.name]));
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i)).filter(d => byDay[d]);
    parts.push(card("Campaign plan: next 7 days", days.map(d => `<div class="ovday"><b>${esc(d === today ? "Today" : fmtShort(d))}</b>${byDay[d].map(e =>
      `<div class="ovline"><span class="pill">${esc(name[e.category_id] || "")}</span> ${esc(e.content)}</div>`).join("")}</div>`).join("") || none("Nothing planned this week."), "plan"));
  }
  if (gov) {
    parts.push(card("Governance due", gov.data.map(g => `<div class="ovline ${g.due_date < today ? "late" : ""}"><b>${esc(fmtShort(g.due_date))}</b> ${esc(g.title)} <span class="muted">· ${esc(g.area)} · ${esc(g.status)}${g.owner ? " · " + esc(g.owner) : ""}</span></div>`).join("") ||
      none("Nothing due in the next fortnight."), "budget"));
  }
  if (cov) parts.push(card("Latest media", cov.data.map(c => { const u = safeUrl(c.url);
    return `<div class="ovline"><b>${esc(fmtShort(c.covered_on))}</b> ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(c.headline)}</a>` : esc(c.headline)} <span class="muted">· ${esc(c.outlet)}</span></div>`; }).join("") || none("Nothing logged yet."), "media"));
  main.innerHTML = `<h2>${esc(fmtDay(today))}</h2><div class="ovgrid">${parts.join("") || card("Welcome", none("Pick a page above."))}</div>`;
  main.onclick = e => { const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); go(g.dataset.go); } };
}

AuthUI.watchRecovery(sb, main);
boot();
