/* LOVELACE: London Organisation for Voters, Engagement, Liberalism, Action, Campaigns & Elections (formerly The Mall).
 * Static front end; all data and permissions live in Supabase (row-level security).
 * Nothing in this file is a security boundary: the server decides what each role can read or write. */
const { sb, esc, safeUrl } = Athena;
const $ = (s, el = document) => el.querySelector(s);
const main = $("#main");

const ROLES = { core_team: "Core team", executive: "Executive", local_party_chair: "Local party chair",
  candidate: "Candidate", support_team: "Support team", member: "Member" };
const RESOURCES = {
  dayplan_full: "Daily Plan: every day and every area, including Governance and Legal and London Politics (read and change)", dayplan_volunteer: "Volunteer's Zone: today's activities, without Governance and Legal",
  help_offer: "Help the Campaign: send a suggestion or an offer to help", help_inbox: "Suggestions and offers list (People page)",
  mayor_todo: "Mayor's To-Do List: read and tick done (write: add, edit, delete items)",
  visits: "Local party visit details and contacts (shown under the calendar)", budget: "Budget & governance",
  volunteers_all: "Full volunteer list (People page)", volunteers_add: "Add volunteers (own entries visible to the adder)", policies: "Policies (Communications)",
  social: "Social Media Channels Tracker and tracked accounts (Communications)", coverage: "Media trackers (Communications): news coverage",
  stakeholders_all: "Full stakeholder list (People page)", stakeholders_add: "Add stakeholders (own entries visible to the adder)",
  users: "Team & access: see users / change roles", permissions: "Edit this permissions table",
  audit: "Activity log (who changed what)", ulysse: "LUCIEN policy tracker (only the admin can change this row)" };

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
  AuthUI.render(sb, main, { title: "LOVELACE" });
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
  ["today", "Overview", () => can("dayplan_full", "read") || can("dayplan_volunteer", "read"), renderToday],
  ["plan", "Calendar", () => can("dayplan_full", "read"), renderPlan],
  ["zone", "Volunteer's Zone", () => can("dayplan_volunteer", "read"), renderZone],
  ["help", "Help the Campaign", () => can("help_offer", "write") || can("help_inbox", "read"), renderHelp],
  ["todo", "Mayor's To-Do List", () => can("mayor_todo", "read"), renderTodos],
  ["budget", "Budget & governance", () => can("budget", "read"), renderBudget],
  ["people", "Volunteers & stakeholders", () => can("volunteers_all", "read") || can("stakeholders_all", "read") || can("volunteers_add", "write") || can("stakeholders_add", "write"), renderPeople],
  ["comms", "Communications", () => can("coverage", "read") || can("social", "read") || can("policies", "read"), renderComms],
  ["team", "Team & access", () => S.admin, renderTeam, true]   // the administrator's alone: its button is in the footer, as on LUCIEN and LIBBY
];
// old addresses (bookmarks) of the pages that were merged
const ALIAS = { visits: "plan", social: "comms", coverage: "comms", media: "comms", policies: "comms", volunteers: "people", stakeholders: "people", suggestions: "people", offers: "help" };
function buildTabs() {
  const vis = TABS.filter(t => t[3] && t[2]());
  const nav = $("#tabs"); nav.hidden = false;
  if (S.admin) Shell.footLink("team", "Team & access", () => go("team"));
  nav.innerHTML = vis.filter(t => !t[4]).map(t => `<button data-t="${t[0]}">${esc(t[1])}</button>`).join("");
  nav.onclick = e => { const b = e.target.closest("button"); if (b) go(b.dataset.t); };
  const hash = ALIAS[location.hash.slice(1)] || location.hash.slice(1);
  go(vis.some(t => t[0] === hash) ? hash : S.tab && vis.some(t => t[0] === S.tab) ? S.tab : vis[0]?.[0]);
}
async function go(id, quiet) {
  S.tab = id; S.loadedAt = Date.now();
  if (location.hash.slice(1) !== id) history.replaceState(null, "", "#" + id);
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.t === id));
  { const t = TABS.find(x => x[0] === id), pt = $("#pt"); if (t && pt) { pt.hidden = false; $("h1", pt).textContent = t[1]; } }
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
  host.innerHTML = `${cfg.title ? `<h2 class="h2-rule">${esc(cfg.title)}</h2>` : ""}${cfg.note ? `<p class="muted">${esc(cfg.note)}</p>` : ""}
    <div class="row"><input class="grow" type="search" placeholder="Search…" data-q>${canAdd ? '<button class="btn primary" data-add>+ Add</button>' : ""}<button class="btn" data-csv title="Download what is shown as a spreadsheet">CSV</button></div>
    ${cfg.filters ? `<div class="row"><div class="seg">${cfg.filters.map((f, i) => `<button data-fl="${i}">${esc(f.label)}</button>`).join("")}</div></div>` : ""}
    ${cfg.beforeTable ? cfg.beforeTable : ""}<div class="tablewrap"><table></table></div><div data-foot></div>`;
  let qy = sb.from(cfg.table).select(cfg.select || "*");
  if (cfg.where) qy = qy.match(cfg.where);   // a page can show only some of a table's rows (Media: Overall and Lib Dem)
  const { data, error } = await qy.order(cfg.order[0], { ascending: cfg.order[1] });
  if (error) return showError(error);
  const cols = cfg.fields.filter(f => !f.hidden);
  const srt = sortState[cfg.key || cfg.table] ||= { k: null, asc: true };
  const fst = filterState[cfg.key || cfg.table] ||= { i: 0 };
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
        if (cfg.where && !row) Object.assign(vals, cfg.where);
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

