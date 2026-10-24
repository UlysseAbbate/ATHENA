// The Whips page (Whips and above): #/whips, #/whips/duty, #/whips/availability, #/whips/hymn-sheets
//   Duty Whips             a calendar with two Whips a day, chosen by Staff and Admin
//   Availability           a calendar where each Whip marks days green (prefer), amber (no preference) or red (not free).
//                          The names are the people given the Whip role on the Roles page. Whips and above only (pages.js).
//   Hymn Sheets            uploaded by Staff and Admin, downloaded by the Whips
import { api } from '../api.js';
import { esc, peer, fmtDate, fmtShort, todayIso, addDays, loading, errorBox, empty, pageHeader } from '../ui.js';
import { hasLevel, authFieldsHtml, readAuth, rememberAuth, savedName } from '../session.js';
import { loadWhips, surnameKey } from '../peer-list.js';

const WEEKS = 5; // weeks shown at a time, Monday to Friday
const crumbs = [['#/whips', 'Whips']];

/* ------------------------------------------------------------------ shared */

const SUBPAGES = [['duty', 'Duty Whips'], ['availability', 'Availability for Whipping'], ['hymn-sheets', 'Hymn Sheets']];

function subButtons(current) {
  return `<nav class="whips-buttons" aria-label="Whips sections">${SUBPAGES.map(([k, label]) =>
    `<a class="button ${k === current ? '' : 'button-quiet'}" href="#/whips/${k}" ${k === current ? 'aria-current="true"' : ''}>${esc(label)}</a>`).join('')}</nav>`;
}

function mondayOf(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}
const rangeFrom = (query) => mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : todayIso());

/** Five weeks, Monday to Friday, laid out like the Future calendar. cellHtml(date) draws one day. */
function weeksGrid(from, cellHtml) {
  const today = todayIso();
  const rows = [];
  for (let w = 0; w < WEEKS; w++) {
    rows.push(`<div class="cal-row" role="row">${[0, 1, 2, 3, 4].map((i) => cellHtml(addDays(from, w * 7 + i), today)).join('')}</div>`);
  }
  return `<div class="cal" role="table" aria-label="Calendar">
    <div class="cal-row cal-headrow" role="row">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => `<div role="columnheader">${d}</div>`).join('')}</div>${rows.join('')}</div>`;
}

function calNav(sub, from) {
  const last = addDays(from, WEEKS * 7 - 3);
  const fmt = (d) => fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
  return `<nav class="cal-nav" aria-label="Move the calendar">
    <a class="button button-quiet" href="#/whips/${sub}?from=${addDays(from, -WEEKS * 7)}">Earlier</a>
    <a class="button button-quiet" href="#/whips/${sub}">This week</a>
    <a class="button button-quiet" href="#/whips/${sub}?from=${addDays(from, WEEKS * 7)}">Later</a>
    <span class="small muted">${esc(fmt(from))} to ${esc(fmt(last))}</span></nav>`;
}

const STATUS_LABEL = { green: 'Prefer to be duty whip', amber: 'No preference', red: 'Not free' };
const legendHtml = () => `<p class="avail-legend" aria-label="Key">${['green', 'amber', 'red'].map((s) => `<span class="avail-${s}"><i class="avail-dot"></i>${esc(STATUS_LABEL[s])}</span>`).join('')}</p>`;

/** { date: { whip: status } } from the list the server sends. */
function availabilityMap(entries) {
  const m = {};
  for (const e of entries || []) (m[e.date] ||= {})[e.whip] = e.status;
  return m;
}

/* ------------------------------------------------------------------ landing */

function landing(el) {
  el.innerHTML = `${pageHeader('Whips', 'The duty rota, who is available to whip, and the hymn sheets.')}
    <nav class="index index-small" aria-label="Whips sections">
      <a class="index-row" href="#/whips/duty"><span class="index-title"><span class="swipe">Duty Whips</span></span>
        <span class="index-text">Which two Whips are on duty each day.</span></a>
      <a class="index-row" href="#/whips/availability"><span class="index-title"><span class="swipe">Availability for Whipping</span></span>
        <span class="index-text">Mark the days you would prefer to be duty whip, have no preference, or are not free.</span></a>
      <a class="index-row" href="#/whips/hymn-sheets"><span class="index-title"><span class="swipe">Hymn Sheets</span></span>
        <span class="index-text">The hymn sheets prepared by the advisers, to download.</span></a>
    </nav>`;
}

