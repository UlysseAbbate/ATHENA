/* Drop-downs: every section heading (h2.h2-rule) and sub-heading (h3.h3-section) on every page opens and closes, in the same way.
 * The heading becomes the summary of a <details> and everything after it, up to the next heading of its kind, goes inside. Pages just write
 * the headings; this runs after each page draws (a MutationObserver), so no page needs to know about it. Every drop-down starts CLOSED.
 * (A day's business sections in LIBBY, .chamber-head, work the same way.) Headings are left alone inside a dialog, a panel that sets data-flat, or when they are already in a summary. */
(() => {
  const H2 = "h2.h2-rule, .chamber-head", H3 = "h3.h3-section";
  const isHeading = (n, sel) => n.nodeType === 1 && (n.matches(sel) || n.matches("details.dd, details.dd-sub") || (sel === H3 && n.matches(H2)));
  function wrap(h, kind) {
    if (h.dataset.dd || h.closest("summary, dialog, [data-flat]")) { h.dataset.dd = "1"; return; }
    h.dataset.dd = "1";
    const det = document.createElement("details");
    det.className = kind === 2 ? "dd" : "dd-sub";
    det.open = window.ATHENA_DROPDOWNS_OPEN === true;   // closed to start with; the browser tests set this to read whole pages
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
  const start = () => { enhance(); new MutationObserver(queue).observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
