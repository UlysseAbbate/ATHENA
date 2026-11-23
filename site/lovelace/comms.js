/* LOVELACE > Comms: three parts.
 *   Media     two trackers (London Media Tracker, Lib Dem Media Tracker): each line is a persona, a channel and a summary (a headline or a caption); and Tracked accounts, a sheet of personas by channel.
 *   Stories   pitches: every role can send one, only the core team can read them.
 *   Policies  documents the core team uploads; the text is read in the browser and kept in passages so people (Local party chair and above) can search them.
 * A classic script, loaded BEFORE lovelace.js (whose TABS list names renderComms); it uses lovelace.js's helpers (sb, can, esc, openForm, ...) only when a page is drawn, never when this file loads. */

const commsState = { section: null, open: {}, shown: { london: 40, libdem: 40 }, q: { london: "", libdem: "" }, persona: { london: "", libdem: "" }, channel: { london: "", libdem: "" }, policyQ: "", policyTheme: "" };
const CHANNELS = ["Instagram", "Facebook", "Twitter", "BlueSky", "TikTok", "LinkedIn", "YouTube", "Substack", "Threads", "Mastodon", "Print media", "Website", "Other"];
const CHANNEL_LABEL = { Twitter: "X (Twitter)" };
const chLabel = c => CHANNEL_LABEL[c] || c;
const TRACKER_NAMES = { london: "London Media Tracker", libdem: "Lib Dem Media Tracker" };
const TRACKER_NOTES = {
  london: "London news: the Evening Standard, MyLondon, the local borough outlets and the rest. Stories are found automatically at 6am and 6pm and anything can be added by hand.",
  libdem: "Sarah Olney, Lib Dem accounts, other candidates and the local parties: what they post and what is written about them. Accounts on BlueSky, Substack, YouTube and Mastodon are read automatically at 6am and 6pm; other platforms do not allow it, so add those by hand."
};
const commsSections = () => [["media", "Media", () => can("coverage", "read") || can("social", "read")], ["stories", "Stories", () => can("stories", "write") || can("stories", "read")],
  ["policies", "Policies", () => can("policies", "read")]].filter(s => s[2]());

async function renderComms() {
  const sections = commsSections();
  if (!sections.length) { main.innerHTML = '<p class="muted">Communications is not open to your role yet.</p>'; return; }
  const sec = sections.some(s => s[0] === commsState.section) ? commsState.section : sections[0][0];
  main.innerHTML = `<div class="row">${sections.length > 1 ? `<div class="seg" data-sec>${sections.map(s => `<button data-s="${s[0]}" class="${s[0] === sec ? "on" : ""}">${esc(s[1])}</button>`).join("")}</div>` : ""}</div><div id="cm"></div>`;
  main.onclick = e => { const s = e.target.closest("[data-s]"); if (s) { commsState.section = s.dataset.s; renderComms(); } };
  const host = $("#cm");
  if (sec === "media") return renderMedia(host);
  if (sec === "stories") return renderStories(host);
  return renderPolicyLibrary(host);
}

/* ================================================================== MEDIA */
async function renderMedia(host) {
  const accounts = can("social", "write");
  host.innerHTML = `<h2 class="h2-rule">${TRACKER_NAMES.london}</h2><div id="trk-london"></div>
    <h2 class="h2-rule">${TRACKER_NAMES.libdem}</h2><div id="trk-libdem"></div>
    ${accounts ? '<h2 class="h2-rule">Tracked accounts</h2><div id="trk-accounts"></div>' : ""}`;
  await Promise.all([drawTracker($("#trk-london", host), "london"), drawTracker($("#trk-libdem", host), "libdem"), accounts ? drawAccounts($("#trk-accounts", host)) : null]);
}

