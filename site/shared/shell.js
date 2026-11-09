/* The shared page header: the Athena masthead, a switcher for the programs this person may open, who is signed in,
 * the theme button and Sign out. Used by the home page and Admin now, and by every program as it moves to the shared look.
 * Nothing here is a security boundary; the programs and the database decide what a person can open or read. */
window.Shell = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /* opts: { name (the big word, default Athena), sub, programs: [{href, label}], current (href), email, home (href of Athena's home),
   *         slot (html for a program's own header bits, e.g. <span id="who">), tabs (id of a <nav> to move into the masthead) } */
  function mount(host, opts = {}) {
    const home = opts.home || "./";
    const nav = (opts.programs || []).map(p =>
      `<a href="${esc(p.href)}"${p.href === opts.current ? ' aria-current="page"' : ""}>${esc(p.label)}</a>`).join("");
    host.className = "masthead";
    host.innerHTML = `<div class="masthead-inner">
      <a class="brand" href="${esc(home)}"><span class="brand-name">${esc(opts.name || "Athena")}</span><span class="brand-sub">${esc(opts.sub || "")}</span></a>
      <div class="tools">${opts.slot || ""}${opts.home && opts.name ? `<a href="${esc(opts.home)}">Athena</a>` : ""}${nav ? `<nav class="topnav" aria-label="Programs">${nav}</nav>` : ""}
        ${opts.email ? `<span class="who" title="${esc(opts.email)}">${esc(opts.email)}</span><button type="button" class="ghost" id="shell-so">Sign out</button>` : ""}
        </div></div>`;
    const tabs = opts.tabs && document.getElementById(opts.tabs);
    if (tabs) host.append(tabs);
    footer();
    const so = host.querySelector("#shell-so");
    if (so && opts.signOut) so.onclick = async () => { await opts.signOut(); location.reload(); };
  }
  /* The foot of every page: the theme button and any links a program adds (for example Team & access, the administrator's alone).
   * It is built once and kept when the header is drawn again (signing in redraws it). */
  const links = [];
  function footer() {
    let f = document.getElementById("shell-foot");
    if (!f) { f = document.createElement("footer"); f.id = "shell-foot"; f.className = "foot shell-foot"; document.body.append(f); }
    f.innerHTML = `<p>${links.map(l => `<button type="button" class="linkish" data-foot="${esc(l.id)}">${esc(l.label)}</button>`).join(" · ")}${links.length ? " · " : ""}${window.RefreshAll ? RefreshAll.html + " · " : ""}${Theme.toggleHtml()}</p>`;
    f.querySelectorAll("[data-foot]").forEach(b => { b.onclick = () => links.find(l => l.id === b.dataset.foot)?.run(); });
    Theme.wire(f);
  }
  function footLink(id, label, run) { if (!links.some(l => l.id === id)) links.push({ id, label, run }); footer(); }
  return { mount, footLink, esc };
})();
