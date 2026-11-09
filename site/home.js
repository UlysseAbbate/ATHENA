// Home page: adds the workspaces this person may open. The data behind each is protected server-side regardless.
(async () => {
  const hd = document.getElementById("hd"), main = document.getElementById("main");
  Shell.mount(hd, { sub: "One login for every program" });
  let acc;
  try { acc = await Athena.access(); } catch (e) { main.textContent = e.message; return; }
  AuthUI.watchRecovery(Athena.sb, main);
  if (!acc) return AuthUI.render(Athena.sb, main, { title: "Sign in to Athena" });   // one sign-in for every program
  const n = document.getElementById("n");
  const card = (href, title, full, text) => `<a class="index-row" href="${href}"><b class="index-title">${title}</b><span class="index-full">${full}</span><span class="index-text">${text}</span></a>`;
  const pg = acc.programs || {};
  if (pg.lovelace || acc.admin) n.insertAdjacentHTML("beforeend", card("lovelace/", "LOVELACE", "London program", "The campaign plan, media, volunteers and stakeholders."));
  if (pg.lucien || Athena.may(acc, "ulysse")) n.insertAdjacentHTML("beforeend", card("lucien/", "LUCIEN", "Policy program", "Committees, think tanks, the media and polling."));
  if (pg.libby || acc.admin) n.insertAdjacentHTML("beforeend", card("libby/", "LIBBY", "Parliamentary program", "Parliamentary business, legislation and policy."));
  const manages = Object.values(pg).some(v => v.manager);   // a program manager (including LOVELACE's core team) uses the Access page for their program
  if (acc.admin || manages) n.insertAdjacentHTML("beforeend", card("access/", "Access", "Who can open what", "Accounts, levels and shared access codes for each program."));
  if (acc.admin) n.insertAdjacentHTML("beforeend", card("admin/", "Admin", "System status", "Data collection, sources and recent activity."));
  if (!n.children.length) n.insertAdjacentHTML("beforeend", '<p class="lede">Your account has been created. It is waiting for the administrator to give it access: nothing opens until then.</p>');
  Shell.mount(hd, { sub: "One login for every program", email: acc.session.user.email, signOut: () => Athena.sb.auth.signOut() });
})();
