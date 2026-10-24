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

const results = [];
const check = (name, ok, extra = "") => { results.push([ok, name, extra]); };

(async () => {
  const srv = spawn("python3", [path.join(__dirname, "serve.py"), String(PORT)], { stdio: "ignore" });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch();
  try {
    for (const who of ["admin", "core", "member"]) {
      const ctx = await browser.newContext({ acceptDownloads: true });
      const page = await ctx.newPage();
      const errors = [], log = [];
      page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
      page.on("pageerror", e => errors.push("pageerror: " + e.message));
      await mock(page, who, log);

      await page.goto(BASE + "/");
      await page.waitForTimeout(600);
      const links = await page.$$eval("#n a b", bs => bs.map(b => b.textContent));
      check(`${who}: home shows Ulysse only to admin`, links.includes("Ulysse") === (who === "admin"), links.join(","));

      await page.goto(BASE + "/mall/");
      await page.waitForSelector("#tabs button", { timeout: 5000 });
      const tabs = await page.$$eval("#tabs button", bs => bs.map(b => b.textContent));
      check(`${who}: mall tabs`, who === "member" ? !tabs.includes("Budget & governance") && tabs.includes("Overview") : tabs.includes("Budget & governance") && tabs.includes("Team & access"), tabs.join(" | "));
      await page.waitForSelector(".ovgrid", { timeout: 5000 });
      const ov = await page.$$eval(".card.ov h3", hs => hs.map(h => h.textContent.replace(" open ›", "")));
      check(`${who}: overview cards`, ov.length >= 2 && (who === "member" ? !ov.includes("Governance due") : ov.includes("Governance due")), ov.join(" | "));
      for (const t of tabs) {
        await page.click(`#tabs button:text-is("${t}")`);
        await page.waitForTimeout(350);
        const txt = await page.$eval("#main", m => m.innerText);
        check(`${who}: tab ${t} renders`, txt.length > 20 && !/Loading…$/.test(txt.trim()), txt.slice(0, 60).replace(/\n/g, " "));
      }
      if (who !== "member") {
        // sorting + CSV on the budget table
        await page.click('#tabs button:text-is("Budget & governance")'); await page.waitForTimeout(300);
        await page.click('#b1 [data-sort="amount"]');
        const first = await page.$eval("#b1 tbody tr td", td => td.textContent);
        check(`${who}: sort budget by amount`, first === "Hall hire", first);
        const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#b1 [data-csv]")]);
        const csv = fs.readFileSync(await dl.path(), "utf8");
        check(`${who}: CSV export`, csv.includes("Leaflets") && csv.includes("Item"), csv.split("\n")[0]);
        // conflict protection on plan entries (mock returns 0 rows updated)
        await page.click('#tabs button:text-is("Campaign plan")'); await page.waitForTimeout(300);
        await page.click("[data-e=p1]");
        await page.fill("#f_content", "Changed");
        await page.click("dialog button[value=ok]");
        await page.waitForTimeout(300);
        const msg = await page.$eval("dialog #fe", e => e.textContent).catch(() => "");
        check(`${who}: edit conflict is reported`, /Someone else changed/.test(msg), msg.slice(0, 50));
        check(`${who}: conflict check sends updated_at`, log.some(l => l.includes("PATCH plan_entries") && l.includes("updated_at=eq.")), log.filter(l => l.startsWith("PATCH")).join(";"));
        await page.keyboard.press("Escape");
        await page.click('#tabs button:text-is("Team & access")'); await page.waitForTimeout(400);
        const team = await page.$eval("#main", m => m.innerText);
        check(`${who}: team page has access dates, last seen, activity`, /Access until/.test(team) && /Last signed in/.test(team) && /Recent activity/.test(team));
        const ulysseLocked = await page.$eval('[data-p="member|ulysse|read"]', e => e.disabled);
        check(`${who}: Ulysse permission editable only by admin`, ulysseLocked === (who !== "admin"));
        const selfLocked = await page.$$eval(`[data-u="${USERS[who].id}"]`, e => e.length === 0);
        check(`${who}: cannot edit own role`, selfLocked);
      }

      await page.goto(BASE + "/ulysse/");
      await page.waitForTimeout(1200);
      const ul = await page.$eval("body", b => b.innerText);
      check(`${who}: ulysse access`, who === "admin" ? /Everything/.test(ul) && /items? shown|item/.test(ul) : /Not found/.test(ul), ul.slice(0, 40).replace(/\n/g, " "));
      if (who === "admin") {
        await page.click('#tabs button[data-tab="health"]'); await page.waitForTimeout(200);
        check("admin: ulysse health tab", /sources returning data/.test(await page.$eval("#healthpanel", e => e.innerText)));
        await page.click('#tabs button[data-tab="media"]'); await page.waitForTimeout(200);
        await page.reload(); await page.waitForTimeout(1000);
        check("admin: ulysse remembers tab", await page.$eval('#tabs button.on', b => b.dataset.tab) === "media");
      }

      await page.goto(BASE + "/admin/");
      await page.waitForTimeout(1000);
      const ad = await page.$eval("body", b => b.innerText);
      check(`${who}: admin page`, who === "admin" ? /Collector healthy/.test(ad) && /Recent activity/.test(ad) : /Not found/.test(ad), ad.slice(0, 50).replace(/\n/g, " "));

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
