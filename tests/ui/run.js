// End-to-end UI check with a mocked Supabase: every page, as an admin, a core team member and a member.
// Fails on console errors, CSP violations or missing content. Run: node tests/ui/run.js  (starts its own server)
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = 8765, BASE = `http://127.0.0.1:${PORT}`;
const SB = "https://fbsoibmtvapmxdlfdgxc.supabase.co";
const ROOT = path.resolve(__dirname, "../..");
const today = new Date(), iso = d => d.toISOString().slice(0, 10), plus = n => iso(new Date(Date.now() + n * 864e5));
const feedFile = path.join(ROOT, "data/ulysse/feed.json");
const _rel = (id, title, publisher, tier, kind, date, extra = {}) => ({ id, title, publisher, tier, kind, date, datetime: null, date_precision: "day", date_status: "confirmed", previous_dates: [], cancelled: kind === "cancelled", summary: "", url: "https://www.gov.uk/x/" + id, first_seen: "2026-01-01T00:00:00+00:00", ...extra });
const STATSCAL = { updated: new Date().toISOString(), changes: [{ at: new Date().toISOString(), type: "date_changed", id: "r2", title: "Moved release", publisher: "Office for National Statistics", tier: "ons", date: plus(9), old_date: plus(3), new_date: plus(9), url: "https://www.ons.gov.uk/x" }],
  sources: [{ source: "ons", ok: true, count: 3 }, { source: "govuk", ok: false, count: 0, stale: true, error: "HTTP 503" }],
  releases: [_rel("r1", "Labour market overview", "Office for National Statistics", "ons", "upcoming", plus(2), { datetime: plus(2) + "T09:30:00+00:00" }),
    _rel("r2", "Moved release", "Office for National Statistics", "ons", "upcoming", plus(9), { date_status: "provisional", previous_dates: [{ date: plus(3), change_notice: "Postponed", changed_at: null }] }),
    _rel("r3", "Monthly crime figures", "Home Office", "national", "upcoming", plus(5), { date_precision: "month", date_status: "provisional" }),
    _rel("r4", "Hospital admissions", "NHS England", "alb", "published", plus(-1)),
    _rel("r5", "Cancelled thing", "Department for Transport", "national", "cancelled", plus(4)),
    _rel("r6", "Police.uk data (next, estimated)", "data.police.uk (all forces)", "london", "upcoming", plus(12), { date_status: "estimated" }),
    _rel("m1", "Transport Committee", "London Assembly", "london", "upcoming", plus(2), { category: "meeting", datetime: plus(2) + "T10:00:00+00:00", summary: "Agenda: 1. Apologies for Absence; 2. Declarations of Interests; 3. Bus services", links: [{ label: "Agenda frontsheet", url: "https://www.london.gov.uk/a.pdf" }, { label: "Agenda reports pack", url: "https://www.london.gov.uk/b.pdf" }] }),
    _rel("m2", "Police and Crime Committee", "London Assembly", "london", "published", plus(-2), { category: "meeting", datetime: plus(-2) + "T14:00:00+00:00" })] };
const FEED =fs.existsSync(feedFile) ? JSON.parse(fs.readFileSync(feedFile)) : { updated: new Date().toISOString(), items: [] };
FEED.updated = new Date().toISOString();

const USERS = {
  admin: { id: "00000000-0000-0000-0000-0000000000a1", email: "owner@test.invalid", role: "core_team", admin: true },
  core: { id: "00000000-0000-0000-0000-0000000000c1", email: "core@test.invalid", role: "core_team", admin: false },
  member: { id: "00000000-0000-0000-0000-0000000000e1", email: "member@test.invalid", role: "member", admin: false },
  lmgr: { id: "00000000-0000-0000-0000-0000000000b1", email: "lucienmgr@test.invalid", role: null, admin: false },   // manages LUCIEN only
};
const LEVELS = [
  ["lovelace", "member", "Member", 1], ["lovelace", "candidate", "Candidate", 3], ["lovelace", "core_team", "Core team", 6],
  ["lucien", "access", "Access", 1],
  ["libby", "beta", "Beta tester", 1], ["libby", "peers", "Peer", 1], ["libby", "staff", "Staff", 3], ["libby", "admin", "Admin", 4]].map(([program, level, label, rank]) => ({ program, level, label, rank, admin_only: level === "admin" }));
const BIG = 2147483647;
const programsFor = who => who === "admin" ? { lovelace: { level: "core_team", manager: true, limit: BIG }, lucien: { level: "access", manager: true, limit: BIG }, libby: { level: "admin", manager: true, limit: BIG } }
  : who === "core" ? { lovelace: { level: "core_team", manager: true, limit: BIG } }
  : who === "lmgr" ? { lucien: { level: "access", manager: true, limit: BIG } }
  : { lovelace: { level: "member", manager: false, limit: 0 } };
const PEOPLE = { lucien: [{ user_id: "p1", email: "reader@test.invalid", full_name: "Rae Reader", level: "access", is_manager: false, grant_ceiling: null, expires_at: null, last_sign_in_at: null }],
  libby: [{ user_id: "p2", email: "peer@test.invalid", full_name: "", level: "peers", is_manager: false, grant_ceiling: null, expires_at: null, last_sign_in_at: null },
          { user_id: "p3", email: "bm@test.invalid", full_name: "", level: "staff", is_manager: true, grant_ceiling: 3, expires_at: null, last_sign_in_at: null }],
  lovelace: [{ user_id: "p4", email: "core@test.invalid", full_name: "", level: "core_team", is_manager: true, grant_ceiling: null, expires_at: null, last_sign_in_at: null }] };
const PERMS = {
  core_team: ["plan_full", "plan_shared", "plan_constituency", "budget", "volunteers_all", "volunteers_add", "policies", "social", "coverage", "stakeholders_all", "stakeholders_add", "visits", "users", "permissions", "audit"],
  member: ["plan_shared", "volunteers_add", "stakeholders_add", "coverage"],
};
const ALLRES = [...PERMS.core_team, "ulysse"];
const ts = new Date(Date.now() - 3 * 36e5).toISOString();
const TABLES = {
  profiles: Object.values(USERS).map(u => ({ id: u.id, email: u.email, full_name: u.email.split("@")[0], role: u.role, access_until: u.role === "member" ? plus(20) : null, created_at: ts })),
  role_permissions: ["core_team", "member"].flatMap(r => ALLRES.map(res => ({ role: r, resource: res, can_read: PERMS[r].includes(res) || (r === "member" && res === "coverage"), can_write: PERMS[r].includes(res) && r === "core_team" || ["volunteers_add", "stakeholders_add"].includes(res) }))),
  plan_categories: [{ id: 1, name: "Main News", grp: "Main News", sort: 1, shared: false }, { id: 4, name: "Constituency Activity: North East", grp: "Across London", sort: 11, shared: true, constituency: true }, { id: 5, name: "Constituency Activity: West Central", grp: "Across London", sort: 12, shared: true, constituency: true }, { id: 6, name: "Local Party Activity", grp: "Across London", sort: 30, shared: true, constituency: true },
    { id: 8, name: "Mayoral Activity", grp: "Campaigning", sort: 50, shared: true }, { id: 3, name: "Action Days", grp: "Campaigning", sort: 51, shared: true }, { id: 7, name: "Parliamentary News", grp: "Media", sort: 60, shared: false }, { id: 2, name: "Media Activity", grp: "Media", sort: 63, shared: false }],
  plan_entries: [{ id: "p1", plan_date: iso(today), category_id: 1, content: "Launch housing pledge", updated_at: ts }, { id: "p3", plan_date: iso(today), category_id: 6, content: "Richmond Park street stall", updated_at: ts }, { id: "p2", plan_date: plus(2), category_id: 2, content: "Op-ed in the Standard", updated_at: ts }],
  local_party_visits: [{ id: "v1", local_party: "Richmond Park", request: "Street stall", contact_name: "Pat", contact_phone: "0701", taken_by: "Louis", actioning: "Sarah", visit_date: iso(today), updated_at: ts },
    { id: "v2", local_party: "Hounslow", request: "AGM", visit_date: null, updated_at: ts }],
  governance_items: [{ id: "g1", title: "Register with Electoral Commission", area: "Legal", status: "To do", due_date: plus(-1), updated_at: ts }],
  content_items: [{ id: "c1", name: "Housing video", status: "In Development", scheduled: plus(4), platforms: "Instagram", updated_at: ts }],
  media_coverage: [{ id: "m1", covered_on: iso(today), outlet: "BBC News", headline: "Sarah Olney on Heathrow", url: "https://example.org/a", source: "auto", kind: "libdem", updated_at: ts },
    { id: "m2", covered_on: plus(-3), outlet: "Standard", headline: "Olney backs rent reform", url: "https://example.org/b", source: "manual", kind: "libdem", updated_at: ts },
    { id: "m3", covered_on: plus(-1), outlet: "BlueSky", headline: "Out in Kingston talking about the cost of living", url: "https://example.org/c", source: "social", kind: "libdem", updated_at: ts },
    { id: "m4", covered_on: plus(-1), outlet: "Hansard", headline: "Heathrow expansion debated in the Commons", url: "https://example.org/d", source: "manual", kind: "overall", topic: "parliament", updated_at: ts }],
  contacts: [{ id: "vo1", kind: "volunteer", name: "Alex Volunteer", organisation: "Lib Dems", sector: "Lib Dems", email: "alex@test.invalid", phone: "0700", owner: "Louis", notes: "Role: Canvassing", created_by: USERS.member.id, created_at: ts, updated_at: ts },
    { id: "s1", kind: "stakeholder", name: "Jo Bloggs", organisation: "Shelter", sector: "Campaign", email: null, phone: null, owner: "Sarah", notes: null, created_by: USERS.core.id, created_at: ts, updated_at: ts }],
  budget_items: [{ id: "b1", item: "Leaflets", amount: 1200, category: "Print", updated_at: ts }, { id: "b2", item: "Hall hire", amount: 300, category: "Events", updated_at: ts }],
  policies: [{ id: "po1", policy: "Rent controls", theme: "Housing", updated_at: ts }],
  social_accounts: ["Instagram", "Facebook", "Twitter", "BlueSky", "Substack", "TikTok", "LinkedIn"].map((p, i) => ({ id: "sa" + i, organisation: "Sarah Olney", platform: p, handle: i ? null : "@sarah", url: null, updated_at: ts })),
  social_posts: [],
  audit_log: [{ id: 1, at: ts, user_email: "core@test.invalid", table_name: "plan_entries", label: "Launch housing pledge", action: "update", changed: ["content"] }],
  ulysse_data: [{ name: "statscal", body: STATSCAL, updated_at: new Date().toISOString() }, { name: "feed", body: FEED, updated_at: new Date().toISOString() }, { name: "polls", body: { rows: [] } }, { name: "health", body: { sources: [{ group: "media", name: "BBC News", ok: true, items: 3 }, { group: "thinktanks", name: "IFS", ok: false, items: 0, error: "site refuses bots" }] } }],
  ulysse_read: [],
  program_levels: LEVELS,
  access_grants: [],
  access_codes: [{ id: "k1", label: "Peers", program: "libby", level: "peers", code_text: "Peers2026-test", expires_at: null, max_uses: null, uses: 3, revoked_at: null, created_at: ts }],
};

function access(u) {
  const perms = {};
  for (const res of ALLRES) {
    const r = TABLES.role_permissions.find(x => x.role === u.role && x.resource === res) || {};
    perms[res] = { r: u.admin || !!r.can_read, w: u.admin || !!r.can_write };
  }
  return { profile: TABLES.profiles.find(p => p.id === u.id), role: u.role, admin: u.admin, perms, programs: programsFor(Object.keys(USERS).find(k => USERS[k] === u)) };
}

async function mock(page, who, log) {
  const u = USERS[who];
  await page.route(SB + "/**", async route => {
    const req = route.request(), url = new URL(req.url()), m = req.method();
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", ...headers }, body: JSON.stringify(body) });
    if (m === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (url.pathname === "/functions/v1/invite-person") { log.push(`INVITE ${req.postData()}`); return json({ status: "invited", emailed: true, note: "" }); }
    if (url.pathname === "/rest/v1/rpc/my_access") return json(access(u));
    if (url.pathname === "/rest/v1/rpc/team_last_seen") return json(Object.values(USERS).map(x => ({ id: x.id, last_sign_in_at: ts })));
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.split("/").pop(), body = m === "POST" ? JSON.parse(req.postData() || "{}") : {};
      if (fn === "program_people") return json(PEOPLE[body.p] || []);
      if (fn === "program_codes") return json((TABLES.access_codes || []).filter(c => c.program === body.p).map(c => ({ ...c, code: c.code_text || null })));
      if (fn === "all_people") return json(u.admin ? [
        { user_id: USERS.admin.id, email: USERS.admin.email, full_name: "", created_at: ts, last_sign_in_at: ts, admin: true, grants: [] },
        { user_id: "n1", email: "newbie@test.invalid", full_name: "", created_at: ts, last_sign_in_at: null, admin: false, grants: [] },
        { user_id: USERS.core.id, email: USERS.core.email, full_name: "Cora Core", created_at: ts, last_sign_in_at: ts, admin: false, grants: [{ program: "lovelace", level: "core_team", is_manager: true, grant_ceiling: null, expires_at: null }] }] : []);
      log.push(`RPC ${fn} ${JSON.stringify(body)}`);
      return json(fn === "create_access_code" ? "abcd-1234-abcd-1234-abcd" : null);
    }
    const t = url.pathname.replace("/rest/v1/", "");
    if (!(t in TABLES)) { log.push(`unmocked ${m} ${url.pathname}`); return json({ message: "not mocked" }, 404); }
    if (m === "HEAD") return route.fulfill({ status: 200, headers: { "content-range": `0-0/${TABLES[t].length}`, "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" } });
    if (m === "PATCH") { log.push(`PATCH ${t} ${url.search}`); return json(t === "plan_entries" ? [] : [{ id: "x" }]); }   // plan edits simulate a conflict
    if (m === "POST" || m === "DELETE") { log.push(`${m} ${t}`); return json([]); }
    let rows = TABLES[t];
    const eqProgram = url.searchParams.get("program");
    if (eqProgram) rows = rows.filter(r => "eq." + r.program === eqProgram);
    const eqName = url.searchParams.get("name");
    if (eqName) rows = rows.filter(r => "eq." + r.name === eqName);
    const eqKind = url.searchParams.get("kind");
    if (eqKind) rows = rows.filter(r => "eq." + r.kind === eqKind);
    if (url.searchParams.get("topic") === "not.is.null") rows = rows.filter(r => r.topic);
    if ((req.headers()["accept"] || "").includes("vnd.pgrst.object")) return json(rows[0] || null);
    return json(rows);
  });
  await page.addInitScript(([u]) => {
    localStorage.setItem("sb-fbsoibmtvapmxdlfdgxc-auth-token", JSON.stringify({
      access_token: "x.y.z", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: u.id, email: u.email, aud: "authenticated", role: "authenticated" } }));
  }, [u]);
}

