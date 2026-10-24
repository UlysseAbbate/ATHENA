// Screenshots of the main pages with the same mocked data as run.js. Run: SHOTS=/some/dir node tests/ui/shots.js
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = 8765, BASE = `http://127.0.0.1:${PORT}`;
const SB = "https://fbsoibmtvapmxdlfdgxc.supabase.co";
const ROOT = path.resolve(__dirname, "../..");
const today = new Date(), iso = d => d.toISOString().slice(0, 10), plus = n => iso(new Date(Date.now() + n * 864e5));
const feedFile = path.join(ROOT, "data/ulysse/feed.json");
const FEED = fs.existsSync(feedFile) ? JSON.parse(fs.readFileSync(feedFile)) : { updated: new Date().toISOString(), items: [] };
FEED.updated = new Date().toISOString();

const USERS = {
  admin: { id: "00000000-0000-0000-0000-0000000000a1", email: "owner@test.invalid", role: "core_team", admin: true },
  core: { id: "00000000-0000-0000-0000-0000000000c1", email: "core@test.invalid", role: "core_team", admin: false },
  member: { id: "00000000-0000-0000-0000-0000000000e1", email: "member@test.invalid", role: "member", admin: false },
};
const PERMS = {
  core_team: ["plan_full", "plan_shared", "budget", "volunteers_all", "volunteers_add", "policies", "social", "coverage", "stakeholders_all", "stakeholders_add", "visits", "users", "permissions", "audit"],
  member: ["plan_shared", "volunteers_add", "stakeholders_add", "coverage"],
};
const ALLRES = [...PERMS.core_team, "ulysse"];
const ts = new Date(Date.now() - 3 * 36e5).toISOString();
const TABLES = {
  profiles: Object.values(USERS).map(u => ({ id: u.id, email: u.email, full_name: u.email.split("@")[0], role: u.role, access_until: u.role === "member" ? plus(20) : null, created_at: ts })),
  role_permissions: ["core_team", "member"].flatMap(r => ALLRES.map(res => ({ role: r, resource: res, can_read: PERMS[r].includes(res) || (r === "member" && res === "coverage"), can_write: PERMS[r].includes(res) && r === "core_team" || ["volunteers_add", "stakeholders_add"].includes(res) }))),
  plan_categories: [{ id: 1, name: "SOLNEY story", sort: 1, shared: true }, { id: 2, name: "Press", sort: 2, shared: false }],
  plan_entries: [{ id: "p1", plan_date: iso(today), category_id: 1, content: "Launch housing pledge", updated_at: ts }, { id: "p2", plan_date: plus(2), category_id: 2, content: "Op-ed in the Standard", updated_at: ts }],
  local_party_visits: [{ id: "v1", local_party: "Richmond Park", request: "Street stall", visit_date: plus(3), updated_at: ts }],
  governance_items: [{ id: "g1", title: "Register with Electoral Commission", area: "Legal", status: "To do", due_date: plus(-1), updated_at: ts }],
  content_items: [{ id: "c1", name: "Housing video", status: "In Development", scheduled: plus(4), platforms: "Instagram", updated_at: ts }],
  media_coverage: [{ id: "m1", covered_on: iso(today), outlet: "BBC News", headline: "Sarah Olney on Heathrow", url: "https://example.org/a", source: "auto", updated_at: ts },
    { id: "m2", covered_on: plus(-3), outlet: "Standard", headline: "Olney backs rent reform", url: "https://example.org/b", source: "manual", updated_at: ts }],
  volunteers: [{ id: "vo1", name: "Alex", role_wanted: "Canvassing", accepted: null, created_by: USERS.member.id, created_at: ts, updated_at: ts }],
  stakeholders: [{ id: "s1", name: "Jo Bloggs", organisation: "Shelter", sector: "Campaign", created_by: USERS.core.id, updated_at: ts }],
  budget_items: [{ id: "b1", item: "Leaflets", amount: 1200, category: "Print", updated_at: ts }, { id: "b2", item: "Hall hire", amount: 300, category: "Events", updated_at: ts }],
  policies: [{ id: "po1", policy: "Rent controls", theme: "Housing", updated_at: ts }],
  social_accounts: ["Instagram", "Facebook", "Twitter", "BlueSky", "Substack", "TikTok", "LinkedIn"].map((p, i) => ({ id: "sa" + i, organisation: "Sarah Olney", platform: p, handle: i ? null : "@sarah", url: null, updated_at: ts })),
  social_posts: [],
  audit_log: [{ id: 1, at: ts, user_email: "core@test.invalid", table_name: "plan_entries", label: "Launch housing pledge", action: "update", changed: ["content"] }],
  ulysse_data: [{ name: "feed", body: FEED, updated_at: new Date().toISOString() }, { name: "polls", body: { rows: [] } }, { name: "health", body: { sources: [{ group: "media", name: "BBC News", ok: true, items: 3 }, { group: "thinktanks", name: "IFS", ok: false, items: 0, error: "site refuses bots" }] } }],
  ulysse_read: [],
};

