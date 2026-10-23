/* The Mall: Mayoral Analysis for London's Liberals.
 * Static front end; all data and permissions live in Supabase (row-level security).
 * Nothing in this file is a security boundary: the server decides what each role can read or write. */
const CFG = window.MALL_CONFIG;
const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, detectSessionInUrl: true } });
const $ = (s, el = document) => el.querySelector(s);
const main = $("#main");

const ROLES = { core_team: "Core team", executive: "Executive", local_party_chair: "Local party chair",
  candidate: "Candidate", support_team: "Support team", member: "Member" };
const RESOURCES = {
  plan_full: "Full campaign plan (all rows)", plan_shared: "Shared plan rows (Solney story, milestones, policy, digital, campaigns, visits)",
  visits: "Local party visits sheet (incl. contacts)", budget: "Budget & governance", volunteers_all: "Full volunteer list",
  volunteers_add: "Add volunteers (own entries visible to the adder)", policies: "Policies", social: "Social media tracker",
  coverage: "Coverage", stakeholders_all: "Full stakeholder list", stakeholders_add: "Add stakeholders (own entries visible to the adder)",
  users: "Team & access: see users / change roles", permissions: "Edit this permissions table" };

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = u => { try { const p = new URL(u); return /^https?:$/.test(p.protocol) ? p.href : null; } catch { return null; } };
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = s => { const d = parseISO(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const fmtDay = s => parseISO(s).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtShort = s => parseISO(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const gbp = n => "£" + Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const S = { user: null, profile: null, perm: {}, tab: null };
const can = (res, act) => !!(S.perm[res] && S.perm[res][act === "read" ? "r" : "w"]);

function notice(msg, kind = "err") { const n = document.createElement("div"); n.className = "notice " + kind; n.textContent = msg; return n; }
function showError(err) { main.prepend(notice(err.message || String(err))); window.scrollTo(0, 0); }

/* ------------------------------------------------------------------ auth */
function renderLogin() {
  $("#tabs").hidden = true; $("#who").textContent = "";
  AuthUI.render(sb, main, { title: "THE MALL" });
}

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return renderLogin();
  S.user = session.user;
  const { data: prof, error } = await sb.from("profiles").select("*").eq("id", S.user.id).maybeSingle();
  if (error) return showError(error);
  S.profile = prof;
  $("#who").innerHTML = `${esc(S.user.email)} · ${esc(prof?.role ? ROLES[prof.role] : "no role yet")} <button class="btn sm" id="pw">Password</button> <button class="btn sm" id="so">Sign out</button>`;
  $("#so").onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $("#pw").onclick = () => { $("#tabs").hidden = true; AuthUI.changePassword(sb, main); };
  if (!prof?.role) {
    $("#tabs").hidden = true;
    main.innerHTML = `<div class="login"><div class="card"><h2 style="margin-top:0">Waiting for access</h2>
      <p>You're signed in as <b>${esc(S.user.email)}</b>, but a core team member hasn't given you a role yet. Ask them to assign you one, then refresh this page.</p></div></div>`;
    return;
  }
  const { data: perms, error: pe } = await sb.from("role_permissions").select("*").eq("role", prof.role);
  if (pe) return showError(pe);
  S.perm = Object.fromEntries(perms.map(p => [p.resource, { r: p.can_read, w: p.can_write }]));
  buildTabs();
}

const TABS = [
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
async function go(id) {
  S.tab = id;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.t === id));
  main.innerHTML = '<p class="muted">Loading…</p>';
  const t = TABS.find(x => x[0] === id);
  if (t) { try { await t[3](); } catch (e) { showError(e); } }
}

/* ------------------------------------------------------------------ dialog form */
function openForm({ title, fields, values = {}, submitLabel = "Save", onSubmit, onDelete }) {
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
    <button class="btn" type="button" id="cx">Cancel</button>${onDelete ? '<button class="btn danger" type="button" id="del" style="margin-left:auto">Delete</button>' : ""}</div><div id="fe"></div></form>`;
  document.body.append(dlg); dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); };
  $("#cx", dlg).onclick = close; dlg.addEventListener("cancel", () => dlg.remove());
  $("form", dlg).onsubmit = async e => {
    e.preventDefault();
    const out = {};
    for (const f of fields) {
      const raw = $("#f_" + f.k, dlg).value.trim();
      out[f.k] = raw === "" ? null : f.type === "number" ? Number(raw) : f.type === "bool" ? raw === "true" : raw;
    }
    const err = await onSubmit(out);
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
// cfg: {table, title, fields, order:[col,asc], canEdit(), canAdd(), owned, note, hideCols}
async function crud(cfg, host = main, after) {
  const canAdd = cfg.canAdd ? cfg.canAdd() : cfg.canEdit();
  const canEdit = cfg.canEdit();
  host.innerHTML = `${cfg.title ? `<h2>${esc(cfg.title)}</h2>` : ""}${cfg.note ? `<p class="muted">${esc(cfg.note)}</p>` : ""}
    <div class="row"><input class="grow" type="search" placeholder="Search…" data-q>${canAdd ? '<button class="btn primary" data-add>+ Add</button>' : ""}</div>
    ${cfg.beforeTable ? cfg.beforeTable : ""}<div class="tablewrap"><table></table></div><div data-foot></div>`;
  const { data, error } = await sb.from(cfg.table).select(cfg.select || "*").order(cfg.order[0], { ascending: cfg.order[1] });
  if (error) return showError(error);
  const cols = cfg.fields.filter(f => !f.hidden);
  const draw = () => {
    const q = $("[data-q]", host).value.toLowerCase();
    const rows = data.filter(r => !q || JSON.stringify(Object.values(r)).toLowerCase().includes(q));
    $("table", host).innerHTML = `<tr>${cols.map(f => `<th>${esc(f.label)}</th>`).join("")}${canEdit ? "<th></th>" : ""}</tr>` +
      (rows.map(r => `<tr>${cols.map(f => `<td class="${f.type === "textarea" ? "wrapcell" : ""}">${f.render ? f.render(r) : cellHtml(f, r[f.k])}</td>`).join("")}${canEdit || (cfg.ownEdit && r.created_by === S.user.id) ? `<td><button class="btn sm" data-edit="${r.id}">Edit</button></td>` : ""}</tr>`).join("") ||
        `<tr><td colspan="${cols.length + 1}" class="muted">Nothing here yet.</td></tr>`);
    $("[data-foot]", host).innerHTML = cfg.footer ? cfg.footer(rows) : `<p class="muted">${rows.length} row${rows.length === 1 ? "" : "s"}</p>`;
  };
  const form = (row) => {
    const fields = cfg.fields.filter(f => !f.noForm);
    openForm({
      title: row ? "Edit" : "Add", fields, values: row || {},
      onSubmit: async vals => {
        if (cfg.owned && !row) vals.created_by = S.user.id;
        const { error: e } = row ? await sb.from(cfg.table).update(vals).eq("id", row.id) : await sb.from(cfg.table).insert(vals);
        if (!e) (after || (() => crud(cfg, host, after)))();
        return e;
      },
      onDelete: row ? async () => { const { error: e } = await sb.from(cfg.table).delete().eq("id", row.id); if (!e) (after || (() => crud(cfg, host, after)))(); return e; } : null
    });
  };
  draw();
  $("[data-q]", host).oninput = draw;
  const add = $("[data-add]", host); if (add) add.onclick = () => form(null);
  host.onclick = e => { const b = e.target.closest("[data-edit]"); if (b) form(data.find(r => r.id === b.dataset.edit)); };
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
    onSubmit: async v => { const { error } = entry ? await sb.from("plan_entries").update({ ...v, updated_at: new Date().toISOString() }).eq("id", entry.id)
      : await sb.from("plan_entries").insert({ ...v, category_id: cat.id }); if (!error) renderPlan(); return error; },
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
  note: "Every time Sarah Olney has been mentioned in the media.",
  fields: [T("covered_on", "Date", "date", { req: true }), T("outlet", "Outlet", "text", { req: true }), T("headline", "Headline", "text", { req: true, render: r => {
      const u = safeUrl(r.url); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(r.headline)}</a>` : esc(r.headline); } }),
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
      fields: [T("account_id", "Account", "select", { req: true, options: opts, render: r => esc(map[r.account_id] || "") }), T("posted_at", "Posted", "date", { render: r => r.posted_at ? esc(fmtShort(r.posted_at.slice(0, 10))) : "—" }),
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
        onSubmit: async v => { const { error: er } = await sb.from("social_accounts").update(v).eq("id", a.id); if (!er) renderSocial(); return er; } }); }
    if (o) openForm({ title: "Add organisation", fields: [T("organisation", "Organisation or account owner", "text", { req: true })],
      onSubmit: async v => { const { error: er } = await sb.from("social_accounts").insert(PLATFORMS.map(p => ({ organisation: v.organisation, platform: p }))); if (!er) renderSocial(); return er; } });
  };
}

