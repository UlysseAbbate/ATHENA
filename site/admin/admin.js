/* Owner-only status board. Anyone who is not the admin sees "Not found"; the data is admin-only in the database too. */
const { sb, esc, ago } = Athena;
const m = document.getElementById("m");
const STALE_HOURS = 7;   // the collector runs every 3 hours: two missed runs is worth a warning
const TABLES = { plan_entries: "Plan", plan_categories: "Plan rows", local_party_visits: "Visits", budget_items: "Budget", governance_items: "Governance",
  policies: "Policies", social_accounts: "Social accounts", social_posts: "Social outputs", content_items: "Content", media_coverage: "Coverage",
  volunteers: "Volunteers", stakeholders: "Stakeholders", profiles: "People", role_permissions: "Permissions" };

Shell.mount(document.getElementById("hd"), { sub: "Admin", home: "../" });
AuthUI.watchRecovery(sb, m);
(async () => {
  let acc;
  try { acc = await Athena.access(); } catch (e) { m.textContent = e.message; return; }
  if (!acc) return AuthUI.render(sb, m, { title: "Admin" });
  if (!acc.admin) return Athena.notFound();
  const count = (t, f = b => b) => f(sb.from(t).select("*", { count: "exact", head: true })).then(r => r.count);
  const today = new Date().toISOString().slice(0, 10), soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const [people, pending, ending, vols, stk, cov, autoCov, feed, health, act] = await Promise.all([
    count("profiles"), count("profiles", b => b.is("role", null)),
    sb.from("profiles").select("email,access_until").gte("access_until", today).lte("access_until", soon).order("access_until"),
    count("volunteers"), count("stakeholders"), count("media_coverage"),
    count("media_coverage", b => b.eq("source", "auto").gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString())),
    sb.from("ulysse_data").select("updated_at").eq("name", "feed").maybeSingle(),
    sb.from("ulysse_data").select("body").eq("name", "health").maybeSingle(),
    sb.from("audit_log").select("*").order("at", { ascending: false }).limit(25)]);
  const src = health.data?.body?.sources || [], bad = src.filter(s => !s.ok);
  const updated = feed.data?.updated_at, staleH = updated ? (Date.now() - new Date(updated)) / 36e5 : Infinity;
  const row = (l, v) => `<tr><td>${l}</td><td class="n">${v ?? "–"}</td></tr>`;
  Shell.mount(document.getElementById("hd"), { sub: "Admin", home: "../", email: acc.session.user.email, signOut: () => sb.auth.signOut(),
    programs: [{ href: "../access/", label: "Access" }, { href: "../lovelace/", label: "Lovelace" }, { href: "../lucien/", label: "Lucien" }] });
  m.innerHTML = `<div class="page-head"><h1>System status</h1></div>
    ${staleH > STALE_HOURS ? `<div class="alert"><b>Lucien data is ${updated ? esc(ago(updated)) : "missing"}.</b> The collector should upload every 3 hours: check GitHub → Actions → <i>Update tracker</i>.</div>`
      : `<div class="alert ok">Collector healthy: last upload ${esc(ago(updated))}.</div>`}
    <h2 class="h2-rule">Lovelace</h2><table class="grid">
      ${row("People signed up", people)}${row("Awaiting a role", pending)}
      ${row("Access ending in the next 14 days", (ending.data || []).map(p => `${esc(p.email)} (${esc(p.access_until)})`).join("<br>") || "none")}
      ${row("Volunteers", vols)}${row("Stakeholders", stk)}${row("Coverage entries", cov)}${row("Coverage added automatically this week", autoCov)}</table>
    <p class="muted">Assign roles, access dates and permissions in <a href="../lovelace/#team">Lovelace → Team &amp; access</a>. Lucien can be opened to a role there too (only you can change that).</p>
    <h2 class="h2-rule">Lucien sources</h2><table class="grid">
      ${row("Sources returning data", src.length ? `${src.length - bad.length} / ${src.length}` : "–")}
      ${bad.slice(0, 40).map(s => `<tr><td>${esc(s.name)} <span class="muted">· ${esc(s.group)}</span><small class="why">${esc(s.error || "no items")}</small></td><td class="n">✕</td></tr>`).join("")}</table>
    <h2 class="h2-rule">Recent activity</h2><table class="grid act">${(act.data || []).map(a => `<tr><td>${esc(new Date(a.at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }))}</td>
      <td>${esc(a.user_email || "system")}</td><td>${esc(a.action)} · ${esc(TABLES[a.table_name] || a.table_name)}${a.label ? ` · <i>${esc(a.label)}</i>` : ""}${a.changed?.length ? `<small class="why">${esc(a.changed.join(", "))}</small>` : ""}</td></tr>`).join("") || "<tr><td>No changes yet.</td></tr>"}</table>`;
})();