function access(u) {
  const perms = {};
  for (const res of ALLRES) {
    const r = TABLES.role_permissions.find(x => x.role === u.role && x.resource === res) || {};
    perms[res] = { r: u.admin || !!r.can_read, w: u.admin || !!r.can_write };
  }
  return { profile: TABLES.profiles.find(p => p.id === u.id), role: u.role, admin: u.admin, perms };
}

async function mock(page, who, log) {
  const u = USERS[who];
  await page.route(SB + "/**", async route => {
    const req = route.request(), url = new URL(req.url()), m = req.method();
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", ...headers }, body: JSON.stringify(body) });
    if (m === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (url.pathname === "/rest/v1/rpc/my_access") return json(access(u));
    if (url.pathname === "/rest/v1/rpc/team_last_seen") return json(Object.values(USERS).map(x => ({ id: x.id, last_sign_in_at: ts })));
    const t = url.pathname.replace("/rest/v1/", "");
    if (!(t in TABLES)) { log.push(`unmocked ${m} ${url.pathname}`); return json({ message: "not mocked" }, 404); }
    if (m === "HEAD") return route.fulfill({ status: 200, headers: { "content-range": `0-0/${TABLES[t].length}`, "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" } });
    if (m === "PATCH") { log.push(`PATCH ${t} ${url.search}`); return json(t === "plan_entries" ? [] : [{ id: "x" }]); }   // plan edits simulate a conflict
    if (m === "POST" || m === "DELETE") { log.push(`${m} ${t}`); return json([]); }
    let rows = TABLES[t];
    const eqName = url.searchParams.get("name");
    if (eqName) rows = rows.filter(r => "eq." + r.name === eqName);
    if ((req.headers()["accept"] || "").includes("vnd.pgrst.object")) return json(rows[0] || null);
    return json(rows);
  });
  await page.addInitScript(([u]) => {
    localStorage.setItem("sb-fbsoibmtvapmxdlfdgxc-auth-token", JSON.stringify({
      access_token: "x.y.z", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: u.id, email: u.email, aud: "authenticated", role: "authenticated" } }));
  }, [u]);
}


(async () => {
  const srv = spawn("python3", [path.join(__dirname, "serve.py"), String(PORT)], { stdio: "ignore" });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch();
  const out = process.env.SHOTS;
  for (const [who, url, name, w] of [["admin", "/", "home", 1100], ["admin", "/admin/", "admin", 1000], ["member", "/", "home-phone", 390], ["core", "/lovelace/", "lovelace-overview", 1200], ["core", "/lovelace/#team", "lovelace-team", 1200], ["admin", "/lucien/", "lucien", 1200]]) {
    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
      const page = await ctx.newPage(); await mock(page, who, []);
      await page.goto(BASE + url); await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(out, `${name}-${scheme}.png`), fullPage: true });
      await ctx.close();
    }
  }
  await browser.close(); srv.kill();
})();