/* ------------------------------------------------------------------ the Daily Plan, as a calendar (and the Volunteer's Zone, the same calendar for volunteers) */
// Each day has four areas. Every section can hold several entries (what, time, place, link, notes), like the Issues Tracker in LIBBY.
const AREAS = [
  { id: "mayor", name: "Mayor's Activity", sections: [["field", "Field Campaign"], ["media", "Media"], ["membership", "Membership Engagement"], ["other", "Other Activities"]] },
  { id: "gla", name: "GLA Activity", sections: [["field", "Field Campaign"], ["media", "Media"], ["membership", "Membership Engagement"], ["other", "Other Activities"]] },
  { id: "internal", name: "Internal Campaign", sections: [["membership", "Membership Engagement"], ["donor", "Donor Events"], ["staff", "Staff Activities"], ["other", "Other"]] },
  { id: "governance", name: "Governance and Legal", sections: [["governance", "Governance and Legal"]] },
  // GLA / London Data fills itself from the Stats calendar's collector (the GLA and London data drops only); the other two are typed in
  { id: "london", name: "London Politics", sections: [["data", "GLA / London Data"], ["political", "Political Events"], ["events", "London Events"]] }
];
// What volunteers see, and only for today (the database enforces the same rule): Mayor's and GLA Activity, and Internal Campaign > Membership Engagement; never Governance and Legal or London Politics.
const volunteerSees = e => e.area === "mayor" || e.area === "gla" || (e.area === "internal" && e.section === "membership");
const sectionName = (area, sec) => (AREAS.find(a => a.id === area)?.sections.find(s => s[0] === sec) || [, sec])[1];
const areaName = id => AREAS.find(a => a.id === id)?.name || id;
const byTime = (a, b) => String(a.starts || "~").localeCompare(String(b.starts || "~"), "en-GB", { numeric: true }) || String(a.created_at || "").localeCompare(String(b.created_at || ""));
const monthStartOf = s => s.slice(0, 7) + "-01";
const addMonths = (s, n) => { const d = parseISO(monthStartOf(s)); d.setMonth(d.getMonth() + n); return iso(d); };

async function loadPlan(from, to, filter) {
  const { data, error } = await sb.from("day_plan_entries").select("*").gte("plan_date", from).lte("plan_date", to).order("plan_date");
  if (error) throw error;
  const inRange = data.filter(e => e.plan_date >= from && e.plan_date <= to);   // (the database already limits it: this keeps the page right whatever it is sent)
  return (filter ? inRange.filter(filter) : inRange).sort(byTime);
}
/** One entry, as a line: time, what, where, link, notes. */
function entryHtml(e, editable) {
  const u = e.link && safeUrl(e.link);
  return `<div class="pe"><div class="pe-main">${e.starts ? `<span class="pe-time">${esc(e.starts)}</span>` : ""}<span class="pe-title">${esc(e.title)}</span>${e.place ? ` <span class="muted">· ${esc(e.place)}</span>` : ""}${u ? ` <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">link</a>` : ""}${editable ? ` <button class="btn sm" data-e="${e.id}">Edit</button>` : ""}</div>${e.detail ? `<div class="pe-detail muted">${esc(e.detail)}</div>` : ""}</div>`;
}
/** A day's plan. Editors see every section, with a button to add to it; everyone else sees only what is planned (nothing is shown for an empty section). */
function dayHtml(list, { editable, areas = AREAS }) {
  const out = areas.map(a => {
    const secs = a.sections.map(([sid, sname]) => {
      const mine = list.filter(e => e.area === a.id && e.section === sid);
      if (!mine.length && !editable) return "";
      const single = a.sections.length === 1;
      return `<div class="sec">${single ? "" : `<h3 class="h3-section">${esc(sname)}</h3>`}${mine.map(e => entryHtml(e, editable)).join("")}${editable ? `<button class="btn sm" data-add="${a.id}|${sid}">+ Add${single ? "" : ` to ${esc(sname)}`}</button>` : ""}</div>`;
    }).join("");
    return secs ? `<section class="grp"><h2 class="h2-rule">${esc(a.name)}</h2>${secs}</section>` : "";
  }).join("");
  return out || '<p class="muted">Nothing is planned for this day.</p>';
}

const PLANNERS = {
  plan: { state: { mode: "month", date: iso(new Date()) }, editable: () => can("dayplan_full", "write"), filter: null, areas: AREAS, visits: true }
};
const AREA_DOT = { mayor: "a-mayor", gla: "a-gla", internal: "a-internal", governance: "a-gov", london: "a-london" };

