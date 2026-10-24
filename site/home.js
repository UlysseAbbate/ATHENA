// Home page: adds the workspaces this person may open. The data behind each is protected server-side regardless.
(async () => {
  try {
    const acc = await Athena.access();
    if (!acc) return;
    const n = document.getElementById("n");
    if (Athena.may(acc, "ulysse")) n.insertAdjacentHTML("afterbegin", '<a href="ulysse/"><b>Ulysse</b><span>Policy tracker: select committees, think tanks, Lib Dems in the media, polling.</span></a>');
    if (acc.admin) n.insertAdjacentHTML("beforeend", '<a href="admin/"><b>Admin</b><span>System status, sources and recent activity.</span></a>');
    const who = document.getElementById("who");
    who.innerHTML = `${Athena.esc(acc.session.user.email)} · <a href="#" id="so">Sign out</a>`;
    document.getElementById("so").onclick = async e => { e.preventDefault(); await Athena.sb.auth.signOut(); location.reload(); };
  } catch (e) { /* signed-out view stays as it is */ }
})();
