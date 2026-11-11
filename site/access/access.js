/* Access: who can open each program, at what level, until when, and the shared access codes.
 * The admin starts on "Everyone": every account that has been made, with a level to choose for LOVELACE, LUCIEN and LIBBY on the one row.
 * A tab for each program shows that program's people, managers and shared codes. A program manager sees only the programs they manage. The rules (who may give what to whom)
 * are enforced in the database; this page only offers what the database would accept. */
const { sb, esc } = Athena;
const m = document.getElementById("m");
const NAMES = { lovelace: "LOVELACE", lucien: "LUCIEN", libby: "LIBBY" };
const day = d => d ? new Date(d + "T12:00:00").toLocaleDateString("en-GB", { dateStyle: "medium" }) : "no end date";
const localInput = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
const when = d => d ? new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "never";

let acc, levels = {}, prog, notice = null;
const me = () => acc.session.user.id;
const lim = () => acc.programs[prog].limit ?? 0;
const isAdmin = () => !!acc.admin;
const canGive = l => isAdmin() || (!l.admin_only && l.rank <= lim());
const say = (t, err) => { const e = document.getElementById("msg"); if (e) { e.className = t ? (err ? "state-error" : "state-ok") : ""; e.textContent = t || ""; } if (err && t) flash(t, true); };
/* A short message that stays in view wherever the page is scrolled, so a change never needs the page to be redrawn or scrolled back. */
let flashTimer;
const flash = (text, bad) => {
  let f = document.getElementById("flash");
  if (!f) { f = document.createElement("div"); f.id = "flash"; f.className = "flash"; f.setAttribute("role", "status"); document.body.append(f); }
  f.textContent = text; f.classList.toggle("flash-bad", !!bad); f.hidden = false;
  clearTimeout(flashTimer); flashTimer = setTimeout(() => { f.hidden = true; }, bad ? 7000 : 3500);
};
const plain = h => String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/* Redraw after a change, but keep the page where it was: the scroll position and the control being used. */
const keepPlace = async fn => {
  const y = window.scrollY, a = document.activeElement, label = a && a.getAttribute && a.getAttribute("aria-label");
  await fn();
  window.scrollTo(0, y);
  if (label) { const again = [...document.querySelectorAll("[aria-label]")].find(x => x.getAttribute("aria-label") === label); if (again && again.focus) again.focus({ preventScroll: true }); }
};
/* Run a change. By default the lists are redrawn afterwards (with the page kept in place); with { redraw: false } nothing is redrawn and the result is shown as a message,
 * which is what a level, date or manager change does: the page stays exactly as it was. */
const run = async (p, ok, { redraw = true } = {}) => {
  const r = await p;
  if (r.error) { say(r.error.message, true); return false; }
  if (!redraw) { if (ok) flash(plain(ok)); return true; }
  if (ok) { notice = ok; flash(plain(ok)); }
  await keepPlace(draw);
  return true;
};

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
  const tabs = [...(isAdmin() ? [["everyone", "Everyone"]] : []), ...mine.map(id => [id, NAMES[id] || id])];
  const ids = tabs.map(t => t[0]);
  prog = ids.includes(location.hash.slice(1)) ? location.hash.slice(1) : ids[0];
  m.innerHTML = `<div class="page-head"><h1>Access</h1><p class="lede">Choose who can open each program, and at what level. Changes apply the next time they load a page.</p></div>
    <div class="tabs" role="tablist" id="tabs">${tabs.map(([id, name]) => `<button role="tab" data-p="${id}">${esc(name)}</button>`).join("")}</div><div id="body"></div>`;
  document.getElementById("tabs").onclick = e => { const b = e.target.closest("[data-p]"); if (b) { prog = b.dataset.p; notice = null; history.replaceState(null, "", "#" + prog); draw(); } };
  draw();
})();

/* Invite someone by email: the invite becomes their access the moment their account exists (the email lets them make one; if it cannot be sent they can simply sign up with that email).
 * Someone who signs up WITHOUT an invite has no access at all until an administrator approves them (the "Waiting for approval" list on Everyone). */