async function renderPlanner(kind) {
  const P = PLANNERS[kind], st = P.state, editable = P.editable(), today = iso(new Date());
  const areas = P.areas;
  const reload = () => renderPlanner(kind);
  if (st.mode === "month") {
    const first = monthStartOf(st.date), gridStart = mondayOf(first), lastOfMonth = addDays(addMonths(first, 1), -1);
    const days = []; for (let d = gridStart; ; d = addDays(d, 1)) { days.push(d); if (d >= lastOfMonth && parseISO(d).getDay() === 0) break; }   // whole weeks, Monday to Sunday
    let entries;
    try { entries = await loadPlan(gridStart, days[days.length - 1], P.filter); } catch (e) { return showError(e); }
    const byDay = {}; entries.forEach(e => (byDay[e.plan_date] ||= []).push(e));
    main.innerHTML = `<div class="row"><button class="btn" data-n="-1" aria-label="Earlier month">◀</button><button class="btn" data-n="0">Today</button><button class="btn" data-n="1" aria-label="Later month">▶</button>
      <b class="cal-title">${esc(parseISO(first).toLocaleDateString("en-GB", { month: "long", year: "numeric" }))}</b></div>
      <p class="muted">Click a day to see and edit its plan.</p>
      <div class="cal" role="grid" aria-label="Calendar"><div class="cal-head">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(w => `<div>${w}</div>`).join("")}</div><div class="cal-body">${days.map(d => {
        const list = byDay[d] || [], inMonth = d.slice(0, 7) === first.slice(0, 7);
        return `<button class="cal-cell${inMonth ? "" : " other"}${d === today ? " today" : ""}" data-day="${d}" aria-label="${esc(fmtDay(d))}${list.length ? `, ${list.length} planned` : ""}"><span class="cal-n">${parseISO(d).getDate()}</span>${
          list.slice(0, 3).map(e => `<span class="cal-ev ${AREA_DOT[e.area] || ""}">${esc((e.starts ? e.starts + " " : "") + e.title)}</span>`).join("")}${list.length > 3 ? `<span class="cal-more">+${list.length - 3} more</span>` : ""}</button>`; }).join("")}</div></div>`;
    main.onclick = e => {
      const n = e.target.closest("[data-n]"), d = e.target.closest("[data-day]");
      if (n) { st.date = n.dataset.n === "0" ? iso(new Date()) : addMonths(first, +n.dataset.n); return reload(); }
      if (d) { st.mode = "day"; st.date = d.dataset.day; reload(); }
    };
    if (P.visits && can("visits", "read")) visitsPanel(reload);
    return;
  }
  // one day: the daily plan
  const date = st.date;
  const canVisits = P.visits && can("visits", "read");
  let entries, vis = { data: [] };
  try {
    [entries, vis] = await Promise.all([loadPlan(date, date, P.filter), canVisits ? sb.from("local_party_visits").select("*").eq("visit_date", date) : Promise.resolve({ data: [] })]);
  } catch (e) { return showError(e); }
  if (vis.error) return showError(vis.error);
  const visitLine = v => [v.request, v.contact_name && `contact ${v.contact_name}${v.contact_phone ? " " + v.contact_phone : ""}`, v.taken_by && `taken by ${v.taken_by}`, v.actioning && `actioning ${v.actioning}`, v.notes].filter(Boolean).join(" · ");
  main.innerHTML = `<div class="row"><button class="btn" data-back>◀ Calendar</button><button class="btn" data-n="-1" aria-label="Previous day">‹ Previous day</button><button class="btn" data-n="0">Today</button><button class="btn" data-n="1" aria-label="Next day">Next day ›</button>
      <input type="date" value="${esc(date)}" style="width:auto" data-d></div>
    <h2 class="cal-day">${esc(fmtDay(date))}</h2>${dayHtml(entries, { editable, areas })}
    ${vis.data.length ? `<section class="grp"><h2 class="h2-rule">Local party visits</h2>${vis.data.map(v => `<div class="pe"><div class="pe-main"><span class="pe-title">${esc(v.local_party)}</span>${visitLine(v) ? ` <span class="muted">· ${esc(visitLine(v))}</span>` : ""}${can("visits", "write") ? ` <button class="btn sm" data-v="${v.id}">Edit visit</button>` : ""}</div></div>`).join("")}</section>` : ""}`;
  const go_ = d => { st.date = d; reload(); };
  main.onclick = e => {
    if (e.target.closest("[data-back]")) { st.mode = "month"; return reload(); }
    const n = e.target.closest("[data-n]");
    if (n) return go_(n.dataset.n === "0" ? iso(new Date()) : addDays(date, +n.dataset.n));
    const a = e.target.closest("[data-add]"), x = e.target.closest("[data-e]"), vb = e.target.closest("[data-v]");
    if (vb) return visitForm(vis.data.find(v => v.id === vb.dataset.v));
    if (a) { const [area, sec] = a.dataset.add.split("|"); return entryForm(null, area, sec, date, reload); }
    if (x) { const en = entries.find(z => z.id === x.dataset.e); return entryForm(en, en.area, en.section, date, reload); }
  };
  main.onchange = e => { if (e.target.matches("[data-d]") && e.target.value) go_(e.target.value); };
}
function entryForm(entry, area, sec, date, after) {
  openForm({
    title: `${areaName(area)}${areaName(area) === sectionName(area, sec) ? "" : ` · ${sectionName(area, sec)}`}: ${fmtShort(entry?.plan_date || date)}`,
    fields: [T("title", "What", "text", { req: true }), T("starts", "Time (for example 10:00, or all day)"), T("place", "Where"), T("link", "Link"), T("detail", "Notes", "textarea"), T("plan_date", "Date", "date", { req: true })],
    values: entry || { plan_date: date }, meta: edited(entry),
    onSubmit: async v => {
      const error = entry ? await guardedUpdate("day_plan_entries", entry, v) : (await sb.from("day_plan_entries").insert({ ...v, area, section: sec })).error;
      if (!error || error.message === CONFLICT) after(); return error;
    },
    onDelete: entry ? async () => { const { error } = await sb.from("day_plan_entries").delete().eq("id", entry.id); if (!error) after(); return error; } : null
  });
}
/** Local party visit requests (the sheet), under the calendar for those who may see them. */
function visitsPanel(reload) {
  main.insertAdjacentHTML("beforeend", `<details class="card" id="vreq" style="margin-top:18px"><summary><b>Local party visit requests</b> <span class="muted">· requests from local parties and who is handling them</span></summary><div id="vreqb"></div></details>`);
  $("#vreq").ontoggle = e => { if (e.target.open && !$("#vreqb").dataset.on) { $("#vreqb").dataset.on = 1; crud(VISITS, $("#vreqb"), reload); } };
}
function renderPlan() { return renderPlanner("plan"); }
/** The Volunteer's Zone: what is happening today, and nothing else (the database shows volunteers no other day). */
async function renderZone() {
  const today = iso(new Date());
  const areas = AREAS.filter(a => a.id === "mayor" || a.id === "gla" || a.id === "internal").map(a => a.id === "internal" ? { ...a, sections: a.sections.filter(s => s[0] === "membership") } : a);
  let entries;
  try { entries = await loadPlan(today, today, volunteerSees); } catch (e) { return showError(e); }
  main.innerHTML = `<h2 class="cal-day">${esc(fmtDay(today))}</h2><p class="muted">What is happening today: the Mayor's and GLA activity, and the party's membership engagement.</p>${dayHtml(entries, { editable: false, areas })}`;
  main.onclick = null;
}

/* ------------------------------------------------------------------ entity configs */
const T = (k, label, type = "text", extra = {}) => ({ k, label, type, ...extra });
function visitForm(row) {
  openForm({ title: `Visit: ${row.local_party}`, fields: VISITS.fields.filter(f => !f.noForm), values: row, meta: edited(row),
    onSubmit: async v => { const e = await guardedUpdate("local_party_visits", row, v); if (!e || e.message === CONFLICT) renderPlan(); return e; },
    onDelete: async () => { const { error: e } = await sb.from("local_party_visits").delete().eq("id", row.id); if (!e) renderPlan(); return e; } });
}
const VISITS = { table: "local_party_visits", title: "", order: ["visit_date", true], canEdit: () => can("visits", "write"),
  note: "Requests from local parties and who is handling them. A visit with a date shows its details on the calendar for that day. Contains contact details.",
  fields: [T("local_party", "Local party", "text", { req: true }), T("request", "Request"), T("taken_by", "Who took it"), T("actioning", "Who actioning"),
    T("happening", "When happening"), T("visit_date", "Date (if fixed)", "date"), T("contact_name", "Contact"), T("contact_phone", "Number"), T("notes", "Notes", "textarea")] };
