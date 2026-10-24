/* The Mall: Mayoral Analysis for London's Liberals.
 * Static front end; all data and permissions live in Supabase (row-level security).
 * Nothing in this file is a security boundary: the server decides what each role can read or write. */
const { sb, esc, safeUrl } = Athena;
const $ = (s, el = document) => el.querySelector(s);
const main = $("#main");

const ROLES = { core_team: "Core team", executive: "Executive", local_party_chair: "Local party chair",
  candidate: "Candidate", support_team: "Support team", member: "Member" };
const RESOURCES = {
  plan_full: "Full campaign plan (all rows)", plan_shared: "Shared plan rows (Solney story, milestones, policy, digital, campaigns, visits)",
  visits: "Local party visits sheet (incl. contacts)", budget: "Budget & governance", volunteers_all: "Full volunteer list",
  volunteers_add: "Add volunteers (own entries visible to the adder)", policies: "Policies", social: "Social media tracker",
  coverage: "Coverage", stakeholders_all: "Full stakeholder list", stakeholders_add: "Add stakeholders (own entries visible to the adder)",
  users: "Team & access: see users / change roles", permissions: "Edit this permissions table",
  audit: "Activity log (who changed what)", ulysse: "Ulysse policy tracker (only the admin can change this row)" };

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
  AuthUI.render(sb, main, { title: "The Mall" });
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
  ["visits", "Local party visits", () => can("visits", "read"), () => crud(VISITS)],
  ["budget", "Budget & governance", () => can("budget", "read"), renderBudget],
  ["volunteers", "Volunteers", () => can("volunteers_all", "read") || can("volunteers_add", "write"), renderVolunteers],
  ["policies", "Policies", () => can("policies", "read"), () => crud(POLICIES)],
  ["social", "Social media", () => can("social", "read"), renderSocial],
  ["coverage", "Coverage", () => can("coverage", "read"), () => crud(COVERAGE)],
  ["stakeholders", "Stakeholders", () => can("stakeholders_all", "read") || can("stakeholders_add", "write"), renderStakeholders],
  ["team", "Team & access", () => can("users", "read"), renderTeam]
];
function buildTabs() {
  const vis = TABS.filter(t => t[3] && t[2]());
  const nav = $("#tabs"); nav.hidden = false;
  nav.innerHTML = vis.map(t => `<button data-t="${t[0]}">${esc(t[1])}</button>`).join("");
  nav.onclick = e => { const b = e.target.closest("button"); if (b) go(b.dataset.t); };
  const hash = location.hash.slice(1);
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
    else if (f.type === "select") input = `<select id="${id}" ${req}><option value=""></option>${f.options.map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(v) === String(ov) ? "selected" : ""}>${esc(ol)}</option>`; }).join("")}</select>`;
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
const sortState = {};
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
    ${cfg.beforeTable ? cfg.beforeTable : ""}<div class="tablewrap"><table></table></div><div data-foot></div>`;
  const { data, error } = await sb.from(cfg.table).select(cfg.select || "*").order(cfg.order[0], { ascending: cfg.order[1] });
  if (error) return showError(error);
  const cols = cfg.fields.filter(f => !f.hidden);
  const srt = sortState[cfg.table] ||= { k: null, asc: true };
  let shown = data;
  const draw = () => {
    const q = $("[data-q]", host).value.toLowerCase();
    shown = data.filter(r => !q || JSON.stringify(Object.values(r)).toLowerCase().includes(q));
    if (srt.k) {
      const f = cfg.fields.find(x => x.k === srt.k), num = f?.type === "number";
      shown = shown.slice().sort((a, b) => {
        const x = a[srt.k], y = b[srt.k];
        if (x == null || x === "") return 1; if (y == null || y === "") return -1;
        const c = num ? x - y : String(x).localeCompare(String(y), "en-GB", { numeric: true, sensitivity: "base" });
        return srt.asc ? c : -c;
      });
    }
    const editable = r => canEdit || (cfg.ownEdit && r.created_by === S.user.id);
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
  $("[data-csv]", host).onclick = () => csvDownload(cfg.table, cfg.fields, shown);
  host.onclick = e => {
    const b = e.target.closest("[data-edit]"); if (b) return form(data.find(r => r.id === b.dataset.edit));
    const so = e.target.closest("[data-sort]");
    if (so) { srt.asc = srt.k === so.dataset.sort ? !srt.asc : true; srt.k = so.dataset.sort; draw(); }
  };
}