const levelOptions = p => (levels[p] || []).filter(canGiveIn(p)).map(l => `<option value="${l.level}">${esc(l.label)}</option>`).join("");
const canGiveIn = p => l => isAdmin() || (!l.admin_only && l.rank <= (acc.programs[p]?.limit ?? 0));
function inviteFormHtml(progs) {
  const first = progs[0];
  return `<h2 class="h2-rule">Invite someone</h2>
    <form class="row-form" id="invite" data-programs="${progs.join(",")}">
      <div><label for="ie">Their email</label><input id="ie" type="email" required autocomplete="off" placeholder="name@example.org"></div>
      ${progs.length > 1 ? `<div><label for="ip">Program</label><select id="ip">${progs.map(p => `<option value="${p}">${esc(NAMES[p])}</option>`).join("")}</select></div>` : `<input type="hidden" id="ip" value="${first}">`}
      <div><label for="il">Level</label><select id="il">${levelOptions(first)}</select></div>
      <div><label for="iu">Until (optional)</label><input id="iu" type="date"></div>
      <div><label class="show" style="display:inline"><input type="checkbox" id="is" checked> Send them an email</label></div>
      <button class="button" type="submit">Invite</button></form>
    <p class="muted">If they already have an account they get access at once. Otherwise the invite waits, and becomes their access as soon as they make an account with that email.</p>
    <div id="invite-import"></div>`;
}
function invitesTable(list, label) {
  if (!list.length) return "";
  return `<h3 class="h3-section">Waiting to sign up <span class="count">${list.length}</span></h3>
    <div class="table-wrap"><table class="grid" id="invites"><thead><tr><th>Email</th><th>Level</th><th>Until</th><th>Invited</th><th></th></tr></thead><tbody>
    ${list.map(i => `<tr data-i="${i.id}"><td>${esc(i.email)}</td><td>${esc(label ? label(i.level) : i.level)}</td><td>${esc(day(i.expires_at))}</td><td>${esc(when(i.created_at))}</td>
      <td class="act"><button class="button button-small button-quiet" data-delinvite title="Delete this invite">Delete</button></td></tr>`).join("")}</tbody></table></div>`;
}
/* Invite many people from a spreadsheet (an email and a level on each row): the same invites as the form, one after another. */
async function mountInviteImport(root, progs) {
  const host = root.querySelector("#invite-import");
  if (!host) return;
  const [{ mountImport }, { IMPORTERS }] = await Promise.all([import("../shared/import/panel.js"), import("../shared/import/importers.js")]);
  const programs = progs.map(id => ({ id, name: NAMES[id] }));
  const mapLevels = () => Object.fromEntries(progs.map(p => [p, (levels[p] || []).filter(canGiveIn(p)).map(l => ({ level: l.level, label: l.label }))]));
  mountImport(host, {
    importer: IMPORTERS.invites,
    lookups: async () => ({ programs, levels: mapLevels() }),
    after: () => keepPlace(draw),
    controls: {
      html: `<div class="row-form"><div><label for="iprog">Program (for rows with no program column)</label><select id="iprog" data-iprog>${programs.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div>
        <div><label class="show" style="display:inline"><input type="checkbox" data-isend checked> Send them an email</label></div></div>`,
      read: box => ({ fixedProgram: box.querySelector("[data-iprog]").value }),
      onChange: (box, again) => box.querySelector("[data-iprog]").addEventListener("change", again),
    },
    commit: async (entries, progress) => {
      const send = host.querySelector("[data-isend]").checked;
      let added = 0, done = 0; const failed = [];
      for (const e of entries) {
        const { data, error } = await sb.functions.invoke("invite-person", { body: { email: e.email, program: e.program, level: e.level, expires: e.until || null, send, redirectTo: location.origin + "/" } });
        let msg = data && data.error;
        if (error && !msg) { try { msg = (await error.context.json()).error; } catch { msg = error.message; } }
        if (msg) failed.push({ summary: e.email, error: msg }); else added++;
        progress(++done, entries.length);
      }
      return { added, skipped: 0, failed };
    },
  });
}
function wireInvites(root) {
  const f = root.querySelector("#invite");
  if (f) mountInviteImport(root, f.dataset.programs.split(","));
  if (f) {
    const ip = f.querySelector("#ip"), il = f.querySelector("#il");
    ip.addEventListener("change", () => { il.innerHTML = levelOptions(ip.value); });
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = f.querySelector("button"), email = f.querySelector("#ie").value.trim();
      btn.disabled = true; flash(`Inviting ${email}…`);
      const { data, error } = await sb.functions.invoke("invite-person", { body: { email, program: ip.value, level: il.value, expires: f.querySelector("#iu").value || null, send: f.querySelector("#is").checked, redirectTo: location.origin + "/" } });
      btn.disabled = false;
      let msg = data && data.error, status = data && data.status;
      if (error && !msg) { try { msg = (await error.context.json()).error; } catch { msg = error.message; } }
      if (msg) return say(msg, true);
      f.reset();
      flash(status === "granted" ? `${email} already had an account: access given.`
        : data.emailed ? `Invite sent to ${email}. They get access as soon as they accept.`
        : `Invite saved for ${email}, but the email could not be sent${data.note ? ` (${data.note})` : ""}. Tell them to create an account with that email: they will get access automatically.`);
      await keepPlace(draw);
    });
  }
  root.querySelector("#invites")?.addEventListener("click", e => {
    if (!e.target.matches("[data-delinvite]")) return;
    const tr = e.target.closest("tr");
    if (confirm(`Delete the invite for ${tr.querySelector("td").textContent}?`)) run(sb.rpc("delete_invite", { p_id: tr.dataset.i }), "Invite deleted.");
  });
}

