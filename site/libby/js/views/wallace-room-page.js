// The Wallace Room (#/wallace-room) and Room 391 (#/room-391): the same booking calendar for each room, by week or by month, in 30-minute slots.
// Everyone signed in can book the room (a booking can repeat). The Whips and above see who booked and why; everyone else sees only "Booked" on other people's
// bookings (and their own in full), and can ask for a slot with a message: the booker is told in the "Requests" box on this page and answers there.
// People in a team with the booker (set up by Staff on the Teams page) also see it in full, but can only look. A booking can be set in stone: nobody can then ask for it, but the booker and the Whips can still change it.
// The rules (opening hours, limits, how a repeat becomes dates) are in public/js/wallace-rules.js, shared with the server.
import { api } from '../api.js';
import { esc, fmtDate, fmtShort, todayIso, loading, errorBox, pageHeader } from '../ui.js';
import { hasLevel, savedName } from '../session.js';
import { loadPeers } from '../peer-list.js';
import {
  ROOM_NAME, WEEKDAYS, OPEN_MINUTES, SLOT_MINUTES, MAX_BOOKINGS_PER_SERIES, MAX_NOTE_LENGTH,
  slotStarts, endTimesAfter, toMinutes, toTime, expandRecurrence, describeRepeat,
  mondayOf, isoAddDays, addMonths, monthStart, weekdayOf, isIso,
} from '../wallace-rules.js';

const NAME_KEY = 'wallaceRoomName';
const WEEKENDS_KEY = 'wallaceRoomWeekends';
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } },
};

/** The same person always gets the same colour, so a booking can be spotted at a glance. */
const hue = (name) => { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const range = (a, b) => `${a}\u2013${b}`;

/** London's current time of day in minutes, for greying out slots that have passed today. */
function nowMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === 'hour').value) * 60 + Number(parts.find((p) => p.type === 'minute').value);
}

async function post(body) {
  const res = await fetch('/api/libby/room-bookings', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.login) { location.reload(); return new Promise(() => {}); }
  return { ok: res.ok, status: res.status, data };
}

/* ------------------------------------------------------------------ the page */

const ROOMS = { wallace: { name: ROOM_NAME, path: 'wallace-room' }, '391': { name: 'Room 391', path: 'room-391' } };

