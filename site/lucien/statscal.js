/* LUCIEN > Stats calendar: upcoming and recently published data releases from UK public-sector bodies.
 * The data (releases, changes, sources) is collected at 6am and 6pm by tracker/statscal.py and stored as "statscal"; this file only shows it.
 * Two views (agenda by day, month grid), filters kept in the address (#stats?...) so a view can be shared, badges, panels and a calendar download. */
const StatsCal = (() => {
  const esc = Athena.esc;
  const TZ = "Europe/London";
  const TIERS = { national: "Government department", alb: "Agency or regulator", ons: "ONS", london: "London" };
  const KINDS = { upcoming: "Upcoming", published: "Published", cancelled: "Cancelled" };
  const RANGES = { "7": ["Next 7 days", -1, 7], "30": ["Next 30 days + last 7", -7, 30], "90": ["Next 90 days + last 7", -7, 90], all: ["All stored", -9999, 9999] };
  const DEFAULTS = { view: "agenda", tier: "", publisher: "", kind: "", range: "30", q: "", month: "", day: "" };
  const f = { ...DEFAULTS };
  let body = null, host = null;

  const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const fmtDay = k => new Date(k + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const fmtShort = k => new Date(k + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const fmtMonth = k => new Date(k + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const fmtTime = iso => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const fmtWhen = iso => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });

  /* ---- the address keeps the filters */
  function fromHash() {
    const h = location.hash;
    if (!h.startsWith("#stats")) return false;
    const p = new URLSearchParams(h.split("?")[1] || "");
    for (const k of Object.keys(DEFAULTS)) if (p.has(k)) f[k] = p.get(k);
    if (!RANGES[f.range]) f.range = DEFAULTS.range;
    if (!["agenda", "month"].includes(f.view)) f.view = "agenda";
    return true;
  }
  function toHash() {
    const p = new URLSearchParams();
    for (const k of Object.keys(DEFAULTS)) if (f[k] && f[k] !== DEFAULTS[k]) p.set(k, f[k]);
    try { history.replaceState(null, "", "#stats" + (p.toString() ? "?" + p : "")); } catch (e) { /* the address is a convenience */ }
  }

  /* ---- filtering */
  const releases = () => (body && body.releases) || [];
  function matches(r, { range = true } = {}) {
    if (f.tier && r.tier !== f.tier) return false;
    if (f.kind && r.kind !== f.kind) return false;
    if (f.publisher && !r.publisher.toLowerCase().includes(f.publisher.toLowerCase())) return false;
    if (f.q) { const q = f.q.toLowerCase(); if (!(r.title + " " + r.publisher + " " + (r.summary || "")).toLowerCase().includes(q)) return false; }
    if (range) {
      const [, a, b] = RANGES[f.range], t = todayIso();
      if (r.date_precision === "day") { if (r.date < addDays(t, a) || r.date > addDays(t, b)) return false; }
      else if (r.date.slice(0, 7) < addDays(t, a).slice(0, 7) || r.date.slice(0, 7) > addDays(t, b).slice(0, 7)) return false;
    }
    return true;
  }

  /* ---- one release */
  // on the very first run everything was first seen at once, so "New" would mean nothing
  const isNew = r => r.first_seen && Date.now() - new Date(r.first_seen) < 48 * 36e5 && !(body.releases || []).every(x => x.first_seen === r.first_seen);
  function badges(r) {
    const b = [];
    if (r.kind === "cancelled" || r.cancelled) b.push('<span class="sc-b sc-cancelled">Cancelled</span>');
    else if (r.kind === "published") b.push('<span class="sc-b sc-published">Published</span>');
    else b.push(`<span class="sc-b sc-${esc(r.date_status)}">${esc(r.date_status[0].toUpperCase() + r.date_status.slice(1))}</span>`);
    const moved = (r.previous_dates || []).filter(p => p.date !== r.date).slice(-1)[0];
    if (moved && r.kind === "upcoming") b.push(`<span class="sc-b sc-changed" title="Moved from ${esc(fmtShort(moved.date))} to ${esc(fmtShort(r.date))}${moved.change_notice ? ". " + esc(moved.change_notice) : ""}">Changed</span> <span class="small muted">was ${esc(fmtShort(moved.date))}</span>`);
    if (isNew(r)) b.push('<span class="sc-b sc-new">New</span>');
    return b.join(" ");
  }
  function item(r) {
    const url = Athena.safeUrl(r.url);
    const title = url ? `<a class="title" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>` : `<span class="title">${esc(r.title)}</span>`;
    const time = r.datetime && r.date_precision === "day" ? fmtTime(r.datetime) : "";
    return `<article class="sc-item sc-k-${esc(r.kind)} ${r.date_status === "estimated" ? "sc-est" : ""}">
      <div class="sc-time">${esc(time)}</div>
      <div>${title}
        <div class="meta"><span class="src">${esc(r.publisher)}</span><span>${esc(TIERS[r.tier] || "")}</span>${r.official_status ? `<span>${esc(r.official_status)}</span>` : ""}</div>
        ${r.summary ? `<p class="summary">${esc(r.summary)}</p>` : ""}</div>
      <div class="sc-badges">${badges(r)}</div></article>`;
  }

  /* ---- views */
  function agenda(rows) {
    const t = todayIso();
    const dayRows = rows.filter(r => r.date_precision === "day" && (!f.day || r.date === f.day));
    const tbc = f.day ? [] : rows.filter(r => r.date_precision !== "day");
    let html = "";
    if (tbc.length) {
      const by = {}; tbc.forEach(r => (by[r.date.slice(0, 7)] ||= []).push(r));
      html += Object.keys(by).sort().map(m => `<section class="sc-tbc"><h3>${esc(fmtMonth(m))}: date to be confirmed <span class="count">${by[m].length}</span></h3>${by[m].map(item).join("")}</section>`).join("");
    }
    let last = "";
    for (const r of dayRows) {
      if (r.date !== last) { html += `<div class="day">${esc(fmtDay(r.date))}${r.date === t ? " · today" : ""}</div>`; last = r.date; }
      html += item(r);
    }
    return html || '<div class="empty">Nothing matches. Try widening the date range or clearing a filter.</div>';
  }
  function monthGrid(rows) {
    const t = todayIso(), m = f.month || t.slice(0, 7);
    const first = new Date(m + "-01T12:00:00Z"), lead = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const by = {}; rows.filter(r => r.date_precision === "day" && r.date.slice(0, 7) === m).forEach(r => (by[r.date] ||= []).push(r));
    const tbc = rows.filter(r => r.date_precision !== "day" && r.date.slice(0, 7) === m);
    const prev = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
    let cells = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => `<div class="sc-dow">${d}</div>`).join("") + '<div class="sc-cell sc-blank"></div>'.repeat(lead);
    for (let d = 1; d <= days; d++) {
      const k = `${m}-${String(d).padStart(2, "0")}`, list = by[k] || [];
      cells += `<div class="sc-cell ${k === t ? "sc-today" : ""}"><b>${d}</b>${list.slice(0, 3).map(r => `<span class="sc-chip sc-k-${esc(r.kind)} ${r.date_status === "estimated" ? "sc-est" : ""}" title="${esc(r.publisher + ": " + r.title)}">${esc(r.title)}</span>`).join("")}${list.length > 3 ? `<button type="button" class="linkish small" data-sc-day="${k}">+${list.length - 3} more</button>` : list.length ? `<button type="button" class="linkish small" data-sc-day="${k}">Open</button>` : ""}</div>`;
    }
    return `<div class="sc-monthbar"><button type="button" class="ghost" data-sc-month="${prev}">&larr; ${esc(fmtMonth(prev))}</button><strong>${esc(fmtMonth(m))}</strong><button type="button" class="ghost" data-sc-month="${next}">${esc(fmtMonth(next))} &rarr;</button></div>
      <div class="sc-grid">${cells}</div>
      ${tbc.length ? `<section class="sc-tbc"><h3>${esc(fmtMonth(m))}: date to be confirmed <span class="count">${tbc.length}</span></h3>${tbc.map(item).join("")}</section>` : ""}`;
  }

  /* ---- calendar download: all-day events (so summer time never moves them), confirmed and provisional dates only unless estimates are asked for */
  const icsEsc = s => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const fold = line => { const out = []; while (line.length > 73) { out.push(line.slice(0, 73)); line = " " + line.slice(73); } out.push(line); return out.join("\r\n"); };
  function icsText(withEstimates) {
    const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
    const ev = releases().filter(r => r.kind === "upcoming" && !r.cancelled && r.date_precision === "day" && (r.date_status !== "estimated" || withEstimates)).map(r => {
      const d = r.date.replace(/-/g, ""), e = addDays(r.date, 1).replace(/-/g, "");
      const desc = [r.publisher, r.datetime ? "Due " + fmtTime(r.datetime) + " (London time)" : "", r.date_status === "estimated" ? "ESTIMATED date: not announced" : r.date_status === "provisional" ? "Provisional date" : "Confirmed date", r.url].filter(Boolean).join(" · ");
      return ["BEGIN:VEVENT", `UID:${r.id.replace(/[^A-Za-z0-9:._/-]/g, "")}@athena-statscal`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${e}`,
        `SUMMARY:${icsEsc((r.date_status === "estimated" ? "(est.) " : "") + r.title)}`, `DESCRIPTION:${icsEsc(desc)}`, r.url ? `URL:${r.url}` : "", "END:VEVENT"].filter(Boolean).map(fold).join("\r\n");
    });
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Athena//Stats calendar//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:Stats calendar${withEstimates ? " (with estimates)" : ""}`, ...ev, "END:VCALENDAR"].join("\r\n") + "\r\n";
  }
  function download(withEstimates) {
    const url = URL.createObjectURL(new Blob([icsText(withEstimates)], { type: "text/calendar" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: withEstimates ? "stats-calendar-with-estimates.ics" : "stats-calendar.ics" });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---- the tab */
  function render(el, data) {
    host = el; body = data;
    if (!body) { el.innerHTML = '<div class="empty">No stats calendar data yet. It appears after the next 6am or 6pm update (or press Refresh all data at the foot of the page).</div>'; return; }
    toHash();
    const all = releases(), t = todayIso();
    const rows = all.filter(r => matches(r)).sort((a, b) => a.date.localeCompare(b.date) || (a.datetime || "").localeCompare(b.datetime || "") || a.title.localeCompare(b.title));
    const bad = (body.sources || []).filter(s => !s.ok);
    const publishers = [...new Set(all.map(r => r.publisher))].sort();
    const changed = (body.changes || []).filter(c => ["date_changed", "cancelled"].includes(c.type) && c.at >= new Date(Date.now() - 14 * 864e5).toISOString()).slice(0, 10);
    const justOut = all.filter(r => r.kind === "published" && r.date >= addDays(t, -7)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
    const link = (c, line) => { const u = Athena.safeUrl(c.url); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${line}</a>` : line; };
    el.innerHTML = `
      <p class="small muted">Last refreshed ${esc(fmtWhen(body.updated))} (updates at 6am and 6pm). Times are London time.</p>
      ${bad.length ? `<div class="sc-warn" role="status"><strong>Some sources could not be refreshed:</strong> ${bad.map(s => esc(s.source)).join(", ")}. What is shown for them is the last good copy. See Source health.</div>` : ""}
      <div class="sc-panels">
        <div class="panel"><div class="panel-head"><h2>Recently changed</h2><span class="muted">last 14 days</span></div>${changed.length ? `<ul class="plain">${changed.map(c => `<li>${link(c, esc(c.title))}<br><span class="small muted">${esc(c.publisher)} · ${c.type === "cancelled" ? "cancelled" : `moved ${esc(fmtShort(c.old_date))} → ${esc(fmtShort(c.new_date))}`}</span></li>`).join("")}</ul>` : '<p class="muted small">No date changes or cancellations lately.</p>'}</div>
        <div class="panel"><div class="panel-head"><h2>Just published</h2><span class="muted">last 7 days</span></div>${justOut.length ? `<ul class="plain">${justOut.map(r => `<li>${link(r, esc(r.title))}<br><span class="small muted">${esc(r.publisher)} · ${esc(fmtShort(r.date))}</span></li>`).join("")}</ul>` : '<p class="muted small">Nothing published in the last 7 days.</p>'}</div>
      </div>
      <section class="controls" aria-label="Filters">
        <div class="toggle sc-viewtoggle" role="group" aria-label="View"><button type="button" data-sc-view="agenda" ${f.view === "agenda" ? 'aria-current="true"' : ""}>Agenda</button><button type="button" data-sc-view="month" ${f.view === "month" ? 'aria-current="true"' : ""}>Month</button></div>
        <input id="sc-q" type="search" placeholder="Search releases…" aria-label="Search releases" value="${esc(f.q)}">
        <select id="sc-tier" aria-label="Kind of body"><option value="">All bodies</option>${Object.entries(TIERS).map(([k, v]) => `<option value="${k}" ${f.tier === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
        <input id="sc-pub" list="sc-pubs" placeholder="Publisher…" aria-label="Publisher" value="${esc(f.publisher)}"><datalist id="sc-pubs">${publishers.map(p => `<option value="${esc(p)}">`).join("")}</datalist>
        <select id="sc-kind" aria-label="Upcoming, published or cancelled"><option value="">Upcoming, published, cancelled</option>${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${f.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <select id="sc-range" aria-label="Date range" ${f.view === "month" ? "disabled" : ""}>${Object.entries(RANGES).map(([k, v]) => `<option value="${k}" ${f.range === k ? "selected" : ""}>${v[0]}</option>`).join("")}</select>
        <button type="button" class="ghost" id="sc-reset">Reset</button>
      </section>
      <div class="listhead"><span class="muted">${f.view === "month" ? "" : `${rows.length} release${rows.length === 1 ? "" : "s"}`}${f.day ? ` on ${esc(fmtShort(f.day))} <button type="button" class="linkish small" data-sc-day="">show all days</button>` : ""}</span>
        <span><button type="button" class="ghost" data-sc-ics="0" title="Confirmed and provisional dates only">Download calendar (.ics)</button> <button type="button" class="ghost" data-sc-ics="1" title="Includes estimated dates, marked as such">with estimates</button></span></div>
      <div class="sc-legend small muted"><span class="sc-b sc-confirmed">Confirmed</span> <span class="sc-b sc-provisional">Provisional</span> <span class="sc-b sc-estimated">Estimated</span> (worked out from past updates, never announced) <span class="sc-b sc-cancelled">Cancelled</span> <span class="sc-b sc-changed">Changed</span></div>
      <div class="list sc-list">${f.view === "month" ? monthGrid(all.filter(r => matches(r, { range: false }))) : agenda(rows)}</div>
      <p class="small muted">Sources: ONS release calendar, GOV.UK statistics announcements, London Datastore, data.police.uk, and a hand-kept list for TfL, the Met and MOPAC. Contains public sector information licensed under the Open Government Licence v3.0. This page links to each release and does not copy it.</p>`;
  }

  function bind(rerender) {
    const redo = () => { render(host, body); rerender && rerender(); };
    document.body.addEventListener("click", e => {
      if (!host || host.hidden) return;
      const v = e.target.closest("[data-sc-view]"); if (v) { f.view = v.dataset.scView; f.day = ""; return redo(); }
      const m = e.target.closest("[data-sc-month]"); if (m) { f.month = m.dataset.scMonth; return redo(); }
      const d = e.target.closest("[data-sc-day]"); if (d) { f.day = d.dataset.scDay; f.view = "agenda"; f.range = f.day ? "all" : DEFAULTS.range; return redo(); }
      const i = e.target.closest("[data-sc-ics]"); if (i) return download(i.dataset.scIcs === "1");
      if (e.target.closest("#sc-reset")) { Object.assign(f, DEFAULTS); return redo(); }
    });
    document.body.addEventListener("change", e => {
      if (!host || host.hidden) return;
      const map = { "sc-tier": "tier", "sc-kind": "kind", "sc-range": "range", "sc-pub": "publisher" };
      if (map[e.target.id]) { f[map[e.target.id]] = e.target.value; f.day = ""; redo(); }
    });
    let t;
    document.body.addEventListener("input", e => {
      if (!host || host.hidden || e.target.id !== "sc-q") return;
      clearTimeout(t); t = setTimeout(() => { f.q = e.target.value; render(host, body); const q = document.getElementById("sc-q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 200);
    });
  }
  return { render, bind, fromHash, icsText, state: f };
})();
