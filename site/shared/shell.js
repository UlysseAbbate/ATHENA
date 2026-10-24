/* The shared page header: the Athena masthead, a switcher for the programs this person may open, who is signed in,
 * the theme button and Sign out. Used by the home page and Admin now, and by every program as it moves to the shared look.
 * Nothing here is a security boundary; the programs and the database decide what a person can open or read. */
window.Shell = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /* opts: { sub, programs: [{href, label}], current (href), email, home (href of Athena's home) } */
  function mount(host, opts = {}) {
    const home = opts.home || "./";
    const nav = (opts.programs || []).map(p =>
      `<a href="${esc(p.href)}"${p.href === opts.current ? ' aria-current="page"' : ""}>${esc(p.label)}</a>`).join("");
    host.className = "masthead";
    host.innerHTML = `<div class="masthead-inner">
      <a class="brand" href="${esc(home)}"><span class="brand-name">Athena</span><span class="brand-sub">${esc(opts.sub || "")}</span></a>
      <div class="tools">${nav ? `<nav class="topnav" aria-label="Programs">${nav}</nav>` : ""}
        ${opts.email ? `<span class="who" title="${esc(opts.email)}">${esc(opts.email)}</span><button type="button" class="ghost" id="shell-so">Sign out</button>` : ""}
        ${Theme.toggleHtml()}</div></div>`;
    Theme.wire(host);
    const so = host.querySelector("#shell-so");
    if (so && opts.signOut) so.onclick = async () => { await opts.signOut(); location.reload(); };
  }
  return { mount, esc };
})();