const POLICIES = { table: "policies", title: "Policies", order: ["theme", true], canEdit: () => can("policies", "write"),
  fields: [T("policy", "Policy", "text", { req: true }), T("theme", "Theme"), T("briefing", "Briefing"), T("actions", "Actions", "textarea"),
    T("interested_parties", "Interested parties", "textarea"), T("comms", "Comms", "textarea"), T("notes", "Notes", "textarea")] };
const PLATFORMS = ["Instagram", "Facebook", "Twitter", "BlueSky", "Substack", "TikTok", "LinkedIn"];
const TOPICS = [["parliament", "Parliament"], ["gla", "GLA"], ["council", "Council"]];
const MEDIA_FIELDS = [T("covered_on", "Date", "date", { req: true }), T("outlet", "Outlet / platform", "text", { req: true, list: [...PLATFORMS, "BBC News", "The Guardian", "Evening Standard", "MyLondon"] }),
    T("headline", "Headline / first line of the caption", "text", { req: true, render: r => {
      const u = safeUrl(r.url); return (u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(r.headline)}</a>` : esc(r.headline)) +
        (r.source === "auto" ? ' <span class="pill" title="Found automatically in the outlet\'s news feed or pages">auto</span>' : r.source === "social" ? ' <span class="pill" title="Found automatically on the account">auto</span>' : ""); } }),
    T("topic", "Topic", "select", { options: TOPICS, render: r => esc(Object.fromEntries(TOPICS)[r.topic] || "") }),
    T("url", "URL", "url", { hidden: true }), T("notes", "Notes", "textarea")];
const MEDIA = { table: "media_coverage", key: "media_libdem", where: { kind: "libdem" }, title: "Olney Media Tracker", order: ["covered_on", false], canEdit: () => can("coverage", "write"),
  note: "Sarah Olney in the news: any article that mentions her, found automatically at 6am and 6pm, and anything added by hand. What our social accounts post is on the Social Media Channels Tracker.",
  fields: MEDIA_FIELDS };
const MEDIA_ALL = { table: "media_coverage", key: "media_overall", where: { kind: "overall" }, title: "Overall Media Tracker", order: ["covered_on", false], canEdit: () => can("coverage", "write"),
  note: "Wider political news that matters to the campaign: Parliament, the GLA and the councils.",
  fields: MEDIA_FIELDS };
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
const peopleState = { tab: "people" };
async function renderPeople() {
  if (can("help_inbox", "read")) {   // the campaign team also sees the suggestions and offers that come in from Help the Campaign
    const t = peopleState.tab === "suggestions" ? "suggestions" : "people";
    main.innerHTML = `<div class="row"><div class="seg" data-pt><button data-p="people" class="${t === "people" ? "on" : ""}">Volunteers &amp; stakeholders</button><button data-p="suggestions" class="${t === "suggestions" ? "on" : ""}">Suggestions &amp; offers</button></div></div><div id="pp"></div>`;
    main.onclick = e => { const b = e.target.closest("[data-p]"); if (b) { peopleState.tab = b.dataset.p; renderPeople(); } };
    if (t === "suggestions") return crud(SUGGESTIONS, $("#pp"), renderPeople);
    return renderPeopleList($("#pp"));
  }
  return renderPeopleList(main);
}
async function renderPeopleList(host) {
  const seeAll = can("volunteers_all", "read") || can("stakeholders_all", "read");
  await crud({ table: "contacts", title: "Volunteers & stakeholders", owned: true, order: ["name", true], key: "contacts",
    canEdit: () => can("volunteers_all", "write") || can("stakeholders_all", "write"), canAdd: () => mayAdd("volunteer") || mayAdd("stakeholder"),
    canEditRow: r => r.created_by === S.user.id || mayEditAll(r.kind),
    note: seeAll ? "One list for everyone we work with. Volunteers are filed under Lib Dems. The point of contact is the person on our side who owns the relationship. Anyone can add; you can always see and edit your own entries."
      : "Add a volunteer or stakeholder. You can only see entries you added.",
    filters: [{ label: "Everyone", test: () => true }, { label: "Volunteers", test: r => r.kind === "volunteer" }, { label: "Stakeholders", test: r => r.kind === "stakeholder" }],
    transform: v => { if (v.kind === "volunteer") { v.organisation ||= "Lib Dems"; v.sector ||= "Lib Dems"; } },
    fields: [T("name", "Full name", "text", { req: true }), T("organisation", "Organisation"), T("sector", "Sector", "text", { list: SECTORS }), T("email", "Email"), T("phone", "Phone"),
      T("owner", "Point of contact"), T("notes", "Notes", "textarea"),
      T("kind", "Type", "select", { req: true, hidden: true, options: () => Object.entries(KIND).filter(([k]) => mayAdd(k)) })] }, host, renderPeople);
}

/* ------------------------------------------------------------------ Help the Campaign: anyone can send a suggestion or an offer; the campaign team reads them on the People page */
const HELP_KINDS = [["venue", "I know of a venue(s) to host events/set pieces"], ["contact", "I know of a contact(s) at an organisation"], ["policy", "I would like to make a policy suggestion"],
  ["digital_filming", "I can support/have expertise in digital communications (filming)"], ["digital_editing", "I can support/have expertise in digital communications (editing)"], ["events", "I can support events and set pieces"]];
const SUGGESTIONS = { table: "campaign_suggestions", key: "suggestions", title: "Suggestions & offers", order: ["created_at", false], owned: true, canEdit: () => can("help_inbox", "write"),
  note: "What people have sent through Help the Campaign. Say who is dealing with each one in the notes, and set its status.",
  transform: v => { v.status ||= "new"; if (v.ok_to_contact === null || v.ok_to_contact === undefined) v.ok_to_contact = false; },
  fields: [T("created_at", "Received", "date", { noForm: true, render: r => esc(fmtShort(String(r.created_at).slice(0, 10))) }), T("name", "Name", "text", { req: true }), T("contact", "Contact"),
    T("ok_to_contact", "Happy to be contacted", "bool"), T("kind", "Suggesting / offering", "select", { req: true, options: HELP_KINDS, render: r => esc(Object.fromEntries(HELP_KINDS)[r.kind] || r.kind) }),
    T("details", "Further details", "textarea"), T("status", "Status", "select", { options: ["new", "in progress", "done"] }), T("notes", "Team notes", "textarea")] };
/* ------------------------------------------------------------------ the Mayor's To-Do List: things for the Mayoral candidate to sign off */
// The core team fills it: action, responsible, link, notes. Anyone who can see the list can tick an item done (the database lets them change only the tick).
const todoState = { show: "todo" };
async function renderTodos() {
  const manage = can("mayor_todo", "write");
  const { data, error } = await sb.from("mayor_todos").select("*").order("created_at");
  if (error) return showError(error);
  const open = data.filter(r => !r.done), done = data.filter(r => r.done);
  const shown = todoState.show === "done" ? done : todoState.show === "all" ? [...open, ...done] : open;
  const row = r => { const u = r.link && safeUrl(r.link);
    return `<tr class="${r.done ? "todo-done" : ""}"><td class="todo-tick"><input type="checkbox" data-tick="${r.id}" ${r.done ? "checked" : ""} aria-label="Done: ${esc(r.action)}"></td>
      <td class="wrapcell">${esc(r.action)}${r.done && r.done_at ? `<div class="muted small">Done ${esc(Athena.ago(r.done_at))}</div>` : ""}</td><td>${esc(r.responsible || "")}</td>
      <td>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">link</a>` : ""}</td><td class="wrapcell">${esc(r.notes || "")}</td>${manage ? `<td><button class="btn sm" data-edit="${r.id}">Edit</button></td>` : ""}</tr>`; };
  main.innerHTML = `<h2>Mayor's To-Do List</h2><p class="muted">Things for the Mayoral candidate to sign off. Tick an item when it is done.</p>
    <div class="row"><div class="seg" data-ts>${[["todo", `To do (${open.length})`], ["done", `Done (${done.length})`], ["all", "All"]].map(([k, l]) => `<button data-s="${k}" class="${todoState.show === k ? "on" : ""}">${esc(l)}</button>`).join("")}</div>${manage ? '<button class="btn primary" data-add>+ Add an item</button>' : ""}</div>
    <div class="tablewrap"><table class="grid"><thead><tr><th>Done</th><th>Action</th><th>Responsible</th><th>Link</th><th>Further notes</th>${manage ? "<th></th>" : ""}</tr></thead>
      <tbody>${shown.map(row).join("") || `<tr><td colspan="${manage ? 6 : 5}" class="muted">${todoState.show === "done" ? "Nothing is done yet." : "Nothing to sign off."}</td></tr>`}</tbody></table></div>`;
  const form = r => openForm({ title: r ? "Edit item" : "Add an item", values: r || {}, meta: edited(r),
    fields: [T("action", "Action (what the candidate is to sign off)", "textarea", { req: true }), T("responsible", "Responsible"), T("link", "Link"), T("notes", "Further notes", "textarea")],
    onSubmit: async v => { const e = r ? await guardedUpdate("mayor_todos", r, v) : (await sb.from("mayor_todos").insert({ ...v, created_by: S.user.id })).error; if (!e || e.message === CONFLICT) renderTodos(); return e; },
    onDelete: r ? async () => { const { error: e } = await sb.from("mayor_todos").delete().eq("id", r.id); if (!e) renderTodos(); return e; } : null });
  main.onclick = e => {
    const s = e.target.closest("[data-s]"), ed = e.target.closest("[data-edit]");
    if (s) { todoState.show = s.dataset.s; return renderTodos(); }
    if (ed) return form(data.find(r => r.id === ed.dataset.edit));
    if (e.target.closest("[data-add]")) form(null);
  };
  main.onchange = async e => {
    const t = e.target.closest("[data-tick]"); if (!t) return;
    t.disabled = true;
    const { error: er } = await sb.from("mayor_todos").update({ done: t.checked }).eq("id", t.dataset.tick);
    if (er) { t.checked = !t.checked; t.disabled = false; return showError(er); }
    renderTodos();
  };
}

async function renderHelp() {
  main.innerHTML = `<h2>Make a suggestion / offer to help</h2>
    <p class="muted">Know a venue for an event, someone at an organisation we should talk to, or have a policy idea? Can you help with filming, editing or events? Tell the campaign team here.</p>
    <form id="helpf" class="helpform">
      <label for="h_name">Your name *</label><input id="h_name" name="name" required maxlength="120" autocomplete="name" value="${esc(S.profile?.full_name || "")}">
      <label for="h_contact">Your contact (email or phone)</label><input id="h_contact" name="contact" maxlength="200" autocomplete="email">
      <label class="chk"><input type="checkbox" name="ok"> I am happy to be contacted about this</label>
      <label for="h_kind">What are you suggesting or offering? *</label><select id="h_kind" name="kind" required><option value="">Choose…</option>${HELP_KINDS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select>
      <label for="h_details">Further details</label><textarea id="h_details" name="details" maxlength="1500" rows="4" placeholder="A few words are enough"></textarea>
      <p><button class="btn primary" type="submit">Send</button> <span class="muted" id="hmsg" role="status" aria-live="polite"></span></p></form>`;
  $("#helpf").onsubmit = async e => {
    e.preventDefault();
    const f = e.target.elements, msg = $("#hmsg"), btn = $("button", e.target);
    btn.disabled = true; msg.textContent = "Sending…";
    const { error } = await sb.from("campaign_suggestions").insert({ name: f.name.value.trim(), contact: f.contact.value.trim() || null, ok_to_contact: f.ok.checked, kind: f.kind.value,
      details: f.details.value.trim() || null, created_by: S.user.id });
    btn.disabled = false;
    if (error) { msg.textContent = `It did not send: ${error.message}`; return; }
    e.target.reset(); f.name.value = S.profile?.full_name || ""; msg.textContent = "Thank you: the campaign team has your message.";
  };
}

/* ------------------------------------------------------------------ Communications: Media (three trackers) and Policies */
const commsState = { section: null, tracker: null };
const TRACKERS = [
  ["overall", "Overall Media Tracker", () => can("coverage", "read")],
  ["olney", "Olney Media Tracker", () => can("coverage", "read")],
  ["social", "Social Media Channels Tracker", () => can("social", "read")],
  ["accounts", "Tracked accounts", () => can("social", "read")]
];
async function renderComms() {
  const sections = [["media", "Media", () => can("coverage", "read") || can("social", "read")], ["policies", "Policies", () => can("policies", "read")]].filter(s => s[2]());
  if (!sections.length) { main.innerHTML = '<p class="muted">Communications is not open to your role yet.</p>'; return; }
  const sec = sections.some(s => s[0] === commsState.section) ? commsState.section : sections[0][0];
  const trackers = TRACKERS.filter(t => t[2]());
  const tr = trackers.some(t => t[0] === commsState.tracker) ? commsState.tracker : trackers[0]?.[0];
  main.innerHTML = `<div class="row">${sections.length > 1 ? `<div class="seg" data-sec>${sections.map(s => `<button data-s="${s[0]}" class="${s[0] === sec ? "on" : ""}">${esc(s[1])}</button>`).join("")}</div>` : ""}</div>
    ${sec === "media" ? `<h2 class="h2-rule">Media</h2><div class="row"><div class="seg" data-tr>${trackers.map(t => `<button data-t="${t[0]}" class="${t[0] === tr ? "on" : ""}">${esc(t[1])}</button>`).join("")}</div></div>` : ""}<div id="cm"></div>`;
  main.onclick = e => {
    const s = e.target.closest("[data-s]"), t = e.target.closest("[data-t]");
    if (s) { commsState.section = s.dataset.s; renderComms(); }
    if (t) { commsState.tracker = t.dataset.t; renderComms(); }
  };
  const host = $("#cm");
  if (sec === "policies") return crud(POLICIES, host, renderComms);
  if (tr === "overall") return crud(MEDIA_ALL, host, renderComms);
  if (tr === "olney") return crud(MEDIA, host, renderComms);
  if (tr === "social") return renderSocialTracker(host);
  if (tr === "accounts") return renderAccounts(host);
}

/* ---- the Social Media Channels Tracker: the accounts being followed, and their posts */
const POST_SHOWN = 6;
async function renderSocialTracker(host) {
  const w = can("social", "write");
  const [accts, posts] = await Promise.all([sb.from("social_accounts").select("*").order("organisation").order("platform"), sb.from("social_posts").select("*").order("posted_at", { ascending: false }).limit(2000)]);
  if (accts.error || posts.error) return showError(accts.error || posts.error);
  const tracked = accts.data.filter(a => a.handle || a.url || posts.data.some(p => p.account_id === a.id));
  const auto = a => a.platform === "BlueSky" || a.platform === "Substack";
  const fmtPost = p => `<div class="pe"><div class="pe-main"><span class="pe-time">${esc(fmtShort(String(p.posted_at).slice(0, 10)))}</span>${(() => { const u = safeUrl(p.url); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(p.summary || "post")}</a>` : esc(p.summary || "post"); })()}${w ? ` <button class="btn sm" data-pe="${p.id}">Edit</button>` : ""}</div></div>`;
  host.innerHTML = `<p class="muted">Every account we follow, with its latest posts. <b>BlueSky</b> and <b>Substack</b> posts are found automatically at 6am and 6pm; the other platforms do not allow automatic reading, so add their posts by hand. The list of accounts is kept on the <a href="#" data-acc>Tracked accounts</a> page, where you can upload links.</p>
    <div class="row"><input class="grow" type="search" placeholder="Search accounts and posts…" data-q></div><div id="acc-list"></div>`;
  const draw = () => {
    const q = $("[data-q]", host).value.toLowerCase();
    const items = tracked.map(a => ({ a, ps: posts.data.filter(p => p.account_id === a.id) })).filter(({ a, ps }) => !q || `${a.organisation} ${a.platform} ${a.handle || ""}`.toLowerCase().includes(q) || ps.some(p => String(p.summary || "").toLowerCase().includes(q)));
    $("#acc-list", host).innerHTML = items.length ? items.map(({ a, ps }) => { const u = safeUrl(a.url);
      return `<section class="acct"><h3>${esc(a.organisation)} <span class="muted">· ${esc(a.platform)}${a.handle ? ` · ${esc(a.handle)}` : ""}</span> ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="Open the account">↗</a>` : ""} <span class="pill">${auto(a) && a.handle ? "automatic" : "by hand"}</span>
        ${w ? `<button class="btn sm" data-addp="${a.id}">+ Add a post</button>` : ""}</h3>
        ${ps.length ? ps.slice(0, POST_SHOWN).map(fmtPost).join("") + (ps.length > POST_SHOWN ? `<details><summary class="muted">${ps.length - POST_SHOWN} older post${ps.length - POST_SHOWN === 1 ? "" : "s"}</summary>${ps.slice(POST_SHOWN).map(fmtPost).join("")}</details>` : "") : '<p class="muted small">No posts yet.</p>'}</section>`; }).join("")
      : `<p class="muted">${tracked.length ? "Nothing matches the search." : "No accounts are being tracked yet. Add their links on the Tracked accounts page."}</p>`;
  };
  draw();
  $("[data-q]", host).oninput = draw;
  const postForm = (a, row) => openForm({ title: `${a.organisation} · ${a.platform}`, fields: [T("posted_at", "Date posted", "date", { req: true }), T("summary", "What it says (the first line is enough)", "text", { req: true }), T("url", "Link to the post"), T("topic", "Topic")],
    values: row ? { ...row, posted_at: String(row.posted_at).slice(0, 10) } : { posted_at: iso(new Date()) }, meta: edited(row),
    onSubmit: async v => { v.posted_at = `${v.posted_at}T12:00:00Z`; const e = row ? await guardedUpdate("social_posts", row, v) : (await sb.from("social_posts").insert({ ...v, account_id: a.id })).error;
      if (!e || e.message === CONFLICT) renderSocialTracker(host); return e; },
    onDelete: row ? async () => { const { error: e } = await sb.from("social_posts").delete().eq("id", row.id); if (!e) renderSocialTracker(host); return e; } : null });
  host.onclick = e => {
    if (e.target.closest("[data-acc]")) { e.preventDefault(); commsState.tracker = "accounts"; return renderComms(); }
    const ap = e.target.closest("[data-addp]"), pe = e.target.closest("[data-pe]");
    if (ap) postForm(tracked.find(a => a.id === ap.dataset.addp));
    if (pe) { const p = posts.data.find(x => x.id === pe.dataset.pe); postForm(accts.data.find(a => a.id === p.account_id), p); }
  };
}

