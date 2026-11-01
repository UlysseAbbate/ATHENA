/* "Team & access" for LUCIEN and LIBBY, laid out like LOVELACE's page: People, What each level means, Access codes, Recent activity.
 * Only the administrator is offered it, and the database only answers the administrator (program_people, access_codes and audit_log are admin-readable).
 * It shows who has access; changing it is done on the Access page. Nothing here is a security boundary.
 *   TeamPage.render(host, { program: "lucien" | "libby", name: "LUCIEN" }) */
window.TeamPage = (() => {
  const { sb, esc } = Athena;
  const day = d => d ? new Date(d + "T12:00:00").toLocaleDateString("en-GB", { dateStyle: "medium" }) : "no end date";
  const when = d => d ? new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "never";
  async function render(host, { program, name }) {
    host.innerHTML = '<p class="muted">Loading…</p>';
    const [ppl, lv, codes, log] = await Promise.all([
      sb.rpc("program_people", { p: program }),
      sb.from("program_levels").select("*").eq("program", program).order("rank"),
      sb.from("access_codes").select("*").eq("program", program).order("created_at", { ascending: false }),
      sb.from("audit_log").select("*").in("table_name", ["access_grants", "access_codes"]).order("at", { ascending: false }).limit(300)]);
    const bad = [ppl, lv, codes, log].find(r => r.error);
    if (bad) { host.innerHTML = `<p class="state-error">${esc(bad.error.message)}</p>`; return; }
    const levels = lv.data || [], label = id => levels.find(l => l.level === id)?.label || id;
    const today = new Date().toISOString().slice(0, 10);
    const ended = p => p.expires_at && p.expires_at < today;
    const ids = new Set((codes.data || []).map(c => String(c.id)));
    const mine = (log.data || []).filter(l => l.table_name === "access_grants" ? String(l.label || "").includes(` · ${program} · `) : ids.has(String(l.row_id))).slice(0, 60);
    const live = c => !c.revoked_at && (!c.expires_at || new Date(c.expires_at) > new Date()) && (c.max_uses == null || c.uses < c.max_uses);
    const people = ppl.data || [];
    host.innerHTML = `<div class="page-head"><h1>Team &amp; access</h1><p class="lede">Only you can see this page. Roles, end dates and codes are given on the <a href="../access/#${esc(program)}">Access page</a>; this shows who has ${esc(name)} and what happened.</p></div>
      <h2 class="h2-rule">People <span class="count">${people.length}</span></h2>
      ${people.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Email</th><th>Name</th><th>Level</th><th>Access until</th><th>Last signed in</th></tr></thead><tbody>${people.map(p =>
        `<tr${ended(p) ? ' style="opacity:.55"' : ""}><td>${esc(p.email)}${p.is_manager ? ' <span class="badge">Manager</span>' : ""}</td><td>${esc(p.full_name)}</td><td>${esc(label(p.level))}</td>
        <td>${esc(day(p.expires_at))}${ended(p) ? ' <span class="pill">ended</span>' : ""}</td><td class="muted">${esc(p.last_sign_in_at ? when(p.last_sign_in_at) : "never")}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="muted">Nobody has been given access to ${esc(name)} yet.</p>`}
      <h2 class="h2-rule">What each level is</h2>
      <div class="table-wrap"><table class="grid"><thead><tr><th>Level</th><th>Order</th><th>Who can give it</th></tr></thead><tbody>${levels.map(l =>
        `<tr><td>${esc(l.label)}</td><td>${esc(l.rank)}</td><td>${l.admin_only ? "Only you" : "You, and a program manager up to their own level"}</td></tr>`).join("")}</tbody></table></div>
      <h2 class="h2-rule">Access codes <span class="count">${(codes.data || []).filter(live).length} live</span></h2>
      ${(codes.data || []).length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Label</th><th>Level</th><th>Ends</th><th>Used</th><th>Status</th></tr></thead><tbody>${codes.data.map(c =>
        `<tr><td>${esc(c.label)}</td><td>${esc(label(c.level))}</td><td>${esc(c.expires_at ? when(c.expires_at) : "no end")}</td><td>${c.uses}${c.max_uses != null ? ` / ${c.max_uses}` : ""}</td>
        <td>${c.revoked_at ? "switched off" : live(c) ? "live" : "ended"}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">No codes.</p>'}
      <h2 class="h2-rule">Recent activity</h2><p class="muted">Who gave or changed access (values are not stored here). Last ${mine.length || 60} changes.</p>
      <div class="table-wrap"><table class="grid"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>${mine.map(l =>
        `<tr><td>${esc(new Date(l.at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }))}</td><td>${esc(l.user_email || "automatic")}</td>
        <td>${esc(l.action)} · ${l.table_name === "access_codes" ? "Code" : "Access"}${l.label ? ` · <i>${esc(l.label)}</i>` : ""}${l.changed?.length ? ` <span class="muted">(${esc(l.changed.join(", "))})</span>` : ""}</td></tr>`).join("")
        || '<tr><td colspan="3" class="muted">No changes yet.</td></tr>'}</tbody></table></div>`;
  }
  return { render };
})();