export async function renderWallaceRoom(el, { room = 'wallace' } = {}, query) {
  const R = ROOMS[room] || ROOMS.wallace;
  const view = query.view === 'month' ? 'month' : 'week';
  const anchor = isIso(query.from) ? query.from : todayIso();
  const today = todayIso();

  // the period shown, and the dates the data is wanted for
  const first = monthStart(anchor);
  const from = view === 'month' ? mondayOf(first) : mondayOf(anchor);
  const lastOfMonth = isoAddDays(addMonths(first, 1), -1);
  const to = view === 'month' ? isoAddDays(lastOfMonth, 6 - weekdayOf(lastOfMonth)) : isoAddDays(from, 6);

  const link = (v, d) => `#/${R.path}?view=${v}&from=${d}`;
  const prev = view === 'month' ? addMonths(first, -1) : isoAddDays(from, -7);
  const next = view === 'month' ? addMonths(first, 1) : isoAddDays(from, 7);
  const period = view === 'month'
    ? fmtDate(first, { month: 'long', year: 'numeric' })
    : `${fmtDate(from, { day: 'numeric', month: 'short' })} to ${fmtDate(isoAddDays(from, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`;

  el.innerHTML = `${pageHeader(R.name, hasLevel('whips') ? 'See who has the room and when. Choose your name, then book a free slot: once, or on a repeat.' : 'See when the room is free. Choose your name, then book a free slot: once, or on a repeat. Other people\u2019s bookings show only as \u201CBooked\u201D: click one to ask for it, with a message. Your own bookings show in full.')}
    <div id="room-root">
      <div id="room-inbox" aria-live="polite"></div>
      <div class="room-controls">
        <div class="toggle" role="group" aria-label="Show the calendar by">
          <a href="${link('week', anchor)}" ${view === 'week' ? 'aria-current="true"' : ''}>Week</a>
          <a href="${link('month', anchor)}" ${view === 'month' ? 'aria-current="true"' : ''}>Month</a>
        </div>
        <nav class="room-nav" aria-label="Move the calendar">
          <a class="button button-quiet" href="${link(view, prev)}">Earlier</a>
          <a class="button button-quiet" href="#/${R.path}?view=${view}">Today</a>
          <a class="button button-quiet" href="${link(view, next)}">Later</a>
          <strong class="room-period">${esc(period)}</strong>
        </nav>
        <label class="room-weekends"><input type="checkbox" data-weekends> Show weekends</label>
      </div>
      <div class="room-who">
        <label class="field field-narrow"><span>Book as</span><select data-who></select></label>
        <button type="button" class="button" data-new>Book the room</button>
      </div>
      <p class="small" data-status aria-live="polite"></p>
      <p class="small muted" data-teamnote hidden></p>
      <div id="room-panel" aria-live="polite"></div>
      <div id="room-cal">${loading('Loading the bookings')}</div>
      <p class="small muted">Times are in 30-minute slots, ${esc(toTime(OPEN_MINUTES))} to 21:00. A booking can be changed or cancelled by the account that made it, or by the Whips and above.</p>
    </div>`;
  const root = el.querySelector('#room-root'); // handlers go on this, which is rebuilt on every visit (the page container is reused)
  const cal = root.querySelector('#room-cal');
  const panel = root.querySelector('#room-panel');
  const status = root.querySelector('[data-status]');
  const whoSelect = root.querySelector('[data-who]');
  const weekendsBox = root.querySelector('[data-weekends]');

  let data; let peers = [];
  try {
    [data, peers] = await Promise.all([api(`room-bookings?room=${room}&from=${from}&to=${to}`), loadPeers().catch(() => [])]);
  } catch (err) { cal.innerHTML = errorBox(err); return; }
  if (!root.isConnected) return;
  const teamNote = root.querySelector('[data-teamnote]');
  if ((data.teams || []).length) { teamNote.hidden = false; teamNote.textContent = `You can see in full the bookings made by people in your team${data.teams.length === 1 ? '' : 's'} (${data.teams.join(', ')}); you cannot change them.`; }
  let bookings = data.bookings || [];
  let series = data.series || {};
  const whipsView = hasLevel('whips');   // who booked, and the notes, are for the Whips and above (the server sends nobody else those)
  let inbox = { incoming: [], outgoing: [] };
  const inboxEl = root.querySelector('#room-inbox');

  let who = store.get(NAME_KEY);
  if (who && !peers.includes(who)) peers = [...peers, who];
  whoSelect.innerHTML = `<option value="">Choose your name\u2026</option>${peers.map((n) => `<option value="${esc(n)}" ${n === who ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;
  let weekends = store.get(WEEKENDS_KEY) === '1';
  weekendsBox.checked = weekends;
  let openDetail = null; // the id of the booking whose details are showing

  const reload = async () => {
    const d = await api(`room-bookings?room=${room}&from=${from}&to=${to}`);
    bookings = d.bookings || [];
    series = d.series || {};
    await loadInbox();
  };
  const byDate = () => {
    const m = {};
    for (const b of bookings) (m[b.date] ||= []).push(b);
    for (const list of Object.values(m)) list.sort((a, b) => a.start.localeCompare(b.start));
    return m;
  };

  /** What a booking is called in hover text: the Whips and the owner get the name and note, everyone else just that it is booked. */
  const label = (b) => (b.visible ? `${b.peer}, ${range(b.start, b.end)}${b.note ? `, ${b.note}` : ''}${b.locked ? ' (set in stone)' : ''}${b.team ? ' (your team)' : ''}` : `Booked, ${range(b.start, b.end)}${b.locked ? ' (fixed: cannot be requested)' : ' (click to ask for it)'}`);

  /* ---------------------------------------------------------------- week view */
  const weekHtml = () => {
    const dates = [];
    for (let i = 0; i < (weekends ? 7 : 5); i++) dates.push(isoAddDays(from, i));
    const slots = slotStarts();
    const now = nowMinutes();
    const taken = new Set();
    const blocks = [];
    let hidden = 0;
    for (const b of bookings) {
      const col = dates.indexOf(b.date);
      if (col < 0) { hidden++; continue; }
      const r1 = Math.max(0, (toMinutes(b.start) - OPEN_MINUTES) / SLOT_MINUTES);
      const r2 = Math.min(slots.length, (toMinutes(b.end) - OPEN_MINUTES) / SLOT_MINUTES);
      for (let r = r1; r < r2; r++) taken.add(`${b.date}|${r}`);
      const text = label(b);
      blocks.push(`<button type="button" class="room-booking ${b.mine ? 'room-mine' : ''}" data-booking="${b.id}" style="grid-column:${col + 2};grid-row:${r1 + 2} / ${r2 + 2};--h:${b.visible ? hue(b.peer) : 210}" title="${esc(text)}" aria-label="${esc(text)}. Show details.">
        <span class="room-b-time">${esc(range(b.start, b.end))}</span><span class="room-b-name">${esc(b.visible ? b.peer : b.requested ? 'Booked (you asked)' : 'Booked')}${b.locked ? ' \u00B7 fixed' : ''}</span>${b.visible && b.note ? `<span class="room-b-note">${esc(b.note)}</span>` : ''}</button>`);
    }
    const head = dates.map((d, i) => `<div class="room-dayhead ${d === today ? 'is-today' : ''}" style="grid-column:${i + 2};grid-row:1">${esc(fmtShort(d))}</div>`).join('');
    const times = slots.map((t, r) => `<div class="room-time" style="grid-column:1;grid-row:${r + 2}">${t.endsWith(':00') ? esc(t) : ''}</div>`).join('');
    const cells = [];
    dates.forEach((d, c) => slots.forEach((t, r) => {
      if (taken.has(`${d}|${r}`)) return;
      const past = d < today || (d === today && toMinutes(t) < now);
      const pos = `grid-column:${c + 2};grid-row:${r + 2}`;
      cells.push(past
        ? `<div class="room-free room-past ${t.endsWith(':30') ? 'half' : ''}" style="${pos}"></div>`
        : `<button type="button" class="room-free ${t.endsWith(':30') ? 'half' : ''}" data-date="${d}" data-time="${t}" style="${pos}" aria-label="Book ${esc(fmtShort(d))} at ${t}"></button>`);
    }));
    return `<div class="room-scroll"><div class="room-week" style="--cols:${dates.length};--rows:${slots.length}">
      <div class="room-corner"></div>${head}${times}${cells.join('')}${blocks.join('')}</div></div>
      ${hidden ? `<p class="small muted">${hidden} booking${hidden === 1 ? '' : 's'} at the weekend ${hidden === 1 ? 'is' : 'are'} hidden: tick "Show weekends" to see ${hidden === 1 ? 'it' : 'them'}.</p>` : ''}
      ${bookings.length ? '' : '<p class="small muted">Nothing is booked this week yet. Click a slot to book it.</p>'}`;
  };

  /* ---------------------------------------------------------------- month view */
  const monthHtml = () => {
    const cols = weekends ? 7 : 5;
    const days = byDate();
    const cells = [];
    for (let d = from; d <= to; d = isoAddDays(d, 1)) {
      if (!weekends && weekdayOf(d) > 4) continue;
      const list = days[d] || [];
      const shown = list.slice(0, 4);
      cells.push(`<div class="room-month-cell ${d.slice(0, 7) !== first.slice(0, 7) ? 'is-other' : ''} ${d === today ? 'is-today' : ''}">
        <a class="room-month-date" href="${link('week', d)}" title="Show this week by the half hour">${esc(fmtShort(d))}</a>
        ${shown.map((b) => `<button type="button" class="room-line ${b.mine ? 'room-mine' : ''}" data-booking="${b.id}" style="--h:${b.visible ? hue(b.peer) : 210}" title="${esc(label(b))}">${esc(b.start)} ${esc(b.visible ? b.peer : 'Booked')}${b.locked ? ' \u00B7 fixed' : ''}</button>`).join('')}
        ${list.length > shown.length ? `<a class="small" href="${link('week', d)}">+${list.length - shown.length} more</a>` : ''}</div>`);
    }
    return `<div class="room-month" style="--cols:${cols}">${WEEKDAYS.slice(0, cols).map((w) => `<div class="room-month-head">${w}</div>`).join('')}${cells.join('')}</div>`;
  };

  const draw = () => { cal.innerHTML = view === 'month' ? monthHtml() : weekHtml(); };

  /* ---------------------------------------------------------------- the booking form */
  const showNotice = (html) => { panel.innerHTML = html; };
  const timeOptions = (list, chosen) => list.map((t) => `<option value="${t}" ${t === chosen ? 'selected' : ''}>${t}</option>`).join('');

  const openForm = (pre = {}) => {
    const date = pre.date && pre.date >= today ? pre.date : today;
    const start = pre.start || '09:00';
    const ends = endTimesAfter(start);
    const end = pre.end && ends.includes(pre.end) ? pre.end : (ends.includes(toTime(toMinutes(start) + 60)) ? toTime(toMinutes(start) + 60) : ends[0]);
    showNotice(`<form class="room-form" data-book>
      <h2 class="h2-rule">Book ${esc(R.name === ROOM_NAME ? 'the ' + R.name : R.name)}</h2>
      <div class="row">
        <label class="field field-narrow"><span>Book as</span><select name="peer" required><option value="">Choose your name\u2026</option>${peers.map((n) => `<option value="${esc(n)}" ${n === who ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <label class="field field-narrow"><span>Date</span><input type="date" name="date" value="${date}" min="${today}" required></label>
        <label class="field field-narrow"><span>From</span><select name="start">${timeOptions(slotStarts(), start)}</select></label>
        <label class="field field-narrow"><span>To</span><select name="end">${timeOptions(ends, end)}</select></label>
      </div>
      <label class="field"><span>Note, shown to you and the Whips (optional)</span><input type="text" name="note" maxlength="${MAX_NOTE_LENGTH}" placeholder="e.g. Group meeting"></label>
      <label class="check"><input type="checkbox" name="locked"> Set in stone: nobody can ask for this booking to be moved (you and the Whips can still change it)</label>
      <div class="row">
        <label class="field field-narrow"><span>Repeat</span><select name="repeat">
          <option value="none">Does not repeat</option><option value="weekly">Every week</option><option value="fortnightly">Every two weeks</option>
          <option value="weekdays">Every weekday (Mon to Fri)</option><option value="custom">Choose the days\u2026</option></select></label>
        <label class="field field-narrow" data-until hidden><span>Repeat until</span><input type="date" name="until"></label>
      </div>
      <fieldset class="room-custom" data-custom hidden><legend class="small">Repeat on</legend>
        ${WEEKDAYS.map((w, i) => `<label class="check"><input type="checkbox" name="day" value="${i}"> ${w}</label>`).join('')}
        <label class="field field-narrow"><span>Every</span><select name="every"><option value="1">week</option><option value="2">2 weeks</option><option value="3">3 weeks</option><option value="4">4 weeks</option></select></label>
      </fieldset>
      <p class="small" data-preview></p>
      <div data-clashes></div>
      <p><button class="button" type="submit">Book</button> <button type="button" class="button button-quiet" data-close>Close</button> <span class="small" data-formstatus aria-live="polite"></span></p>
    </form>`);
    panel.querySelector('select[name="peer"]').focus();
    updateForm();
    panel.scrollIntoView?.({ block: 'nearest' });
  };

  const field = (form, name) => form.elements.namedItem(name); // not form.title and the like: a form has built-in properties with some of these names

  /** The repeat chosen in the form, as the server expects it (null for a single booking). */
  const repeatOf = (form) => {
    const kind = field(form, 'repeat').value;
    const until = field(form, 'until').value;
    if (kind === 'none' || !until) return null;
    if (kind === 'weekly') return { every: 1, days: [], until };
    if (kind === 'fortnightly') return { every: 2, days: [], until };
    if (kind === 'weekdays') return { every: 1, days: [0, 1, 2, 3, 4], until };
    const days = [...form.querySelectorAll('input[name="day"]:checked')].map((c) => Number(c.value));
    return { every: Number(field(form, 'every').value), days, until };
  };

  /** Keep the "To" times, the repeat fields and the preview in step with what has been chosen. */
  const updateForm = () => {
    const form = panel.querySelector('[data-book]');
    if (!form) return;
    const start = field(form, 'start').value;
    const endSel = field(form, 'end');
    const ends = endTimesAfter(start);
    if (!ends.includes(endSel.value)) endSel.value = '';
    endSel.innerHTML = timeOptions(ends, ends.includes(endSel.value) ? endSel.value : (ends.includes(toTime(toMinutes(start) + 60)) ? toTime(toMinutes(start) + 60) : ends[0]));
    const kind = field(form, 'repeat').value;
    form.querySelector('[data-until]').hidden = kind === 'none';
    form.querySelector('[data-custom]').hidden = kind !== 'custom';
    const dateVal = field(form, 'date').value;
    const untilEl = field(form, 'until');
    if (kind !== 'none' && !untilEl.value && isIso(dateVal)) untilEl.value = isoAddDays(dateVal, ['weekly', 'fortnightly'].includes(kind) ? 12 * 7 : 4 * 7);
    const preview = form.querySelector('[data-preview]');
    if (kind === 'none' || !isIso(dateVal)) { preview.textContent = ''; return; }
    const { dates, error } = expandRecurrence(dateVal, repeatOf(form));
    const names = dates.slice(0, 4).map((d) => fmtShort(d)).join(', ');
    preview.textContent = error ? error : `This will make ${dates.length} booking${dates.length === 1 ? '' : 's'}: ${names}${dates.length > 4 ? ` and ${dates.length - 4} more` : ''} (up to ${MAX_BOOKINGS_PER_SERIES} are allowed).`;
  };

  const submitBooking = async (form, skipConflicts = false) => {
    const peer = field(form, 'peer').value;
    const formStatus = form.querySelector('[data-formstatus]');
    const clashBox = form.querySelector('[data-clashes]');
    clashBox.innerHTML = '';
    if (!peer) { formStatus.textContent = 'Choose your name first.'; return; }
    formStatus.textContent = 'Booking\u2026';
    const result = await post({
      action: 'book', room, peer, date: field(form, 'date').value, start: field(form, 'start').value, end: field(form, 'end').value,
      note: field(form, 'note').value, locked: field(form, 'locked').checked, repeat: repeatOf(form), skipConflicts,
    });
    if (result.ok) {
      who = peer; store.set(NAME_KEY, who);
      whoSelect.value = who;
      const { created, skipped } = result.data;
      status.textContent = `Booked: ${created} booking${created === 1 ? '' : 's'}${skipped ? `, ${skipped} date${skipped === 1 ? '' : 's'} skipped because the room was already booked` : ''}.`;
      panel.innerHTML = '';
      await reload(); draw();
      return;
    }
    formStatus.textContent = result.data.error || `The server returned ${result.status}.`;
    const clashes = result.data.clashes || [];
    if (result.status === 409 && clashes.length) {
      clashBox.innerHTML = `<ul class="small">${clashes.slice(0, 8).map((c) => `<li>${esc(fmtShort(c.date))}, ${esc(range(c.start, c.end))}: booked${c.peer ? ` by ${esc(c.peer)}` : ''}</li>`).join('')}${clashes.length > 8 ? `<li>and ${clashes.length - 8} more</li>` : ''}</ul>
        ${result.data.free ? `<p><button type="button" class="button" data-skip>Book the other ${result.data.free} date${result.data.free === 1 ? '' : 's'}</button></p>` : ''}`;
    }
    if (result.data.raced) { await reload(); draw(); }
  };

  /* ---------------------------------------------------------------- booking details and cancelling */
  const showDetail = (id) => {
    const b = bookings.find((x) => x.id === id);
    if (!b) { panel.innerHTML = ''; openDetail = null; return; }
    openDetail = id;
    const when = `${esc(fmtDate(b.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}, ${esc(range(b.start, b.end))}`;
    const past = b.date < today;
    if (!b.manage) {
      // Someone else's booking: only that it is booked (unless they are in a team with you, when you see it in full but cannot change it).
      // It can be asked for (with a message) unless it is set in stone.
      const mineReq = inbox.outgoing.find((r) => r.status === 'open' && r.date === b.date && r.start === b.start);
      panel.innerHTML = `<section class="room-detail"><h2 class="h2-rule">${b.visible ? 'Booking' : 'Booked'}</h2>
        ${b.visible ? `<p><strong>${esc(b.peer)}</strong> <span class="small muted">(made by someone in your team: you can look but not change it)</span><br>${when}</p>${b.note ? `<p>${esc(b.note)}</p>` : ''}` : `<p>${when}</p>`}
        ${b.locked ? '<p class="small">This booking is fixed, so it cannot be requested.</p>'
          : past ? '<p class="small muted">This booking has passed.</p>'
          : (b.requested || mineReq) ? `<p class="small">You have asked for this slot. The booker will answer in the Requests box above.${mineReq ? ` <button type="button" class="linkish" data-withdraw="${mineReq.id}">Withdraw my request</button>` : ''}</p>`
          : `<form data-ask="${b.id}"><p class="small">Need this slot? Ask for it. The booker is told, with your message, and can choose to move their meeting.</p>
              <label class="field"><span>Your message (why you need the room)</span><textarea name="message" rows="3" maxlength="500" required placeholder="e.g. A briefing for the Leader that morning: could your meeting move to the afternoon?"></textarea></label>
              <label class="field field-narrow"><span>Your name</span><input name="as" maxlength="80" value="${esc(who || savedName() || '')}"></label>
              <p><button class="button" type="submit">Ask for this slot</button> <span class="small" data-askstatus aria-live="polite"></span></p></form>`}
        <p class="room-actions"><button type="button" class="button button-quiet" data-close>Close</button></p></section>`;
      return;
    }
    const s = b.seriesId ? series[b.seriesId] : null;
    const waiting = inbox.incoming.filter((r) => r.date === b.date && r.start === b.start);
    panel.innerHTML = `<section class="room-detail"><h2 class="h2-rule">Booking</h2>
      <p><strong>${esc(b.peer)}</strong>${b.mine ? ' <span class="small muted">(your booking)</span>' : ''}<br>${when}</p>
      ${b.note ? `<p>${esc(b.note)}</p>` : ''}
      ${b.locked ? '<p class="small"><strong>Set in stone</strong>: nobody can ask for this booking to be moved.</p>' : ''}
      ${s ? `<p class="small muted">${esc(describeRepeat(s.rule))}, until ${esc(fmtDate(s.rule.until, { day: 'numeric', month: 'long', year: 'numeric' }))}.</p>` : ''}
      ${waiting.map((r) => `<p class="small state state-warn">${esc(r.requester)} has asked for this slot: \\u201C${esc(r.message)}\\u201D (see the Requests box above to answer).</p>`).join('')}
      <p class="room-actions">
        <button type="button" class="button button-quiet" data-lock="${b.locked ? 0 : 1}" data-id="${b.id}">${b.locked ? 'Free it (people can ask for it again)' : 'Set in stone'}</button>
        ${s ? `<button type="button" class="button button-quiet" data-lock="${b.locked ? 0 : 1}" data-scope="all" data-id="${b.id}">${b.locked ? 'Free' : 'Set in stone'} every future booking in the series</button>` : ''}
        ${past ? '' : `<button type="button" class="button button-quiet" data-amend-open="${b.id}">Change the day, time or note</button>`}
        <button type="button" class="button" data-cancel="one" data-id="${b.id}">Cancel this booking</button>
        ${s ? `<button type="button" class="button button-quiet" data-cancel="following" data-id="${b.id}">Cancel this and all later bookings in the series</button>
        <button type="button" class="button button-quiet" data-cancel="all" data-id="${b.id}">Cancel every future booking in the series</button>` : ''}
        <button type="button" class="button button-quiet" data-close>Close</button></p>
      <div data-amend-host></div><p class="small" data-detailstatus aria-live="polite"></p></section>`;
  };

  const amendForm = (b) => `<form class="room-form" data-amend="${b.id}"><h3>Change this booking</h3>
    <div class="row"><label class="field field-narrow"><span>Date</span><input type="date" name="date" value="${b.date}" min="${today}" required></label>
      <label class="field field-narrow"><span>From</span><select name="start">${timeOptions(slotStarts(), b.start)}</select></label>
      <label class="field field-narrow"><span>To</span><select name="end">${timeOptions(endTimesAfter('08:00'), b.end)}</select></label></div>
    <label class="field"><span>Note (optional)</span><input name="note" maxlength="${MAX_NOTE_LENGTH}" value="${esc(b.note)}"></label>
    <p class="small muted">Moving it takes it out of any repeat. Anyone waiting for this slot is told it is free.</p>
    <p><button class="button" type="submit">Save</button> <button type="button" class="button button-quiet" data-amend-cancel>Cancel</button> <span class="small" data-amendstatus aria-live="polite"></span></p></form>`;

  /* ---------------------------------------------------------------- the Requests box */
  const STATUS_TEXT = { 'will-move': 'The booker will move their meeting.', 'cannot-move': 'The booker cannot move it.', released: 'The slot is free.', withdrawn: 'You withdrew this request.', open: 'Waiting for an answer.' };
  const roomName = (r) => (r === '391' ? 'Room 391' : ROOM_NAME);
  const inboxHtml = () => {
    const inc = inbox.incoming, out = inbox.outgoing.filter((r) => r.status !== 'withdrawn' && !(r.status === 'open' && r.date < today)).slice(0, 8);
    if (!inc.length && !out.length) return '';
    return `<section class="room-inbox"><h2 class="h2-rule">Requests ${inc.length ? `<span class="count">${inc.length}</span>` : ''}</h2>
      ${inc.length ? `<p class="small muted">${whipsView ? 'Someone has asked for a booked slot.' : 'Someone has asked for a slot you have booked.'} You can say you will move your meeting, or that you cannot.</p>
        <ul class="room-requests">${inc.map((r) => `<li data-req="${r.id}"><strong>${esc(roomName(r.room))}</strong>, ${esc(fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' }))} ${esc(range(r.start, r.end))}${whipsView && r.booker ? ` <span class="small muted">(booked by ${esc(r.booker)})</span>` : ''}
          <br><span class="small">${esc(r.requester)} asks: \\u201C${esc(r.message)}\\u201D</span>
          <br><input class="small" maxlength="300" placeholder="Reply (optional)" aria-label="Reply to ${esc(r.requester)}" data-reply>
          <button type="button" class="button button-small" data-respond="will-move">I will move it</button> <button type="button" class="button button-quiet button-small" data-respond="cannot-move">I cannot move it</button></li>`).join('')}</ul>` : ''}
      ${out.length ? `<p class="small muted">Your requests</p><ul class="room-requests small">${out.map((r) => `<li>${esc(roomName(r.room))}, ${esc(fmtShort(r.date))} ${esc(range(r.start, r.end))}: ${esc(STATUS_TEXT[r.status] || r.status)}${r.response ? ` \\u201C${esc(r.response)}\\u201D` : ''}${r.status === 'open' ? ` <button type="button" class="linkish" data-withdraw="${r.id}">withdraw</button>` : ''}</li>`).join('')}</ul>` : ''}</section>`;
  };
  async function loadInbox() {
    try { inbox = await api('room-requests'); } catch { inbox = { incoming: [], outgoing: [] }; }   // (a tester without access simply has no box)
    inboxEl.innerHTML = inboxHtml();
  }
  const answer = async (body) => {
    const r = await fetch('/api/libby/room-requests', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && d.login) { location.reload(); return new Promise(() => {}); }
    return { ok: r.ok, status: r.status, data: d };
  };

  const cancelBooking = async (id, scope) => {
    const b = bookings.find((x) => x.id === id);
    const what = { one: 'this booking', following: 'this booking and all later bookings in the series', all: 'every future booking in the series' }[scope];
    if (!window.confirm(`Cancel ${what}${b ? ` (${b.peer || 'Booked'}, ${fmtShort(b.date)}, ${range(b.start, b.end)})` : ''}?`)) return;
    status.textContent = 'Cancelling\u2026';
    const result = await post({ action: 'cancel', id, as: who, scope });
    if (!result.ok) { status.textContent = result.data.error || `The server returned ${result.status}.`; return; }
    status.textContent = `Cancelled ${result.data.cancelled} booking${result.data.cancelled === 1 ? '' : 's'}.`;
    panel.innerHTML = ''; openDetail = null;
    await reload(); draw();
  };

  /* ---------------------------------------------------------------- events */
  draw();
  loadInbox();
  whoSelect.addEventListener('change', () => {
    who = whoSelect.value; store.set(NAME_KEY, who);
    draw();
    if (openDetail) showDetail(openDetail); // who may cancel depends on the name
  });
  weekendsBox.addEventListener('change', () => { weekends = weekendsBox.checked; store.set(WEEKENDS_KEY, weekends ? '1' : '0'); draw(); });
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-new]')) { openForm({ date: from <= today && today <= to ? today : anchor }); return; }
    const free = t.closest('.room-free[data-date]');
    if (free) { openForm({ date: free.dataset.date, start: free.dataset.time }); return; }
    const booking = t.closest('[data-booking]');
    if (booking) { showDetail(Number(booking.dataset.booking)); panel.scrollIntoView?.({ block: 'nearest' }); return; }
    if (t.closest('[data-close]')) { panel.innerHTML = ''; openDetail = null; return; }
    const cancel = t.closest('[data-cancel]');
    if (cancel) { cancelBooking(Number(cancel.dataset.id), cancel.dataset.cancel); return; }
    if (t.closest('[data-skip]')) submitBooking(panel.querySelector('[data-book]'), true);
    const lockBtn = t.closest('[data-lock]');
    if (lockBtn) { setLock(Number(lockBtn.dataset.id), lockBtn.dataset.lock === '1', lockBtn.dataset.scope || 'one'); return; }
    const amendOpen = t.closest('[data-amend-open]');
    if (amendOpen) { const b = bookings.find((x) => x.id === Number(amendOpen.dataset.amendOpen)); panel.querySelector('[data-amend-host]').innerHTML = amendForm(b); return; }
    if (t.closest('[data-amend-cancel]')) { panel.querySelector('[data-amend-host]').innerHTML = ''; return; }
    const respond = t.closest('[data-respond]');
    if (respond) { respondTo(respond); return; }
    const withdraw = t.closest('[data-withdraw]');
    if (withdraw) { withdrawRequest(Number(withdraw.dataset.withdraw)); }
  });
  const setLock = async (id, locked, scope) => {
    const result = await post({ action: 'lock', id, locked, scope });
    const out = panel.querySelector('[data-detailstatus]') || status;
    if (!result.ok) { out.textContent = result.data.error || `The server returned ${result.status}.`; return; }
    status.textContent = locked ? 'Set in stone: nobody can ask for it now.' : 'Freed: people can ask for it again.';
    await reload(); draw(); showDetail(id);
  };
  const respondTo = async (btn) => {
    const li = btn.closest('[data-req]');
    const result = await answer({ action: 'respond', id: Number(li.dataset.req), response: btn.dataset.respond, reply: li.querySelector('[data-reply]').value });
    if (!result.ok) { status.textContent = result.data.error || `The server returned ${result.status}.`; return; }
    status.textContent = btn.dataset.respond === 'will-move' ? 'Thank you: the person who asked will see that you will move it. Remember to change or cancel your booking.' : 'Thank you: the person who asked will see that you cannot move it.';
    await loadInbox();
  };
  const withdrawRequest = async (id) => {
    const result = await answer({ action: 'withdraw', id });
    if (!result.ok) { status.textContent = result.data.error || `The server returned ${result.status}.`; return; }
    status.textContent = 'Your request was withdrawn.';
    await reload(); draw(); if (openDetail) showDetail(openDetail);
  };
  root.addEventListener('change', (e) => { if (e.target.closest('[data-book]')) updateForm(); });
  root.addEventListener('input', (e) => { if (e.target.closest('[data-book]') && e.target.name === 'until') updateForm(); });
  root.addEventListener('submit', async (e) => {
    const ask = e.target.closest('[data-ask]');
    if (ask) {
      e.preventDefault();
      const out = ask.querySelector('[data-askstatus]');
      out.textContent = 'Sending\u2026';
      const result = await answer({ action: 'request', bookingId: Number(ask.dataset.ask), message: ask.elements.message.value, as: ask.elements.as.value });
      if (!result.ok) { out.textContent = result.data.error || `The server returned ${result.status}.`; return; }
      status.textContent = 'Your request was sent. The booker is told, and will answer in the Requests box on this page.';
      await reload(); draw(); showDetail(Number(ask.dataset.ask));
      return;
    }
    const amend = e.target.closest('[data-amend]');
    if (amend) {
      e.preventDefault();
      const out = amend.querySelector('[data-amendstatus]');
      out.textContent = 'Saving\u2026';
      const result = await post({ action: 'amend', id: Number(amend.dataset.amend), date: amend.elements.date.value, start: amend.elements.start.value, end: amend.elements.end.value, note: amend.elements.note.value });
      if (!result.ok) { out.textContent = result.data.error || `The server returned ${result.status}.`; return; }
      status.textContent = result.data.moved ? 'Moved. Anyone waiting for the old slot has been told it is free.' : 'Saved.';
      panel.innerHTML = ''; openDetail = null;
      await reload(); draw();
      return;
    }
    const form = e.target.closest('[data-book]');
    if (!form) return;
    e.preventDefault();
    submitBooking(form);
  });
}