/* Everyone (admin only): every account that has been made, newest first, with a level to choose for each program, as on LOVELACE's old
 * Team page. Choosing "No access" takes the program away. The end date under a level is optional. */
async function drawEveryone(body) {
  const { data, error } = await sb.rpc("all_people");
  if (error) { body.innerHTML = `<div class="state-error">${esc(error.message)}</div>`; return; }
  const people = (data || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const programs = Object.keys(NAMES).filter(p => levels[p]?.length);
  const grantOf = (r, p) => (r.grants || []).find(g => g.program === p);
  const waiting = people.filter(r => !r.admin && !(r.grants || []).length).length;
  const cell = (r, p) => {
    if (r.admin) return `<td><span class="muted">Admin (everything)</span></td>`;
    const g = grantOf(r, p);
    return `<td><select data-ev="${p}" aria-label="${esc(NAMES[p])} level for ${esc(r.email)}"><option value="">No access</option>${(levels[p] || []).map(l => `<option value="${l.level}"${g?.level === l.level ? " selected" : ""}>${esc(l.label)}</option>`).join("")}</select>
      ${g ? `<input type="date" data-eu="${p}" value="${g.expires_at || ""}" aria-label="${esc(NAMES[p])} access until for ${esc(r.email)}" title="Access until (optional)">` : ""}${g?.is_manager ? ' <span class="badge">Manager</span>' : ""}</td>`;
  };
  const pending = people.filter(r => !r.admin && !(r.grants || []).length && r.user_id !== me());
  const approveRow = r => `<tr data-u="${r.user_id}" data-e="${esc(r.email)}"><td>${esc(r.email)}${r.full_name ? `<small class="why">${esc(r.full_name)}</small>` : ""}</td><td>${esc(when(r.created_at))}</td>
      <td><select data-ap aria-label="Program for ${esc(r.email)}">${programs.map(p => `<option value="${p}">${esc(NAMES[p])}</option>`).join("")}</select>
        <select data-al aria-label="Level for ${esc(r.email)}">${levelOptions(programs[0])}</select></td>
      <td class="act"><button class="button button-small" data-approve>Approve</button> <button class="button button-small button-quiet" data-delperson>Delete</button></td></tr>`;
  const rowCells = r => `<td>${esc(r.email)}${r.full_name ? `<small class="why">${esc(r.full_name)}</small>` : ""}${r.user_id === me() ? ` <span class="muted">(you)</span>` : ""}</td>
        <td>${esc(when(r.created_at))}</td><td>${esc(when(r.last_sign_in_at))}</td>${programs.map(p => cell(r, p)).join("")}
        <td class="act">${r.admin || r.user_id === me() ? "" : `<button class="button button-small button-quiet" data-delperson title="Delete this account for good">Delete</button>`}</td>`;
  body.innerHTML = `<div id="msg" role="alert"></div>${notice || ""}
    <div id="pending">${pending.length ? `<h2 class="h2-rule">Waiting for your approval <span class="count">${pending.length}</span></h2>
      <p class="muted">These people made an account without an invite. They can open nothing until you approve them: choose a program and level, then Approve. Delete removes the account.</p>
      <div class="table-wrap"><table class="grid" id="approve"><thead><tr><th>Account</th><th>Signed up</th><th>Give</th><th></th></tr></thead><tbody>${pending.map(approveRow).join("")}</tbody></table></div>` : ""}</div>
    ${inviteFormHtml(programs)}
    <h2 class="h2-rule">Everyone <span class="count" id="ecount">${people.length}</span></h2>
    <p class="muted">Everyone who has made an account, newest first. Choose their level in each program; "No access" removes it (they can be given it again). The date under a level is optional: after it, they see nothing until it is extended. Delete removes an account for good.</p>
    ${people.length ? `<div class="table-wrap"><table class="grid" id="everyone"><thead><tr><th>Account</th><th>Signed up</th><th>Last signed in</th>${programs.map(p => `<th>${esc(NAMES[p])}</th>`).join("")}<th></th></tr></thead><tbody>
      ${people.map(r => `<tr data-u="${r.user_id}" data-e="${esc(r.email)}">${rowCells(r)}</tr>`).join("")}</tbody></table></div>` : `<p class="muted">Nobody has made an account yet.</p>`}`;
  notice = null;
  wireInvites(body);
  const tbl = body.querySelector("#everyone");
  // A level or date is changed in place: the table is not redrawn, so the page stays where it is and you can go straight on to the next change.
  tbl?.addEventListener("change", async e => {
    const tr = e.target.closest("tr[data-u]"); if (!tr) return;
    const sel = e.target.closest("[data-ev]"), dt = e.target.closest("[data-eu]");
    const p = (sel || dt)?.dataset.ev || (sel || dt)?.dataset.eu; if (!p) return;
    const row = people.find(r => r.user_id === tr.dataset.u), cur = grantOf(row, p);
    let r;
    if (sel && !sel.value) r = await sb.from("access_grants").delete().eq("user_id", tr.dataset.u).eq("program", p);
    else r = await sb.rpc("grant_access", { p_email: tr.dataset.e, p_program: p, p_level: sel ? sel.value : cur.level, p_expires: sel ? (cur?.expires_at || null) : (dt.value || null) });
    if (r.error) { say(r.error.message, true); return keepPlace(() => drawEveryone(body)); }   // not saved: show what is really there
    if (sel && !sel.value) row.grants = (row.grants || []).filter(g => g.program !== p);
    else if (sel) { if (cur) cur.level = sel.value; else (row.grants ||= []).push({ program: p, level: sel.value, is_manager: false, expires_at: null }); }
    else cur.expires_at = dt.value || null;
    const td = (sel || dt).closest("td"), label = (sel || dt).getAttribute("aria-label");
    const y = window.scrollY;
    td.outerHTML = cell(row, p);
    window.scrollTo(0, y);
    const again = [...tbl.querySelectorAll("[aria-label]")].find(x => x.getAttribute("aria-label") === label); if (again) again.focus({ preventScroll: true });
    flash(`${tr.dataset.e}: ${NAMES[p]} ${sel && !sel.value ? "access removed" : "access saved"}.`);
  });
  tbl?.addEventListener("click", e => {
    if (!e.target.matches("[data-delperson]")) return;
    const tr = e.target.closest("tr");
    if (confirm(`Delete the account ${tr.dataset.e} for good? Their access goes with it, and they would have to make a new account and be approved again.`)) run(sb.rpc("delete_person", { p_user: tr.dataset.u }), "Account deleted.");
  });
  const ap = body.querySelector("#approve");
  ap?.addEventListener("change", e => { if (e.target.matches("[data-ap]")) e.target.closest("tr").querySelector("[data-al]").innerHTML = levelOptions(e.target.value); });
  ap?.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-u]"); if (!tr) return;
    if (e.target.matches("[data-approve]")) run(sb.rpc("grant_access", { p_email: tr.dataset.e, p_program: tr.querySelector("[data-ap]").value, p_level: tr.querySelector("[data-al]").value, p_expires: null }), `${tr.dataset.e} approved.`);
    if (e.target.matches("[data-delperson]") && confirm(`Delete the account ${tr.dataset.e} for good?`)) run(sb.rpc("delete_person", { p_user: tr.dataset.u }), "Account deleted.");
  });
}

