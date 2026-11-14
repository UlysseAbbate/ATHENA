/* Drop-downs: every section heading (h2.h2-rule) and sub-heading (h3.h3-section) on every page opens and closes, in the same way.
 * The heading becomes the summary of a <details> and everything after it, up to the next heading of its kind, goes inside. Pages just write
 * the headings; this runs after each page draws (a MutationObserver), so no page needs to know about it. Every drop-down starts CLOSED.
 * (A day's business sections in LIBBY, .chamber-head, work the same way.) Headings are left alone inside a dialog, a panel that sets data-flat, or when they are already in a summary.
 * A page that redraws itself after a change (ticking a permission, saving an entry) makes new drop-downs: so that the section a person is working in does not close under them,
 * a drop-down that was open before the redraw opens again when its heading comes back (matched by the headings, from the outside in, within a few seconds). */
(() => {
  const H2 = "h2.h2-rule, .chamber-head", H3 = "h3.h3-section";
  const isHeading = (n, sel) => n.nodeType === 1 && (n.matches(sel) || n.matches("details.dd, details.dd-sub") || (sel === H3 && n.matches(H2)));
  const wasOpen = new Map();   // heading path -> when it was last seen open as a page redrew
  const KEEP_MS = 4000;
  const titleOf = (h) => {
    const own = [...h.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join("").replace(/\s+/g, " ").trim();   // the heading's own words, not a count or a button beside them
    return own || h.textContent.replace(/[\d\s]+$/, "").replace(/\s+/g, " ").trim();
  };
  const pathOf = (det) => {
    const parts = [];
    for (let d = det; d; d = d.parentElement && d.parentElement.closest("details.dd, details.dd-sub")) { const h = d.querySelector(":scope > summary > *"); parts.unshift(h ? titleOf(h) : ""); }
    return parts.join(" > ");
  };
  function noteOpen(records) {
    for (const r of records) for (const n of r.removedNodes) {
      if (n.nodeType !== 1) continue;
      const open = [...(n.matches("details.dd[open], details.dd-sub[open]") ? [n] : []), ...n.querySelectorAll("details.dd[open], details.dd-sub[open]")];
      for (const d of open) wasOpen.set(pathOf(d), Date.now());
    }
  }
  function reopen(h) {
    const outer = h.parentElement && h.parentElement.closest("details.dd, details.dd-sub");
    const path = [outer ? pathOf(outer) : "", titleOf(h)].filter(Boolean).join(" > ");
    const at = wasOpen.get(path) || 0;
    wasOpen.set(path, 0);   // used: a later redraw notes it afresh
    return Date.now() - at < KEEP_MS;
  }
  function wrap(h, kind) {
    if (h.dataset.dd || h.closest("summary, dialog, [data-flat]")) { h.dataset.dd = "1"; return; }
    h.dataset.dd = "1";
    const det = document.createElement("details");
    det.className = kind === 2 ? "dd" : "dd-sub";
    det.open = window.ATHENA_DROPDOWNS_OPEN === true || reopen(h);   // closed to start with; the browser tests set this to read whole pages
    const sum = document.createElement("summary");
    const body = document.createElement("div");
    body.className = "dd-body";
    const sel = kind === 2 ? H2 : H3;
    let n = h.nextSibling;
    while (n && !isHeading(n, sel)) { const next = n.nextSibling; body.append(n); n = next; }
    h.replaceWith(det);
    sum.append(h);
    det.append(sum, body);
  }
  function enhance() {
    // sections first (so their content is inside before sub-headings are wrapped), then sub-headings
    document.querySelectorAll("h2.h2-rule:not([data-dd]), .chamber-head:not([data-dd])").forEach(h => wrap(h, 2));
    document.querySelectorAll(H3 + ":not([data-dd])").forEach(h => wrap(h, 3));
  }
  let queued = false;
  const queue = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; enhance(); }); };
  let lastPage = location.pathname + location.hash;
  const start = () => {
    enhance();
    new MutationObserver((records) => {
      const here = location.pathname + location.hash;
      if (here !== lastPage) { lastPage = here; wasOpen.clear(); }   // another page, not a redraw of this one: nothing carries over
      else noteOpen(records);
      queue();
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
