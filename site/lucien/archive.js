/* LUCIEN > Archive: everything the collector has ever found, kept for good (the other tabs show the last 180 days).
 * Select committee reports and government responses go back to 2010; think tank, media and polling items are kept from the day the archive started.
 * The table (lucien_archive) is read straight from Supabase with a search, filters and pages; the collector is the only thing that writes to it. */
const Archive = (() => {
  const { sb, esc } = Athena;
  const PAGE = 50, EXPORT_MAX = 5000;
  const CATS = [["", "Everything"], ["committee", "Select committees"], ["thinktank", "Think tanks"], ["media", "Lib Dems in the media"], ["polling", "Polling"]];
  const f = { q: "", category: "", source: "", from: "", to: "", house: "", type: "", page: 0 };
  let host = null, card = null, lock = "";   // lock: a kind the tab is fixed to ("committee" for the Select committees tab)

  const clean = s => String(s || "").replace(/[%_,()*\\]/g, " ").trim();
  /** The query for the current filters (rows, or a count), newest first. */
  function query(cols, opts) {
    let q = sb.from("lucien_archive").select(cols, opts);
    if (lock) q = q.eq("category", lock); else if (f.category) q = q.eq("category", f.category);
    if (lock === "committee" && f.house) q = q.contains("tags", [f.house]);
    if (lock === "committee" && f.type) q = q.contains("tags", [f.type]);
    if (f.source.trim()) q = q.ilike("source", `%${clean(f.source)}%`);
    if (f.from) q = q.gte("published", `${f.from}T00:00:00Z`);
    if (f.to) q = q.lte("published", `${f.to}T23:59:59Z`);
    if (f.q.trim()) q = q.textSearch("search", f.q.trim(), { type: "websearch", config: "english" });
    return q.order("published", { ascending: false, nullsFirst: false }).order("id");
  }
  const asItem = r => ({ ...(r.item || {}), ...r, areas: (r.item || {}).areas || [], geo: (r.item || {}).geo || [] });

  function shell() {
    const cm = lock === "committee";
    host.innerHTML = `<div class="panel"><div class="panel-head"><h2>${cm ? "Select committees" : "Archive"}</h2><span class="muted" id="arc-count"></span></div>
      <p class="muted arc-note">${cm ? "Every select committee report, special report and government response in Parliament's Committees API, newest first, from every committee of the Commons, the Lords and the joint committees. Search by words, committee, House, type or date." : "Everything LUCIEN has found, kept for good. Select committee reports and government responses go back as far as the Parliament Committees API holds them; think tank, media and polling items are kept from the day the archive began. The other tabs show only the last 180 days."}</p>
      <form class="arc-form" id="arc-form" role="search">
        <input type="search" id="arc-q" placeholder="Search titles and summaries…" value="${esc(f.q)}" aria-label="Search the archive">
        ${cm ? `<select id="arc-house" aria-label="House">${[["", "Commons, Lords and joint"], ["Commons", "Commons"], ["Lords", "Lords"], ["Joint", "Joint committees"]].map(([v, l]) => `<option value="${v}" ${f.house === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <select id="arc-type" aria-label="Type">${[["", "Reports and responses"], ["Report", "Reports"], ["Special Report", "Special reports"], ["Government Response", "Government responses"]].map(([v, l]) => `<option value="${v}" ${f.type === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>` : `<select id="arc-cat" aria-label="Kind of item">${CATS.map(([v, l]) => `<option value="${v}" ${f.category === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`}
        <input type="text" id="arc-src" placeholder="${cm ? "Committee (for example Health and Social Care)" : "Source (for example Health Committee)"}" value="${esc(f.source)}" aria-label="${cm ? "Committee" : "Source"}">
        <label class="arc-d">From <input type="date" id="arc-from" value="${esc(f.from)}"></label>
        <label class="arc-d">To <input type="date" id="arc-to" value="${esc(f.to)}"></label>
        <button class="ghost" type="submit">Search</button><button class="ghost" type="button" id="arc-reset">Clear</button><button class="ghost" type="button" id="arc-csv" title="Download the matching items as a spreadsheet (up to ${EXPORT_MAX})">CSV</button>
      </form></div><div id="arc-list"></div><div class="arc-pager" id="arc-pager"></div>`;
    host.querySelector("#arc-form").onsubmit = e => { e.preventDefault(); read(); f.page = 0; draw(); };
    host.querySelector("#arc-reset").onclick = () => { Object.assign(f, { q: "", category: "", source: "", from: "", to: "", house: "", type: "", page: 0 }); shell(); draw(); };
    host.querySelector("#arc-csv").onclick = exportCsv;
    host.querySelector("#arc-pager").onclick = e => { const b = e.target.closest("[data-pg]"); if (b) { f.page = Math.max(0, f.page + +b.dataset.pg); draw(); window.scrollTo({ top: host.offsetTop - 10 }); } };
  }
  function read() {
    f.q = host.querySelector("#arc-q").value; f.source = host.querySelector("#arc-src").value;
    if (host.querySelector("#arc-cat")) f.category = host.querySelector("#arc-cat").value;
    if (host.querySelector("#arc-house")) { f.house = host.querySelector("#arc-house").value; f.type = host.querySelector("#arc-type").value; }
    f.from = host.querySelector("#arc-from").value; f.to = host.querySelector("#arc-to").value;
  }

  async function draw() {
    const list = host.querySelector("#arc-list"), count = host.querySelector("#arc-count"), pager = host.querySelector("#arc-pager");
    list.innerHTML = '<p class="muted">Searching…</p>';
    const { data, count: total, error } = await query("id,category,source,title,url,published,first_seen,summary,tags,item", { count: "exact" }).range(f.page * PAGE, f.page * PAGE + PAGE - 1);
    if (error) { list.innerHTML = `<div class="empty">The archive could not be read: ${esc(error.message)}</div>`; count.textContent = ""; pager.innerHTML = ""; return; }
    const n = total ?? data.length, last = Math.max(0, Math.ceil(n / PAGE) - 1);
    count.textContent = `${n.toLocaleString("en-GB")} item${n === 1 ? "" : "s"}`;
    list.innerHTML = data.length ? data.map(r => card(asItem(r))).join("") : '<div class="empty">Nothing in the archive matches. Try other words or clear a filter.</div>';
    pager.innerHTML = n > PAGE ? `<button class="ghost" data-pg="-1" ${f.page === 0 ? "disabled" : ""}>‹ Newer</button><span class="muted">Page ${f.page + 1} of ${last + 1}</span><button class="ghost" data-pg="1" ${f.page >= last ? "disabled" : ""}>Older ›</button>` : "";
  }

  async function exportCsv() {
    read();
    const rows = [];
    for (let from = 0; from < EXPORT_MAX; from += 1000) {
      const { data, error } = await query("category,source,title,url,published,summary", {}).range(from, from + 999);
      if (error) { alert(`The archive could not be read: ${error.message}`); return; }
      rows.push(...data); if (data.length < 1000) break;
    }
    const cell = v => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };   // (a leading = + - @ would run as a formula in a spreadsheet)
    const csv = [["Kind", "Source", "Title", "Link", "Published", "Summary"], ...rows.map(r => [r.category, r.source, r.title, r.url, r.published ? r.published.slice(0, 10) : "", r.summary])].map(r => r.map(cell).join(",")).join("\r\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })), download: `lucien-archive-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** Draws the archive into `el`; `cardHtml` draws one item (the same card as the other tabs). */
  function render(el, cardHtml, opts = {}) { host = el; card = cardHtml; if (lock !== (opts.category || "")) Object.assign(f, { q: "", category: "", source: "", from: "", to: "", house: "", type: "", page: 0 }); lock = opts.category || ""; shell(); draw(); }
  return { render };
})();