/* ------------------------------------------------------------------ team & access */
async function renderTeam() {
  const [{ data: profs, error }, { data: perms, error: pe }] = await Promise.all([
    sb.from("profiles").select("*").order("created_at"), sb.from("role_permissions").select("*")]);
  if (error || pe) return showError(error || pe);
  const canRole = can("users", "write"), canPerm = can("permissions", "write");
  const pending = profs.filter(p => !p.role).length;
  main.innerHTML = `<h2>People ${pending ? `<span class="pill" style="color:var(--warn)">${pending} awaiting a role</span>` : ""}</h2>
    <div class="tablewrap"><table><tr><th>Email</th><th>Name</th><th>Role</th></tr>${profs.map(p => `<tr><td>${esc(p.email)}</td><td>${esc(p.full_name)}</td><td>${canRole ?
      `<select data-u="${p.id}"><option value="">(no access)</option>${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${p.role === k ? "selected" : ""}>${l}</option>`).join("")}</select>` : esc(ROLES[p.role] || "none")}</td></tr>`).join("")}</table></div>
    <h2>What each role can do</h2><p class="muted">R = read, W = write. These are the defaults and can be changed here. The core team's own "Team &amp; access" rights are locked so you can't lock yourself out.</p>
    <div class="tablewrap"><table><tr><th>Area</th>${Object.values(ROLES).map(l => `<th>${l}</th>`).join("")}</tr>${Object.entries(RESOURCES).map(([res, label]) =>
      `<tr><td>${esc(label)}</td>${Object.keys(ROLES).map(role => { const p = perms.find(x => x.role === role && x.resource === res) || {};
        const locked = !canPerm || (role === "core_team" && (res === "users" || res === "permissions"));
        return `<td>${["read", "write"].map(a => `<label style="display:inline;margin-right:8px;color:var(--ink)"><input type="checkbox" style="width:auto" data-p="${role}|${res}|${a}" ${p["can_" + a] ? "checked" : ""} ${locked ? "disabled" : ""}> ${a === "read" ? "R" : "W"}</label>`).join("")}</td>`; }).join("")}</tr>`).join("")}</table></div>`;
  main.onchange = async e => {
    const u = e.target.closest("[data-u]"), p = e.target.closest("[data-p]");
    if (u) { const { error: er } = await sb.from("profiles").update({ role: u.value || null }).eq("id", u.dataset.u); if (er) showError(er); else renderTeam(); }
    if (p) { const [role, res, a] = p.dataset.p.split("|");
      const cur = perms.find(x => x.role === role && x.resource === res) || { can_read: false, can_write: false };
      const row = { role, resource: res, can_read: cur.can_read, can_write: cur.can_write, ["can_" + a]: p.checked };
      const { error: er } = await sb.from("role_permissions").upsert(row); if (er) showError(er); else renderTeam(); }
  };
}

AuthUI.watchRecovery(sb, main);
boot();
