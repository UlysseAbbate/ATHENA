/* Tables everywhere on Athena: every column title gets a filter (like the filter arrows in Excel or Google Sheets) and can be sorted,
 * and the title row stays at the top while you scroll. Works on any <table> with a title row of <th> cells, including tables a page draws
 * later or redraws (a MutationObserver finds them; filters and sorting are kept when a page redraws its table).
 *   - The arrow on a title opens a list of that column's values with a search box: tick the values to show.
 *   - Clicking the title text sorts (a table that already sorts itself, with its own data-sort buttons, keeps its own sorting).
 *   - Add data-nofilter to a <table> to leave it alone.
 * The page's own search or buttons still work: they hide rows in their own way, and a row shows only if nothing hides it. */
(() => {
  "use strict";
  const BLANK = "(blank)";
  const MAX_VALUES = 400;
  const states = new Map();       // table key -> { filters: { colIndex: Set(values) }, sort: { col, dir } }
  let open = null;                // the filter list that is showing: { pop, th, close }

  const clean = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const cellText = td => {
    if (!td) return "";
    const sel = td.querySelector("select");
    if (sel) return clean(sel.selectedOptions[0]?.textContent);
    const inp = td.querySelector("input:not([type=checkbox]):not([type=hidden])");
    if (inp) return clean(inp.value);
    const chk = td.querySelector("input[type=checkbox]");
    if (chk && !clean(td.textContent)) return chk.checked ? "Yes" : "No";
    return clean(td.textContent);
  };

  /** { head: the title row, cols: [th], rows: [{ tr, extras: [detail rows that follow it] }] } or null if this is not a table to work on. */
  function parts(table) {
    if (table.hasAttribute("data-nofilter") || table.closest("[data-nofilter], .tf-pop")) return null;
    const all = [...table.rows];
    const head = (table.tHead && table.tHead.rows[0]) || all.find(r => r.cells.length && [...r.cells].every(c => c.tagName === "TH"));
    if (!head || ![...head.cells].every(c => c.colSpan === 1)) return null;
    const cols = [...head.cells];
    if (cols.length < 2) return null;
    const rows = [];
    for (const tr of all) {
      if (tr === head || (tr.parentNode.tagName === "THEAD")) continue;
      const detail = tr.cells.length === 1 && cols.length > 1;      // a row spanning the table: a detail row under the one above, or "nothing here"
      if (detail && rows.length) rows[rows.length - 1].extras.push(tr);
      else if (!detail) rows.push({ tr, extras: [] });
    }
    return { head, cols, rows };
  }

  const keyOf = (table, cols) => `${location.pathname}${location.hash.split("?")[0]}|${table.id || ""}|${cols.map(c => clean(c.dataset.tfName || c.textContent)).join("|")}`;
  const titleOf = th => clean(th.dataset.tfName || [...th.childNodes].filter(n => !(n.nodeType === 1 && n.classList.contains("tf-btn"))).map(n => n.textContent).join(""));

  /** A title that is only there for screen readers (a column of buttons) has nothing to filter. */
  const visibleTitle = th => { const c = th.cloneNode(true); c.querySelectorAll(".sr-only, .tf-btn, .tf-dir").forEach(x => x.remove()); return clean(c.textContent); };

  /* ---- showing and hiding rows */
  function apply(table, p, st) {
    let shownN = 0;
    for (const r of p.rows) {
      const off = Object.entries(st.filters).some(([c, set]) => !set.has(cellText(r.tr.cells[c]) || BLANK));
      r.tr.classList.toggle("tf-off", off);
      for (const x of r.extras) x.classList.toggle("tf-off", off);
      if (!off) shownN++;
    }
    p.cols.forEach((th, i) => {
      th.classList.toggle("tf-active", !!st.filters[i]);
      const b = th.querySelector(".tf-btn");
      if (b) b.setAttribute("aria-pressed", String(!!st.filters[i]));
    });
    bar(table, p, st, shownN);
  }

  /** "Showing 3 of 12 rows. Clear filters" above the table while any filter is on. */
  function bar(table, p, st, shownN) {
    const anchor = table.closest(".table-wrap, .tablewrap") || table;
    let el = anchor.previousElementSibling;
    if (!el || !el.classList || !el.classList.contains("tf-bar")) el = null;
    if (!Object.keys(st.filters).length) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("div");
      el.className = "tf-bar";
      el.setAttribute("role", "status");
      anchor.parentNode.insertBefore(el, anchor);
      el.addEventListener("click", e => { if (e.target.closest("[data-clear]")) { st.filters = {}; reapply(table); } });
    }
    el.innerHTML = `Filtered: showing ${shownN} of ${p.rows.length} rows. <button type="button" class="tf-clear" data-clear>Clear filters</button>`;
  }

  /* ---- sorting (tables that do not sort themselves) */
  const NUM = /^[-+]?[£$€]?\d[\d,]*(\.\d+)?%?$/;
  const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
  function sortKey(text) {
    const t = clean(text);
    if (!t) return { e: true };
    if (NUM.test(t)) return { n: parseFloat(t.replace(/[^\d.+-]/g, "")) };
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return { n: Date.parse(t) };
    const m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/);
    if (m && MONTHS.includes(m[2].toLowerCase())) return { n: Date.UTC(+m[3], MONTHS.indexOf(m[2].toLowerCase()), +m[1]) };
    return { s: t };
  }
  const compare = (a, b) => {
    if (a.e || b.e) return a.e && b.e ? 0 : a.e ? 1 : -1;     // blanks last
    if (a.n != null && b.n != null) return a.n - b.n;
    return String(a.s ?? a.n).localeCompare(String(b.s ?? b.n), "en-GB", { numeric: true, sensitivity: "base" });
  };
  function sortRows(table, p, st) {
    if (st.sort == null || st.sort.col == null) return;
    const { col, dir } = st.sort;
    const body = p.rows[0]?.tr.parentNode;
    if (!body) return;
    const keyed = p.rows.map((r, i) => ({ r, i, k: sortKey(cellText(r.tr.cells[col])) }));
    keyed.sort((x, y) => (compare(x.k, y.k) * (dir === "desc" ? -1 : 1)) || x.i - y.i);
    const mark = document.createComment("tf");
    const last = p.rows[p.rows.length - 1];
    const after = (last.extras[last.extras.length - 1] || last.tr).nextSibling;
    body.insertBefore(mark, after);
    for (const { r } of keyed) { body.insertBefore(r.tr, mark); for (const x of r.extras) body.insertBefore(x, mark); }
    mark.remove();
    p.cols.forEach((th, i) => {
      const own = th.querySelector("[data-sort]");
      if (!own) th.setAttribute("aria-sort", i === col ? (dir === "desc" ? "descending" : "ascending") : "none");
      const ind = th.querySelector(".tf-dir");
      if (ind) ind.textContent = i === col ? (dir === "desc" ? " ▼" : " ▲") : "";
    });
  }

  /* ---- the filter list */
  function closePop() { if (open) { open.close(); open = null; } }
  function openPop(table, th, i) {
    closePop();
    const p = parts(table); if (!p) return;
    const st = stateFor(table, p);
    const counts = new Map();
    for (const r of p.rows) { const v = cellText(r.tr.cells[i]) || BLANK; counts.set(v, (counts.get(v) || 0) + 1); }
    const all = [...counts.keys()].sort((a, b) => compare(sortKey(a === BLANK ? "" : a), sortKey(b === BLANK ? "" : b)));
    const shownAll = all.slice(0, MAX_VALUES);
    const current = st.filters[i];
    const checked = new Set(current ? [...current] : shownAll);
    const pop = document.createElement("div");
    pop.className = "tf-pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", `Filter ${titleOf(th)}`);
    const selfSorted = !!th.querySelector("[data-sort]");
    pop.innerHTML = `${selfSorted ? "" : `<div class="tf-sorts"><button type="button" data-s="asc">Sort A to Z</button><button type="button" data-s="desc">Sort Z to A</button></div>`}
      <input type="search" class="tf-search" placeholder="Search this column" aria-label="Search the values in ${esc(titleOf(th))}">
      <div class="tf-links"><button type="button" data-all>Select all shown</button><button type="button" data-none>Clear</button></div>
      <ul class="tf-list"></ul>
      ${all.length > MAX_VALUES ? `<p class="tf-note">Showing the first ${MAX_VALUES} of ${all.length} values: search to find others.</p>` : ""}
      <div class="tf-actions"><button type="button" class="tf-ok" data-ok>Apply</button><button type="button" data-reset>Remove filter</button></div>`;
    document.body.appendChild(pop);
    const list = pop.querySelector(".tf-list"), search = pop.querySelector(".tf-search");
    let visible = shownAll;
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      visible = (q ? all.filter(v => v.toLowerCase().includes(q)) : all).slice(0, MAX_VALUES);
      list.innerHTML = visible.map((v, n) => `<li><label><input type="checkbox" data-n="${n}"${checked.has(v) ? " checked" : ""}> <span>${esc(v.length > 120 ? v.slice(0, 117) + "…" : v)}</span> <small>${counts.get(v)}</small></label></li>`).join("") || '<li class="tf-note">Nothing matches.</li>';
    };
    draw();
    search.addEventListener("input", () => { checked.clear(); draw(); const q = search.value.trim(); if (q) visible.forEach(v => checked.add(v)); draw(); });   // typing selects what it finds, as in Excel
    list.addEventListener("change", e => { const c = e.target.closest("[data-n]"); if (c) (c.checked ? checked.add(visible[+c.dataset.n]) : checked.delete(visible[+c.dataset.n])); });
    pop.addEventListener("click", e => {
      const s = e.target.closest("[data-s]");
      if (s) { st.sort = { col: i, dir: s.dataset.s }; reapply(table); closePop(); return; }
      if (e.target.closest("[data-all]")) { visible.forEach(v => checked.add(v)); draw(); }
      if (e.target.closest("[data-none]")) { visible.forEach(v => checked.delete(v)); draw(); }
      if (e.target.closest("[data-ok]")) {
        if (all.every(v => checked.has(v))) delete st.filters[i]; else st.filters[i] = new Set(checked);
        reapply(table); closePop();
      }
      if (e.target.closest("[data-reset]")) { delete st.filters[i]; reapply(table); closePop(); }
    });
    pop.addEventListener("keydown", e => { if (e.key === "Escape") { closePop(); th.querySelector(".tf-btn")?.focus(); } if (e.key === "Enter" && e.target === search) { e.preventDefault(); pop.querySelector("[data-ok]").click(); } });
    const place = () => {
      const r = th.getBoundingClientRect(), w = Math.min(300, window.innerWidth - 16);
      pop.style.width = w + "px";
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + "px";
      pop.style.top = Math.min(r.bottom + 2, window.innerHeight - 120) + "px";
      pop.style.maxHeight = Math.max(200, window.innerHeight - r.bottom - 16) + "px";
    };
    place();
    const onDoc = e => { if (!pop.contains(e.target) && !th.contains(e.target)) closePop(); };
    const onMove = () => place();
    setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    open = { pop, th, close() { pop.remove(); document.removeEventListener("mousedown", onDoc); window.removeEventListener("resize", onMove); window.removeEventListener("scroll", onMove, true); } };
    search.focus();
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---- putting it on a table */
  function stateFor(table, p) {
    const k = keyOf(table, p.cols);
    if (!states.has(k)) states.set(k, { filters: {}, sort: { col: null, dir: "asc" } });
    return states.get(k);
  }
  function reapply(table) {
    const p = parts(table); if (!p) return;
    const st = stateFor(table, p);
    sortRows(table, p, st);
    apply(table, p, st);
  }
  function enhance(table) {
    const p = parts(table); if (!p) return;
    const st = stateFor(table, p);
    p.cols.forEach((th, i) => {
      th.classList.add("tf-head");
      if (th.querySelector(".tf-btn") || !titleOf(th) || !visibleTitle(th)) return;
      th.dataset.tfName = titleOf(th);
      const own = !!th.querySelector("[data-sort]");
      if (!own) {
        const ind = document.createElement("span"); ind.className = "tf-dir"; ind.setAttribute("aria-hidden", "true");
        th.appendChild(ind);
        th.classList.add("tf-sortable");
        th.addEventListener("click", e => {
          if (e.target.closest(".tf-btn")) return;
          const s = stateFor(table, parts(table)).sort;
          s.dir = s.col === i && s.dir === "asc" ? "desc" : "asc"; s.col = i;
          reapply(table);
        });
      }
      const b = document.createElement("button");
      b.type = "button"; b.className = "tf-btn"; b.setAttribute("aria-haspopup", "dialog"); b.setAttribute("aria-label", `Filter ${titleOf(th)}`); b.setAttribute("aria-pressed", "false");
      b.innerHTML = '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M1 2h8L6 5.5V9L4 8V5.5z" fill="currentColor"/></svg>';
      b.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); open && open.th === th ? closePop() : openPop(table, th, i); });
      th.appendChild(b);
    });
    sortRows(table, p, st);
    apply(table, p, st);
  }

  /* ---- finding tables, now and as pages draw them */
  let queued = false, busy = false;
  const queue = new Set();
  function flush() {
    queued = false; busy = true;
    try { for (const t of queue) if (t.isConnected) enhance(t); } finally { queue.clear(); setTimeout(() => { busy = false; }, 0); }
  }
  function note(node) {
    if (!node || node.nodeType !== 1) return;
    const tables = node.tagName === "TABLE" ? [node] : node.closest("table") ? [node.closest("table")] : [...node.querySelectorAll("table")];
    for (const t of tables) queue.add(t);
    if (queue.size && !queued) { queued = true; requestAnimationFrame(flush); }
  }
  new MutationObserver(muts => {
    if (busy) return;
    for (const m of muts) {
      if (m.target.closest && m.target.closest(".tf-pop, .tf-bar")) continue;
      if (m.type === "childList") { for (const n of m.addedNodes) if (!(n.nodeType === 1 && n.classList.contains("tf-bar"))) note(n); note(m.target); }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll("table").forEach(t => queue.add(t));
  if (queue.size) { queued = true; requestAnimationFrame(flush); }

  /** For a page's own "download what is shown": `rows` are the page's rows in the order it drew them; the ones this filter hides are left out. */
  function visibleOnly(table, rows) {
    const p = table && parts(table);
    if (!p || p.rows.length !== rows.length) return rows;
    return rows.filter((_, i) => !p.rows[i].tr.classList.contains("tf-off"));
  }
  window.TableTools = { enhance, visibleOnly };
})();
