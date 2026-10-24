// Home page: adds the workspaces this person may open. The data behind each is protected server-side regardless.
(async () => {
  const hd = document.getElementById("hd");
  Shell.mount(hd, { sub: "One login for every program" });
  try {
    const acc = await Athena.access();
    if (!acc) return;
    const n = document.getElementById("n");
    const card = (href, title, full, text) => `<a class="index-row" href="${href}"><b class="index-title">${title}</b><span class="index-full">${full}</span><span class="index-text">${text}</span></a>`;
    if (Athena.may(acc, "ulysse")) n.insertAdjacentHTML("afterbegin", card("ulysse/", "Ulysse", "Policy tracker", "Select committees, think tanks, Lib Dems in the media, polling."));
    if (acc.admin) n.insertAdjacentHTML("beforeend", card("admin/", "Admin", "System status", "Collector health, sources and recent activity."));
    Shell.mount(hd, { sub: "One login for every program", email: acc.session.user.email, signOut: () => Athena.sb.auth.signOut() });
  } catch (e) { /* signed-out view stays as it is */ }
})();