/* ---- Tracked accounts: the list of accounts the tracker follows. Links can be uploaded from a spreadsheet, or added one at a time. */
async function renderAccounts(host) {
  const w = can("social", "write");
  const { data: accts, error } = await sb.from("social_accounts").select("*").order("organisation");
  if (error) return showError(error);
  const known = accts.filter(a => a.handle || a.url);
  host.innerHTML = `<p class="muted">The accounts the Social Media Channels Tracker follows. ${w ? "Upload a spreadsheet of links (an account owner and a link to each profile), or add one below: the platform and handle are worked out from the link. " : ""}<b>BlueSky</b> and <b>Substack</b> accounts are read automatically at 6am and 6pm; for the other platforms add the posts by hand.</p>
    ${w ? '<div id="acc-import"></div><form class="row" data-one><input name="organisation" placeholder="Account owner, e.g. Sarah Olney MP" required style="width:22rem"><input name="url" placeholder="Link to the profile" required style="width:24rem"><button class="btn primary" type="submit">Add this account</button><span class="muted small" data-onemsg role="status" aria-live="polite"></span></form>' : ""}
    <div class="tablewrap"><table class="grid"><thead><tr><th>Account owner</th><th>Platform</th><th>Handle</th><th>Link</th>${w ? "<th></th>" : ""}</tr></thead><tbody>${known.map(a => { const u = safeUrl(a.url);
      return `<tr><td>${esc(a.organisation)}</td><td>${esc(a.platform)}</td><td>${esc(a.handle || "")}</td><td>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">link</a>` : ""}</td>${w ? `<td><button class="btn sm" data-a="${a.id}">Edit</button></td>` : ""}</tr>`; }).join("") || `<tr><td colspan="${w ? 5 : 4}" class="muted">No accounts yet.</td></tr>`}</tbody></table></div>`;
  if (!w) return;
  const { mountImport } = await import("../shared/import/panel.js"), { IMPORTERS, platformOf, handleOf } = await import("../shared/import/importers.js");
  mountImport($("#acc-import", host), {
    importer: IMPORTERS.accounts,
    after: () => renderAccounts(host),
    commit: async (entries, progress) => {
      let added = 0, done = 0; const failed = [];
      for (const e of entries) {
        const { error: er } = await sb.from("social_accounts").upsert({ organisation: e.organisation, platform: e.platform, handle: e.handle || null, url: e.url || null }, { onConflict: "organisation,platform" });
        if (er) failed.push({ summary: `${e.organisation} · ${e.platform}`, error: er.message }); else added++;
        progress(++done, entries.length);
      }
      return { added, skipped: 0, failed };
    }
  });
  host.querySelector("[data-one]").onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target.elements, msg = host.querySelector("[data-onemsg]"), url = f.url.value.trim(), platform = platformOf(url);
    if (!platform) { msg.textContent = "I could not tell the platform from that link."; return; }
    const { error: er } = await sb.from("social_accounts").upsert({ organisation: f.organisation.value.trim(), platform, handle: handleOf(platform, url) || null, url }, { onConflict: "organisation,platform" });
    if (er) { msg.textContent = er.message; return; }
    renderAccounts(host);
  };
  host.onclick = e => {
    const c = e.target.closest("[data-a]"); if (!c) return;
    const a = accts.find(x => x.id === c.dataset.a);
    openForm({ title: `${a.organisation} · ${a.platform}`, fields: [T("handle", "Handle"), T("url", "Profile link", "url"), T("notes", "Notes", "textarea")], values: a, meta: edited(a),
      onSubmit: async v => { const er = await guardedUpdate("social_accounts", a, v); if (!er || er.message === CONFLICT) renderAccounts(host); return er; },
      onDelete: async () => { const { error: er } = await sb.from("social_accounts").delete().eq("id", a.id); if (!er) renderAccounts(host); return er; } });
  };
}