async function draw() {
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.p === prog));
  const body = document.getElementById("body");
  if (prog === "everyone") { const n = notice; await drawEveryone(body); if (n) notice = null; return; }
  const [ppl, codes, invites] = await Promise.all([sb.rpc("program_people", { p: prog }), sb.rpc("program_codes", { p: prog }), sb.rpc("program_invites", { p: prog })]);
  const lv = levels[prog] || [], label = id => lv.find(l => l.level === id)?.label || id, readonly = false;
  const people = ppl.data || [];
  const opts = (sel, rowLevel) => lv.filter(l => canGive(l) || l.level === rowLevel).map(l => `<option value="${l.level}"${l.level === sel ? " selected" : ""}${canGive(l) ? "" : " disabled"}>${esc(l.label)}</option>`).join("");
  const rowRank = r => lv.find(l => l.level === r.level)?.rank ?? 0, rowAdminOnly = r => !!lv.find(l => l.level === r.level)?.admin_only;
  const locked = r => readonly || r.user_id === me() || (!isAdmin() && (r.is_manager || rowAdminOnly(r) || rowRank(r) > lim()));
  const live = c => !c.revoked_at && (!c.expires_at || new Date(c.expires_at) > new Date()) && (c.max_uses == null || c.uses < c.max_uses);

  body.innerHTML = `<div id="msg" role="alert"></div>${notice || ""}
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
    ${readonly ? "" : `${inviteFormHtml([prog])}
    ${invitesTable(invites.data || [], label)}
    <form class="row-form" id="add"><div><label for="ae">Give access to (their account email)</label><input id="ae" type="email" required autocomplete="off"></div>
      <div><label for="al">Level</label><select id="al">${opts(lv.find(canGive)?.level)}</select></div>
      <div><label for="au">Until (optional)</label><input id="au" type="date"></div><button class="button" type="submit">Give access</button></form>
      <p class="muted">They need an account first. Anyone can create one on the sign-in page; they see nothing until you give them a level.</p>
      <h2 class="h2-rule">Access codes <span class="count">${(codes.data || []).filter(live).length} live</span></h2>
      <p class="lede">A code lets a group in with one password and no account. Everyone using it appears as the code's label, not by name. The codes are kept here, so you can copy them again, change what they give and when they end, and see how often each has been used. Switch one off and everyone using it is signed out.</p>
      ${(codes.data || []).length ? `<div class="table-wrap"><table class="grid" id="codes"><thead><tr><th>Code</th><th>Label</th><th>Level</th><th>Ends</th><th>Used</th><th>Status</th><th></th></tr></thead><tbody>
        ${codes.data.map(c => `<tr data-c="${c.id}"><td>${c.code ? `<code>${esc(c.code)}</code> <button class="button button-small button-quiet" data-copy="${esc(c.code)}">Copy</button>` : `<span class="muted">made before codes were kept</span>`}</td>
          <td>${esc(c.label)}</td>
          <td><select data-cl aria-label="Level for the code ${esc(c.label)}">${opts(c.level, c.level)}</select></td>
          <td><input type="datetime-local" data-ce value="${c.expires_at ? localInput(c.expires_at) : ""}" aria-label="Ends, for the code ${esc(c.label)}"></td>
          <td>${c.uses}${c.max_uses != null ? ` / ${c.max_uses}` : ""}</td><td>${c.revoked_at ? "switched off" : live(c) ? "live" : "ended"}</td>
          <td class="act">${live(c) ? `<button class="button button-small button-quiet" data-off>Switch off</button>` : c.revoked_at ? `<button class="button button-small button-quiet" data-on>Switch on</button>` : ""} <button class="button button-small button-quiet" data-delcode title="Delete this code for good">Delete</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No codes yet.</p>`}
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
      run(sb.from("access_grants").update(patch).eq("user_id", u).eq("program", prog), "Saved.", { redraw: false });
    } else if (e.target.matches("[data-mgr]")) {
      tr.querySelector("[data-ceil]").hidden = !e.target.checked;
      run(sb.rpc("set_manager", { p_user: u, p_program: prog, p_on: e.target.checked, p_ceiling: e.target.checked ? (+tr.querySelector("[data-ceil]").value || null) : null }), e.target.checked ? "Made a manager." : "No longer a manager.", { redraw: false });
    } else if (e.target.matches("[data-ceil]")) {
      run(sb.rpc("set_manager", { p_user: u, p_program: prog, p_on: true, p_ceiling: +e.target.value || null }), "Saved.", { redraw: false });
    }
  });
  body.querySelector("#people")?.addEventListener("click", e => {
    if (!e.target.matches("[data-del]")) return;
    const tr = e.target.closest("tr"), who = tr.querySelector("td").firstChild.textContent;
    if (confirm(`Remove ${who}'s access to ${NAMES[prog]}?`)) run(sb.from("access_grants").delete().eq("user_id", tr.dataset.u).eq("program", prog));
  });
  wireInvites(body);
  body.querySelector("#add")?.addEventListener("submit", e => {
    e.preventDefault();
    run(sb.rpc("grant_access", { p_email: body.querySelector("#ae").value, p_program: prog, p_level: body.querySelector("#al").value, p_expires: body.querySelector("#au").value || null }));
  });
  body.querySelector("#codes")?.addEventListener("click", e => {
    const id = e.target.closest("tr")?.dataset.c;
    if (e.target.matches("[data-off]") && confirm("Switch this code off? Everyone using it will be signed out.")) run(sb.rpc("revoke_access_code", { p_id: id }));
    if (e.target.matches("[data-on]")) run(sb.rpc("restore_access_code", { p_id: id }), "Code switched on again.");
    if (e.target.matches("[data-delcode]") && confirm("Delete this code for good? It cannot be brought back (switching it off can be undone, deleting cannot). Everyone using it is signed out.")) run(sb.rpc("delete_access_code", { p_id: id }), "Code deleted.");
    if (e.target.matches("[data-copy]")) { navigator.clipboard?.writeText(e.target.dataset.copy); e.target.textContent = "Copied"; }
  });
  body.querySelector("#codes")?.addEventListener("change", e => {
    const id = e.target.closest("tr")?.dataset.c;
    if (e.target.matches("[data-cl]")) run(sb.rpc("set_code_level", { p_id: id, p_level: e.target.value }), `The code now gives ${label(e.target.value)}.`, { redraw: false });
    if (e.target.matches("[data-ce]")) run(sb.rpc("set_code_expiry", { p_id: id, p_expires: e.target.value ? new Date(e.target.value).toISOString() : null }), "End time saved.", { redraw: false });
  });
  body.querySelector("#mk")?.addEventListener("submit", async e => {
    e.preventDefault();
    const end = body.querySelector("#ce").value, label = body.querySelector("#cl").value;
    const r = await sb.rpc("create_access_code", { p_label: label, p_program: prog, p_level: body.querySelector("#cv").value,
      p_expires: end ? new Date(end).toISOString() : null, p_max_uses: +body.querySelector("#cm").value || null, p_code: body.querySelector("#cc").value || null });
    if (r.error) return say(r.error.message, true);
    await run(Promise.resolve({}), `<div class="state-ok"><b>Code made for ${esc(label)}:</b> <code id="newcode">${esc(r.data)}</code> <button class="button button-small button-quiet" type="button" id="cp">Copy</button> It is kept in the table below.</div>`);
    document.getElementById("cp")?.addEventListener("click", ev => { navigator.clipboard?.writeText(r.data); ev.target.textContent = "Copied"; });
  });
}