/* ------------------------------------------------------------------ plan */
const planState = { mode: "day", date: iso(new Date()) };
async function renderPlan() {
  const { mode, date } = planState;
  const start = mode === "day" ? date : mondayOf(date), end = mode === "day" ? date : addDays(start, 6);
  const [cats, ents] = await Promise.all([
    sb.from("plan_categories").select("*").order("sort"),
    sb.from("plan_entries").select("*").gte("plan_date", start).lte("plan_date", end).order("updated_at")
  ]);
  if (cats.error || ents.error) return showError(cats.error || ents.error);
  const canCat = c => can("plan_full", "write") || (can("plan_shared", "write") && c.shared);
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
  if (mode === "day") {
    pv.innerHTML = cats.data.map(c => {
      const list = byKey[c.id + "|" + date] || [];
      return `<div class="sec ${c.shared ? "shared" : ""}"><h3>${esc(c.name)} ${c.shared && can("plan_full", "read") ? '<span class="pill">visible to all roles</span>' : ""} ${canCat(c) ? `<button class="btn sm" data-add="${c.id}">+ Add</button>` : ""}</h3>
        ${list.map(e => `<div class="entry"><span>${esc(e.content)}</span>${canCat(c) ? `<span class="acts"><button class="btn sm" data-e="${e.id}">Edit</button></span>` : ""}</div>`).join("") || '<span class="muted">Nothing planned.</span>'}</div>`;
    }).join("");
    pv.onclick = e => {
      const a = e.target.closest("[data-add]"), x = e.target.closest("[data-e]");
      if (a) edit(null, cats.data.find(c => c.id == a.dataset.add), date);
      if (x) { const en = ents.data.find(z => z.id === x.dataset.e); edit(en, cats.data.find(c => c.id === en.category_id), date); }
    };
  } else {
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    pv.innerHTML = `<div class="tablewrap"><table class="grid"><tr><th>Row</th>${days.map(d => `<th class="${d === today ? "today" : ""}"><a href="#" data-day="${d}">${esc(fmtShort(d))}</a></th>`).join("")}</tr>` +
      cats.data.map(c => `<tr><td>${esc(c.name)}</td>${days.map(d => `<td class="${d === today ? "today" : ""}">${(byKey[c.id + "|" + d] || []).map(e => esc(e.content)).join("\n\n")}</td>`).join("")}</tr>`).join("") + "</table></div>";
    pv.onclick = e => { const a = e.target.closest("[data-day]"); if (a) { e.preventDefault(); planState.mode = "day"; planState.date = a.dataset.day; renderPlan(); } };
  }
}

/* ------------------------------------------------------------------ entity configs */
const T = (k, label, type = "text", extra = {}) => ({ k, label, type, ...extra });
const VISITS = { table: "local_party_visits", title: "Local party visits", order: ["visit_date", true], canEdit: () => can("visits", "write"),
  note: "Requests from local parties and who is handling them. Contains contact details.",
  fields: [T("local_party", "Local party", "text", { req: true }), T("request", "Request"), T("taken_by", "Who took it"), T("actioning", "Who actioning"),
    T("happening", "When happening"), T("visit_date", "Date (if fixed)", "date"), T("contact_name", "Contact"), T("contact_phone", "Number"), T("notes", "Notes", "textarea")] };
const POLICIES = { table: "policies", title: "Policies", order: ["theme", true], canEdit: () => can("policies", "write"),
  fields: [T("policy", "Policy", "text", { req: true }), T("theme", "Theme"), T("briefing", "Briefing"), T("actions", "Actions", "textarea"),
    T("interested_parties", "Interested parties", "textarea"), T("comms", "Comms", "textarea"), T("notes", "Notes", "textarea")] };