/* ------------------------------------------------------------------ team & access */
const TABLE_LABEL = { mayor_todos: "Mayor's To-Do List", campaign_suggestions: "Suggestions and offers", day_plan_entries: "Daily Plan", plan_entries: "Plan (old)", plan_categories: "Plan rows", local_party_visits: "Visits", budget_items: "Budget", governance_items: "Governance",
  policies: "Policies", social_accounts: "Social accounts", social_posts: "Social outputs", content_items: "Content", media_coverage: "Coverage",
  volunteers: "Volunteers", stakeholders: "Stakeholders", contacts: "Volunteers & stakeholders", profiles: "People", role_permissions: "Permissions" };
const READ_ONLY = new Set(["audit", "ulysse"]);
// the core team can always see, edit and delete these (the database refuses to take it away): their boxes are locked on the grid
const CORE_KEEPS = new Set(["dayplan_full", "dayplan_volunteer", "budget", "volunteers_all", "volunteers_add", "stakeholders_all", "stakeholders_add", "policies", "social", "coverage", "visits", "help_offer", "help_inbox", "mayor_todo"]);   // only "can see" means anything for these
async function renderTeam() {
  const [{ data: profs, error }, { data: perms, error: pe }, seen, log] = await Promise.all([
    sb.from("profiles").select("*").order("created_at"), sb.from("role_permissions").select("*"), sb.rpc("team_last_seen"),
    can("audit", "read") ? sb.from("audit_log").select("*").order("at", { ascending: false }).limit(60) : Promise.resolve({ data: null })]);
  if (error || pe) return showError(error || pe);
  const last = Object.fromEntries((seen.data || []).map(r => [r.id, r.last_sign_in_at]));
  const canPerm = can("permissions", "write");
  const today = iso(new Date());
  const pending = profs.filter(p => !p.role).length;
  const ended = p => p.access_until && p.access_until < today;
  main.innerHTML = `<h2 class="h2-rule">People ${pending ? `<span class="pill" style="color:var(--red)">${pending} awaiting a role</span>` : ""}</h2>
    <p class="muted">Roles and end dates are given on the <a href="../access/#lovelace">Access page</a>, as for LUCIEN and LIBBY. This list shows who has what.</p>
    <div class="tablewrap"><table><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Access until</th><th>Last signed in</th></tr></thead><tbody>${profs.map(p => {
      const lock = true;   // read-only here: the Access page gives roles
      return `<tr class="${ended(p) ? "ended" : ""}"><td>${esc(p.email)}</td><td>${esc(p.full_name)}</td><td>${!lock ?
        `<select data-u="${p.id}"><option value="">(no access)</option>${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${p.role === k ? "selected" : ""}>${l}</option>`).join("")}</select>` : esc(ROLES[p.role] || "none")}</td>
        <td>${!lock ? `<input type="date" data-until="${p.id}" value="${esc(p.access_until || "")}" style="width:auto">` : esc(p.access_until ? fmtShort(p.access_until) : "no end date")}${ended(p) ? ' <span class="pill">ended</span>' : ""}</td>
        <td class="muted">${esc(last[p.id] ? Athena.ago(last[p.id]) : "never")}</td></tr>`; }).join("")}</tbody></table></div>
    <h2 class="h2-rule">What each role can do</h2><p class="muted">R = read, W = write. The core team's own "Team &amp; access" rights are locked so nobody can be locked out, the core team always keeps the right to edit and delete everything here (those boxes are locked too), and only the admin can open LUCIEN to a role.</p>
    <div class="tablewrap"><table><thead><tr><th>Area</th>${Object.values(ROLES).map(l => `<th>${l}</th>`).join("")}</tr></thead><tbody>${Object.entries(RESOURCES).map(([res, label]) =>
      `<tr><td>${esc(label)}</td>${Object.keys(ROLES).map(role => { const p = perms.find(x => x.role === role && x.resource === res) || {};
        const locked = !canPerm || (role === "core_team" && (res === "users" || res === "permissions" || CORE_KEEPS.has(res))) || (res === "ulysse" && !S.admin);
        return `<td class="perm">${(READ_ONLY.has(res) ? ["read"] : ["read", "write"]).map(a => `<label><input type="checkbox" data-p="${role}|${res}|${a}" ${p["can_" + a] ? "checked" : ""} ${locked ? "disabled" : ""}> ${a === "read" ? "R" : "W"}</label>`).join("")}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
    ${log.data ? `<h2 class="h2-rule">Recent activity</h2><p class="muted">Who changed what (values are not stored here). Last 60 changes.</p>
    <div class="tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>${log.data.map(l => `<tr><td>${esc(new Date(l.at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }))}</td>
      <td>${esc(l.user_email || "automatic")}</td><td>${esc(l.action)} · ${esc(TABLE_LABEL[l.table_name] || l.table_name)}${l.label ? ` · <i>${esc(l.label)}</i>` : ""}${l.changed?.length ? ` <span class="muted">(${esc(l.changed.join(", "))})</span>` : ""}</td></tr>`).join("") || '<tr><td colspan="3" class="muted">No changes yet.</td></tr>'}</tbody></table></div>` : ""}`;
  main.onchange = async e => {
    const p = e.target.closest("[data-p]");
    if (p) { const [role, res, a] = p.dataset.p.split("|");
      const cur = perms.find(x => x.role === role && x.resource === res) || { can_read: false, can_write: false };
      const row = { role, resource: res, can_read: cur.can_read, can_write: cur.can_write, ["can_" + a]: p.checked };
      const { error: er } = await sb.from("role_permissions").upsert(row); if (er) showError(er); else renderTeam(); }
  };
}

/* ------------------------------------------------------------------ overview: what is coming up, day by day */
// A list of the days ahead that have something planned. A day with nothing is left out, and so is an area or section with nothing in it.
async function renderToday() {
  const today = iso(new Date());
  const full = can("dayplan_full", "read"), zone = can("dayplan_volunteer", "read");
  const end = full ? addDays(today, 20) : today;   // volunteers see today only
  if (!full && !zone) { main.innerHTML = `<h2>${esc(fmtDay(today))}</h2><p class="muted">The plan is not open to your role yet.</p>`; return; }
  let entries;
  try { entries = await loadPlan(today, end, full ? null : volunteerSees); } catch (e) { return showError(e); }
  const days = [...new Set(entries.map(e => e.plan_date))].sort();
  main.innerHTML = `<div class="ov-head"><div><p class="ov-kicker">${full ? "Coming up" : "Today"}</p><h2>${esc(full ? `${fmtShort(today)} – ${fmtShort(end)}` : fmtShort(today))}</h2></div>
      <a class="btn primary" href="#${full ? "plan" : "zone"}" data-go="${full ? "plan" : "zone"}">${full ? "Open the calendar" : "Open the Volunteer's Zone"} ›</a></div>
    ${days.length ? days.map(d => {
      const list = entries.filter(e => e.plan_date === d);
      return `<section class="ovday${d === today ? " now" : ""}"><h3><a href="#" data-day="${d}">${esc(d === today ? "Today · " : "")}${esc(fmtDay(d))}</a></h3>${AREAS.map(a => {
        const mine = list.filter(e => e.area === a.id);
        if (!mine.length) return "";
        return `<div class="ovarea"><h4>${esc(a.name)}</h4>${a.sections.map(([sid, sname]) => { const m = mine.filter(e => e.section === sid);
          return m.length ? `<div class="ovsec">${a.sections.length > 1 ? `<span class="ovtag">${esc(sname)}</span>` : ""}${m.map(e => entryHtml(e, false)).join("")}</div>` : ""; }).join("")}</div>`; }).join("")}</section>`; }).join("") : '<p class="muted">${full ? "Nothing is planned in the next three weeks." : "Nothing is planned for today."}</p>'}`;
  main.onclick = e => {
    const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); return go(g.dataset.go); }
    const d = e.target.closest("[data-day]");
    if (d && full) { e.preventDefault(); PLANNERS.plan.state.mode = "day"; PLANNERS.plan.state.date = d.dataset.day; go("plan"); }
    else if (d) e.preventDefault();
  };
}

AuthUI.watchRecovery(sb, main);
boot();
