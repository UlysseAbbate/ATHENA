/* Access: who can open each program, at what level, until when, and the shared access codes.
 * The admin sees every program; a program manager sees only the programs they manage. The rules (who may give what to whom)
 * are enforced in the database; this page only offers what the database would accept. */
const { sb, esc } = Athena;
const m = document.getElementById("m");
const NAMES = { lovelace: "Lovelace", lucien: "Lucien", libby: "LIBBY" };
const day = d => d ? new Date(d + "T12:00:00").toLocaleDateString("en-GB", { dateStyle: "medium" }) : "no end date";
const when = d => d ? new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "never";

let acc, levels = {}, prog, notice = null;
const me = () => acc.session.user.id;
const lim = () => acc.programs[prog].limit ?? 0;
const isAdmin = () => !!acc.admin;
const canGive = l => isAdmin() || (!l.admin_only && l.rank <= lim());
const say = (t, err) => { const e = document.getElementById("msg"); if (e) { e.className = t ? (err ? "state-error" : "state-ok") : ""; e.textContent = t || ""; } };
const run = async (p, ok) => { const r = await p; if (r.error) { say(r.error.message, true); return false; } if (ok) notice = ok; await draw(); return true; };

AuthUI.watchRecovery(sb, m);
(async () => {
  Shell.mount(document.getElementById("hd"), { sub: "Access", home: "../" });
  try { acc = await Athena.access(); } catch (e) { m.textContent = e.message; return; }
  if (!acc) return AuthUI.render(sb, m, { title: "Access" });
  const mine = Object.entries(acc.programs || {}).filter(([, v]) => v.manager).map(([id]) => id);
  if (!mine.length) return Athena.notFound();
  Shell.mount(document.getElementById("hd"), { sub: "Access", home: "../", email: acc.session.user.email, signOut: () => sb.auth.signOut() });
  const { data } = await sb.from("program_levels").select("*").order("rank");
  for (const l of data || []) (levels[l.program] ||= []).push(l);
  prog = mine.includes(location.hash.slice(1)) ? location.hash.slice(1) : mine[0];
  m.innerHTML = `<div class="page-head"><h1>Access</h1><p class="lede">Choose who can open each program, and at what level. Changes apply the next time they load a page.</p></div>
    <div class="tabs" role="tablist" id="tabs">${mine.map(id => `<button role="tab" data-p="${id}">${esc(NAMES[id] || id)}</button>`).join("")}</div><div id="body"></div>`;
  document.getElementById("tabs").onclick = e => { const b = e.target.closest("[data-p]"); if (b) { prog = b.dataset.p; notice = null; history.replaceState(null, "", "#" + prog); draw(); } };
  draw();
})();