const COVERAGE = { table: "media_coverage", title: "Coverage: Sarah Olney in the media", order: ["covered_on", false], canEdit: () => can("coverage", "write"),
  note: "Every time Sarah Olney has been mentioned in the media. Stories in the tracked outlets' news feeds are added automatically every 3 hours (marked auto); add anything else by hand.",
  fields: [T("covered_on", "Date", "date", { req: true }), T("outlet", "Outlet", "text", { req: true }), T("headline", "Headline", "text", { req: true, render: r => {
      const u = safeUrl(r.url); return (u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(r.headline)}</a>` : esc(r.headline)) +
        (r.source === "auto" ? ' <span class="pill" title="Found automatically in the outlet\'s news feed">auto</span>' : ""); } }),
    T("url", "URL", "url", { hidden: true }), T("notes", "Notes", "textarea")] };
const BUDGET = { table: "budget_items", title: "Budget", order: ["created_at", true], canEdit: () => can("budget", "write"),
  fields: [T("item", "Item", "text", { req: true }), T("amount", "Amount (£)", "number"), T("category", "Category"), T("notes", "Notes", "textarea")],
  footer: rows => `<div class="total">Total: ${esc(gbp(rows.reduce((s, r) => s + Number(r.amount || 0), 0)))}</div>` };
const GOVERNANCE = { table: "governance_items", title: "Governance (legal, compliance, finance controls)", order: ["due_date", true], canEdit: () => can("budget", "write"),
  fields: [T("title", "Item", "text", { req: true }), T("area", "Area", "select", { options: ["Legal", "Finance", "Compliance", "Data protection", "Other"] }),
    T("status", "Status", "select", { options: ["To do", "In progress", "Done"] }), T("owner", "Owner"), T("due_date", "Due", "date"), T("notes", "Notes", "textarea")] };
const CONTENT = { table: "content_items", title: "Content pipeline (Sarah's own posts)", order: ["scheduled", false], canEdit: () => can("social", "write"),
  fields: [T("name", "Name", "text", { req: true }), T("platforms", "Platforms"), T("creator", "Creator"), T("proof_read", "Proof read", "select", { options: ["Yes", "No"] }),
    T("content_type", "Type", "select", { options: ["Photo", "Video", "Video/Reel", "Text", "Article", "Other"] }), T("description", "Description / metadata", "textarea"),
    T("drive_link", "Google Drive"), T("scheduled", "Scheduled", "date"), T("status", "Status", "select", { options: ["Idea", "In Development", "Ready", "Complete"] })] };

/* ------------------------------------------------------------------ budget & governance */
async function renderBudget() {
  main.innerHTML = '<div id="b1"></div><div id="b2"></div>';
  await crud(BUDGET, $("#b1"), renderBudget); await crud(GOVERNANCE, $("#b2"), renderBudget);
}

/* ------------------------------------------------------------------ volunteers & stakeholders (add by anyone) */
const FREE_TEXT_ROLES = ["Literature", "Policy", "Press (pitching)", "Press (copywriting)", "Social", "Fundraising", "Agent", "Phoning", "Canvassing", "Events", "Photography / video", "Design", "Other"];
async function renderVolunteers() {
  const all = can("volunteers_all", "read");
  await crud({ table: "volunteers", title: all ? "Volunteers" : "Volunteer for the campaign", owned: true, ownEdit: true, order: ["created_at", false],
    canEdit: () => can("volunteers_all", "write"), canAdd: () => can("volunteers_add", "write"),
    note: all ? "Everyone can add volunteers; only the core team and executive see the full list." : "Add yourself or someone else. You can only see entries you added.",
    fields: [T("name", "Name", "text", { req: true }), T("role_wanted", "Role in the campaign", "text", { list: FREE_TEXT_ROLES }),
      T("availability", "Regular times free to support", "textarea"), T("email", "Email"), T("phone", "Phone"),
      ...(all ? [T("asked_by", "Asked by"), T("accepted", "Accepted?", "bool")] : []), T("notes", "Notes", "textarea")] });
}
async function renderStakeholders() {
  const all = can("stakeholders_all", "read");
  await crud({ table: "stakeholders", title: "Stakeholders", owned: true, ownEdit: true, order: ["name", true],
    canEdit: () => can("stakeholders_all", "write"), canAdd: () => can("stakeholders_add", "write"),
    note: all ? "Media, think tanks, campaigns, donors and others. Anyone can add a stakeholder." : "Add a stakeholder. You can only see entries you added.",
    fields: [T("name", "Name", "text", { req: true }), T("organisation", "Organisation"),
      T("sector", "Sector", "text", { list: ["Media", "Think tank", "Campaign", "Donor", "Elected official", "Local party", "Business", "Union / membership body", "Community group", "Other"] }),
      T("email", "Email"), T("phone", "Phone"), T("point_person_name", "Point person"), T("point_person_contact", "Point person contact"),
      T("owner", "Owner (who on our side)"), T("notes", "Other information", "textarea")] });
}

/* ------------------------------------------------------------------ social */
const PLATFORMS = ["Instagram", "Facebook", "Twitter", "BlueSky", "Substack", "TikTok", "LinkedIn"];
const socialState = { sub: "accounts" };
async function renderSocial() {
  main.innerHTML = `<div class="row"><div class="seg">${[["accounts", "Accounts"], ["posts", "Outputs"], ["content", "Sarah's content pipeline"]].map(([k, l]) =>
    `<button data-s="${k}" class="${socialState.sub === k ? "on" : ""}">${l}</button>`).join("")}</div></div><div id="sv"></div>`;
  main.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { socialState.sub = b.dataset.s; renderSocial(); });
  const host = $("#sv"), w = can("social", "write");
  if (socialState.sub === "content") return crud(CONTENT, host, renderSocial);
  const { data: accts, error } = await sb.from("social_accounts").select("*").order("organisation");
  if (error) return showError(error);
  if (socialState.sub === "posts") {
    const opts = accts.map(a => [a.id, `${a.organisation} · ${a.platform}`]);
    const map = Object.fromEntries(opts);
    return crud({ table: "social_posts", title: "Outputs by tracked accounts", order: ["posted_at", false], canEdit: () => can("social", "write"),
      note: "Log what each tracked account has published. Automatic collection is limited by the platforms' terms, so entries are added by hand.",
      fields: [T("account_id", "Account", "select", { req: true, options: opts, render: r => esc(map[r.account_id] || ""), csv: r => map[r.account_id] || "" }), T("posted_at", "Posted", "date", { render: r => r.posted_at ? esc(fmtShort(r.posted_at.slice(0, 10))) : "—" }),
        T("summary", "What it says", "textarea"), T("topic", "Topic"), T("url", "Link", "url")] }, host, renderSocial);
  }
  const orgs = [...new Set(accts.map(a => a.organisation))];
  host.innerHTML = `<p class="muted">Tracked accounts across Instagram, Facebook, Twitter, BlueSky, Substack, TikTok and LinkedIn. ${w ? "Click a cell to set its handle and link." : ""}</p>
    ${w ? '<div class="row"><button class="btn primary" data-org>+ Add organisation</button></div>' : ""}
    <div class="tablewrap"><table class="grid"><tr><th>Organisation</th>${PLATFORMS.map(p => `<th>${p}</th>`).join("")}</tr>` +
    orgs.map(o => `<tr><td>${esc(o)}</td>${PLATFORMS.map(p => { const a = accts.find(x => x.organisation === o && x.platform === p);
      const u = a && safeUrl(a.url); const label = a?.handle ? esc(a.handle) : '<span class="muted">—</span>';
      return `<td>${a ? (w ? `<a href="#" data-a="${a.id}">${label}</a>` : label) : ""}${u ? ` <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">↗</a>` : ""}</td>`; }).join("")}</tr>`).join("") + "</table></div>";
  host.onclick = e => {
    const c = e.target.closest("[data-a]"), o = e.target.closest("[data-org]");
    if (c) { e.preventDefault(); const a = accts.find(x => x.id === c.dataset.a);
      openForm({ title: `${a.organisation} · ${a.platform}`, fields: [T("handle", "Handle"), T("url", "Profile URL", "url"), T("notes", "Notes", "textarea")], values: a,
        meta: edited(a), onSubmit: async v => { const er = await guardedUpdate("social_accounts", a, v); if (!er || er.message === CONFLICT) renderSocial(); return er; } }); }
    if (o) openForm({ title: "Add organisation", fields: [T("organisation", "Organisation or account owner", "text", { req: true })],
      onSubmit: async v => { const { error: er } = await sb.from("social_accounts").insert(PLATFORMS.map(p => ({ organisation: v.organisation, platform: p }))); if (!er) renderSocial(); return er; } });
  };
}

/* ------------------------------------------------------------------ team & access */
const TABLE_LABEL = { plan_entries: "Plan", plan_categories: "Plan rows", local_party_visits: "Visits", budget_items: "Budget", governance_items: "Governance",
  policies: "Policies", social_accounts: "Social accounts", social_posts: "Social outputs", content_items: "Content", media_coverage: "Coverage",
  volunteers: "Volunteers", stakeholders: "Stakeholders", profiles: "People", role_permissions: "Permissions" };
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
    <h2>What each role can do</h2><p class="muted">R = read, W = write. The core team's own "Team &amp; access" rights are locked so nobody can be locked out, and only the admin can open Ulysse to a role.</p>
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
  const [cats, ents, visits, gov, content, cov, vols] = await Promise.all([
    q(can("plan_full", "read") || can("plan_shared", "read"), () => sb.from("plan_categories").select("*").order("sort")),
    q(can("plan_full", "read") || can("plan_shared", "read"), () => sb.from("plan_entries").select("*").gte("plan_date", today).lte("plan_date", week).order("plan_date")),
    q(can("visits", "read"), () => sb.from("local_party_visits").select("*").gte("visit_date", today).lte("visit_date", fortnight).order("visit_date")),
    q(can("budget", "read"), () => sb.from("governance_items").select("*").neq("status", "Done").lte("due_date", fortnight).order("due_date")),
    q(can("social", "read"), () => sb.from("content_items").select("*").neq("status", "Complete").gte("scheduled", today).lte("scheduled", fortnight).order("scheduled")),
    q(can("coverage", "read"), () => sb.from("media_coverage").select("*").order("covered_on", { ascending: false }).limit(6)),
    q(can("volunteers_all", "read"), () => sb.from("volunteers").select("id,accepted,created_at"))]);
  const firstError = [cats, ents, visits, gov, content, cov, vols].find(r => r?.error);
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
  if (visits) parts.push(card("Local party visits", visits.data.map(v => `<div class="ovline"><b>${esc(fmtShort(v.visit_date))}</b> ${esc(v.local_party)}${v.request ? ` <span class="muted">· ${esc(v.request)}</span>` : ""}</div>`).join("") || none("No visits in the next fortnight."), "visits"));
  if (content) parts.push(card("Content scheduled", content.data.map(c => `<div class="ovline"><b>${esc(fmtShort(c.scheduled))}</b> ${esc(c.name)} <span class="muted">· ${esc(c.status || "")}${c.platforms ? " · " + esc(c.platforms) : ""}</span></div>`).join("") || none("Nothing scheduled in the next fortnight."), "social"));
  if (cov) parts.push(card("Latest coverage", cov.data.map(c => { const u = safeUrl(c.url);
    return `<div class="ovline"><b>${esc(fmtShort(c.covered_on))}</b> ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(c.headline)}</a>` : esc(c.headline)} <span class="muted">· ${esc(c.outlet)}</span></div>`; }).join("") || none("No coverage logged yet."), "coverage"));
  if (vols) { const open = vols.data.filter(v => v.accepted == null).length, recent = vols.data.filter(v => v.created_at >= addDays(today, -7)).length;
    parts.push(card("Volunteers", `<div class="ovstat"><b>${vols.data.length}</b> signed up · <b>${recent}</b> this week · <b>${open}</b> awaiting a decision</div>`, "volunteers")); }
  main.innerHTML = `<h2>${esc(fmtDay(today))}</h2><div class="ovgrid">${parts.join("") || card("Welcome", none("Pick a page above."))}</div>`;
  main.onclick = e => { const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); go(g.dataset.go); } };
}

AuthUI.watchRecovery(sb, main);
boot();