/* ---- the trackers: a persona, a channel and a summary for each item */
const TRACKER_KIND = { london: "overall", libdem: "libdem" };   // media_coverage.kind
async function trackerRows(kind) {
  const accts = await sb.from("social_accounts").select("id,organisation,platform,tracker").eq("tracker", kind);
  if (accts.error) throw accts.error;
  const ids = accts.data.map(a => a.id), byId = Object.fromEntries(accts.data.map(a => [a.id, a]));
  const reads = [sb.from("media_coverage").select("id,covered_on,persona,outlet,channel,headline,url,source,updated_at").eq("kind", TRACKER_KIND[kind]).order("covered_on", { ascending: false }).limit(1500)];
  reads.push(ids.length && can("social", "read") ? sb.from("social_posts").select("id,account_id,posted_at,url,summary,updated_at").in("account_id", ids).order("posted_at", { ascending: false }).limit(1500) : Promise.resolve({ data: [] }));
  reads.push(kind === "london" && can("london_media", "read") ? sb.from("london_feed").select("id,published,first_seen,source,title,url").eq("kind", "media").order("published", { ascending: false, nullsFirst: false }).limit(600) : Promise.resolve({ data: [] }));
  const [cov, posts, feed] = await Promise.all(reads);
  for (const r of [cov, posts, feed]) if (r.error) throw r.error;
  const rows = [
    ...cov.data.map(r => ({ src: "media", id: r.id, date: r.covered_on, persona: r.persona || r.outlet, channel: r.channel || "Online news", summary: r.headline, url: r.url, auto: r.source === "auto" || r.source === "social", row: r })),
    ...posts.data.map(p => ({ src: "post", id: p.id, date: String(p.posted_at || "").slice(0, 10), persona: byId[p.account_id]?.organisation || "", channel: byId[p.account_id]?.platform || "", summary: p.summary || "post", url: p.url, auto: false, row: p, account: byId[p.account_id] })),
    ...feed.data.map(r => ({ src: "feed", id: r.id, date: String(r.published || r.first_seen || "").slice(0, 10), persona: r.source, channel: "Online news", summary: r.title, url: r.url, auto: true, row: r }))];
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { rows, accounts: accts.data };
}
async function drawTracker(host, kind) {
  let data;
  try { data = await trackerRows(kind); } catch (e) { host.innerHTML = ""; host.append(notice(e.message || String(e))); return; }
  const w = can("coverage", "write");
  const personas = [...new Set(data.rows.map(r => r.persona).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const channels = [...new Set(data.rows.map(r => r.channel).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  host.innerHTML = `<p class="muted">${esc(TRACKER_NOTES[kind])}</p>
    <div class="row"><input class="grow" type="search" placeholder="Search the summaries…" data-q="${kind}" value="${esc(commsState.q[kind])}" aria-label="Search ${esc(TRACKER_NAMES[kind])}">
      <select data-persona="${kind}" aria-label="Persona"><option value="">All personas</option>${personas.map(p => `<option ${p === commsState.persona[kind] ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
      <select data-channel="${kind}" aria-label="Channel"><option value="">All channels</option>${channels.map(c => `<option value="${esc(c)}" ${c === commsState.channel[kind] ? "selected" : ""}>${esc(chLabel(c))}</option>`).join("")}</select>
      ${w ? `<button class="btn primary" data-add="${kind}">+ Add an entry</button>` : ""}</div>
    ${w ? `<div data-imp="${kind}"></div>` : ""}<div data-list="${kind}"></div>`;
  const list = $(`[data-list="${kind}"]`, host);
  const draw = () => {
    const q = commsState.q[kind].toLowerCase(), pf = commsState.persona[kind], cf = commsState.channel[kind];
    const rows = data.rows.filter(r => (!pf || r.persona === pf) && (!cf || r.channel === cf) && (!q || `${r.summary} ${r.persona} ${r.channel}`.toLowerCase().includes(q)));
    const shown = rows.slice(0, commsState.shown[kind]);
    list.innerHTML = rows.length ? `<p class="muted small">${rows.length.toLocaleString("en-GB")} item${rows.length === 1 ? "" : "s"}</p>
      <div class="tablewrap"><table class="grid trk"><thead><tr><th>Date</th><th>Persona</th><th>Channel</th><th>Summary</th>${w ? "<th></th>" : ""}</tr></thead><tbody>${shown.map(r => { const u = safeUrl(r.url);
        const editable = w && r.src !== "feed";
        return `<tr><td class="nowrap">${esc(r.date ? fmtShort(r.date) : "")}</td><td>${esc(r.persona)}</td><td class="nowrap">${esc(chLabel(r.channel))}</td>
          <td>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(r.summary)}</a>` : esc(r.summary)}${r.auto ? ' <span class="pill" title="Found automatically">auto</span>' : ""}</td>
          ${w ? `<td>${editable ? `<button class="btn sm" data-edit="${r.src}|${r.id}">Edit</button>` : ""}</td>` : ""}</tr>`; }).join("")}</tbody></table></div>
      ${rows.length > shown.length ? `<p><button class="btn" data-more="${kind}">Show more (${rows.length - shown.length} left)</button></p>` : ""}`
      : `<div class="empty">${data.rows.length ? "Nothing matches." : "Nothing here yet."}</div>`;
  };
  draw();
  const entryForm = (r) => {
    const row = r && r.src === "media" ? r.row : null;
    const post = r && r.src === "post" ? r.row : null;
    const known = [...new Set([...data.accounts.map(a => a.organisation), ...personas])].sort();
    openForm({ title: r ? "Edit this entry" : `Add an entry to the ${TRACKER_NAMES[kind]}`,
      fields: [T("date", "Date", "date", { req: true }), T("persona", "Persona (who it is from or about)", "text", { req: true, list: known }), T("channel", "Channel", "select", { req: true, options: [...CHANNELS.map(c => [c, chLabel(c)]), "Online news"] }),
        T("summary", "Summary (the headline, or the first line of the caption)", "text", { req: true }), T("url", "Link")],
      values: r ? { date: r.date, persona: r.persona, channel: r.channel, summary: r.summary, url: r.url || "" } : { date: iso(new Date()), channel: kind === "london" ? "Online news" : "" },
      meta: r ? edited(r.row) : "",
      onSubmit: async v => {
        if (v.url && !safeUrl(v.url)) return new Error("The link should start with https://");
        let e;
        if (post) e = await guardedUpdate("social_posts", post, { posted_at: `${v.date}T12:00:00Z`, summary: v.summary, url: v.url });
        else if (row) e = await guardedUpdate("media_coverage", row, { covered_on: v.date, persona: v.persona, outlet: v.persona, channel: v.channel, headline: v.summary, url: v.url });
        else e = (await sb.from("media_coverage").insert({ kind: TRACKER_KIND[kind], covered_on: v.date, persona: v.persona, outlet: v.persona, channel: v.channel, headline: v.summary, url: v.url || null, source: "manual" })).error;
        if (!e || e.message === CONFLICT) drawTracker(host, kind);
        return e;
      },
      onDelete: r ? async () => { const { error: e } = await sb.from(post ? "social_posts" : "media_coverage").delete().eq("id", r.id); if (!e) drawTracker(host, kind); return e; } : null });
  };
  host.onclick = e => {
    if (e.target.closest(`[data-add="${kind}"]`)) return entryForm(null);
    const more = e.target.closest(`[data-more="${kind}"]`); if (more) { commsState.shown[kind] += 40; return draw(); }
    const ed = e.target.closest("[data-edit]"); if (ed) { const [src, id] = ed.dataset.edit.split("|"); const r = data.rows.find(x => x.src === src && String(x.id) === id); if (r) entryForm(r); }
  };
  host.oninput = e => { if (e.target.matches(`[data-q="${kind}"]`)) { commsState.q[kind] = e.target.value; commsState.shown[kind] = 40; draw(); } };
  host.onchange = e => {
    if (e.target.matches(`[data-persona="${kind}"]`)) { commsState.persona[kind] = e.target.value; commsState.shown[kind] = 40; draw(); }
    if (e.target.matches(`[data-channel="${kind}"]`)) { commsState.channel[kind] = e.target.value; commsState.shown[kind] = 40; draw(); }
  };
  if (w) {   // upload many entries from a spreadsheet (Date, Persona, Channel, Summary, Link)
    const { mountImport } = await import("../shared/import/panel.js"), { IMPORTERS } = await import("../shared/import/importers.js");
    mountImport($(`[data-imp="${kind}"]`, host), {
      importer: IMPORTERS.media, after: () => drawTracker(host, kind),
      commit: async (entries, progress) => {
        let added = 0, done = 0; const failed = [];
        for (const e of entries) {
          const row = { kind: TRACKER_KIND[kind], covered_on: e.date, persona: e.persona, outlet: e.persona, channel: e.channel, headline: e.summary, url: e.url || null, source: "manual" };
          const { error: er } = await sb.from("media_coverage").insert(row);
          if (er) failed.push({ summary: `${e.persona} · ${e.summary}`, error: /duplicate|unique/i.test(er.message) ? "already on the tracker (same link)" : er.message }); else added++;
          progress(++done, entries.length);
        }
        return { added, skipped: 0, failed };
      } });
  }
}

/* ---- Tracked accounts: one row per persona, one column per channel, each cell the handle or link (core team and above) */
async function drawAccounts(host) {
  const { data: accts, error } = await sb.from("social_accounts").select("id,organisation,platform,handle,url,tracker,updated_at").order("organisation");
  if (error) { host.append(notice(error.message)); return; }
  const by = new Map();
  for (const a of accts) { if (!by.has(a.organisation)) by.set(a.organisation, { name: a.organisation, tracker: a.tracker, cells: {} }); by.get(a.organisation).cells[a.platform] = a; }
  const personas = [...by.values()];
  const cellText = a => (a && (a.handle || a.url)) || "";
  host.innerHTML = `<p class="muted">Every persona we follow, one row each, with a column for each channel. Type a handle or paste a link into a box (a link also fills in the handle); clear a box to forget it. Change a name or the tracker it belongs to in the first columns, and press Delete to remove a whole persona (and what was tracked for it).
    <b>BlueSky</b>, <b>Substack</b>, <b>YouTube</b> and <b>Mastodon</b> are read automatically at 6am and 6pm.</p>
    <div id="acc-import"></div>
    <form class="row" data-newp><input name="name" placeholder="New persona, e.g. Sarah Olney MP" required style="width:20rem"><select name="tracker"><option value="libdem">Lib Dem Media Tracker</option><option value="london">London Media Tracker</option></select><button class="btn primary" type="submit">Add persona</button><span class="muted small" data-newmsg></span></form>
    <div class="tablewrap"><table class="grid sheet"><thead><tr><th>Persona</th><th>Tracker</th>${CHANNELS.map(c => `<th>${esc(chLabel(c))}</th>`).join("")}<th></th></tr></thead><tbody>${personas.map((p, i) =>
      `<tr data-p="${i}"><td><input class="sh-name" value="${esc(p.name)}" aria-label="Persona name"></td>
        <td><select class="sh-tr" aria-label="Tracker"><option value="libdem" ${p.tracker === "libdem" ? "selected" : ""}>Lib Dem</option><option value="london" ${p.tracker === "london" ? "selected" : ""}>London</option></select></td>
        ${CHANNELS.map(c => { const a = p.cells[c], t = cellText(a), u = a && safeUrl(a.url); return `<td><input class="sh-cell" data-c="${esc(c)}" value="${esc(t)}" title="${esc(a?.url || t)}" aria-label="${esc(p.name)} on ${esc(chLabel(c))}">${u ? `<a class="sh-go" href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="Open">↗</a>` : ""}</td>`; }).join("")}
        <td><button class="btn sm danger" data-del="${i}">Delete</button></td></tr>`).join("") || `<tr><td colspan="${CHANNELS.length + 3}" class="muted">No personas yet. Add one above, or upload a spreadsheet.</td></tr>`}</tbody></table></div>
    <div class="note small muted" data-accmsg aria-live="polite"></div>`;
  const msg = t => { $("[data-accmsg]", host).textContent = t; };
  const { handleOf } = await import("../shared/import/importers.js");
  host.onchange = async e => {
    const tr = e.target.closest("tr[data-p]"); if (!tr) return;
    const p = personas[+tr.dataset.p];
    if (e.target.matches(".sh-cell")) {
      const c = e.target.dataset.c, val = e.target.value.trim(), a = p.cells[c];
      if (!val && !a) return;
      let handle = null, url = null;
      if (val) {
        if (/^https?:\/\//i.test(val) || /^[\w-]+(\.[\w-]+)+\//.test(val)) { url = /^https?:\/\//i.test(val) ? val : `https://${val}`; handle = (["Website", "Print media", "Other"].includes(c) ? (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })() : handleOf(c, url)) || null; }
        else handle = val.replace(/^@/, "");
      }
      const { error: er } = a ? await sb.from("social_accounts").update({ handle, url }).eq("id", a.id) : await sb.from("social_accounts").insert({ organisation: p.name, platform: c, handle, url, tracker: p.tracker });
      if (er) { msg(er.message); return; }
      msg(val ? `Saved ${p.name} · ${chLabel(c)}.` : `Cleared ${p.name} · ${chLabel(c)}.`); return drawAccounts(host);
    }
    if (e.target.matches(".sh-tr")) {
      const { error: er } = await sb.from("social_accounts").update({ tracker: e.target.value }).eq("organisation", p.name);
      if (er) { msg(er.message); return; } msg(`${p.name} is now on the ${TRACKER_NAMES[e.target.value]}.`); return drawAccounts(host);
    }
    if (e.target.matches(".sh-name")) {
      const name = e.target.value.trim();
      if (!name || name === p.name) { e.target.value = p.name; return; }
      if (by.has(name)) { msg(`"${name}" is already a persona.`); e.target.value = p.name; return; }
      const { error: er } = await sb.from("social_accounts").update({ organisation: name }).eq("organisation", p.name);
      if (er) { msg(er.message); return; } msg(`Renamed to ${name}.`); return drawAccounts(host);
    }
  };
  host.onclick = async e => {
    const d = e.target.closest("[data-del]"); if (!d) return;
    const p = personas[+d.dataset.del];
    if (!confirm(`Delete ${p.name} and everything tracked for it (its accounts and their posts)?`)) return;
    const { error: er } = await sb.from("social_accounts").delete().eq("organisation", p.name);
    if (er) { msg(er.message); return; } msg(`Deleted ${p.name}.`); drawAccounts(host);
  };
  $("[data-newp]", host).onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target.elements, name = f.name.value.trim();
    if (by.has(name)) { $("[data-newmsg]", host).textContent = "That persona is already on the sheet."; return; }
    const { error: er } = await sb.from("social_accounts").insert({ organisation: name, platform: "Other", tracker: f.tracker.value });
    if (er) { $("[data-newmsg]", host).textContent = er.message; return; }
    drawAccounts(host);
  };
  const { mountImport } = await import("../shared/import/panel.js"), { IMPORTERS } = await import("../shared/import/importers.js");
  mountImport($("#acc-import", host), {
    importer: IMPORTERS.accounts, after: () => drawAccounts(host),
    commit: async (entries, progress) => {
      let added = 0, done = 0; const failed = [];
      for (const e of entries) {
        const { error: er } = await sb.from("social_accounts").upsert({ organisation: e.organisation, platform: e.platform, handle: e.handle || null, url: e.url || null }, { onConflict: "organisation,platform", ignoreDuplicates: false });
        if (er) failed.push({ summary: `${e.organisation} · ${e.platform}`, error: er.message }); else added++;
        progress(++done, entries.length);
      }
      return { added, skipped: 0, failed };
    } });
}

/* ================================================================== STORIES */
const STORY_STATUS = [["new", "New"], ["considering", "Considering"], ["used", "Used"], ["declined", "Declined"]];
const SET_PIECES = ["Speech", "Panel", "Engagement session", "Writing a report", "Rally", "Other"];
const SET_LABEL = { yes: "Yes", no: "No", not_sure: "Not sure" };
const STORY_FILE_MAX = 3 * 1024 * 1024;
const lineCount = s => String(s).replace(/\s+$/, "").split("\n").length;

async function renderStories(host, sentMsg = "") {
  const read = can("stories", "read"), write = can("stories", "write");
  host.innerHTML = `<p class="muted">A pitch is a story idea for the media, with how it would run in a digital comms plan, who might want it, the policy behind it and whether it suits a set piece. ${read ? "" : "Pitches are read by the core team only: you will not see yours again once it is sent."}</p>
    <div class="row">${write ? '<button class="btn primary" data-pitch>+ Pitch a story</button>' : ""}<span class="muted small" data-sent aria-live="polite">${esc(sentMsg)}</span></div><div id="st-list"></div>`;
  host.onclick = e => { if (e.target.closest("[data-pitch]")) pitchForm(host); const r = e.target.closest("[data-story]"); if (r) openStory(host, r.dataset.story); };
  if (!read) return;
  const { data, error } = await sb.from("story_pitches").select("id,status,pitched_name,headline,hook,set_piece,created_at,updated_at").order("created_at", { ascending: false }).limit(500);
  if (error) { $("#st-list", host).append(notice(error.message)); return; }
  commsState.stories = data;
  $("#st-list", host).innerHTML = data.length ? `<div class="tablewrap"><table class="grid"><thead><tr><th>Sent</th><th>Headline</th><th>Hook</th><th>From</th><th>Set piece</th><th>Status</th></tr></thead><tbody>${data.map(s =>
    `<tr class="clickable" data-story="${esc(s.id)}" tabindex="0"><td class="nowrap">${esc(fmtShort(String(s.created_at).slice(0, 10)))}</td><td><b>${esc(s.headline)}</b></td><td>${esc(s.hook)}</td><td>${esc(s.pitched_name || "")}</td>
      <td>${esc(SET_LABEL[s.set_piece] || "")}</td><td><span class="pill">${esc(Object.fromEntries(STORY_STATUS)[s.status] || s.status)}</span></td></tr>`).join("")}</tbody></table></div>`
    : '<div class="empty">No pitches yet.</div>';
}

/** The pitch form: five parts, every box required except each part's "Other comments". */
function pitchForm(host) {
  const dlg = document.createElement("dialog"); dlg.className = "wide";
  const ta = (id, label, hint, rows = 2, max = 600) => `<label for="${id}">${label} *</label>${hint ? `<span class="hint muted small">${hint}</span>` : ""}<textarea id="${id}" rows="${rows}" maxlength="${max}" required></textarea>`;
  const other = n => `<label for="o${n}">Other comments</label><textarea id="o${n}" rows="2" maxlength="1500"></textarea>`;
  const contactRow = i => `<fieldset class="rep" data-rep="media"><legend>Person or organisation ${i}</legend>
    <label>Organisation *<input class="m-org" maxlength="200" required></label><label>Contact name *<input class="m-name" maxlength="200" required></label>
    <label>Contact details *<input class="m-det" maxlength="300" required placeholder="email, phone or social handle"></label><label>Why they would be interested *<textarea class="m-why" rows="2" maxlength="600" required></textarea></label></fieldset>`;
  const orgRow = i => `<fieldset class="rep" data-rep="orgs"><legend>Organisation ${i}</legend>
    <label>Organisation *<input class="o-org" maxlength="200" required></label><label>Links or references to their sources *<textarea class="o-ref" rows="2" maxlength="800" required placeholder="a link, a report title, a page number"></textarea></label></fieldset>`;
  dlg.innerHTML = `<form method="dialog" class="pitch"><h3>Pitch a story</h3><p class="muted small">Every box marked * is needed. If you are not sure of something, say so in the box (for example "not sure").</p>
    <fieldset><legend>1. What is the story?</legend>
      <label for="p_head">The story, as a headline (3 lines at most) *</label><textarea id="p_head" rows="3" maxlength="300" required></textarea><span class="muted small" data-headcount>0 of 3 lines</span>
      ${other(1)}</fieldset>
    <fieldset><legend>2. How would it appear in a digital comms plan?</legend>
      ${ta("p_hook", "Hook", "One line: the 3-second opener", 1, 300)}${ta("p_content", "Content", "Two or three key facts", 3, 1500)}${ta("p_turn", "Turn", "Why it matters, why we care", 2, 1000)}${ta("p_cta", "Call to action", "What are you calling for?", 2, 600)}
      ${other(2)}</fieldset>
    <fieldset><legend>3. Which media personalities or agencies might be interested?</legend><div id="p_media">${contactRow(1)}</div>
      <p><button type="button" class="btn sm" data-addrep="media">+ Add another</button></p>${other(3)}</fieldset>
    <fieldset><legend>4. The detailed policy briefing</legend>
      <label for="p_link">Link to the policy briefing</label><input id="p_link" maxlength="800" placeholder="https://…"><label for="p_file">or attach it (PDF, Word or text, up to 3 MB)</label><input id="p_file" type="file" accept=".pdf,.doc,.docx,.txt,.md"><span class="muted small">A link or an attachment is needed.</span>
      ${ta("p_cost", "How much is this expected to cost or save?", "If you are not sure, give a range or say \"not sure\"", 1, 500)}
      <div id="p_orgs">${orgRow(1)}</div><p><button type="button" class="btn sm" data-addrep="orgs">+ Add another organisation</button></p>
      <span class="muted small">Which organisations have done work on this? Give each organisation and where to find its work.</span>${other(4)}</fieldset>
    <fieldset><legend>5. Is it right for a set piece?</legend>
      <label for="p_set">Is this appropriate for a set piece opportunity? *</label><select id="p_set" required><option value=""></option><option value="yes">Yes</option><option value="no">No</option><option value="not_sure">Not sure</option></select>
      <div id="p_setmore" hidden><label for="p_kind">What would the set piece be? *</label><select id="p_kind">${SET_PIECES.map(k => `<option>${esc(k)}</option>`).join("")}</select>
        <input id="p_kindo" placeholder="Describe it" hidden maxlength="200"><label for="p_where">Where would it take place? *</label><input id="p_where" maxlength="300"></div>
      ${other(5)}</fieldset>
    <div class="row"><button class="btn primary" value="ok">Send the pitch</button><button class="btn" type="button" id="cx">Cancel</button></div><div id="fe"></div></form>`;
  document.body.append(dlg); dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener("close", () => dlg.remove());
  $("#cx", dlg).onclick = close;
  const head = $("#p_head", dlg), count = $("[data-headcount]", dlg);
  const checkHead = () => { const n = lineCount(head.value); count.textContent = `${head.value.trim() ? n : 0} of 3 lines`; head.setCustomValidity(n > 3 ? "Keep the headline to three lines at most." : ""); };
  head.oninput = checkHead;
  $("#p_set", dlg).onchange = e => { $("#p_setmore", dlg).hidden = e.target.value !== "yes"; $("#p_kind", dlg).required = $("#p_where", dlg).required = e.target.value === "yes"; };
  $("#p_kind", dlg).onchange = e => { const o = $("#p_kindo", dlg); o.hidden = e.target.value !== "Other"; o.required = e.target.value === "Other"; };
  dlg.addEventListener("click", e => {
    const b = e.target.closest("[data-addrep]"); if (!b) return;
    const k = b.dataset.addrep, box = $(k === "media" ? "#p_media" : "#p_orgs", dlg), n = box.children.length;
    if (n >= 8) return;
    box.insertAdjacentHTML("beforeend", k === "media" ? contactRow(n + 1) : orgRow(n + 1));
  });
  $("form", dlg).onsubmit = async e => {
    e.preventDefault(); checkHead();
    const v = id => ($(id, dlg).value || "").trim(), err = $("#fe", dlg), btn = $("button[value=ok]", dlg);
    err.replaceChildren();
    const media = [...dlg.querySelectorAll('[data-rep="media"]')].map(f => ({ organisation: $(".m-org", f).value.trim(), name: $(".m-name", f).value.trim(), details: $(".m-det", f).value.trim(), why: $(".m-why", f).value.trim() }));
    const orgs = [...dlg.querySelectorAll('[data-rep="orgs"]')].map(f => ({ organisation: $(".o-org", f).value.trim(), references: $(".o-ref", f).value.trim() }));
    const link = v("#p_link"), file = $("#p_file", dlg).files[0];
    if (link && !/^https?:\/\//i.test(link)) { err.append(notice("The link should start with https://")); return; }
    if (!link && !file) { err.append(notice("Give a link to the policy briefing, or attach it.")); return; }
    if (file && file.size > STORY_FILE_MAX) { err.append(notice("That attachment is over 3 MB: send a link instead, or a smaller file.")); return; }
    const kind = v("#p_kind") === "Other" ? v("#p_kindo") : v("#p_kind");
    const row = { pitched_name: S.profile?.full_name || S.user?.email || "", headline: head.value.trim(), other_1: v("#o1") || null, hook: v("#p_hook"), content: v("#p_content"), turn: v("#p_turn"), cta: v("#p_cta"), other_2: v("#o2") || null,
      media, other_3: v("#o3") || null, briefing_link: link || null, cost_estimate: v("#p_cost"), orgs_work: orgs, other_4: v("#o4") || null,
      set_piece: v("#p_set"), set_piece_kind: v("#p_set") === "yes" ? kind : null, set_piece_where: v("#p_set") === "yes" ? v("#p_where") : null, other_5: v("#o5") || null, pitched_by: S.user.id };
    if (file) { row.briefing_file_name = file.name; row.briefing_mime = file.type || "application/octet-stream"; row.briefing_size = file.size; row.briefing_data = await fileBase64(file); }
    btn.disabled = true;
    const { error } = await sb.from("story_pitches").insert(row);   // no .select(): a person who may only send pitches cannot read them back
    btn.disabled = false;
    if (error) { err.append(notice(error.message)); return; }
    close();
    renderStories(host, "Thank you: your pitch has been sent.");
  };
}
function fileBase64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(r.error); r.readAsDataURL(file); }); }
function downloadBase64(b64, name, mime) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function openStory(host, id) {
  const { data: s, error } = await sb.from("story_pitches").select("id,status,pitched_name,headline,other_1,hook,content,turn,cta,other_2,media,other_3,briefing_link,briefing_file_name,cost_estimate,orgs_work,other_4,set_piece,set_piece_kind,set_piece_where,other_5,notes,created_at,updated_at").eq("id", id).maybeSingle();
  if (error || !s) { host.prepend(notice(error ? error.message : "That pitch could not be found.")); return; }
  const w = can("stories", "write");
  const dlg = document.createElement("dialog"); dlg.className = "wide";
  const sec = (t, body, other) => `<h4>${esc(t)}</h4>${body}${other ? `<p class="muted small"><b>Other comments:</b> ${esc(other)}</p>` : ""}`;
  const dl = (k, v) => `<dt>${esc(k)}</dt><dd>${v ? esc(v) : '<span class="muted">—</span>'}</dd>`;
  const link = safeUrl(s.briefing_link);
  dlg.innerHTML = `<div class="pitch view"><h3>${esc(s.headline).replace(/\n/g, "<br>")}</h3><p class="muted small">From ${esc(s.pitched_name || "someone")} · sent ${esc(fmtShort(String(s.created_at).slice(0, 10)))}</p>
    ${sec("2. In a digital comms plan", `<dl>${dl("Hook", s.hook)}${dl("Content", s.content)}${dl("Turn", s.turn)}${dl("Call to action", s.cta)}</dl>`, s.other_2)}
    ${sec("3. Who might be interested", `<ul>${(s.media || []).map(m => `<li><b>${esc(m.organisation)}</b>: ${esc(m.name)} (${esc(m.details)}). ${esc(m.why)}</li>`).join("")}</ul>`, s.other_3)}
    ${sec("4. The policy briefing", `<dl><dt>Briefing</dt><dd>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(s.briefing_link)}</a>` : ""}${s.briefing_file_name ? ` <button class="btn sm" data-file>${esc(s.briefing_file_name)}</button>` : ""}</dd>${dl("Expected cost or saving", s.cost_estimate)}</dl>
      <ul>${(s.orgs_work || []).map(o => `<li><b>${esc(o.organisation)}</b>: ${esc(o.references)}</li>`).join("")}</ul>`, s.other_4)}
    ${sec("5. Set piece", `<dl>${dl("Appropriate?", SET_LABEL[s.set_piece])}${s.set_piece === "yes" ? dl("What", s.set_piece_kind) + dl("Where", s.set_piece_where) : ""}</dl>`, s.other_5)}
    ${s.other_1 ? `<p class="muted small"><b>Other comments (the story):</b> ${esc(s.other_1)}</p>` : ""}
    ${w ? `<h4>The team</h4><label>Status <select id="s_status">${STORY_STATUS.map(([k, l]) => `<option value="${k}" ${k === s.status ? "selected" : ""}>${l}</option>`).join("")}</select></label><label>Notes<textarea id="s_notes" rows="3">${esc(s.notes || "")}</textarea></label>` : ""}
    <div class="row">${w ? '<button class="btn primary" id="s_save">Save</button>' : ""}<button class="btn" id="cx">Close</button>${w ? '<button class="btn danger" id="s_del" style="margin-left:auto">Delete</button>' : ""}</div><div id="fe"></div></div>`;
  document.body.append(dlg); dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener("close", () => dlg.remove());
  $("#cx", dlg).onclick = close;
  const f = $("[data-file]", dlg);
  if (f) f.onclick = async () => { const { data: d, error: er } = await sb.from("story_pitches").select("briefing_data,briefing_mime").eq("id", id).maybeSingle(); if (er || !d) return $("#fe", dlg).replaceChildren(notice(er ? er.message : "Not found.")); downloadBase64(d.briefing_data, s.briefing_file_name, d.briefing_mime); };
  if (w) {
    $("#s_save", dlg).onclick = async () => { const er = await guardedUpdate("story_pitches", s, { status: $("#s_status", dlg).value, notes: $("#s_notes", dlg).value.trim() || null }); if (er) return $("#fe", dlg).replaceChildren(notice(er.message)); close(); renderStories(host); };
    $("#s_del", dlg).onclick = async () => { if (!confirm("Delete this pitch?")) return; const { error: er } = await sb.from("story_pitches").delete().eq("id", id); if (er) return $("#fe", dlg).replaceChildren(notice(er.message)); close(); renderStories(host); };
  }
}

/* ================================================================== POLICIES */
const POLICY_MAX = 6 * 1024 * 1024;
const POLICY_KINDS = /\.(pdf|docx|txt|md)$/i;
const markHtml = s => esc(s).replace(/&lt;mark&gt;/g, "<mark>").replace(/&lt;\/mark&gt;/g, "</mark>");
function loadScript(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = () => (window[global] ? res(window[global]) : rej(new Error(`${global} did not load.`))); s.onerror = () => rej(new Error(`Could not load ${global}.`)); document.head.appendChild(s); });
}
/** The text of an uploaded document, read in the browser (it is not sent anywhere to be read): { text, pages }. */
async function readDocument(file) {
  const name = file.name.toLowerCase();
  if (/\.(txt|md)$/.test(name)) return { text: await file.text(), pages: null };
  if (name.endsWith(".docx")) {
    const JSZip = await loadScript("../libby/vendor/jszip.min.js", "JSZip");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const xml = await zip.file("word/document.xml").async("string");
    const text = xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    return { text, pages: null };
  }
  const pdfjs = await loadScript("../libby/vendor/pdf.min.js", "pdfjsLib");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../libby/vendor/pdf.worker.min.js", location.href).href;
  let doc;
  try { doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; } catch (e) { throw new Error(/password/i.test(String(e && e.message)) ? "That PDF is password protected." : "That file could not be read as a PDF."); }
  const parts = [];
  for (let n = 1; n <= doc.numPages && n <= 400; n++) { const c = await (await doc.getPage(n)).getTextContent(); parts.push(c.items.map(it => it.str + (it.hasEOL ? "\n" : " ")).join("")); }
  return { text: parts.join("\n\n"), pages: doc.numPages };
}
/** Cut text into passages of about 1,000 characters (the unit that is searched and shown as the extract). */
function chunkText(text, size = 1000) {
  const paras = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").split(/\n\s*\n|\n(?=[A-Z0-9][^\n]{0,80}\n)/).map(p => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  const out = []; let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (const p of paras) {
    if (p.length > size * 1.4) { push(); for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size)); continue; }
    if ((cur + " " + p).length > size) push();
    cur += (cur ? " " : "") + p;
  }
  push();
  return out;
}

async function renderPolicyLibrary(host) {
  const w = can("policies", "write");
  const { data: docs, error } = await sb.from("policy_docs").select("id,title,theme,summary,file_name,mime,size_bytes,pages,chunk_count,created_at,updated_at").order("theme", { nullsFirst: false }).order("title");
  if (error) { host.append(notice(error.message)); return; }
  const themes = [...new Set(docs.map(d => d.theme).filter(Boolean))].sort();
  host.innerHTML = `<p class="muted">Policy documents${w ? " (you upload them here)" : ""}. Search for a word or phrase to find what our policy says, or browse by theme.</p>
    <form class="row" data-ps role="search"><input class="grow" type="search" name="q" placeholder='e.g. housing, "social rent", fares' value="${esc(commsState.policyQ)}" aria-label="Search the policy documents">
      <select name="theme" aria-label="Theme"><option value="">All themes</option>${themes.map(t => `<option ${t === commsState.policyTheme ? "selected" : ""}>${esc(t)}</option>`).join("")}</select><button class="btn primary" type="submit">Search</button></form>
    <div id="pol-results" aria-live="polite"></div>
    ${w ? '<h2 class="h2-rule">Upload a policy document</h2><div id="pol-upload"></div>' : ""}
    <h2 class="h2-rule" data-open>By theme</h2><div id="pol-browse"></div>`;
  const results = $("#pol-results", host);
  const search = async () => {
    const q = commsState.policyQ.trim();
    if (!q) { results.innerHTML = ""; return; }
    results.innerHTML = '<p class="muted">Searching…</p>';
    const { data, error: er } = await sb.rpc("search_policy_docs", { q, theme_filter: commsState.policyTheme || null, max_results: 40 });
    if (er) { results.innerHTML = ""; results.append(notice(er.message)); return; }
    results.innerHTML = data.length ? `<p class="muted small">${data.length} document${data.length === 1 ? "" : "s"}, best match first.</p><ol class="results">${data.map(r => `<li><a class="result" href="#" data-doc="${esc(r.doc_id)}"><blockquote class="extract">…${markHtml(r.extract_text)}…</blockquote><span class="result-title">${esc(r.title)}</span> <span class="muted small">${esc(r.theme || "")}${r.theme ? " · " : ""}${esc(r.file_name)}</span></a></li>`).join("")}</ol>`
      : `<div class="empty">No document mentions "${esc(q)}". Try fewer or broader words.</div>`;
  };
  const byTheme = new Map(); for (const d of docs) { const t = d.theme || "No theme"; if (!byTheme.has(t)) byTheme.set(t, []); byTheme.get(t).push(d); }
  $("#pol-browse", host).innerHTML = docs.length ? [...byTheme.entries()].map(([t, l]) => `<h3 class="h3-section">${esc(t)} <span class="muted small">${l.length}</span></h3><ul class="plain">${l.map(d => `<li><a href="#" data-doc="${esc(d.id)}">${esc(d.title)}</a> <span class="muted small">${esc(d.file_name)}${d.pages ? ` · ${d.pages} pages` : ""}${d.chunk_count ? "" : " · no text found: cannot be searched"}</span>${w ? ` <button class="btn sm" data-edit="${esc(d.id)}">Edit</button>` : ""}</li>`).join("")}</ul>`).join("")
    : `<div class="empty">${w ? "No documents yet. Upload one above." : "No documents have been uploaded yet."}</div>`;
  $("[data-ps]", host).onsubmit = e => { e.preventDefault(); commsState.policyQ = e.target.elements.q.value; commsState.policyTheme = e.target.elements.theme.value; search(); };
  host.onclick = async e => {
    const o = e.target.closest("[data-doc]"); if (o) { e.preventDefault(); return openPolicyFile(host, o.dataset.doc, docs); }
    const ed = e.target.closest("[data-edit]");
    if (ed) { const d = docs.find(x => x.id === ed.dataset.edit);
      openForm({ title: d.title, fields: [T("title", "Title", "text", { req: true }), T("theme", "Theme", "text", { list: themes }), T("summary", "Note", "textarea")], values: d, meta: edited(d),
        onSubmit: async v => { const er = await guardedUpdate("policy_docs", d, v); if (!er || er.message === CONFLICT) renderPolicyLibrary(host); return er; },
        onDelete: async () => { const { error: er } = await sb.from("policy_docs").delete().eq("id", d.id); if (!er) renderPolicyLibrary(host); return er; } }); }
  };
  if (commsState.policyQ) search();
  if (w) policyUpload($("#pol-upload", host), themes, () => renderPolicyLibrary(host));
}
async function openPolicyFile(host, id, docs) {
  const d = docs.find(x => x.id === id);
  const { data, error } = await sb.from("policy_doc_files").select("data").eq("doc_id", id).maybeSingle();
  if (error || !data) { host.prepend(notice(error ? error.message : "That file could not be found.")); return; }
  downloadBase64(data.data, d.file_name, d.mime);
}
function policyUpload(box, themes, after) {
  box.innerHTML = `<form class="pol-form" data-up><label>Document (PDF, Word .docx or text, up to 6 MB)<input type="file" name="file" accept=".pdf,.docx,.txt,.md" required></label>
    <label>Title<input name="title" maxlength="300" required placeholder="e.g. Housing policy paper 2026"></label>
    <label>Theme<input name="theme" list="pol-themes" maxlength="120" placeholder="e.g. Housing"><datalist id="pol-themes">${themes.map(t => `<option value="${esc(t)}">`).join("")}</datalist></label>
    <label>Note (optional)<textarea name="summary" rows="2" maxlength="600"></textarea></label>
    <div class="row"><button class="btn primary" type="submit">Upload</button><span class="muted small" data-upmsg aria-live="polite"></span></div></form>`;
  const form = $("[data-up]", box), msg = $("[data-upmsg]", box), fileIn = form.elements.file;
  fileIn.onchange = () => { const f = fileIn.files[0]; if (f && !form.elements.title.value) form.elements.title.value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "); };
  form.onsubmit = async e => {
    e.preventDefault();
    const f = fileIn.files[0]; if (!f) return;
    if (!POLICY_KINDS.test(f.name)) { msg.textContent = "Use a PDF, a Word .docx file or a text file."; return; }
    if (f.size > POLICY_MAX) { msg.textContent = "That file is over 6 MB."; return; }
    const btn = $("button[type=submit]", form); btn.disabled = true;
    try {
      msg.textContent = "Reading the document…";
      const { text, pages } = await readDocument(f);
      const chunks = chunkText(text);
      msg.textContent = chunks.length ? `Found ${chunks.length} passages. Saving…` : "No text found in it (is it a scan?). Saving it so it can be downloaded, but it cannot be searched.";
      const { data: doc, error } = await sb.from("policy_docs").insert({ title: form.elements.title.value.trim(), theme: form.elements.theme.value.trim() || null, summary: form.elements.summary.value.trim() || null,
        file_name: f.name, mime: f.type || "application/octet-stream", size_bytes: f.size, pages, chunk_count: chunks.length }).select("id").single();
      if (error) throw error;
      const fe = (await sb.from("policy_doc_files").insert({ doc_id: doc.id, data: await fileBase64(f) })).error;
      if (fe) { await sb.from("policy_docs").delete().eq("id", doc.id); throw fe; }
      for (let i = 0; i < chunks.length; i += 150) {
        const ce = (await sb.from("policy_doc_chunks").insert(chunks.slice(i, i + 150).map((content, k) => ({ doc_id: doc.id, n: i + k, content })))).error;
        if (ce) { await sb.from("policy_docs").delete().eq("id", doc.id); throw ce; }
        msg.textContent = `Saving… ${Math.min(i + 150, chunks.length)} of ${chunks.length} passages`;
      }
      after();
    } catch (er) { msg.textContent = er.message || String(er); btn.disabled = false; }
  };
}