async function draw() {
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.p === prog));
  const body = document.getElementById("body");
  const [ppl, codes] = await Promise.all([sb.rpc("program_people", { p: prog }), sb.from("access_codes").select("*").eq("program", prog).order("created_at", { ascending: false })]);
  const lv = levels[prog] || [], label = id => lv.find(l => l.level === id)?.label || id, readonly = prog === "lovelace";
  const people = ppl.data || [];
  const opts = (sel, rowLevel) => lv.filter(l => canGive(l) || l.level === rowLevel).map(l => `<option value="${l.level}"${l.level === sel ? " selected" : ""}${canGive(l) ? "" : " disabled"}>${esc(l.label)}</option>`).join("");
  const rowRank = r => lv.find(l => l.level === r.level)?.rank ?? 0, rowAdminOnly = r => !!lv.find(l => l.level === r.level)?.admin_only;
  const locked = r => readonly || r.user_id === me() || (!isAdmin() && (r.is_manager || rowAdminOnly(r) || rowRank(r) > lim()));
  const live = c => !c.revoked_at && (!c.expires_at || new Date(c.expires_at) > new Date()) && (c.max_uses == null || c.uses < c.max_uses);

  body.innerHTML = `<div id="msg" role="alert"></div>${notice || ""}
    ${readonly ? `<div class="state-warn">Lovelace access is still managed in <a href="../lovelace/#team">Lovelace → Team &amp; access</a>. It moves to this page later. This list is read-only.</div>` : ""}
    <h2 class="h2-rule">People <span class="count">${people.length}</span></h2>
    ${people.length ? `<div class="table-wrap"><table class="grid" id="people"><thead><tr><th>Person</th><th>Level</th><th>Access until</th><th>Last signed in</th><th></th></tr></thead><tbody>
      ${people.map(r => `<tr data-u="${r.user_id}"><td>${esc(r.email)}${r.full_name ? `<small class="why">${esc(r.full_name)}</small>` : ""}${r.is_manager ? `<span class="badge">Manager</span>` : ""}${r.user_id === me() ? ` <span class="muted">(you)</span>` : ""}</td>
        <td><select data-f="level" aria-label="Level for ${esc(r.email)}"${locked(r) ? " disabled" : ""}>${opts(r.level, r.level)}</select></td>
        <td><input type="date" data-f="expires_at" value="${r.expires_at || ""}" aria-label="Access until for ${esc(r.email)}"${locked(r) ? " disabled" : ""}></td>
        <td>${esc(when(r.last_sign_in_at))}</td>
        <td class="act">${locked(r) ? "" : `<button class="button button-small button-quiet" data-del>Remove</button>`}
          ${isAdmin() && !readonly && r.user_id !== me() ? `<label class="show" style="display:inline;margin:0 0 0 .6rem"><input type="checkbox" data-mgr${r.is_manager ? " checked" : ""}> Manager</label>
          <select data-ceil aria-label="Highest level ${esc(r.email)} may give"${r.is_manager ? "" : " hidden"}><option value="">any level</option>${lv.filter(l => !l.admin_only).map(l => `<option value="${l.rank}"${r.grant_ceiling === l.rank ? " selected" : ""}>up to ${esc(l.label)}</option>`).join("")}</select>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">Nobody has been given access to ${esc(NAMES[prog])} yet.</p>`}
    ${readonly ? "" : `<form class="row-form" id="add"><div><label for="ae">Give access to (their account email)</label><input id="ae" type="email" required autocomplete="off"></div>
      <div><label for="al">Level</label><select id="al">${opts(lv.find(canGive)?.level)}</select></div>
      <div><label for="au">Until (optional)</label><input id="au" type="date"></div><button class="button" type="submit">Give access</button></form>
      <p class="muted">They need an account first. Anyone can create one on the sign-in page; they see nothing until you give them a level.</p>
      <h2 class="h2-rule">Access codes <span class="count">${(codes.data || []).filter(live).length} live</span></h2>
      <p class="lede">A code lets a group in with one password and no account. Everyone using it appears as the code's label, not by name. Switch it off at any time and everyone using it is signed out.</p>
      ${(codes.data || []).length ? `<div class="table-wrap"><table class="grid" id="codes"><thead><tr><th>Label</th><th>Level</th><th>Ends</th><th>Used</th><th>Status</th><th></th></tr></thead><tbody>
        ${codes.data.map(c => `<tr data-c="${c.id}"><td>${esc(c.label)}</td><td>${esc(label(c.level))}</td><td>${esc(c.expires_at ? when(c.expires_at) : "no end")}</td>
          <td>${c.uses}${c.max_uses != null ? ` / ${c.max_uses}` : ""}</td><td>${c.revoked_at ? "switched off" : live(c) ? "live" : "ended"}</td>
          <td class="act">${live(c) ? `<button class="button button-small button-quiet" data-off>Switch off</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No codes yet.</p>`}
      <form class="row-form" id="mk"><div><label for="cl">Label (who it is for)</label><input id="cl" required maxlength="60" placeholder="e.g. Peers"></div>
        <div><label for="cv">Level</label><select id="cv">${opts(lv.find(canGive)?.level)}</select></div>
        <div><label for="cc">Password (leave empty for a random one)</label><input id="cc" autocomplete="off" minlength="8"></div>
        <div><label for="ce">Ends (optional)</label><input id="ce" type="datetime-local"></div>
        <div><label for="cm">Most uses (optional)</label><input id="cm" type="number" min="1" style="width:7rem"></div>
        <button class="button" type="submit">Make code</button></form>`}`;
  notice = null;

  body.querySelector("#people")?.addEventListener("change", e => {
    const tr = e.target.closest("tr[data-u]"), u = tr.dataset.u;
    if (e.target.matches("[data-f]")) {
      const patch = { [e.target.dataset.f]: e.target.value || null };
      run(sb.from("access_grants").update(patch).eq("user_id", u).eq("program", prog), null);
    } else if (e.target.matches("[data-mgr]")) {
      run(sb.rpc("set_manager", { p_user: u, p_program: prog, p_on: e.target.checked, p_ceiling: e.target.checked ? (+tr.querySelector("[data-ceil]").value || null) : null }));
    } else if (e.target.matches("[data-ceil]")) {
      run(sb.rpc("set_manager", { p_user: u, p_program: prog, p_on: true, p_ceiling: +e.target.value || null }));
    }
  });
  body.querySelector("#people")?.addEventListener("click", e => {
    if (!e.target.matches("[data-del]")) return;
    const tr = e.target.closest("tr"), who = tr.querySelector("td").firstChild.textContent;
    if (confirm(`Remove ${who}'s access to ${NAMES[prog]}?`)) run(sb.from("access_grants").delete().eq("user_id", tr.dataset.u).eq("program", prog));
  });
  body.querySelector("#add")?.addEventListener("submit", e => {
    e.preventDefault();
    run(sb.rpc("grant_access", { p_email: body.querySelector("#ae").value, p_program: prog, p_level: body.querySelector("#al").value, p_expires: body.querySelector("#au").value || null }));
  });
  body.querySelector("#codes")?.addEventListener("click", e => {
    if (e.target.matches("[data-off]") && confirm("Switch this code off? Everyone using it will be signed out."))
      run(sb.rpc("revoke_access_code", { p_id: e.target.closest("tr").dataset.c }));
  });
  body.querySelector("#mk")?.addEventListener("submit", async e => {
    e.preventDefault();
    const end = body.querySelector("#ce").value, label = body.querySelector("#cl").value;
    const r = await sb.rpc("create_access_code", { p_label: label, p_program: prog, p_level: body.querySelector("#cv").value,
      p_expires: end ? new Date(end).toISOString() : null, p_max_uses: +body.querySelector("#cm").value || null, p_code: body.querySelector("#cc").value || null });
    if (r.error) return say(r.error.message, true);
    await run(Promise.resolve({}), `<div class="state-ok"><b>Code made for ${esc(label)}.</b> Copy it now: it cannot be shown again.<br><code id="newcode">${esc(r.data)}</code> <button class="button button-small button-quiet" type="button" id="cp">Copy</button></div>`);
    document.getElementById("cp")?.addEventListener("click", ev => { navigator.clipboard?.writeText(r.data); ev.target.textContent = "Copied"; });
  });
}