/* ------------------------------------------------------------------ Duty Whips */

async function dutyPage(el, query) {
  const from = rangeFrom(query);
  const admin = hasLevel('staff'); // Staff and Admin choose the rota
  el.innerHTML = `${pageHeader('Duty Whips', admin
      ? 'Two Whips for each day. Choose from the lists: each Whip is grouped by the availability they have given for that day.'
      : 'The two Whips on duty each day, chosen by Staff.', crumbs)}
    ${subButtons('duty')}${calNav('duty', from)}
    <p class="small" data-status aria-live="polite"></p>
    <div id="cal">${loading('Loading the rota')}</div>`;
  const box = el.querySelector('#cal');
  const status = el.querySelector('[data-status]');

  let duty; let avail; let whips = { names: [], assigned: true };
  try {
    [duty, avail, whips] = await Promise.all([
      api(`duty-whips?from=${from}&days=${WEEKS * 7}`),
      api(`whip-availability?from=${from}&days=${WEEKS * 7}`).catch(() => ({ entries: [] })),
      admin ? loadWhips() : Promise.resolve({ names: [], assigned: true }),
    ]);
  } catch (err) { box.innerHTML = errorBox(err); return; }
  if (!box.isConnected) return;
  const rota = duty.duty || {};
  const peers = whips.names;
  const availability = availabilityMap(avail.entries);

  const optionsFor = (date, current) => {
    const groups = { green: [], amber: [], red: [], none: [] };
    const known = new Set(peers);
    for (const name of [...peers, ...(current && !known.has(current) ? [current] : [])]) groups[availability[date]?.[name] || 'none'].push(name);
    const titles = { green: STATUS_LABEL.green, amber: STATUS_LABEL.amber, red: STATUS_LABEL.red, none: 'No availability given' };
    return `<option value="">Not yet chosen</option>${['green', 'amber', 'red', 'none'].filter((k) => groups[k].length).map((k) =>
      `<optgroup label="${esc(titles[k])}">${groups[k].map((n) => `<option value="${esc(n)}" ${n === current ? 'selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('')}`;
  };
  const slotHtml = (date, i) => {
    const name = (rota[date] || [])[i] || '';
    if (!admin) return `<p class="duty-slot"><span>Whip ${i + 1}</span>${name ? `<strong>${peer(name, true)}</strong>` : '<em class="muted">Not yet chosen</em>'}</p>`;
    const control = peers.length
      ? `<select data-slot="${i + 1}" aria-label="Whip ${i + 1} on ${esc(fmtShort(date))}">${optionsFor(date, name)}</select>`
      : `<input type="text" data-slot="${i + 1}" value="${esc(name)}" maxlength="80" aria-label="Whip ${i + 1} on ${esc(fmtShort(date))}">`;
    return `<label class="duty-slot"><span>Whip ${i + 1}</span>${control}</label>`;
  };

  box.innerHTML = `${weeksGrid(from, (date, today) =>
    `<div class="cal-cell duty-cell ${date === today ? 'is-today' : ''}" role="cell" data-date="${date}">
      <span class="cal-date">${esc(fmtShort(date))}</span>${slotHtml(date, 0)}${slotHtml(date, 1)}</div>`)}
    <p class="small muted">${admin ? 'Changes save as soon as you choose.' : 'Only Staff can change the rota.'}${admin && !whips.assigned ? ' No one has been given the Whip role yet, so every Lib Dem peer is listed: an Admin can choose the Whips on the Roles page.' : ''}</p>`;

  if (!admin) return;
  box.addEventListener('change', async (e) => {
    const field = e.target.closest('[data-slot]');
    const cell = e.target.closest('[data-date]');
    if (!field || !cell) return;
    const date = cell.dataset.date;
    const slot = Number(field.dataset.slot);
    const whip = field.value.trim();
    const before = (rota[date] || ['', ''])[slot - 1] || '';
    status.textContent = 'Saving\u2026';
    try {
      await api('duty-whips', { method: 'POST', body: JSON.stringify({ date, slot, whip, author: savedName() }) });
      (rota[date] ||= ['', ''])[slot - 1] = whip;
      status.textContent = `Saved: ${fmtShort(date)}, Whip ${slot}.`;
    } catch (err) {
      field.value = before; // put the box back to what is actually saved
      status.textContent = err.message;
    }
  });
}

/* ------------------------------------------------------------------ Availability */

const NAME_KEY = 'whipAvailabilityName';
const remembered = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const remember = (n) => { try { localStorage.setItem(NAME_KEY, n); } catch { /* not remembered */ } };

async function availabilityPage(el, query) {
  const from = rangeFrom(query);
  el.innerHTML = `${pageHeader('Availability for Whipping', 'Choose your name, then mark each day: green to prefer being duty whip, amber for no preference, red if you are not free.', crumbs)}
    ${subButtons('availability')}
    <div class="search"><label class="field field-narrow"><span>Your name</span><select name="who" data-who></select></label></div>
    ${legendHtml()}${calNav('availability', from)}
    <p class="small" data-status aria-live="polite"></p>
    <div id="cal">${loading('Loading availability')}</div>`;
  const box = el.querySelector('#cal');
  const status = el.querySelector('[data-status]');
  const select = el.querySelector('[data-who]');

  let data; let whips;
  try {
    [data, whips] = await Promise.all([api(`whip-availability?from=${from}&days=${WEEKS * 7}`), loadWhips()]);
  } catch (err) { box.innerHTML = errorBox(err); return; }
  if (!box.isConnected) return;
  // Only the Whips are listed, and only their availability is shown (everyone, if no one has been given the Whip role yet).
  const peers = whips.names;
  const listed = new Set(peers);
  const map = availabilityMap(data.entries.filter((e) => !whips.assigned || listed.has(e.whip)));
  let who = remembered();
  if (who && !listed.has(who)) who = ''; // a name from before the Whips were chosen
  el.querySelector('.search').insertAdjacentHTML('afterend', whips.assigned ? '' : '<p class="small muted">No one has been given the Whip role yet, so every Lib Dem peer is listed. An Admin can choose the Whips on the Roles page.</p>');
  select.innerHTML = `<option value="">Choose your name\u2026</option>${peers.map((n) => `<option value="${esc(n)}" ${n === who ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;

  const ORDER = { green: 0, amber: 1, red: 2 };
  const dates = [];
  for (let w = 0; w < WEEKS; w++) for (let i = 0; i < 5; i++) dates.push(addDays(from, w * 7 + i));

  const cell = (date, today) => {
    const mine = who ? map[date]?.[who] : '';
    const people = Object.entries(map[date] || {}).sort((a, b) => ORDER[a[1]] - ORDER[b[1]] || surnameKey(a[0]).localeCompare(surnameKey(b[0])));
    const buttons = who ? `<div class="avail-set" role="group" aria-label="Your availability on ${esc(fmtShort(date))}">${[['green', 'Prefer'], ['amber', 'No pref.'], ['red', 'Not free']].map(([s, label]) =>
      `<button type="button" class="avail-btn avail-${s}" data-status="${s}" aria-pressed="${mine === s}" title="${esc(STATUS_LABEL[s])}">${label}</button>`).join('')}</div>` : '';
    return `<div class="cal-cell ${date === today ? 'is-today' : ''}" role="cell" data-date="${date}">
      <span class="cal-date">${esc(fmtShort(date))}</span>${buttons}
      <ul class="avail-list">${people.map(([name, s]) => `<li class="avail-item avail-${s}" title="${esc(STATUS_LABEL[s])}"><i class="avail-dot"></i><span>${esc(name)}${name === who ? ' (you)' : ''}</span></li>`).join('')}</ul></div>`;
  };
  const draw = () => {
    box.innerHTML = `${who ? `<p class="avail-bulk">Set every day shown to:
      ${[['green', 'Prefer'], ['amber', 'No preference'], ['red', 'Not free'], ['clear', 'Clear']].map(([s, label]) => `<button type="button" class="button button-quiet" data-bulk="${s}">${label}</button>`).join('')}</p>`
      : '<p class="state">Choose your name above to mark your own availability. The calendar already shows everyone\u2019s.</p>'}
      ${weeksGrid(from, cell)}`;
  };
  draw();

  const save = async (entries, doneText) => {
    const before = entries.map((e) => [e.date, map[e.date]?.[who]]);
    for (const e of entries) { // show the change straight away
      if (e.status) (map[e.date] ||= {})[who] = e.status; else if (map[e.date]) delete map[e.date][who];
    }
    draw();
    status.textContent = 'Saving\u2026';
    try {
      await api('whip-availability', { method: 'POST', body: JSON.stringify({ whip: who, entries }) });
      status.textContent = doneText;
    } catch (err) {
      for (const [date, old] of before) { if (old) (map[date] ||= {})[who] = old; else if (map[date]) delete map[date][who]; }
      draw();
      status.textContent = err.message;
    }
  };

  select.addEventListener('change', () => { who = select.value; remember(who); status.textContent = ''; draw(); });
  box.addEventListener('click', (e) => {
    if (!who) return;
    const btn = e.target.closest('[data-status]');
    const bulk = e.target.closest('[data-bulk]');
    if (btn) {
      const date = btn.closest('[data-date]').dataset.date;
      const next = map[date]?.[who] === btn.dataset.status ? null : btn.dataset.status; // pressing the chosen colour again clears it
      save([{ date, status: next }], next ? `Saved: ${fmtShort(date)} is ${STATUS_LABEL[next].toLowerCase()}.` : `Cleared ${fmtShort(date)}.`);
    } else if (bulk) {
      const s = bulk.dataset.bulk === 'clear' ? null : bulk.dataset.bulk;
      const what = s ? `"${STATUS_LABEL[s]}"` : 'blank';
      if (!window.confirm(`Set all ${dates.length} days shown (${fmtShort(dates[0])} to ${fmtShort(dates[dates.length - 1])}) to ${what} for ${who}?`)) return;
      save(dates.map((date) => ({ date, status: s })), `Saved all ${dates.length} days.`);
    }
  });
}

/* ------------------------------------------------------------------ Hymn Sheets */

const STAGES = ['Report Stage', 'Ping Pong', 'Committee Stage', 'Third Reading', 'Other'];
const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function sheetHtml(s, admin) {
  const meta = [s.stage, s.day_number ? `Day ${s.day_number}` : '', s.sitting_date ? `sitting ${fmtDate(s.sitting_date, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''].filter(Boolean).join(' \u00b7 ');
  return `<li class="record" data-id="${esc(s.id)}">
    <p class="record-title"><a href="/api/libby/hymn-sheets?id=${esc(s.id)}&download=1">${esc(s.title)}</a></p>
    <p class="hymn-meta">${esc(meta)}${meta ? ' \u00b7 ' : ''}${esc(s.file_name)} (${esc(size(s.size_bytes || 0))}) \u00b7 uploaded ${esc(fmtDate(s.uploaded_at, { day: 'numeric', month: 'short', year: 'numeric' }))}${s.uploaded_by ? ` by ${esc(s.uploaded_by)}` : ''}</p>
    ${admin ? '<p><button type="button" class="button button-quiet" data-delete>Delete</button></p>' : ''}</li>`;
}

async function hymnPage(el) {
  const admin = hasLevel('staff'); // Staff and Admin upload and delete
  el.innerHTML = `${pageHeader('Hymn Sheets', admin ? 'Upload the hymn sheets for the Whips to download.' : 'The hymn sheets prepared by Staff.', crumbs)}
    ${subButtons('hymn-sheets')}<div id="hymns">${loading('Loading the hymn sheets')}</div>`;
  const box = el.querySelector('#hymns');
  let sheets; let bills = null;
  try {
    [{ sheets }, bills] = await Promise.all([api('hymn-sheets'), admin ? api('bills').catch(() => null) : Promise.resolve(null)]);
  } catch (err) { box.innerHTML = errorBox(err); return; }
  if (!box.isConnected) return;

  const billList = bills ? [...bills.government, ...bills.privateMembers, ...bills.other].sort((a, b) => a.title.localeCompare(b.title)) : [];
  const uploadForm = admin ? `<details class="hymn-upload" ${sheets.length ? '' : 'open'}><summary class="h2-rule" style="cursor:pointer">Upload a hymn sheet</summary>
    <form class="hymn-form" data-upload>
      <div class="row">
        <label class="field"><span>Bill</span><select name="bill"><option value="">Other (not tied to a Bill)</option>${billList.map((b) => `<option value="${esc(b.id)}">${esc(b.title)}</option>`).join('')}</select></label>
        <label class="field field-narrow"><span>Stage</span><select name="stage">${STAGES.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>
      </div>
      <div class="row">
        <label class="field field-narrow"><span>Day (optional)</span><input type="number" name="day" min="1" max="20" placeholder="e.g. 2"></label>
        <label class="field field-narrow"><span>Sitting date (optional)</span><input type="date" name="sittingDate"></label>
      </div>
      <label class="field"><span>Title (optional: made from the Bill, stage and day if left blank)</span><input type="text" name="title" maxlength="200"></label>
      <label class="field"><span>File (Word or PDF, up to 4 MB)</span><input type="file" name="file" accept=".docx,.doc,.pdf" required></label>
      <div class="row">${authFieldsHtml()}</div>
      <p><button class="button" type="submit">Upload</button> <span class="small" data-upload-status aria-live="polite"></span></p>
    </form></details>` : '';

  const draw = (filter = '') => {
    const q = filter.trim().toLowerCase();
    const shown = sheets.filter((s) => !q || `${s.title} ${s.bill_title || ''} ${s.stage || ''}`.toLowerCase().includes(q));
    const groups = new Map();
    for (const s of shown) { const k = s.bill_title || 'Other'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
    const list = box.querySelector('[data-list]');
    list.innerHTML = shown.length
      ? [...groups.entries()].sort(([a], [b]) => (a === 'Other') - (b === 'Other') || a.localeCompare(b)).map(([bill, items]) =>
        `<section class="hymn-group"><h3>${esc(bill)}</h3><ul class="records">${items.map((s) => sheetHtml(s, admin)).join('')}</ul></section>`).join('')
      : empty(sheets.length ? 'No hymn sheets match.' : 'No hymn sheets have been uploaded yet.');
  };
  box.innerHTML = `${uploadForm}
    ${sheets.length ? '<label class="field field-narrow"><span>Filter</span><input type="search" data-filter placeholder="Bill or stage"></label>' : ''}
    <div data-list></div>`;
  draw();
  box.querySelector('[data-filter]')?.addEventListener('input', (e) => draw(e.target.value));
  if (!admin) return;

  const form = box.querySelector('[data-upload]');
  const upStatus = box.querySelector('[data-upload-status]');
  const field = (name) => form.elements.namedItem(name); // not form.title and the like: a form has built-in properties with some of these names
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = field('file').files[0];
    if (!file) { upStatus.textContent = 'Choose a file first.'; return; }
    if (file.size > 4 * 1024 * 1024) { upStatus.textContent = 'That file is over 4 MB. Save it as a smaller file and try again.'; return; }
    const { author } = readAuth(form);
    const fd = new FormData();
    fd.set('file', file);
    fd.set('billId', field('bill').value);
    fd.set('billTitle', field('bill').value ? field('bill').options[field('bill').selectedIndex].text : '');
    fd.set('stage', field('stage').value);
    fd.set('day', field('day').value);
    fd.set('sittingDate', field('sittingDate').value);
    fd.set('title', field('title').value);
    fd.set('author', author);
    upStatus.textContent = 'Uploading\u2026';
    try {
      const res = await fetch('/api/libby/hymn-sheets', { method: 'POST', body: fd });
      const out = await res.json().catch(() => ({}));
      if (res.status === 401 && out.login) { location.reload(); return; }
      if (!res.ok) throw new Error(out.error || `The server returned ${res.status}.`);
      rememberAuth('', author);
      upStatus.textContent = `Uploaded: ${out.title}`;
      ({ sheets } = await api('hymn-sheets'));
      form.reset();
      draw(box.querySelector('[data-filter]')?.value || '');
    } catch (err) { upStatus.textContent = err.message; }
  });
  box.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-delete]');
    if (!del) return;
    const id = Number(del.closest('[data-id]').dataset.id);
    const sheet = sheets.find((s) => s.id === id);
    if (!window.confirm(`Delete "${sheet?.title || 'this hymn sheet'}"? This cannot be undone.`)) return;
    try {
      await api('hymn-sheets', { method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
      sheets = sheets.filter((s) => s.id !== id);
      draw(box.querySelector('[data-filter]')?.value || '');
    } catch (err) { upStatus.textContent = err.message; }
  });
}

/* ------------------------------------------------------------------ Router entry */

export async function renderWhips(el, { sub }, query) {
  if (sub === 'duty') return dutyPage(el, query);
  if (sub === 'availability') return availabilityPage(el, query);
  if (sub === 'hymn-sheets') return hymnPage(el);
  return landing(el);
}