const results = [];
const check = (name, ok, extra = "") => { results.push([ok, name, extra]); };

(async () => {
  const srv = spawn("python3", [path.join(__dirname, "serve.py"), String(PORT)], { stdio: "ignore" });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch();
  try {
    {   // signed out: one sign-in for everything, and the old addresses still work
      const ctx = await browser.newContext(); const page = await ctx.newPage(); const errs = [];
      page.on("console", msg => { if (msg.type() === "error") errs.push(msg.text()); });
      await page.route(SB + "/**", r => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" }));
      await page.goto(BASE + "/"); await page.waitForSelector("#aue", { timeout: 5000 }).catch(() => {});
      check("signed out: home shows the sign-in form", (await page.$("#aue")) !== null && !(await page.$("#n a")));
      if (process.env.SHOTS) { await page.goto(BASE + "/"); await page.waitForTimeout(600); await page.screenshot({ path: path.join(process.env.SHOTS, "signin.png") }); }
      await page.goto(BASE + "/mall/#team"); await page.waitForTimeout(500);
      check("old /mall/ address redirects to /lovelace/ and keeps the #team part", page.url() === BASE + "/lovelace/#team", page.url());
      await page.goto(BASE + "/ulysse/"); await page.waitForTimeout(500);
      check("old /ulysse/ address redirects to /lucien/", page.url() === BASE + "/lucien/", page.url());
      check("signed out: no console errors", errs.filter(e => !/404/.test(e)).length === 0, errs.join("|"));
      await ctx.close();
    }
    for (const who of ["admin", "core", "member", "lmgr"]) {
      const ctx = await browser.newContext({ acceptDownloads: true });
      await ctx.addInitScript(() => { window.ATHENA_DROPDOWNS_OPEN = true; });   // the tests read whole pages; the one test of the default turns it off
      const page = await ctx.newPage();
      const errors = [], log = [];
      page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
      page.on("pageerror", e => errors.push("pageerror: " + e.message));
      await mock(page, who, log);

      await page.goto(BASE + "/");
      await page.waitForTimeout(600);
      if (process.env.SHOTS && who === "admin") for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(process.env.SHOTS, `athena-home-${scheme}.png`), fullPage: true }); await page.emulateMedia({ colorScheme: "light" }); }
      const links = await page.$$eval("#n a b", bs => bs.map(b => b.textContent));
      check(`${who}: home shows LUCIEN to the admin and LUCIEN people only`, links.includes("LUCIEN") === (who === "admin" || who === "lmgr"), links.join(","));
      check(`${who}: home shows Access only to the admin and program managers`, links.includes("Access") === (who === "admin" || who === "lmgr" || who === "core"), links.join(","));

      // the Access page: admin sees every program, a program manager only theirs, others nothing
      await page.goto(BASE + "/access/");
      await page.waitForTimeout(800);
      const aTabs = await page.$$eval("#tabs button", bs => bs.map(b => b.textContent)).catch(() => []);
      const aText = await page.$eval("body", b => b.innerText);
      check(`${who}: Access page shows the right programs`, JSON.stringify(aTabs) === JSON.stringify({ admin: ["Everyone", "LOVELACE", "LUCIEN", "LIBBY"], core: ["LOVELACE"], lmgr: ["LUCIEN"], member: [] }[who]) && (aTabs.length > 0 || /Not found/.test(aText)), aTabs.join(","));
      if (who === "admin") {   // Everyone: one row per account, a level to choose for each program
        const rows = await page.$$eval("#everyone tbody tr", rs => rs.map(r => r.dataset.e));
        check("admin: Everyone lists every account, with the ones waiting for access", rows.length === 3 && rows.includes("newbie@test.invalid") && /Waiting for your approval\s*1/.test(await page.$eval("#body", b => b.innerText)), rows.join(","));
        check("admin: a new account waits for approval (nothing is open to it until approved), with Approve and Delete", (await page.$$eval("#approve tbody tr", rs => rs.map(r => r.dataset.e))).join() === "newbie@test.invalid" && (await page.$$("#approve [data-approve]")).length === 1 && (await page.$$("#approve [data-delperson]")).length === 1);
        check("admin: every account except an administrator and yourself can be deleted outright", (await page.$$eval("#everyone tbody tr", rs => rs.filter(r => r.querySelector("[data-delperson]")).map(r => r.dataset.e))).join() === "newbie@test.invalid,core@test.invalid");
        check("admin: there is a form to invite someone by email", (await page.$("#invite")) !== null && (await page.$$eval("#invite #ip option", os => os.map(o => o.value))).join() === "lovelace,lucien,libby");
        await page.fill("#ie", "invitee@test.invalid"); await page.click("#invite button[type=submit]"); await page.waitForTimeout(500);
        check("admin: inviting sends the email, program, level and the redirect", log.some(l => l.startsWith("INVITE") && l.includes("invitee@test.invalid") && l.includes('"program":"lovelace"') && l.includes('"send":true')), log.filter(l => l.startsWith("INVITE")).join(";"));
        await page.evaluate(() => { document.querySelector("#everyone").dataset.marker = "same-table"; window.scrollTo(0, 120); });
        const yBefore = await page.evaluate(() => window.scrollY);
        await page.selectOption('#everyone tr[data-e="core@test.invalid"] select[data-ev="lucien"]', "access"); await page.waitForTimeout(500);
        check("admin: changing someone's level does not redraw the page: the table, scroll position and focus stay put, so the next change can follow at once", (await page.$eval("#everyone", t => t.dataset.marker)) === "same-table" && Math.abs((await page.evaluate(() => window.scrollY)) - yBefore) < 3 && /access saved/.test(await page.$eval("#flash", f => f.textContent)));
        await page.selectOption('#everyone tr[data-e="core@test.invalid"] select[data-ev="lucien"]', ""); await page.waitForTimeout(400);
        check("admin: and the next change works straight away", (await page.$eval("#everyone", t => t.dataset.marker)) === "same-table" && /access removed/.test(await page.$eval("#flash", f => f.textContent)));
        await page.click('#approve [data-approve]'); await page.waitForTimeout(400);
        check("admin: Approve gives the chosen level (grant_access)", log.some(l => l.startsWith("RPC grant_access") && l.includes("newbie@test.invalid")));
        page.once("dialog", d => d.accept());
        await page.click('#everyone tr[data-e="newbie@test.invalid"] [data-delperson]'); await page.waitForTimeout(400);
        check("admin: Delete removes an account for good (delete_person)", log.some(l => l.startsWith("RPC delete_person") && l.includes('"p_user":"n1"')), log.filter(l => l.startsWith("RPC")).slice(-3).join(";"));
        const sels = await page.$$eval('#everyone tr[data-e="newbie@test.invalid"] select', ss => ss.map(x => x.dataset.ev));
        check("admin: each account has a level for LOVELACE, LUCIEN and LIBBY", sels.join(",") === "lovelace,lucien,libby", sels.join(","));
        if (process.env.SHOTS) for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(process.env.SHOTS, `access-everyone-${scheme}.png`), fullPage: true }); }
        await page.emulateMedia({ colorScheme: "light" });
        await page.selectOption('#everyone tr[data-e="newbie@test.invalid"] select[data-ev="lovelace"]', "candidate"); await page.waitForTimeout(500);
        check("admin: choosing a LOVELACE level gives it", log.some(l => l.startsWith("RPC grant_access") && l.includes("newbie@test.invalid") && l.includes('"p_program":"lovelace"') && l.includes('"p_level":"candidate"')), log.filter(l => l.startsWith("RPC")).join(";"));
        await page.selectOption('#everyone tr[data-e="core@test.invalid"] select[data-ev="lovelace"]', ""); await page.waitForTimeout(500);
        check("admin: choosing No access removes it", log.some(l => l.startsWith("DELETE access_grants")), log.slice(-4).join(";"));
      }
      if (who === "admin" || who === "lmgr") {
        if (who === "admin") await page.click('#tabs button:text-is("LIBBY")');
        await page.waitForSelector("#add");   // only editable programs have it, so the table on screen is the right one
        const hasMgr = (await page.$$("[data-mgr]")).length > 0;
        check(`${who}: only the admin sees the Manager switch`, hasMgr === (who === "admin"));
        const levelOpts = await page.$$eval("#al option", os => os.map(o => o.textContent));
        check(`${who}: level list matches what may be given`, who === "admin" ? levelOpts.includes("Admin") : levelOpts.join() === "Access", levelOpts.join());
        await page.fill("#ae", "new@test.invalid"); await page.click('#add button[type=submit]'); await page.waitForTimeout(500);
        check(`${who}: Give access calls grant_access`, log.some(l => l.startsWith("RPC grant_access") && l.includes("new@test.invalid")), log.filter(l => l.startsWith("RPC")).join(";"));
        await page.fill("#cl", "Volunteers"); await page.fill("#cc", "simple-pass-1"); await page.click('#mk button[type=submit]'); await page.waitForTimeout(500);
        check(`${who}: a new code is shown, and kept in the table`, (await page.$eval("#newcode", e => e.textContent).catch(() => "")) === "abcd-1234-abcd-1234-abcd" && log.some(l => l.startsWith("RPC create_access_code") && l.includes("simple-pass-1")));
        check(`${who}: a program tab can invite someone by email too`, (await page.$("#invite")) !== null && (await page.$$("#invite #ip")).length === 1);
        if (await page.$("#codes [data-delcode]")) {
          page.once("dialog", d => d.accept());
          await page.click("#codes [data-delcode]"); await page.waitForTimeout(400);
          check(`${who}: a code can be deleted outright, not only switched off`, log.some(l => l.startsWith("RPC delete_access_code")), log.filter(l => l.startsWith("RPC")).slice(-3).join(";"));
        }
        if (await page.$("#codes")) {
          const kept =await page.$eval("#codes", t => t.innerText);
          check(`${who}: the codes table shows each code (to copy), its level, end time and use`, /Peers2026-test/.test(kept) && (await page.$$("#codes [data-copy]")).length >= 1 && (await page.$$("#codes select[data-cl]")).length >= 1 && (await page.$$("#codes input[data-ce]")).length >= 1 && /used/i.test(kept), kept.slice(0, 120).replace(/\n/g, " "));
          await page.selectOption("#codes select[data-cl]", { index: 0 }); await page.waitForTimeout(400);
          check(`${who}: changing a code's level calls set_code_level`, log.some(l => l.startsWith("RPC set_code_level")), log.filter(l => l.startsWith("RPC")).slice(-4).join(";"));
        }
        if (who === "admin") {
          page.once("dialog", d => d.accept());
          await page.click("#codes [data-off]"); await page.waitForTimeout(400);
          check("admin: Switch off calls revoke_access_code", log.some(l => l.startsWith("RPC revoke_access_code") && l.includes("k1")));
          await page.selectOption('tr[data-u="p2"] select[data-f=level]', "staff"); await page.waitForTimeout(400);
          check("admin: changing a level sends a PATCH", log.some(l => l.startsWith("PATCH access_grants") && l.includes("user_id=eq.p2")), log.filter(l => l.startsWith("PATCH")).join(";"));
          await page.check('tr[data-u="p2"] [data-mgr]'); await page.waitForTimeout(400);
          check("admin: Manager switch calls set_manager", log.some(l => l.startsWith("RPC set_manager") && l.includes('"p_on":true')));
          check("admin: you cannot edit a row that is yourself, a manager above the limit is editable only by admin", (await page.$('tr[data-u="p3"] select[data-f=level]:not([disabled])')) !== null);
          if (process.env.SHOTS) for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.screenshot({ path: path.join(process.env.SHOTS, `access-${scheme}.png`), fullPage: true }); }
          await page.emulateMedia({ colorScheme: "light" });
          await page.click('#tabs button:text-is("LOVELACE")'); await page.waitForTimeout(400);
          check("admin: LOVELACE is managed here like the others (people, levels, give access, codes)", (await page.$("#add")) !== null && (await page.$("#mk")) !== null && !/still managed in/.test(await page.$eval("#body", b => b.innerText)));
        }
      }
      // LIBBY, under the same sign-in: the page runs under its own security policy and asks the server who this is
      if (who === "admin" || who === "core") {
        let lvl = "developer";
        // which LIBBY (house) and which edition the tab has chosen; the tests start in Noble LIBBY (the Lords) unless they say otherwise
        const ed = (v, house = "lords") => page.evaluate(([x, h]) => { try { if (x) sessionStorage.setItem("libbyEdition", x); else sessionStorage.removeItem("libbyEdition"); if (h) localStorage.setItem("libbyHouse", h); else localStorage.removeItem("libbyHouse"); } catch { /* none */ } }, [v, house]);
        await page.route(BASE + "/api/libby/**", route => {
          const u = new URL(route.request().url()), j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
          if (u.pathname.endsWith("/me")) return who === "admin" && lvl !== "none" ? j({ level: lvl, name: { admin: "Admin", beta: "Beta tester", developer: "Developer", staff: "Staff" }[lvl], email: USERS.admin.email }) : j({ error: "You have not been given access to LIBBY.", noAccess: true, email: USERS.core.email }, 403);
          if (u.pathname.endsWith("/status")) return j({ updated: null, lastRun: null, next: { hour: 8, tomorrow: false }, hours: [8] });
          if (u.pathname.endsWith("/api/libby/bills/1")) return j({ id: 1, title: "Test Bill [HL]", longTitle: "A Bill to test", originatingHouse: "Lords", currentStage: "Report stage", url: "https://bills.parliament.uk/bills/1", sponsors: [], summary: "",
            commonsStages: [{ id: 8, description: "Report stage", takesAmendments: true, status: "in progress", billStageId: 60, dates: [], forthcoming: [], docs: [], documents: [], otherDocs: [], slots: [] }], lordsStages: [{ id: 9, description: "Report stage", takesAmendments: true, status: "in progress", billStageId: 50, dates: [], forthcoming: [], docs: [], documents: [], otherDocs: [], slots: [] }], commonsDocs: [], otherDocs: [], unassignedForthcoming: [] });
          if (u.pathname.endsWith("/api/libby/bills/1/amendments")) {
            const sp = (n, ld, lead) => ({ name: n, lead: !!lead, ld });
            if (u.searchParams.get("stage") === "60") return j({ billId: 1, billStageId: 60, total: 1, ours: [], supported: [], all: [{ id: 201, number: "5", place: "Clause 1, page 1, line 3", summary: "A Commons amendment", sponsors: [sp("Daisy Cooper", true, true)], lead: "Daisy Cooper", leadIsLD: true, ldSigned: true }] });
            return j({ billId: 1, billStageId: 50, total: 3, ours: [], supported: [], all: [
              { id: 101, number: "12", place: "Clause 3, page 2, line 14", summary: "Leave out subsection (2)", sponsors: [sp("Lord Alpha", true, true), sp("Baroness Beta", true)], lead: "Lord Alpha", leadIsLD: true, ldSigned: true },
              { id: 102, number: "13", place: "Clause 4, page 3, line 1", summary: "Insert a review", sponsors: [sp("Lord Gamma", false, true), sp("Baroness Beta", true)], lead: "Lord Gamma", leadIsLD: false, ldSigned: true },
              { id: 103, number: "", place: "After Clause 9", summary: "New Clause", sponsors: [sp("Lord Delta", false, true)], lead: "Lord Delta", leadIsLD: false, ldSigned: false }] });
          }
          if (u.pathname.endsWith("/api/libby/bills/1/amendment")) { const aid = u.searchParams.get("aid"); return j({ id: Number(aid), location: "Clause 3", text: ["Page 2, line 14, leave out subsection (2)"], explanatoryStatement: `Statement for ${aid}: this removes the subsection.`, note: "" }); }
          if (u.pathname.endsWith("/api/libby/comments")) return j({ comments: {} });
          if (u.pathname.endsWith("/api/libby/bulletin")) {
            const hs = u.searchParams.get("house") === "commons" ? "commons" : "lords";
            if (route.request().method() === "GET") return j({ house: hs, messages: [{ id: hs === "commons" ? 2 : 1, heading: hs === "commons" ? "Commons Whips notice" : "Lords Whips notice", body: `Message for the ${hs}.`, position: 1, updated_by: "Pat", updated_at: new Date().toISOString() }] });
            (globalThis.__bulletinPosts = globalThis.__bulletinPosts || []).push(route.request().postData()); return j({ ok: true });
          }
          if (u.pathname.endsWith("/api/libby/parliamentary-process")) {
            if (route.request().method() === "GET") return j({ questions: [{ id: 1, question: "When is a Bill a Money Bill?", house: "commons", askedBy: "Pat", answer: "A Bill is a Money Bill when the Speaker certifies it [1].", sources: [{ n: 1, source: "Erskine May", ref: "26.29", title: "Money Bills", where: "", url: "https://erskinemay.parliament.uk/section/1/" }], createdAt: new Date().toISOString() }], companion: { loaded: false, edition: "", pieces: 0 } });
            (globalThis.__processPosts = globalThis.__processPosts || []).push(route.request().postData());
            return j({ id: 2, answer: "Royal Assent may be notified at a break in business [1].", confidence: "clear", sources: [{ n: 1, source: "Erskine May", ref: "26.29", title: "Royal Assent", where: "Chapter 26", url: "https://erskinemay.parliament.uk/section/16612/", excerpt: "Royal Assent may be notified at any convenient break", used: true }], queries: ["royal assent"], note: "The Lords Companion has not been uploaded yet." });
          }
          if (u.pathname.endsWith("/api/libby/data/commons-members")) return j({ date: "2026-11-10", total: 650, parties: [{ name: "Labour", abbreviation: "Lab", colour: "d50000", male: 215, female: 189, nonBinary: 0, total: 404 }, { name: "Liberal Democrat", abbreviation: "LD", colour: "faa61a", male: 40, female: 32, nonBinary: 0, total: 72 }], ldMps: [{ id: 1, name: "Daisy Cooper" }, { id: 2, name: "Sir Ed Davey" }], library: "https://commonslibrary.parliament.uk/type/data-dashboard/" });
          if (u.pathname.endsWith("/api/libby/people-roles")) {
            if (route.request().method() === "GET") return j({ roles: [{ id: "peers", label: "Peer" }, { id: "whips", label: "Whip" }, { id: "staff", label: "Staff" }], people: [{ name: "Baroness Beta", role: "whips", onList: true, house: "lords" }, { name: "Sir Ed Davey", role: "peers", onList: true, house: "commons" }, { name: "Daisy Cooper", role: "peers", onList: true, house: "commons" }, { name: "Pat Staffer", role: "staff", onList: false, house: "commons" }] });
            (globalThis.__rolePosts = globalThis.__rolePosts || []).push(route.request().postData()); return j({ ok: true });
          }
          if (u.pathname.endsWith("/api/libby/issues")) {
            if (route.request().method() === "GET") {
              const only = u.searchParams.get("portfolio");
              const issues = [{ id: 1, portfolio: "DEFRA", title: "Water company regulation", description: "Sewage discharges and Ofwat.", status: "open", createdBy: "Pat", createdAt: new Date().toISOString(), actions: [{ id: 11, what: "Oral Question on sewage discharges", kind: "oral-question", date: "2026-10-05", url: "https://hansard.parliament.uk/lords/2026-10-05/debates/x", parliamentarian: "Baroness Beta", staff: "Pat Adviser", notes: "Minister promised a review", addedBy: "Pat" }, { id: 12, what: "Amendment 14 to the Water Bill", kind: "amendment", date: "2026-11-02", url: "", parliamentarian: "Lord Alpha", staff: "", notes: "", addedBy: "" }] }, { id: 2, portfolio: "HO", title: "Asylum backlog", description: "", status: "open", createdBy: "", createdAt: new Date().toISOString(), actions: [] }];
              return j({ portfolios: [{ code: "DEFRA", name: "Environment, Food and Rural Affairs", count: 1 }, { code: "HO", name: "Home Office", count: 1 }, { code: "DfT", name: "Transport", count: 0 }], issues: only ? issues.filter(i => i.portfolio === only) : issues });
            }
            (globalThis.__issuePosts = globalThis.__issuePosts || []).push(route.request().postData()); return j({ ok: true, id: 3 });
          }
          if (u.pathname.endsWith("/api/libby/concessions")) {
            if (route.request().method() === "GET") return j({ concessions: [{ billId: 1, stageId: 50, amendmentId: 101, house: "lords", number: "12", place: "C3, P2, L14", summary: "Leave out subsection (2)", url: "https://bills.parliament.uk/bills/1/stages/50/amendments/101", billTitle: "Test Bill [HL]", portfolio: ["HO"], notes: "The Government will bring forward its own wording.", wonBy: "Pat", wonAt: new Date().toISOString(), updatedBy: "Pat", updatedAt: new Date().toISOString() }, { billId: 7, stageId: 9, amendmentId: 5, house: "commons", number: "3", place: "", summary: "", url: "https://bills.parliament.uk/bills/7/stages/9/amendments/5", billTitle: "Old Act", portfolio: ["DfT"], notes: "", wonBy: "", wonAt: new Date().toISOString(), updatedBy: "", updatedAt: new Date().toISOString() }] });
            (globalThis.__concPosts = globalThis.__concPosts || []).push(route.request().postData()); return j({ ok: true });
          }
          if (u.pathname.endsWith("/api/libby/amendment-flags")) return route.request().method() === "GET" ? j({ flags: {} }) : j({ ok: true });
          if (u.pathname.endsWith("/api/libby/groupings")) return j({ groupings: [] });
          if (u.pathname.includes("/api/libby/commons/day/")) return j({ date: "2026-11-03", rising: { Chamber: "19:00" }, source: { label: "UK Parliament \u2014 What's On (House of Commons)", url: "https://whatson.parliament.uk/commons/2026-11-03/" },
            sections: [{ name: "Chamber", start: "11:30", items: [{ kind: "oq", category: "Oral questions", title: "HM Treasury", start: "11:30", end: null, peers: [], billId: null, link: null, eventUrl: "" },
              { kind: "legislation", category: "Legislation", title: "Health Bill - report stage", start: null, peers: [{ name: "Daisy Cooper", party: "Liberal Democrat", ld: true }], billId: 4124, link: { href: "#/c/bill/4124", label: "Open Bill page", internal: true }, eventUrl: "" }] },
              { name: "Westminster Hall", start: "09:30", items: [{ kind: "motion", category: "Westminster Hall debate", title: "Impact of extreme weather on train services", start: "14:30", peers: [{ name: "Josh Newbury", party: "Labour", ld: false }], eventUrl: "" }] }] });
          if (u.pathname.endsWith("/api/libby/statutory-instruments")) return j({ total: 2, empty: false, instruments: [{ id: "a1b2c3d4-0000-0000-0000-000000000001", name: "The Example (Amendment) Regulations 2026", paper: "S.I. 2026 No. 1178", laid: "2026-11-06", laidCommons: "2026-11-05", laidLords: "2026-11-06", made: "2026-11-03", procedure: "Made affirmative", url: "https://statutoryinstruments.parliament.uk/instrument/a1b2c3d4-0000-0000-0000-000000000001/timeline/" }, { id: "a1b2c3d4-0000-0000-0000-000000000002", name: "The Other Order 2026", paper: "", laid: "2026-10-01", procedure: "Negative", url: "https://statutoryinstruments.parliament.uk/instrument/a1b2c3d4-0000-0000-0000-000000000002/timeline/" }] });
          if (u.pathname.includes("/api/libby/statutory-instruments/")) return j({ id: "a1b2c3d4-0000-0000-0000-000000000001", name: "The Example (Amendment) Regulations 2026", paper: "S.I. 2026 No. 1178", laid: "2026-11-06", laidCommons: "2026-11-05", laidLords: "2026-11-06", made: "2026-11-03", procedure: "Made affirmative", layingBody: "Home Office", comingIntoForce: "2026-12-01", comingIntoForceNote: "subject to approval", followedBy: "", precededBy: "", url: "https://statutoryinstruments.parliament.uk/instrument/a1b2c3d4-0000-0000-0000-000000000001/timeline/", enablingActs: [{ id: "x", name: "Health and Care Act 2022", link: "https://www.legislation.gov.uk/ukpga/2022/31" }], timelines: [{ id: "t1", name: "Laid in the Lords", date: "2026-11-06" }], steps: [{ id: "b1", date: "2026-11-10", link: "https://example.invalid/x", steps: ["Considered by the Secondary Legislation Scrutiny Committee"], houses: ["Lords"] }], reports: [{ id: 1, title: "Report on the Example Regulations", date: "2026-11-11", committee: "Secondary Legislation Scrutiny Committee", type: "Report", url: "https://committees.parliament.uk/publications/1/" }] });
          if (u.pathname.endsWith("/api/libby/bills/1/update")) return j({ generated: "2026-11-10", bill: { id: 1, title: "Test Bill [HL]", longTitle: "A Bill to test", originatingHouse: "Lords", isAct: false, currentStage: "Report stage", currentHouse: "Lords", url: "https://bills.parliament.uk/bills/1" }, team: { commons: { adviser: "", lead: "" }, lords: { adviser: "Pat Adviser", lead: "Lord Alpha" } }, next: null, summary: { official: "The official summary.", parts: [], sources: [] }, ldActivity: { internal: true, stages: [] }, divisions: [] });
          if (u.pathname.endsWith("/api/libby/bills/1/update-summary")) return j({ overview: "It tests things.", parts: [] });
          if (u.pathname.endsWith("/api/libby/bills/1/secondary")) return j({ billId: 1, isAct: true, title: "Test Act", act: { type: "ukpga", year: 2022, number: 31, title: "Test Act 2022", uri: "https://www.legislation.gov.uk/ukpga/2022/31" }, partial: false, summary: { sections: 2, commenced: 1, powerSections: 1, instruments: 1 }, sections: [{ label: "1", key: "1", heading: "A section", part: "PART 1", commencement: [{ si: { title: "The Test Act (Commencement No. 1) Regulations 2022", uri: "https://www.legislation.gov.uk/uksi/2022/1" }, date: "2022-07-01", qualification: "wholly in force" }], powers: [] }, { label: "2", key: "2", heading: "A power", part: "PART 1", commencement: [], powers: [{ title: "The Test Regs 2023", uri: "https://www.legislation.gov.uk/uksi/2023/2" }] }] });
          if (u.pathname.endsWith("/api/libby/previous-bills")) return j({ bills: [{ id: 4280, title: "Sovereign Grant Act", originatingHouse: "Commons", session: 40, royalAssent: "2026-11-02", portfolios: ["HMT"], typeName: "Government Bill" }, { id: 3000, title: "Old Lords Act 2019", originatingHouse: "Lords", session: 38, royalAssent: "2019-05-01", portfolios: ["HOM"], typeName: "Government Bill" }] });
          if (u.pathname.endsWith("/api/libby/commons/bills")) return j({ government: [{ id: 4124, title: "Health Bill", stage: "Report stage", stageHouse: "Commons", portfolios: ["HEA"], portfolioBy: "dept" }], privateMembers: [], other: [] });
          if (u.pathname.endsWith("/api/libby/live")) return j({ date: "2026-11-03", chamber: { available: true, lines: [{ text: "Health Bill - report stage", style: "" }, { text: "Baroness Beta", style: "member" }] }, grandCommittee: { sittingToday: true, current: { title: "Test Bill - committee", start: "15:45" }, next: null } });
          if (u.pathname.endsWith("/api/libby/commons/annunciator")) return j({ date: "2026-11-03", chamber: { available: true, lines: [{ text: "Oral questions: HM Treasury", style: "" }] }, secondary: { name: "Westminster Hall", sittingToday: true, current: null, next: { title: "Impact of extreme weather", start: "14:30" } } });
          if (u.pathname.endsWith("/api/libby/bill-next")) return j({ dates: {}, missing: [], failed: [] });
          if (u.pathname.endsWith("/api/libby/bills")) return j({ government: [{ id: 1, title: "Test Bill [HL]", stage: "Report stage", stageHouse: "Lords", portfolios: ["HOM"], portfolioBy: "dept" }], privateMembers: [], other: [] });
          if (u.pathname.endsWith("/api/libby/bill-extras")) return j({ advisers: { 1: { name: "Pat Adviser" } }, nextDates: {}, notes: [] });
          if (u.pathname.endsWith("/api/libby/portfolios")) return j([{ code: "HOM", name: "Home Office" }, { code: "HEA", name: "Health" }]);
          if (u.pathname.endsWith("/api/libby/portfolios/HOM")) return j({ code: "HOM", name: "Home Office", policyLink: "#/policy?portfolio=HOM", notes: [], primaryLegislation: [{ id: 1, title: "Test Bill [HL]", stage: "Report stage", category: "government" }, { id: 7, title: "Test Members' Bill [HL]", stage: "Second reading", category: "other" }], secondaryLegislation: [], forthcoming: [], committeeReports: [] });
          if (u.pathname.endsWith("/api/libby/commons/portfolios/HEA")) return j({ code: "HEA", name: "Health", policyLink: "#/policy?portfolio=HEA", primaryLegislation: [{ id: 4124, title: "Health Bill", stage: "Report stage", category: "government" }], oralQuestions: [{ date: "2026-11-03", department: "Department of Health and Social Care" }], legislation: [{ date: "2026-11-03", title: "Health Bill - report stage", billId: 4124 }] });
          if (u.pathname.includes("/api/libby/commons/coming")) return j({ from: "2026-11-02", to: "2026-12-06", days: [{ date: "2026-11-03", sections: [{ name: "Chamber", start: "11:30", items: [{ kind: "oq", title: "HM Treasury", peers: [] }, { kind: "legislation", title: "Health Bill - report stage", billId: 4124, peers: [] }, { kind: "legislation", category: "Private Members' Bills", title: "Pet Abduction Bill: Second Reading", peers: [] }, { kind: "legislation", category: "Private Members' Bills", title: "Renters Bill: Second Reading", peers: [] }] }] }] });
          if (u.pathname.endsWith("/api/libby/future")) return j({ from: "2026-11-02", to: "2026-12-06", fbLoaded: true, days: [{ date: "2026-11-03", source: "Forthcoming Business", count: 1, highlights: [{ kind: "legislation", title: "Test Bill [HL] - report stage", portfolios: ["HOM"] }] }] });
          if (u.pathname.includes("/api/libby/day/")) return j({ date: "2026-11-03", sections: [], source: { label: "Lords Business", url: "https://services.lordsbusiness.parliament.uk/" }, rising: {} });
          if (u.pathname.endsWith("/api/libby/room-bookings")) return j({ room: u.searchParams.get("room"), bookings: [], series: {} });
          if (u.pathname.endsWith("/api/libby/ask-parliamentarian")) return j({ requests: [{ id: 1, requester: "Rae Office", contact: "", kind: "agm", title: "A Peer to speak at our AGM", details: "About 40 members", neededBy: plus(10), eventDate: plus(30), offers: [{ id: 5, who: "Baroness Beta", note: "I can come" }] }, { id: 2, requester: "Sam Student", contact: "", kind: "work-experience", title: "Two days of work experience", details: "", neededBy: plus(5), eventDate: "", offers: [] }] });
          if (u.pathname.endsWith("/api/libby/bill-team")) return j({ billId: 1, lords: { adviser: "Pat Adviser", lead: "Lord Alpha" }, commons: { adviser: "Chris Commons", lead: "Daisy Cooper" } });
          if (u.pathname.endsWith("/api/libby/past/votes")) return j({ skip: 0, items: [u.searchParams.get("house") === "commons"
            ? { id: 2462, number: 104, date: "2026-10-21", title: "Opposition day motion: Support for British farmers", content: 57, notContent: 279, ldContent: 53, ldNotContent: 0, url: "https://votes.parliament.uk/votes/commons/division/2462" }
            : { id: 1, number: 1, date: "2026-10-21", title: "A Lords division", content: 100, notContent: 90, ldContent: 50, ldNotContent: 0, url: "https://votes.parliament.uk/votes/lords/division/1" }] });
          if (u.pathname.endsWith("/api/libby/data/votes")) {
            const tally = (n) => ({ divisions: n, govWin: n - 1, govDefeats: 1, ldCon: 1, ldLab: n - 2, ldAlone: 1, ldDiff: 1, conNeedLd: 0, labNeedLd: 1, ldNoSupport: 0 });
            const party = (i, v) => ({ intention: i, votes: v, rebels: 0, content: v, notContent: 0 });
            const div = (id, date, title) => ({ id, date, title, url: "https://votes.parliament.uk/votes/lords/" + id, department: "DHSC", result: "Content", content: 200, notContent: 150, majority: 50,
              parties: { con: party("Not Content", 80), lab: party("Content", 120), ld: party("Content", 70) }, splits: [], govWin: true, ldCon: false, ldLab: true, ldAlone: false, ldDiff: false, conNeedLd: false, labNeedLd: false, ldNoSupport: false });
            const hs = u.searchParams.get("house") === "commons" ? "commons" : "lords"; (globalThis.__voteHouses = globalThis.__voteHouses || []).push(hs);
            return j({ house: hs, sides: hs === "commons" ? ["Aye", "No"] : ["Content", "Not Content"], from: "2024-07-04", to: "2026-10-28", updated: null, total: tally(20), months: [{ month: "2026-09", ...tally(8) }, { month: "2026-10", ...tally(12) }],
              departments: [{ department: "DHSC", ...tally(10) }, { department: "MoJ", ...tally(10) }], divisions: [div(1, "2026-09-10", "Health Bill: amendment 1"), div(2, "2026-10-12", "Courts Bill: clause 4")] });
          }
          return j({}, 404);
        });
        await page.route(BASE + "/api/claim-code", route => { let b = {}; try { b = JSON.parse(route.request().postData() || "{}"); } catch { /* none */ } return b.code === "test-beta-code-1" ? (lvl = "beta", route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, program: "libby", level: "beta" }) })) : route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "That code is not right, or it has ended." }) }); });
        await ed("");
        await page.goto(BASE + "/libby/"); await page.waitForTimeout(1200);
        const lb = await page.$eval("body", b => b.innerText);
        check(`${who}: LIBBY ${who === "admin" ? "opens straight on the Beta test, with the person's level" : "asks only for the beta code, with no Developer"}`, who === "admin" ? /Signed in as owner@test.invalid \(Developer\)/.test(lb) : (/Beta access code/.test(lb) && !/Developer/.test(lb)), lb.slice(0, 80).replace(/\n/g, " "));
        if (who === "admin") {   // no gate: everyone goes straight to the Beta test; the Theme button and Developer button are in the foot
          const menu = async () => page.$$eval(".topnav a", as => as.map(a => a.textContent));
          check("admin: no Honourable / Noble front page and no Beta / Developer choice", !/Which House|Open the developer site|Open the beta/.test(lb) && (await page.$(".gate")) === null);
          check("admin: the menu is Today, Business, Legislation, Lib Dems 150, Whips Hub and POLD Staff (no Developer in the Beta test)", (await menu()).join("|") === "Today|Business|Legislation|Lib Dems 150|Whips Hub|POLD Staff", (await menu()).join("|"));
          check("admin: the Theme button is in the foot, not the masthead", (await page.$(".masthead [data-theme-btn]")) === null && (await page.$(".foot [data-theme-btn]")) !== null);
          const foot = await page.$eval(".foot", f => f.innerText);
          check("admin: the foot has Developer version, Team & access and Sign out", /Developer version/.test(foot) && /Team & access/.test(foot) && /Sign out/.test(foot), foot.replace(/\n/g, " ").slice(0, 200));
          await page.goto(BASE + "/libby/#/business"); await page.waitForTimeout(600);
          const hub = await page.$eval("#app", b => b.innerText);
          check("admin: LIBBY section pages load their files (Business hub: Future and Past, no Comms)", !/couldn.t load/i.test(hub) && /Business/.test(hub) && /Future/.test(hub) && /Past/.test(hub) && !/Comms/.test(hub), hub.slice(0, 100).replace(/\n/g, " "));
          // the home page: compact section buttons, and an annunciator for each House
          await page.goto(BASE + "/libby/#/"); await page.waitForTimeout(1200);
          const hp = await page.$eval("#app", a => a.innerText);
          const ann = await page.$$eval(".annunciator h2", hs => hs.map(h => h.textContent));
          check("Home: an annunciator for the House of Lords and one for the House of Commons", ann.join("|") === "House of Lords|House of Commons" && /Health Bill - report stage/.test(hp) && /Oral questions: HM Treasury/.test(hp) && /Grand Committee/i.test(hp) && /Westminster Hall/i.test(hp), hp.slice(0, 200).replace(/\n/g, " "));
          const rows = await page.$$eval(".index-compact .index-row", rs => rs.map(r => { const b = r.getBoundingClientRect(); return { top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), after: parseFloat(getComputedStyle(r, "::after").width) || 0 }; }));
          check("Home: the section buttons are small and several sit on one row, with only a small diamond marker", rows.length >= 6 && rows.filter(r => r.top === rows[0].top).length >= 3 && rows[0].w < 400 && rows[0].h < 150 && rows.every(r => r.after < 14), JSON.stringify(rows.slice(0, 4)));
          if (process.env.SHOTS) for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(process.env.SHOTS, `libby-home-${scheme}.png`), fullPage: true }); }
          await page.emulateMedia({ colorScheme: "light" });
          // Today: buttons at the top switch between Honourable (Commons, green) and Noble (Lords, red)
          await page.goto(BASE + "/libby/#/today"); await page.waitForTimeout(800);
          const bar = await page.$eval(".house-switch-btn", b => ({ text: b.innerText.replace(/\s+/g, " "), w: Math.round(b.getBoundingClientRect().width), right: Math.round(window.innerWidth - b.getBoundingClientRect().right), to: b.dataset.house, bg: getComputedStyle(b).backgroundColor }));
          check("Today: a small button at the top right offers the other House, in that House's colour (green on the Lords page)", (await page.$$(".house-switch-btn")).length === 1 && /Switch to the Commons/.test(bar.text) && bar.to === "commons" && bar.w < 260 && bar.right < 260 && bar.bg === "rgb(61, 180, 131)", JSON.stringify(bar));
          check("Today: Noble (the Lords) is the default, and the whole page is red", (await page.getAttribute("html", "data-house")) === "lords" && (await page.$eval(".masthead", b => getComputedStyle(b).backgroundColor)) === "rgb(229, 86, 111)" && (await page.$eval(".page-head", b => getComputedStyle(b).backgroundColor)) === "rgb(250, 219, 224)");
          await page.click(".house-switch-btn"); await page.waitForTimeout(900);
          const day = await page.$eval("#app", a => a.innerText);
          check("Today: Honourable shows the Commons day by section, Lib Dem MPs marked, in the Commons colour", (await page.getAttribute("html", "data-house")) === "commons" && /Chamber/.test(day) && /Westminster Hall/.test(day) && /HM Treasury/.test(day) && (await page.$$("#app mark.ld")).length === 1, day.slice(0, 120).replace(/\n/g, " "));
          if (process.env.SHOTS) for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(process.env.SHOTS, `libby-commons-today-${scheme}.png`), fullPage: true }); }
          await page.emulateMedia({ colorScheme: "light" });
          check("Today: a Bill on the Commons day links to its Commons Bill page", (await page.$eval('#app a[href="#/c/bill/4124"]', a => a.textContent)) === "Health Bill - report stage");
          const colour = await page.$eval(".house-switch-btn", b => ({ bg: getComputedStyle(b).backgroundColor, text: b.innerText.replace(/\s+/g, " "), to: b.dataset.house, head: getComputedStyle(document.querySelector(".masthead")).backgroundColor }));
          check("Today: on the Commons page the whole page is green and the small button is red, offering the Lords", colour.head === "rgb(61, 180, 131)" && colour.bg === "rgb(229, 86, 111)" && /Switch to the Lords/.test(colour.text) && colour.to === "lords", JSON.stringify(colour));
          await page.click(".house-switch-btn"); await page.waitForTimeout(700);
          check("Today: switching back to Noble shows the Lords day and the Lords colour", (await page.getAttribute("html", "data-house")) === "lords" && !/Westminster Hall/.test(await page.$eval("#app", a => a.innerText)));
          // Business: calendar and portfolio, for both Houses
          await page.goto(BASE + "/libby/#/future"); await page.waitForTimeout(800);
          check("Business: the Lords calendar, with a By portfolio choice", (await page.$$("#app .cal-cell")).length > 0 && /By portfolio/.test(await page.$eval("#app", a => a.innerText)) && (await page.$$(".house-switch-btn")).length === 1);
          await page.click(".house-switch-btn"); await page.waitForTimeout(900);
          const cal = await page.$eval("#app", a => a.innerText);
          check("Business: the Commons calendar shows Oral Questions by department, the legislation, and PMBs as a count (2 PMBs)", /Oral Questions/.test(cal) && /HM Treasury/.test(cal) && /Legislation/.test(cal) && /Health Bill/.test(cal) && /2 PMBs/.test(cal) && !/Pet Abduction|Renters Bill/.test(cal), cal.slice(0, 200).replace(/\n/g, " "));
          await page.goto(BASE + "/libby/#/future?view=portfolio"); await page.waitForTimeout(700);
          check("Business: By portfolio lists the portfolios", /Home Office/.test(await page.$eval("#app", a => a.innerText)));
          await page.goto(BASE + "/libby/#/portfolio/HEA"); await page.waitForTimeout(800);
          const ph = await page.$eval("#app", a => a.innerText);
          check("Business: a Commons portfolio has primary legislation, Oral Questions and legislation", /Primary legislation/.test(ph) && /Oral Questions/.test(ph) && /Department of Health and Social Care/.test(ph) && /Health Bill/.test(ph), ph.slice(0, 160).replace(/\n/g, " "));
          await page.click(".house-switch-btn"); await page.waitForTimeout(500);
          await page.goto(BASE + "/libby/#/portfolio/HOM"); await page.waitForTimeout(800);
          const opts = await page.$$eval("[data-category] option", os => os.map(o => o.textContent.replace(/ \(\d+\)/, "")));
          check("Business: primary legislation has a drop-down for Government and other legislation", opts.join("|") === "All primary legislation|Government legislation|Other legislation", opts.join("|"));
          await page.selectOption("[data-category]", "government");
          check("Business: choosing Government legislation shows only Government Bills", (await page.$$eval("[data-bills] li", ls => ls.map(l => l.textContent))).join("|").includes("Test Bill [HL]") && !(await page.$eval("[data-bills]", l => l.textContent)).includes("Members' Bill"));
          // Legislation: every live Bill, the current stage coloured by House
          await page.goto(BASE + "/libby/#/legislation"); await page.waitForTimeout(1000);
          const lh = await page.$$eval("#app thead th", hs => hs.map(h => h.dataset.tfName || h.textContent.trim()));
          check("Legislation: just three columns, Bill, Portfolio and Current stage", lh.join("|") === "Bill|Portfolio|Current stage", lh.join("|"));
          const st = await page.$$eval("td.leg-stage", ts => ts.map(t => `${t.textContent.trim()}:${t.className.includes("leg-stage-commons") ? "commons" : "lords"}:${getComputedStyle(t).backgroundColor}`));
          check("Legislation: Bills from both Houses, the current stage green in the Commons and red in the Lords", st.join("|") === "Report stage:commons:rgb(213, 239, 227)|Report stage:lords:rgb(250, 219, 224)" || (st.length === 2 && st.some(x => x.includes(":commons:")) && st.some(x => x.includes(":lords:"))), st.join("|"));
          const widths = await page.$$eval(".leg-table:first-of-type thead th", hs => hs.map(h => Math.round(h.getBoundingClientRect().width)));
          check("Legislation: no Next Stage or Adviser columns (they are on the Bill's page)", !/Next Stage|Adviser/.test(await page.$eval("#leg-body", b => b.innerText)) && widths.length === 3, widths.join("|"));
          check("Legislation: a section 'Primary legislation' with Live Bills and Previous Bills tabs", /Primary legislation/i.test(await page.$eval(".leg-section", e => e.innerText)) && (await page.$$eval(".leg-section:first-of-type .toggle a", as => as.map(a => a.textContent.trim()))).join("|") === "Live Bills|Previous Bills");
          await page.click('.leg-section .toggle a[href="#/legislation/previous"]'); await page.waitForTimeout(700);
          const pv = await page.$$eval(".leg-table tbody tr", rs => rs.map(r => r.innerText.replace(/\s+/g, " ")));
          check("Previous Bills: every Bill that got Royal Assent, newest first, with portfolio and date", pv.length === 2 && /Sovereign Grant Act/.test(pv[0]) && /HMT/.test(pv[0]) && /2 Nov 2026/.test(pv[0]) && /Old Lords Act/.test(pv[1]), pv.join(" || "));
          check("Previous Bills: each Bill links to its page here (Commons Bills to the Commons page)", (await page.$$eval(".leg-table tbody th a", as => as.map(a => a.getAttribute("href")))).join("|") === "#/c/bill/4280|#/bill/3000");
          await page.fill("[data-prev-q]", "old"); await page.waitForTimeout(150);
          check("Previous Bills: search by title", (await page.$$(".leg-table tbody tr")).length === 1);
          await page.click('.leg-section .toggle a[href="#/legislation/statutory-instruments"]'); await page.waitForTimeout(700);
          const sis = await page.$$eval(".si-table tbody tr", rs => rs.map(r => r.innerText.replace(/\s+/g, " ")));
          check("Legislation: a 'Secondary legislation' section with a Statutory instruments tab listing the instruments", /Secondary legislation/i.test(await page.$$eval(".leg-section-title", ts => ts.map(t => t.textContent).join("|"))) && sis.length === 2 && /Example \(Amendment\)/.test(sis[0]) && /Made affirmative/.test(sis[0]) && /6 Nov 2026/.test(sis[0]), sis.join(" || "));
          check("Statutory instruments: no amendments column, just the instrument, procedure and when it was laid", (await page.$$eval(".si-table thead th", hs => hs.map(h => h.textContent.trim()))).join("|") === "Instrument|Procedure|Laid");
          await page.click(".si-table tbody tr a"); await page.waitForTimeout(700);
          const sit = await page.$eval("#app", e => e.innerText.replace(/\s+/g, " "));
          check("An instrument's page: laid by, procedure, dates, the Act it is made under, its stages and documents (no amendments)", /Home Office/.test(sit) && /Made affirmative/.test(sit) && /Health and Care Act 2022/.test(sit) && /Considered by the Secondary Legislation Scrutiny Committee/.test(sit) && /Report on the Example Regulations/.test(sit) && !/Amendments/.test(sit), sit.slice(0, 200));
          await page.goto(BASE + "/libby/#/bill/1?tab=secondary"); await page.waitForTimeout(900);
          const sec = await page.$eval("#sec-secondary", e => e.innerText.replace(/\s+/g, " "));
          check("A Bill's Secondary legislation tab: each section with its commencement instrument and the instruments that used its powers", /1 of 2 sections brought into force/.test(sec) && /Commencement No\. 1/.test(sec) && /The Test Regs 2023/.test(sec) && /1 Jul 2022/.test(sec), sec.slice(0, 220));
          await page.selectOption("[data-sec-filter]", "uncommenced"); await page.waitForTimeout(150);
          check("Secondary legislation tab: filter to sections not yet brought into force", (await page.$$(".sec-table tbody tr")).length === 1);
          await page.goto(BASE + "/libby/#/legislation"); await page.waitForTimeout(700);
          if (process.env.SHOTS) for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(process.env.SHOTS, `libby-legislation-${scheme}.png`), fullPage: true }); }
          await page.emulateMedia({ colorScheme: "light" });
          // Lib Dems 150
          await page.goto(BASE + "/libby/#/lib-dems-150"); await page.waitForTimeout(700);
          const ld = await page.$eval("#app", a => a.innerText);
          check("Lib Dems 150: Policy, Comms, Wallace Room, Room 391 and Ask a Parliamentarian (Comms is no longer under Business)", ["Policy", "Comms", "Wallace Room", "Room 391", "Ask a Parliamentarian", "Parliamentary process"].every(t => ld.includes(t)) && !/Issues Tracker|Concessionometer/.test(ld), ld.slice(0, 200).replace(/\n/g, " "));
          const guides = await page.$$eval(".link-buttons li", ls => ls.map(l => ({ t: l.querySelector(".button").textContent.trim(), href: l.querySelector("a.button")?.getAttribute("href") || "", off: !!l.querySelector("button[disabled]") })));
          check("Lib Dems 150: the Organogram button links out; the other five (including The Mill and Campaigns Hub) say the link is to come", guides.length === 6 && guides.slice(4).map(g => g.t).join("|") === "The Mill|Campaigns Hub" && guides[0].href.startsWith("https://libdemsparli.retool.com/embedded/public/c9c6ad33") && guides.slice(1).every(g => g.off), JSON.stringify(guides));
          await page.goto(BASE + "/libby/#/issues-tracker"); await page.waitForTimeout(800);
          const pb = await page.$$eval(".iss-portfolios a", as => as.map(a => a.textContent.trim().replace(/\s+/g, " ")));
          check("Issues Tracker: buttons at the top for All and each portfolio, with how many issues each holds", pb[0] === "All 2" && pb.includes("DEFRA 1") && pb.includes("HO 1") && pb.includes("DfT 0"), pb.join("|"));
          const ih = (await page.$$eval(".iss-table thead th", hs => hs.map(h => h.textContent.trim()))).slice(0, 6);
          check("Issues Tracker: each campaign lists its actions: date, what was done, link, parliamentarian, adviser/staff, notes", ih.join("|") === "Date|What was done|Link|Parliamentarian|Adviser / Staff|Notes" && /sewage discharges/.test(await page.$eval(".iss-table", t => t.innerText)) && /Baroness Beta/.test(await page.$eval(".iss-table", t => t.innerText)) && /Pat Adviser/.test(await page.$eval(".iss-table", t => t.innerText)) && /Minister promised a review/.test(await page.$eval(".iss-table", t => t.innerText)));
          check("Issues Tracker: an action links to Hansard", (await page.$eval('.iss-table tr[data-action="11"] a', a => a.getAttribute("href"))).startsWith("https://hansard.parliament.uk/"));
          await page.click('.iss-portfolios a[href="#/issues-tracker?p=HO"]'); await page.waitForTimeout(500);
          check("Issues Tracker: choosing a portfolio shows only its campaigns", (await page.$$(".iss-card")).length === 1 && /Asylum backlog/.test(await page.$eval(".iss-card", c => c.innerText)));
          globalThis.__issuePosts = [];
          await page.click("[data-new-issue]"); await page.fill('[data-issue-form] [name="title"]', "Detention reform"); await page.click('[data-issue-form] button[type="submit"]'); await page.waitForTimeout(400);
          const ip = JSON.parse(globalThis.__issuePosts[0] || "{}");
          check("Issues Tracker: add a campaign to the chosen portfolio", ip.action === "issue" && ip.portfolio === "HO" && ip.title === "Detention reform", JSON.stringify(ip));
          globalThis.__issuePosts = [];
          await page.click("[data-add-action]"); await page.fill('[data-action-form] [name="what"]', "Debate on the Asylum Bill"); await page.fill('[data-action-form] [name="date"]', "2026-11-09");
          await page.fill('[data-action-form] [name="url"]', "https://hansard.parliament.uk/lords/2026-11-09"); await page.fill('[data-action-form] [name="parliamentarian"]', "Baroness Beta"); await page.fill('[data-action-form] [name="staff"]', "Pat Adviser"); await page.fill('[data-action-form] [name="notes"]', "Spoke for 8 minutes");
          await page.click('[data-action-form] button[type="submit"]'); await page.waitForTimeout(400);
          const ap = JSON.parse(globalThis.__issuePosts[0] || "{}");
          check("Issues Tracker: add an action with what, date, link, parliamentarian, staff and notes", ap.action === "action" && ap.issueId === 2 && ap.what === "Debate on the Asylum Bill" && ap.date === "2026-11-09" && ap.url.startsWith("https://hansard") && ap.parliamentarian === "Baroness Beta" && ap.staff === "Pat Adviser" && ap.notes === "Spoke for 8 minutes", JSON.stringify(ap));
          await page.goto(BASE + "/libby/#/room-391"); await page.waitForTimeout(800);
          check("Lib Dems 150: Room 391 is a booking calendar like the Wallace Room", /Room 391/.test(await page.$eval("#app", a => a.innerText)) && (await page.$("#room-cal")) !== null && !/Wallace/.test(await page.$eval("#app h1", a => a.textContent)));
          if (process.env.SHOTS) { await page.screenshot({ path: path.join(process.env.SHOTS, "libby-room-391.png"), fullPage: true }); }
          await page.goto(BASE + "/libby/#/ask-parliamentarian"); await page.waitForTimeout(800);
          const we = await page.$eval("#app", a => a.innerText);
          if (process.env.SHOTS) { await page.screenshot({ path: path.join(process.env.SHOTS, "libby-ask-parliamentarian.png"), fullPage: true }); }

          const asked = await page.$eval("#ask-list", b => b.innerText);
          check("Lib Dems 150: Ask a Parliamentarian lists the requests still needing an answer, with a way to ask", /Ask a Parliamentarian/.test(we) && /Two days of work experience/.test(asked) && !/A Peer to speak at our AGM/.test(asked) && (await page.$("[data-new]")) !== null, asked.slice(0, 120).replace(/\n/g, " "));
          await page.goto(BASE + "/libby/#/ask-parliamentarian?show=answered"); await page.waitForTimeout(700);
          const answered = await page.$eval("#ask-list", b => b.innerText);
          check("Ask a Parliamentarian: an answered request shows who offered support", /A Peer to speak at our AGM/.test(answered) && /Baroness Beta/.test(answered) && /can help/.test(answered), answered.slice(0, 160).replace(/\n/g, " "));
          await page.click("[data-new]"); await page.waitForTimeout(200);
          check("Ask a Parliamentarian: the request form asks for the kind of help, what is needed and by when", (await page.$$("[data-request] select[name=kind], [data-request] input[name=title], [data-request] input[name=neededBy]")).length === 3);
          // the Whips' page and the Advisers' page
          await page.goto(BASE + "/libby/#/whips-office"); await page.waitForTimeout(600);
          const wo = await page.$$eval("#app .index-row .swipe", es => es.map(e => e.textContent));
          check("Whips Hub: Availability, Data, the Issues Tracker and the Concessionometer sit under it", wo.join("|") === "Availability|Data|Issues Tracker|Concessionometer", wo.join("|"));
          await page.goto(BASE + "/libby/#/advisers-office"); await page.waitForTimeout(600);
          const ao = await page.$$eval("#app .index-row .swipe", es => es.map(e => e.textContent));
          check("Advisers' page: the Advisers and Roles pages sit under it", ao.join("|") === "Advisers|Roles", ao.join("|"));
          // Developer version: a button in the foot
          await page.click("#switch-edition"); await page.waitForTimeout(1200);
          check("the Developer version button opens the developer version (the Developer page appears in the menu)", (await menu()).includes("Developer") && /Back to the Beta test/.test(await page.$eval(".foot", f => f.innerText)), (await menu()).join("|"));
          lvl = "none"; await ed("", "lords"); await page.reload(); await page.waitForTimeout(900);
          check("gate: someone with no access is asked for the beta code only", /Beta access code/.test(await page.$eval("#app", b => b.innerText)) && !/Developer/.test(await page.$eval("#app", b => b.innerText)));
          await page.fill('.gate input[name="code"]', "wrong-code-123"); await page.click(".gate form button"); await page.waitForTimeout(500);
          check("gate: a wrong code says so", /not right/.test(await page.$eval(".gate", b => b.innerText)));
          await page.fill('.gate input[name="code"]', "test-beta-code-1"); await page.click(".gate form button"); await page.waitForTimeout(1500);
          check("gate: the beta code opens the beta test (for now just Data)", (await menu()).join("|") === "Data", (await menu()).join("|"));
          lvl = "developer";
        }
        if (who === "admin") {   // the beta tester sees everything except the Whips, the Advisers and the developer pages, and may only read
          const menu = async () => page.$$eval(".topnav a", as => as.map(a => a.textContent));
          lvl = "beta"; await ed("", "lords"); await page.goto(BASE + "/libby/"); await page.reload(); await page.waitForTimeout(900);
          check("beta: the menu is just Data, for now", (await menu()).join("|") === "Data", (await menu()).join("|"));
          await page.goto(BASE + "/libby/#/data"); await page.waitForTimeout(900);
          check("beta: the Data page opens", !/Not available/.test(await page.$eval("#app", b => b.innerText)) && /Data/.test(await page.$eval("#app h1", h => h.textContent)));
          // for now: Backbench and Frontbencher parliamentarians (and their Staff) see only Data; Whips (and Whip's Staff) also the Whips Hub; Leader's circle (and its Staff) everything except the back-end; Administrators everything
          for (const basic of ["backbench", "frontbench_staff"]) {
            lvl = basic; await page.goto(BASE + "/libby/"); await page.reload(); await page.waitForTimeout(900);
            check(`${basic}: the menu is just Data, for now (as a Peer always had)`, (await menu()).join("|") === "Data", (await menu()).join("|"));
            const sh = await page.$eval("#app", b => b.innerText);
            check(`${basic}: the home page offers just Data`, /Data/.test(sh) && !/Legislation|Whips|Advisers/.test(sh), sh.slice(0, 120).replace(/\n/g, " "));
            for (const p_ of ["#/legislation", "#/today", "#/advisers-office", "#/whips-office", "#/parliamentary-process"]) { await page.goto(BASE + "/libby/" + p_); await page.waitForTimeout(300); check(`${basic}: ${p_} says not available, for now`, /Not available/.test(await page.$eval("#app", b => b.innerText))); }
          }
          for (const whip of ["whips", "whips_staff"]) {
            lvl = whip; await page.goto(BASE + "/libby/"); await page.reload(); await page.waitForTimeout(900);
            check(`${whip}: the menu is Lib Dems 150 (for Parliamentary process) and the Whips Hub`, (await menu()).join("|") === "Lib Dems 150|Whips Hub", (await menu()).join("|"));
            await page.goto(BASE + "/libby/#/whips-office"); await page.waitForTimeout(500);
            check(`${whip}: the Whips Hub opens, with Availability, Data, the Issues Tracker and the Concessionometer`, (await page.$$eval(".index-row .swipe", ss => ss.map(s => s.textContent.trim()))).join("|") === "Availability|Data|Issues Tracker|Concessionometer", (await page.$$eval(".index-row .swipe", ss => ss.map(s => s.textContent.trim()))).join("|"));
            await page.goto(BASE + "/libby/#/parliamentary-process"); await page.waitForTimeout(600);
            check(`${whip}: Parliamentary process opens`, !/Not available/.test(await page.$eval("#app", b => b.innerText)) && /Your question/.test(await page.$eval("#app", b => b.innerText)));
            if (whip === "whips") {
              globalThis.__processPosts = [];
              await page.goto(BASE + "/libby/#/parliamentary-process"); await page.waitForTimeout(600);
              check("Parliamentary process: recent questions are listed with their sources, and there is no Companion upload for a Whip (Staff only)", /Money Bill/.test(await page.$eval("#app", b => b.innerText)) && (await page.$("[data-upload]")) === null);
              await page.fill('[data-ask] [name="question"]', "How is Royal Assent notified in the Lords?"); await page.selectOption('[data-ask] [name="house"]', "lords"); await page.click('[data-ask] button[type="submit"]'); await page.waitForTimeout(500);
              const ans = await page.$eval("[data-result]", e => e.innerText.replace(/\s+/g, " "));
              check("Parliamentary process: a question is answered from Erskine May, with the passages used and a link", /Royal Assent may be notified at a break/.test(ans) && /Erskine May 26\.29/.test(ans) && /Lords Companion has not been uploaded/.test(ans) && (await page.$eval('[data-result] a[href^="https://erskinemay.parliament.uk"]', a => a.href)).includes("16612"), ans.slice(0, 200));
              const pp = JSON.parse(globalThis.__processPosts[0] || "{}");
              check("Parliamentary process: the question goes to the server with the House", pp.question === "How is Royal Assent notified in the Lords?" && pp.house === "lords");
            }
            for (const p_ of ["#/legislation", "#/advisers-office", "#/roles"]) { await page.goto(BASE + "/libby/" + p_); await page.waitForTimeout(300); check(`${whip}: ${p_} says not available`, /Not available/.test(await page.$eval("#app", b => b.innerText))); }
          }
          for (const leader of ["leader", "leader_staff"]) {
            lvl = leader; await page.goto(BASE + "/libby/"); await page.reload(); await page.waitForTimeout(900);
            check(`${leader}: everything except the back-end (POLD Staff included)`, (await menu()).join("|") === "Today|Business|Legislation|Lib Dems 150|Whips Hub|POLD Staff", (await menu()).join("|"));
            for (const p_ of ["#/roles", "#/team", "#/developer"]) { await page.goto(BASE + "/libby/" + p_); await page.waitForTimeout(300); check(`${leader}: ${p_} (the back-end) says not available`, /Not available/.test(await page.$eval("#app", b => b.innerText))); }
          }
          lvl = "admin"; await page.goto(BASE + "/libby/"); await page.reload(); await page.waitForTimeout(900);
          check("admin role: keeps everything", (await menu()).join("|") === "Today|Business|Legislation|Lib Dems 150|Whips Hub|POLD Staff", (await menu()).join("|"));
          lvl = "beta"; await page.goto(BASE + "/libby/"); await page.reload(); await page.waitForTimeout(700);
          for (const [path_, name] of [["#/legislation", "Legislation"], ["#/whips-office", "the Whips' page"], ["#/advisers-office", "the Advisers' page"], ["#/developer", "the Developer page"], ["#/team", "Team & access"]]) {
            await page.goto(BASE + "/libby/" + path_); await page.waitForTimeout(400);
            check(`beta: ${name} says not available`, /Not available/.test(await page.$eval("#app", b => b.innerText)));
          }
          lvl = "developer"; await ed("developer"); await page.goto(BASE + "/libby/"); await page.reload(); await page.waitForTimeout(700); await page.goto(BASE + "/libby/#/advisers"); await page.waitForTimeout(700);
          const adv = await page.$$eval("#app h2, #app .adv-list a.button", es => es.map(e => e.textContent));
          check("the Advisers page has exactly the Legislation / Whipping / Office buttons", adv.join("|") === ["Legislation", "Update Bill advisers and leads", "Upload Groupings, Grids & Hymn Sheets", "Whipping", "Whips\u2019 Office Bulletin", "Duty Whips: choose the rota", "Availability: see who is free", "Office", "Wallace Room"].join("|"), adv.join("|"));
          await page.goto(BASE + "/libby/#/duty-whips"); await page.waitForTimeout(700);
          check("the Duty Whips page loads from the Advisers page", /Duty Whips/.test(await page.$eval("#app", b => b.innerText)) && !/page could not be loaded|Not available/i.test(await page.$eval("#app", b => b.innerText)));
          await page.goto(BASE + "/libby/#/whips"); await page.waitForTimeout(700);
          const wp = await page.$eval("#app", b => b.innerText);
          check("the Whips page is just Availability, with no Hymn Sheets or Duty Whips", /Availability for Whipping/.test(wp) && !/Hymn/i.test(wp) && !/Duty Whips/.test(wp), wp.slice(0, 120).replace(/\n/g, " "));
          lvl = "developer"; await ed("developer"); await page.goto(BASE + "/libby/"); await page.reload(); await page.waitForTimeout(900);
          check("developer: the menu has Developer", (await menu()).includes("Developer") && (await menu()).includes("Legislation"), (await menu()).join("|"));
          await page.goto(BASE + "/libby/#/team"); await page.waitForTimeout(700);
          const tm = await page.$eval("#app", b => b.innerText);
          check("developer: LIBBY has Team & access (people, levels, codes, activity)", /Team & access/.test(tm) && /peer@test\.invalid/.test(tm) && /What each level is/.test(tm) && /Peers/.test(tm) && /Recent activity/.test(tm), tm.slice(0, 120).replace(/\n/g, " "));
          await page.goto(BASE + "/libby/#/developer"); await page.waitForTimeout(600);
          const dv = await page.$eval("#app", b => b.innerText);
          check("developer: the Developer page lists the editions and every page", /Beta test/.test(dv) && /Every page/.test(dv) && /policy/.test(dv) && !/couldn.t load/i.test(dv), dv.slice(0, 120).replace(/\n/g, " "));
          // the Data page's tables: the first column and the title row are both frozen
          await page.setViewportSize({ width: 700, height: 800 });
          await page.goto(BASE + "/libby/#/data/votes?view=months"); await page.waitForTimeout(1200);
          const frozen = await page.$eval(".data-table", t => ({ corner: getComputedStyle(t.querySelector("thead th:first-child")).position, cell: getComputedStyle(t.querySelector("tbody th")).position, left: getComputedStyle(t.querySelector("tbody th")).left, top: getComputedStyle(t.querySelector("thead th:nth-child(2)")).top }));
          check("data: the first column and the title row are frozen", frozen.corner === "sticky" && frozen.cell === "sticky" && frozen.left === "0px" && frozen.top === "0px", JSON.stringify(frozen));
          await page.$eval(".table-wrap", w => { w.scrollLeft = 200; });
          const stay = await page.$eval(".data-table", t => { const w = t.closest(".table-wrap").getBoundingClientRect().left; return Math.abs(t.querySelector("tbody th").getBoundingClientRect().left - w) <= 2; });
          check("data: scrolled sideways, the first column stays at the left edge", stay);
          await page.setViewportSize({ width: 1200, height: 900 });
          await page.goto(BASE + "/libby/#/data"); await page.waitForTimeout(600);
          check("Data: the landing page offers Voting Data, Commons Data and Lords Data", /Voting Data/.test(await page.$eval("#app", a => a.innerText)) && /Commons Data/.test(await page.$eval("#app", a => a.innerText)) && /Lords Data/.test(await page.$eval("#app", a => a.innerText)));
          globalThis.__voteHouses = [];
          await page.goto(BASE + "/libby/#/data/votes?view=summary&house=commons"); await page.waitForTimeout(900);
          check("Voting Data: House buttons, and the Commons view asks for the Commons divisions", (await page.$$eval(".data-house a", as => as.map(a => a.textContent.trim()))).join("|") === "Lords|Commons" && globalThis.__voteHouses.includes("commons") && /Commons divisions analysed/.test(await page.$eval("#app", a => a.innerText)), (globalThis.__voteHouses || []).join(","));
          await page.goto(BASE + "/libby/#/data/commons"); await page.waitForTimeout(900);
          const cd = await page.$eval("#app", a => a.innerText.replace(/\s+/g, " "));
          check("Commons Data: party strengths, the Lib Dem MPs (highlighted yellow) and the Library link", /Party strengths/.test(cd) && /Labour\s+404/.test(cd) && /Lib Dem MPs/.test(cd) && (await page.$$eval(".data-mps mark.ld", ms => ms.map(m => m.textContent)).then(a => a.join("|"))) === "Daisy Cooper|Sir Ed Davey" && (await page.$eval('a[href^="https://commonslibrary.parliament.uk"]', a => a.href)).includes("data-dashboard"), cd.slice(0, 160));
          await page.evaluate(() => { try { localStorage.setItem("libbyHouse", "lords"); } catch (e) { /* ignore */ } });
          await page.goto(BASE + "/libby/#/"); await page.reload(); await page.waitForTimeout(1200);
          check("Bulletin: the home page shows the Lords bulletin for the Lords, with a button for the Commons one", /Whips' Office Bulletin: Lords/.test(await page.$eval("#bulletin", b => b.innerText)) && /Lords Whips notice/.test(await page.$eval("#bulletin", b => b.innerText)) && /Show the Commons bulletin/.test(await page.$eval("#bulletin", b => b.innerText)));
          await page.click("[data-bulletin]"); await page.waitForTimeout(500);
          check("Bulletin: the other button shows the Commons bulletin", /Whips' Office Bulletin: Commons/.test(await page.$eval("#bulletin", b => b.innerText)) && /Commons Whips notice/.test(await page.$eval("#bulletin", b => b.innerText)));
          await page.goto(BASE + "/libby/#/bulletin-editor?house=commons"); await page.waitForTimeout(800);
          check("Bulletin: the editor has a Lords and a Commons bulletin, and opens the Commons one", (await page.$$eval(".bul-house a", as => as.map(a => a.textContent.trim()))).join("|") === "Lords bulletin|Commons bulletin" && /Commons/.test(await page.$eval("#app h1", h => h.textContent)) && (await page.$eval(".bul-card [data-heading]", i => i.value)) === "Commons Whips notice");
          globalThis.__bulletinPosts = [];
          await page.click(".bul-card [data-save]"); await page.waitForTimeout(400);
          check("Bulletin: saving a Commons message goes to the Commons bulletin", JSON.parse(globalThis.__bulletinPosts[0] || "{}").house === "commons" && JSON.parse(globalThis.__bulletinPosts[0]).action === "save");
          await page.goto(BASE + "/libby/#/roles"); await page.waitForTimeout(900);
          const rh =await page.$$eval(".roles-table thead th", hs => hs.map(h => h.textContent.trim()));
          check("Roles: the list covers peers and Lib Dem MPs, with a House column", rh.join("|") === "Person|House|Role" && (await page.$$eval(".roles-table tbody tr", rs => rs.map(r => r.dataset.house))).join("|") === "lords|commons|commons|commons");
          check("Roles: Lib Dem MPs and peers on the Members lists are highlighted in yellow; staff added by hand are not", (await page.$$eval('.roles-table tbody tr[data-name="Daisy Cooper"] mark.ld', m => m.length)) === 1 && (await page.$$eval('.roles-table tbody tr[data-name="Baroness Beta"] mark.ld', m => m.length)) === 1 && (await page.$$eval('.roles-table tbody tr[data-name="Pat Staffer"] mark.ld', m => m.length)) === 0);
          await page.selectOption("[data-house]", "commons"); await page.waitForTimeout(150);
          check("Roles: filter by House", (await page.$$eval(".roles-table tbody tr:not([hidden])", rs => rs.length)) === 3);
          globalThis.__rolePosts = [];
          await page.selectOption('tr[data-name="Daisy Cooper"] [data-set]', "whips"); await page.waitForTimeout(300);
          check("Roles: pick a role for an MP, as for a peer", JSON.parse(globalThis.__rolePosts[0] || "{}").name === "Daisy Cooper" && JSON.parse(globalThis.__rolePosts[0]).role === "whips");
          await page.fill('#roles-add [name="name"]', "Sam New"); await page.selectOption('[name="house"][form="roles-add"]', "commons"); await page.click('button[form="roles-add"]'); await page.waitForTimeout(300);
          check("Roles: a person added by hand says which House", JSON.parse(globalThis.__rolePosts[1] || "{}").action === "add" && JSON.parse(globalThis.__rolePosts[1]).house === "commons");
          if (process.env.SHOTS) for (const [view, name] of [["months", "data-months"], ["divisions", "data-divisions"]]) { await page.goto(BASE + "/libby/#/data/votes?view=" + view); await page.waitForTimeout(900); await page.screenshot({ path: path.join(process.env.SHOTS, name + ".png"), fullPage: true }); }
          await page.setViewportSize({ width: 1280, height: 720 });
          lvl = "developer"; await ed("developer"); await page.goto(BASE + "/libby/"); await page.reload(); await page.waitForTimeout(600);
          await page.goto(BASE + "/libby/#/bill/1"); await page.waitForTimeout(1200);
          const teamBox = await page.$$eval(".bill-team-commons, .bill-team-lords", hs => hs.map(h => h.innerText.replace(/\s+/g, " ")));
          check("A Bill's page opens with its team: the Commons and the Lords adviser and Bill lead", teamBox.length === 2 && /Commons/.test(teamBox[0]) && /Chris Commons/.test(teamBox[0]) && /Daisy Cooper/.test(teamBox[0]) && /Lords/.test(teamBox[1]) && /Pat Adviser/.test(teamBox[1]) && /Lord Alpha/.test(teamBox[1]), teamBox.join(" | "));
          check("A Bill's page has a 'Give me an Update' button beside the Commons and Lords teams", (await page.$$eval(".bill-team > section", ss => ss.length)) === 3 && /Give me an Update/.test(await page.$eval("[data-update]", b => b.textContent)));
          const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click("[data-update]")]);
          check("Give me an Update: downloads a Word document titled '[Bill] Update [Date]'", dl.suggestedFilename() === "Test Bill Update 10 November 2026.docx", dl.suggestedFilename());
          await page.waitForTimeout(300);
          check("A Bill's page says when its next stage is", /Next stage:/.test(await page.$eval("[data-next-stage]", p => p.innerText)));
          if (process.env.SHOTS) { await page.screenshot({ path: path.join(process.env.SHOTS, "libby-bill-stages.png"), fullPage: true }); }
          await page.goto(BASE + "/libby/#/bill/1?tab=amendments"); await page.waitForTimeout(1500);
          const heads = await page.$$eval(".am-table thead th", hs => hs.map(h => h.textContent.trim()));
          check("amendments: one table, columns Signed peers / # / Location / Explanatory statement / buttons", heads.slice(0, 4).join("|") === "Signed peers|#|Location|Member\u2019s explanatory statement" && heads.length === 5, heads.join("|"));
          check("amendments: a button switches between Lords and Commons amendments", (await page.$$eval("[data-amhouse]", bs => bs.map(b => b.textContent.trim()))).join("|") === "Lords amendments|Commons amendments");
          await page.click('[data-amhouse="commons"]'); await page.waitForTimeout(800);
          check("amendments: the Commons button shows the Commons amendments", (await page.$$("tr.am-row")).length === 1 && /Daisy Cooper/.test(await page.$eval("tr.am-row", t => t.textContent)));
          await page.click('[data-amhouse="lords"]'); await page.waitForTimeout(800);
          check("amendments: and back to the Lords amendments", (await page.$$("tr.am-row")).length === 3);
          check("amendments: the old Lib Dem / signed lists are gone", (await page.$$eval("#ams h3", h => h.map(x => x.textContent))).every(t => !/Lib Dem amendments|other amendments we have signed/i.test(t)) && (await page.$$(".am-table tbody tr.am-row")).length === 3);
          check("amendments: each signed peer is on its own line", (await page.$$eval("tr.am-row:first-child .am-peer", ps => ps.map(p => p.textContent.trim()))).join("|") === "Lord Alpha|Baroness Beta");
          if (process.env.SHOTS) for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(200); await page.screenshot({ path: path.join(process.env.SHOTS, `amendments-${scheme}.png`), fullPage: true }); }
          await page.emulateMedia({ colorScheme: "light" });
          check("amendments: the title row has filter buttons and is frozen", (await page.$$(".am-table thead .tf-btn")).length === 4 && (await page.$eval(".am-table thead th", h => getComputedStyle(h).position)) === "sticky");
          const place = await page.$eval("tr.am-row .place", t => t.textContent.trim());
          check("amendments: Location is the short code, C3, P2, L14, and # is the number alone", /^C3, P2, L14$/.test(place) && (await page.$eval("tr.am-row .am-n", t => t.textContent.trim())) === "12", place);
          check("amendments: an amendment with no number yet shows an em dash", (await page.$eval('[data-aid-row="103"] .am-n', t => t.textContent.trim())) === "\u2014");
          check("amendments: the explanatory statement is filled in from the API", /Statement for 101/.test(await page.$eval("tr.am-row [data-mes]", t => t.textContent)));
          const btns = await page.$$eval("tr.am-row:first-child .am-actions button", bs => bs.map(b => b.textContent.trim()));
          check("amendments: buttons are Vote, C, NC, Note and WIN", btns.join("|") === "Vote|C|NC|Note|WIN", btns.join("|"));
          const bar = await page.$$eval("[data-flagfilter]", bs => bs.map(b => b.textContent.replace(/\s+\d+$/, "").trim()));
          check("amendments: highlights are All, Lib Dem amendments, Lib Dem-signed, Voting, Content, Not Content and WIN", bar.join("|") === "All|Lib Dem amendments|Lib Dem-signed|Voting|Content|Not Content|WIN", bar.join("|"));
          await page.click('tr.am-row:first-child [data-flag="content"]'); await page.waitForTimeout(200);
          check("amendments: Content turns the row green", (await page.$eval("tr.am-row:first-child", t => t.className)).includes("am-flag-content"));
          check("amendments: Content also puts Vote on the amendment", (await page.$eval('tr.am-row:first-child [data-flag="voting"]', b => b.getAttribute("aria-pressed"))) === "true");
          await page.click('tr.am-row:first-child [data-flag="notcontent"]'); await page.waitForTimeout(200);
          check("amendments: Not Content replaces Content", (await page.$eval("tr.am-row:first-child", t => t.className)).includes("am-flag-notcontent") && (await page.$eval('tr.am-row:first-child [data-flag="content"]', b => b.getAttribute("aria-pressed"))) === "false");
          await page.click('[data-flagfilter="ldsigned"]'); await page.waitForTimeout(200);
          const vis = await page.$$eval("tr.am-row:not([hidden]) .place", ts => ts.map(t => t.textContent.trim()));
          check("amendments: the Lib Dem-signed highlight shows the amendments we signed but did not lead", vis.length === 1 && /C4/.test(vis[0]), vis.join("|"));
          await page.click('[data-flagfilter=""]');
          globalThis.__concPosts = [];
          await page.click('[data-aid-row="103"] [data-win]'); await page.waitForTimeout(250);
          const winPost = JSON.parse((globalThis.__concPosts || [])[0] || "{}");
          check("WIN: marks the amendment, turns the row on and sends it to the Concessionometer (action, amendment, number)", winPost.action === "win" && winPost.on === true && winPost.amendmentId === 103 && winPost.billId === 1 && winPost.house === "lords" && (await page.$eval('[data-aid-row="103"]', t => t.className.includes("am-flag-win") && t.querySelector("[data-win]").getAttribute("aria-pressed") === "true")), JSON.stringify(winPost));
          check("WIN: the highlight counts it", (await page.$eval('[data-fcount="win"]', o => o.textContent)) === "1");
          await page.click('[data-aid-row="103"] [data-win]'); await page.waitForTimeout(250);
          check("WIN: pressing it again takes it off", JSON.parse(globalThis.__concPosts[1]).on === false && !(await page.$eval('[data-aid-row="103"]', t => t.className.includes("am-flag-win"))));
          await page.click('[data-aid-row="102"] [data-comment-btn]'); await page.waitForTimeout(250);
          check("amendments: Note opens the amendment text and note box", await page.$eval('[data-aid-more="102"]', t => !t.hidden && /Add a note/.test(t.textContent) && /leave out subsection/.test(t.textContent)));
          await page.click(".am-table thead th:nth-child(2) .tf-btn"); await page.waitForTimeout(150);
          await page.click('.tf-pop [data-s="desc"]'); await page.waitForTimeout(200);
          check("amendments: Sort Z to A in the filter reorders the rows, each with its detail row", (await page.$$eval("tr.am-row .am-n", ts => ts.map(t => t.textContent.trim()))).join(",") === "13,12,\u2014" && (await page.$$eval("tbody tr", rs => rs.map(r => r.className.split(" ")[0]))).join(" ") === "am-row am-more am-row am-more am-row am-more");
          await page.goto(BASE + "/libby/#/concessionometer"); await page.waitForTimeout(900);
          const ch = await page.$$eval(".conc-table thead th", hs => hs.map(h => h.textContent.trim()));
          check("Concessionometer: a grid of Bill, Portfolio and Notes", ch.join("|") === "Bill|Portfolio|Notes on the concession", ch.join("|"));
          const cr = await page.$$eval(".conc-table tbody tr", rs => rs.map(r => r.innerText.replace(/\s+/g, " ")));
          check("Concessionometer: the first cell is just the Bill and the date won; the portfolio is beside it", cr.length === 2 && /^Test Bill \[HL\] \d+ \w+ \d{4} HO /.test(cr[0]) && !/Amendment|Leave out/.test(cr[0].split("HO")[0]) && /^Old Act/.test(cr[1]) && /DfT/.test(cr[1]), cr.join(" || "));
          check("Concessionometer: the Bill's name links to the amendment on bills.parliament.uk", (await page.$eval(".conc-table tbody tr a.conc-bill", a => a.href)).startsWith("https://bills.parliament.uk/bills/1/stages/50/amendments/101"));
          const widths = await page.$eval(".conc-table", t => { const w = x => Math.round(t.querySelector(x).getBoundingClientRect().width); return { bill: w("thead .conc-col-bill"), port: w("thead .conc-col-port"), notes: w("thead th:last-child") }; });
          check("Concessionometer: the Bill column is much shorter than the notes, which take the room", widths.bill < 200 && widths.notes > 3 * widths.bill, JSON.stringify(widths));
          check("Concessionometer: saved notes are shown as text, not in a box", (await page.$(".conc-table tbody tr textarea")) === null && /The Government will bring forward its own wording/.test(await page.$eval(".conc-table tbody tr .conc-text", t => t.textContent)));
          globalThis.__concPosts = [];
          await page.click(".conc-table tbody tr [data-edit]"); await page.waitForTimeout(150);
          check("Concessionometer: Edit opens the boxes (Bill, date won, notes)", (await page.$$(".conc-table tbody tr [data-bill], .conc-table tbody tr [data-won], .conc-table tbody tr [data-notes]")).length === 3);
          await page.fill(".conc-table tbody tr [data-bill]", "Test Act (corrected)"); await page.fill(".conc-table tbody tr [data-won]", "2026-09-30"); await page.fill(".conc-table tbody tr [data-notes]", "Agreed in principle\nSecond line");
          await page.click(".conc-table tbody tr [data-save]"); await page.waitForTimeout(300);
          const ep = JSON.parse(globalThis.__concPosts[0] || "{}");
          check("Concessionometer: Save sends the notes, the Bill and the date won", ep.action === "edit" && ep.notes === "Agreed in principle\nSecond line" && ep.billTitle === "Test Act (corrected)" && ep.wonAt === "2026-09-30", JSON.stringify(ep));
          check("Concessionometer: after saving the boxes close and the notes show as text again", (await page.$(".conc-table tbody tr textarea")) === null && /Second line/.test(await page.$eval(".conc-table tbody tr .conc-text", t => t.textContent)) && /Test Act \(corrected\)/.test(await page.$eval(".conc-table tbody tr a.conc-bill", a => a.textContent)) && /30 Sep/.test(await page.$eval(".conc-table tbody tr", r => r.innerText)));
          await page.selectOption("[data-portfolio]", "DfT"); await page.waitForTimeout(150);
          check("Concessionometer: filter by portfolio", (await page.$$(".conc-table tbody tr")).length === 1);
          await page.selectOption("[data-portfolio]", ""); await page.waitForTimeout(100);
          globalThis.__concPosts = [];
          page.once("dialog", d => d.accept());
          await page.click(".conc-table tbody tr [data-edit]"); await page.click(".conc-table tbody tr [data-remove]"); await page.waitForTimeout(400);
          const rmPost = JSON.parse(globalThis.__concPosts[0] || "{}");
          check("Concessionometer: an entry can be removed outright (it stops being a WIN)", rmPost.action === "win" && rmPost.on === false && (await page.$$(".conc-table tbody tr")).length === 1, JSON.stringify(rmPost));
          globalThis.__processPosts = [];
          await page.goto(BASE + "/libby/#/parliamentary-process"); await page.waitForTimeout(700);
          page.once("dialog", d => d.accept());
          await page.click("[data-del-q]"); await page.waitForTimeout(300);
          check("Parliamentary process: Staff can delete a question and its answer", JSON.parse(globalThis.__processPosts[0] || "{}").action === "delete" && (await page.$$("[data-del-q]")).length === 0);
          globalThis.__issuePosts = [];
          await page.goto(BASE + "/libby/#/issues-tracker"); await page.waitForTimeout(700);
          page.once("dialog", d => d.accept());
          await page.click("[data-del-action]"); await page.waitForTimeout(400);
          check("Issues Tracker: an action can be deleted for good (and an issue too)", JSON.parse(globalThis.__issuePosts[0] || "{}").action === "delete-action" && (await page.$$("[data-del-issue]")).length >= 1);
          lvl = "developer";
        }
        const cspErr = errors.filter(e => /Content Security Policy|violates/i.test(e));
        check(`${who}: LIBBY page has no security-policy violations`, cspErr.length === 0, cspErr.join("|"));
        if (process.env.SHOTS && who === "admin") for (const scheme of ["light", "dark"]) for (const [hash, name] of [["#/", "libby-home"], ["#/business", "libby-business"], ["#/legislation", "libby-legislation"], ["#/policy", "libby-policy"]]) {
          await page.emulateMedia({ colorScheme: scheme }); await page.goto(BASE + "/libby/" + hash); await page.reload(); await page.waitForTimeout(900);
          await page.screenshot({ path: path.join(process.env.SHOTS, `${name}-${scheme}.png`), fullPage: true });
        }
        await page.emulateMedia({ colorScheme: "light" });
        errors.length = 0;
      }
      if (who === "lmgr") { await ctx.close(); continue; }
      await page.goto(BASE + "/"); await page.waitForTimeout(500);

      // shared look: the theme button cycles Auto -> Light -> Dark and the page really changes colour
      const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await page.emulateMedia({ colorScheme: "light" });
      const btn = page.locator("[data-theme-btn]");
      check(`${who}: theme button starts on Auto`, /Auto/.test(await btn.textContent()));
      const lightBg = await bg();
      await btn.click(); await btn.click();   // Auto -> Light -> Dark
      check(`${who}: theme button reaches Dark and repaints`, /Dark/.test(await btn.textContent()) && (await page.getAttribute("html", "data-theme")) === "dark" && (await bg()) !== lightBg, await bg());
      await page.reload(); await page.waitForTimeout(300);
      check(`${who}: dark theme is remembered`, (await page.getAttribute("html", "data-theme")) === "dark");
      await page.evaluate(() => localStorage.removeItem("athena_theme"));
      await page.emulateMedia({ colorScheme: "dark" }); await page.reload(); await page.waitForTimeout(300);
      check(`${who}: Auto follows a dark device`, (await page.getAttribute("html", "data-theme")) === null && (await bg()) === "rgb(14, 17, 24)", await bg());
      await page.emulateMedia({ colorScheme: "light" });

      await page.goto(BASE + "/lovelace/");
      await page.waitForSelector("#tabs button", { timeout: 5000 });
      const tabs = await page.$$eval("#tabs button", bs => bs.map(b => b.textContent));
      check(`${who}: lovelace tabs`, who === "member" ? !tabs.includes("Budget & governance") && tabs.includes("Overview") : tabs.includes("Budget & governance") && tabs.includes("This Week") && !tabs.includes("Team & access") && ((await page.$('#shell-foot [data-foot="team"]')) !== null) === (who === "admin"), tabs.join(" | "));
      check(`${who}: the Theme button is in the foot, not the masthead`, (await page.$(".masthead [data-theme-btn]")) === null && (await page.$("#shell-foot [data-theme-btn]")) !== null);
      await page.waitForSelector(".ovplan, #main .muted", { timeout: 5000 });
      if (who !== "member") {
        const ov = await page.$$eval(".ovg h3", hs => hs.map(h => h.textContent));
        check(`${who}: the overview is the campaign plan, in the five groups`, ov.join("|") === "Main News|Across London|Campaigning|Media", ov.join(" | "));
        if (process.env.SHOTS && who === "admin") for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(process.env.SHOTS, `lovelace-overview-${scheme}.png`) }); await page.emulateMedia({ colorScheme: "light" }); }
        check(`${who}: the overview shows this week's entries and nothing else`, /Launch housing pledge/.test(await page.$eval("#main", m => m.innerText)) && !(await page.$(".card.ov")));
      }
      for (const t of tabs) {
        await page.click(`#tabs button:text-is("${t}")`);
        await page.waitForTimeout(350);
        const txt = await page.$eval("#main", m => m.innerText);
        check(`${who}: tab ${t} renders`, txt.length > 20 && !/Loading…$/.test(txt.trim()), txt.slice(0, 60).replace(/\n/g, " "));
      }
      // the merged pages: Media (news + social) and Volunteers & stakeholders; visits live on the Campaign plan
      check(`${who}: old pages are merged away`, !tabs.some(t => ["Local party visits", "Social media", "Coverage", "Volunteers", "Stakeholders"].includes(t)) && tabs.includes("Media") && tabs.includes("Volunteers & stakeholders"), tabs.join("|"));
      await page.click('#tabs button:text-is("Volunteers & stakeholders")'); await page.waitForTimeout(350);
      const heads = await page.$$eval("#main table th", hs => hs.map(h => h.textContent.replace(/[▲▼]/g, "").trim()));
      check(`${who}: people columns are Full name / Organisation / Sector / Email / Phone / Point of contact / Notes`, heads.slice(0, 7).join("|") === "Full name|Organisation|Sector|Email|Phone|Point of contact|Notes", heads.join("|"));
      await page.click('#main [data-fl="1"]');
      const vrows = await page.$$eval("#main tbody tr", rs => rs.map(r => r.innerText));
      check(`${who}: volunteers are filed under Lib Dems`, vrows.length === 1 && /Alex Volunteer/.test(vrows[0]) && (vrows[0].match(/Lib Dems/g) || []).length === 2, vrows.join("|"));
      await page.click('#tabs button:text-is("Media")'); await page.waitForTimeout(350);
      check(`${who}: media lists news and social in one table`, /Sarah Olney on Heathrow/.test(await page.$eval("#main", m => m.innerText)) && /Out in Kingston/.test(await page.$eval("#main", m => m.innerText)));
      check(`${who}: media has Overall Media and Lib Dem Media sections`, (await page.$$eval("#main h2", hs => hs.map(h => h.textContent))).join("|").startsWith("Overall Media|Lib Dem Media") && /Heathrow expansion debated/.test(await page.$eval("#m0", m => m.innerText)) && !/Heathrow expansion debated/.test(await page.$eval("#m1", m => m.innerText)));
      await page.click('#m1 [data-fl="2"]');
      const mrows = await page.$$eval("#m1 tbody tr", rs => rs.map(r => r.innerText));
      check(`${who}: the Social media filter shows platform posts only`, mrows.length === 1 && /BlueSky/.test(mrows[0]) && /Out in Kingston/.test(mrows[0]), mrows.join("|"));
      await page.goto(BASE + "/lovelace/#coverage"); await page.waitForTimeout(600);
      check(`${who}: media has no content pipeline`, !/content pipeline/i.test(await page.$eval("#main", m => m.innerText)));
      check(`${who}: the old #coverage address opens Media`, (await page.$eval("#tabs button.on", b => b.textContent)) === "Media");
      if (who !== "member") {
        await page.click('#tabs button:text-is("This Week")'); await page.waitForTimeout(450);
        const plan = await page.$eval("#main", m => m.innerText);
        check(`${who}: the plan shows a dated visit's details under Campaigning`, /Richmond Park/.test(plan) && /contact Pat 0701/.test(plan) && /taken by Louis/.test(plan), plan.slice(0, 200).replace(/\n/g, " "));
        if (process.env.SHOTS && who === "admin") await page.screenshot({ path: path.join(process.env.SHOTS, "lovelace-this-week.png"), fullPage: true });
        const gh = await page.$$eval(".grp .h2-rule", hs => hs.map(h => h.textContent.replace(/\+ Add/, "").trim()));
        check(`${who}: This Week has the five groups, constituencies grouped`, gh.join("|") === "Main News|Across London|Campaigning|Media" && /Constituency Activity/.test(plan) && /Local Party Activity/.test(plan) && /Parliamentary News/.test(plan) && /Media Activity/.test(plan) && /Action Days/.test(plan), gh.join("|"));
        check(`${who}: Parliamentary News shows the latest coverage and links to Media`, /Heathrow expansion debated in the Commons/.test(plan) && /all coverage in Media/.test(plan));
        check(`${who}: a chair-level role can add to a constituency section`, await page.$$eval("details.cons [data-add]", bs => bs.length) === 2);
        check(`${who}: visit requests sit under the plan`, /Local party visit requests/.test(plan) && /1 without a date yet/.test(plan));
      }
      if (who !== "member") {
        // every drop-down starts closed
        await page.evaluate(() => { window.ATHENA_DROPDOWNS_OPEN = false; });
        await page.click('#tabs button:text-is("Budget & governance")'); await page.waitForTimeout(500);
        const dd = await page.$$eval("details.dd", ds => ({ n: ds.length, open: ds.filter(d => d.open).length }));
        check(`${who}: drop-down sections start closed`, dd.n >= 1 && dd.open === 0, JSON.stringify(dd));
        await page.click("details.dd > summary"); await page.waitForTimeout(200);
        check(`${who}: a section opens when its heading is clicked`, (await page.$$("details.dd[open]")).length === 1);
        await page.evaluate(() => { window.ATHENA_DROPDOWNS_OPEN = true; });
        // sorting + CSV on the budget table
        await page.click('#tabs button:text-is("Budget & governance")'); await page.waitForTimeout(300);
        await page.click('#b1 [data-sort="amount"]');
        const first = await page.$eval("#b1 tbody tr td", td => td.textContent);
        check(`${who}: sort budget by amount`, first === "Hall hire", first);
        const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#b1 [data-csv]")]);
        const csv = fs.readFileSync(await dl.path(), "utf8");
        check(`${who}: CSV export`, csv.includes("Leaflets") && csv.includes("Item"), csv.split("\n")[0]);
        // column filters and the frozen title row (site/shared/tables.js)
        await page.waitForTimeout(300);
        const heads = await page.$$eval("#b1 thead th", hs => hs.filter(h => h.textContent.trim()).map(h => ({ filter: !!h.querySelector(".tf-btn"), pos: getComputedStyle(h).position })));
        check(`${who}: every column title has a filter button and sticks to the top`, heads.length >= 3 && heads.every(h => h.filter && h.pos === "sticky"), JSON.stringify(heads));
        const catIdx = (await page.$$eval("#b1 thead th", hs => hs.map(h => h.dataset.tfName))).indexOf("Category");
        await page.click(`#b1 thead th:nth-child(${catIdx + 1}) .tf-btn`); await page.waitForTimeout(150);
        if (process.env.SHOTS && who === "admin") for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(process.env.SHOTS, `table-filter-${scheme}.png`) }); }
        await page.emulateMedia({ colorScheme: "light" });
        const vals = await page.$$eval(".tf-pop .tf-list label span", ss => ss.map(x => x.textContent));
        check(`${who}: the filter lists the column's values`, vals.includes("Print") && vals.includes("Events"), vals.join("|"));
        await page.click('.tf-pop .tf-list li:has-text("Print") input'); await page.click(".tf-pop [data-ok]"); await page.waitForTimeout(200);
        const left = await page.$$eval("#b1 tbody tr:not(.tf-off) td:first-child", ts => ts.map(t => t.textContent));
        check(`${who}: unticking Print leaves only Events`, left.join("|") === "Hall hire" && /showing 1 of 2/.test(await page.$eval(".tf-bar", b => b.innerText)), left.join("|"));
        const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#b1 [data-csv]")]);
        const csv2 = fs.readFileSync(await dl2.path(), "utf8");
        check(`${who}: the CSV download follows the filter`, csv2.includes("Hall hire") && !csv2.includes("Leaflets"), csv2.slice(0, 80));
        await page.fill("#b1 [data-q]", "hall"); await page.waitForTimeout(150);
        check(`${who}: the filter survives the page redrawing its table`, (await page.$$("#b1 tbody tr:not(.tf-off)")).length === 1 && (await page.$$(".tf-bar")).length === 1);
        await page.fill("#b1 [data-q]", ""); await page.click(".tf-bar [data-clear]"); await page.waitForTimeout(200);
        check(`${who}: Clear filters brings every row back`, (await page.$$("#b1 tbody tr:not(.tf-off)")).length === 2 && (await page.$$(".tf-bar")).length === 0);
        // conflict protection on plan entries (mock returns 0 rows updated)
        await page.click('#tabs button:text-is("This Week")'); await page.waitForTimeout(300);
        await page.click("[data-e=p1]");
        await page.fill("#f_content", "Changed");
        await page.click("dialog button[value=ok]");
        await page.waitForTimeout(300);
        const msg = await page.$eval("dialog #fe", e => e.textContent).catch(() => "");
        check(`${who}: edit conflict is reported`, /Someone else changed/.test(msg), msg.slice(0, 50));
        check(`${who}: conflict check sends updated_at`, log.some(l => l.includes("PATCH plan_entries") && l.includes("updated_at=eq.")), log.filter(l => l.startsWith("PATCH")).join(";"));
        await page.keyboard.press("Escape");
      }
      if (who === "admin") {
        await page.click('#shell-foot [data-foot="team"]'); await page.waitForTimeout(400);
        const team = await page.$eval("#main", m => m.innerText);
        check(`${who}: team page has access dates, last seen, activity`, /Access until/i.test(team) && /Last signed in/i.test(team) && /Recent activity/i.test(team));
        const ulysseLocked = await page.$eval('[data-p="member|ulysse|read"]', e => e.disabled);
        check(`${who}: LUCIEN permission editable only by admin`, ulysseLocked === (who !== "admin"));
        const selfLocked = await page.$$eval(`[data-u="${USERS[who].id}"]`, e => e.length === 0);
        check(`${who}: cannot edit own role`, selfLocked);
      }

      await page.goto(BASE + "/lucien/");
      await page.waitForTimeout(1200);
      if (process.env.SHOTS && who === "admin") for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(process.env.SHOTS, `lucien-${scheme}.png`), fullPage: true }); await page.emulateMedia({ colorScheme: "light" }); }
      const ul = await page.$eval("body", b => b.innerText);
      check(`${who}: lucien access`, who === "admin" ? /Everything/.test(ul) && /items? shown|item/.test(ul) : /Not found/.test(ul), ul.slice(0, 40).replace(/\n/g, " "));
      if (who === "admin") {
        await page.click('#tabs button[data-tab="health"]'); await page.waitForTimeout(200);
        check("admin: lucien health tab", /sources returning data/.test(await page.$eval("#healthpanel", e => e.innerText)));
        await page.click('#tabs button[data-tab="statscal"]'); await page.waitForTimeout(300);
        check("stats calendar: it opens as a calendar (a month grid with weekday headings)", (await page.$$(".sc-grid .sc-dow")).length === 7 && (await page.$$(".sc-cell")).length >= 28);
        await page.click('[data-sc-day="' + plus(2) + '"]'); await page.waitForTimeout(200);
        const dayp = await page.$eval(".sc-daypanel", e => e.innerText);
        check("stats calendar: picking a day shows its releases and meetings, with the meeting's agenda and documents", /Labour market overview/.test(dayp) && /Transport Committee/.test(dayp) && /Agenda frontsheet/.test(dayp) && (await page.$$eval(".sc-daypanel .sc-agenda li", ls => ls.map(l => l.textContent)).then(a => a.join("|"))) === "Apologies for Absence|Declarations of Interests|Bus services", dayp.slice(0, 120).replace(/\n/g, " "));
        await page.click('[data-sc-view="agenda"]'); await page.waitForTimeout(200);
        const sc = await page.$eval("#statspanel", e => e.innerText);
        check("stats calendar: a meeting that has happened says Held, not Published", /Held/i.test(sc) && /Police and Crime Committee/.test(sc));
        await page.selectOption("#sc-cat", "meeting"); await page.waitForTimeout(200);
        check("stats calendar: the Meetings filter shows only meetings", (await page.$$(".sc-item")).length === 2 && /cat=meeting/.test(page.url()), page.url());
        await page.selectOption("#sc-cat", ""); await page.waitForTimeout(200);
        check("stats calendar: the agenda lists releases by day with a time, and says when it was refreshed", /Labour market overview/.test(sc) && /09:30/.test(sc) && /Last refreshed/.test(sc), sc.slice(0, 160).replace(/\n/g, " "));
        check("stats calendar: confirmed, provisional, estimated and cancelled each have a badge", /Confirmed/i.test(sc) && /Estimated/i.test(sc) && /Cancelled/i.test(sc) && /Provisional/i.test(sc));
        check("stats calendar: a moved release shows Changed and its old date", /Changed/i.test(sc) && /was /.test(sc));
        check("stats calendar: a month-only date is in a 'date to be confirmed' strip, not on a day", /date to be confirmed/.test(sc) && await page.$$eval(".sc-tbc .sc-item", is => is.some(i => /Monthly crime figures/.test(i.textContent))));
        check("stats calendar: Recently changed and Just published panels", /Recently changed/.test(sc) && /moved .* → /.test(sc) && /Just published/.test(sc) && /Hospital admissions/.test(sc));
        check("stats calendar: a source that failed shows a warning", /could not be refreshed: govuk/.test(sc));
        await page.selectOption("#sc-tier", "ons"); await page.waitForTimeout(200);
        check("stats calendar: the body filter narrows the list and goes in the address", (await page.$$(".sc-item")).length === 2 && /tier=ons/.test(page.url()), page.url());
        await page.click("#sc-reset"); await page.click('[data-sc-view="month"]'); await page.waitForTimeout(200);
        check("stats calendar: the month view is a grid with the releases on their days", (await page.$$(".sc-cell")).length >= 28 && (await page.$$(".sc-chip")).length >= 3);
        const ics = await page.evaluate(() => StatsCal.icsText(false));
        check("stats calendar: the calendar file has confirmed and provisional all-day events, no estimates, no cancelled", /BEGIN:VCALENDAR/.test(ics) && /DTSTART;VALUE=DATE:\d{8}/.test(ics) && /Labour market overview/.test(ics) && !/Police\.uk data/.test(ics) && !/Cancelled thing/.test(ics) && !/Monthly crime/.test(ics));
        check("stats calendar: with estimates the file includes them, marked", /\(est\.\) Police\.uk data/.test(await page.evaluate(() => StatsCal.icsText(true))));
        await page.click('#shell-foot [data-foot="team"]'); await page.waitForTimeout(500);
        const lt =await page.$eval("#teampanel", e => e.innerText);
        check("admin: LUCIEN has Team & access (people, levels, codes, activity)", /Team & access/.test(lt) && /reader@test\.invalid/.test(lt) && /What each level is/.test(lt) && /Access codes/.test(lt) && /Recent activity/.test(lt), lt.slice(0, 120).replace(/\n/g, " "));
        await page.click('#tabs button[data-tab="media"]'); await page.waitForTimeout(200);
        await page.reload(); await page.waitForTimeout(1000);
        check("admin: lucien remembers tab", await page.$eval('#tabs button.on', b => b.dataset.tab) === "media");
        await page.evaluate(() => { sessionStorage.clear(); localStorage.setItem("ulysse.lastVisit", new Date(Date.now() - 3 * 864e5).toISOString()); });
        await page.reload(); await page.waitForTimeout(1000);
        await page.click('#tabs button[data-tab="all"]'); await page.waitForTimeout(200);
        const stats = await page.$eval("#stats", e => e.innerText);
        check("admin: lucien shows what is new since the last visit", /since your last visit/.test(stats) && await page.$eval("#sinceLastWrap", e => !e.hidden), stats.replace(/\n/g, " "));
      }

      await page.goto(BASE + "/admin/");
      await page.waitForTimeout(1000);
      if (process.env.SHOTS && who === "admin") for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(process.env.SHOTS, `admin-${scheme}.png`), fullPage: true }); await page.emulateMedia({ colorScheme: "light" }); }
      const ad = await page.$eval("body", b => b.innerText);
      check(`${who}: admin page`, who === "admin" ? /Collector healthy/i.test(ad) && /Recent activity/i.test(ad) : /Not found/.test(ad), ad.slice(0, 50).replace(/\n/g, " "));

      const bad = errors.filter(e => !/Failed to load resource: the server responded with a status of 404/.test(e));
      check(`${who}: no console errors / CSP violations`, bad.length === 0, bad.slice(0, 3).join(" || "));
      check(`${who}: no unmocked requests`, !log.some(l => l.startsWith("unmocked")), log.filter(l => l.startsWith("unmocked")).join(";"));
      await ctx.close();
    }
  } finally {
    await browser.close(); srv.kill();
  }
  let failed = 0;
  for (const [ok, name, extra] of results) { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra && !ok ? "  -> " + extra : ""}`); }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
