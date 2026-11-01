// Work Experience Support (#/work-experience): ask for a Peer to host work experience students at a date and time, and see (and answer) the requests.
// A month calendar shows what has been asked for; each request lists the Peers who have said they can host. Everyone signed in sees every request.
import { api } from '../api.js';
import { esc, fmtDate, todayIso, addDays, loading, errorBox, empty, pageHeader } from '../ui.js';
import { loadPeers } from '../peer-list.js';
import { hasLevel } from '../session.js';

const NAME_KEY = 'workExperienceName';
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } },
};
const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
const addMonths = (iso, n) => { const d = new Date(`${monthStart(iso)}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const weekdayOf = (iso) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
const mondayOf = (iso) => addDays(iso, -weekdayOf(iso));
const HOURS = Array.from({ length: 25 }, (_, i) => `${String(7 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const opts = (chosen) => HOURS.map((t) => `<option value="${t}" ${t === chosen ? 'selected' : ''}>${t}</option>`).join('');

async function post(body) {
  const res = await fetch('/api/libby/work-experience', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.login) { location.reload(); return new Promise(() => {}); }
  return { ok: res.ok, data };
}

export async function renderWorkExperience(el, _params, query) {
  const today = todayIso();
  const first = monthStart(isIso(query.from) ? query.from : today);
  const from = mondayOf(first);
  const lastOfMonth = addDays(addMonths(first, 1), -1);
  const to = addDays(lastOfMonth, 6 - weekdayOf(lastOfMonth));
  const link = (d) => `#/work-experience?from=${d}`;
  el.innerHTML = `${pageHeader('Work Experience Support', 'Ask for a Peer to host work experience students at a date and time, and see who has said they can. Everyone can see every request.')}
    <div id="we-root">
      <div class="room-controls">
        <nav class="room-nav" aria-label="Move the calendar">
          <a class="button button-quiet" href="${link(addMonths(first, -1))}">Earlier</a>
          <a class="button button-quiet" href="#/work-experience">This month</a>
          <a class="button button-quiet" href="${link(addMonths(first, 1))}">Later</a>
          <strong class="room-period">${esc(fmtDate(first, { month: 'long', year: 'numeric' }))}</strong>
        </nav>
        <button type="button" class="button" data-new>Ask for support</button>
      </div>
      <p class="small" data-status aria-live="polite"></p>
      <div id="we-panel" aria-live="polite"></div>
      <div id="we-cal">${loading('Loading the requests')}</div>
      <div id="we-list"></div>
    </div>`;
  const root = el.querySelector('#we-root');
  const cal = root.querySelector('#we-cal'), list = root.querySelector('#we-list'), panel = root.querySelector('#we-panel'), status = root.querySelector('[data-status]');
  let data, peers = [];
  try { [data, peers] = await Promise.all([api(`work-experience?from=${from}&to=${to}`), loadPeers().catch(() => [])]); } catch (err) { cal.innerHTML = errorBox(err); return; }
  if (!root.isConnected) return;
  const requests = data.requests || [];
  const staff = hasLevel('staff');
  let who = store.get(NAME_KEY);

  const draw = () => {
    const byDate = {};
    for (const r of requests) (byDate[r.date] ||= []).push(r);
    const weeks = [];
    for (let w = from; w <= to; w = addDays(w, 7)) weeks.push(w);
    cal.innerHTML = `<div class="cal" role="table" aria-label="Work experience requests">
      <div class="cal-row cal-headrow" role="row">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => `<div role="columnheader">${d}</div>`).join('')}</div>
      ${weeks.map((w) => `<div class="cal-row" role="row">${[0, 1, 2, 3, 4].map((i) => {
        const date = addDays(w, i);
        if (date.slice(0, 7) !== first.slice(0, 7)) return '<div class="cal-cell is-out" role="cell"></div>';
        const rs = byDate[date] || [];
        return `<div class="cal-cell ${date === today ? 'is-today' : ''}" role="cell"><span class="cal-date">${esc(fmtDate(date, { day: 'numeric', month: 'short' }))}</span>
          ${rs.length ? `<ul>${rs.map((r) => `<li><a href="#we-${r.id}" data-jump="${r.id}">${esc(r.start)} ${esc(r.requester)}</a>${r.offers.length ? ` <span class="tag">${r.offers.length} can host</span>` : ' <span class="muted small">needs a host</span>'}</li>`).join('')}</ul>` : ''}
          ${date >= today ? `<button type="button" class="linkish small" data-ask="${date}">Ask</button>` : ''}</div>`;
      }).join('')}</div>`).join('')}</div>`;
    const month = requests.filter((r) => r.date.slice(0, 7) === first.slice(0, 7));
    list.innerHTML = `<h2 class="h2-rule">Requests this month <span class="count">${month.length}</span></h2>` + (month.length ? month.map((r) => `
      <section class="we-card" id="we-${r.id}">
        <h3>${esc(fmtDate(r.date))}, ${esc(r.start)} to ${esc(r.end)}</h3>
        <p><strong>${esc(r.requester)}</strong>${r.contact ? ` (${esc(r.contact)})` : ''} needs a host for ${r.students} student${r.students === 1 ? '' : 's'}.${r.note ? ` ${esc(r.note)}` : ''}</p>
        ${r.offers.length ? `<ul class="plain">${r.offers.map((o) => `<li>${esc(o.peer)} can host${o.note ? `: ${esc(o.note)}` : ''} <button type="button" class="linkish small" data-withdraw="${o.id}" data-peer="${esc(o.peer)}">Take back</button></li>`).join('')}</ul>` : '<p class="muted small">Nobody has offered yet.</p>'}
        <form class="row" data-offer="${r.id}"><label class="field field-narrow"><span>I can host, as</span><select name="peer" required><option value="">Choose your name…</option>${peers.map((n) => `<option value="${esc(n)}" ${n === who ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
          <label class="field field-narrow"><span>Note (optional)</span><input type="text" name="note" maxlength="300"></label><button class="button button-quiet" type="submit">I can host</button>
          ${staff || r.requester === who ? `<button class="button button-quiet" type="button" data-cancel="${r.id}" data-peer="${esc(r.requester)}">Cancel request</button>` : ''}</form>
      </section>`).join('') : empty('Nothing has been asked for this month yet.'));
  };
  draw();

  const act = async (body, ok) => {
    const r = await post(body);
    if (!r.ok) { status.textContent = r.data.error || 'That did not work.'; return; }
    status.textContent = ok;
    renderWorkExperience(el, _params, query);
  };
  const openForm = (date) => {
    panel.innerHTML = `<form class="room-form" data-request><h2 class="h2-rule">Ask for support</h2>
      <div class="row"><label class="field field-narrow"><span>Who is asking</span><input name="requester" required maxlength="80" value="${esc(who)}"></label>
        <label class="field field-narrow"><span>Contact (optional)</span><input name="contact" maxlength="120" placeholder="email or phone"></label>
        <label class="field field-narrow"><span>Date</span><input type="date" name="date" value="${date >= today ? date : today}" min="${today}" required></label>
        <label class="field field-narrow"><span>From</span><select name="start">${opts('10:00')}</select></label>
        <label class="field field-narrow"><span>To</span><select name="end">${opts('16:00')}</select></label>
        <label class="field field-narrow"><span>Students</span><input type="number" name="students" min="1" max="50" value="1"></label></div>
      <label class="field"><span>What would help (optional)</span><input name="note" maxlength="400" placeholder="e.g. a morning in the Chamber, a tour, shadowing a Peer"></label>
      <p><button class="button" type="submit">Send the request</button> <button class="button button-quiet" type="button" data-close>Cancel</button></p></form>`;
    panel.querySelector('[data-close]').addEventListener('click', () => { panel.innerHTML = ''; });
    panel.querySelector('[data-request]').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target.elements;
      who = f.requester.value.trim(); store.set(NAME_KEY, who);
      act({ action: 'request', requester: f.requester.value, contact: f.contact.value, date: f.date.value, start: f.start.value, end: f.end.value, students: f.students.value, note: f.note.value }, 'Request sent.');
    });
    panel.scrollIntoView({ block: 'nearest' });
  };
  root.querySelector('[data-new]').addEventListener('click', () => openForm(today));
  root.addEventListener('click', (e) => {
    const ask = e.target.closest('[data-ask]'); if (ask) return openForm(ask.dataset.ask);
    const jump = e.target.closest('[data-jump]'); if (jump) { e.preventDefault(); document.getElementById(`we-${jump.dataset.jump}`)?.scrollIntoView({ block: 'center' }); return; }
    const wd = e.target.closest('[data-withdraw]'); if (wd) return act({ action: 'withdraw', offerId: Number(wd.dataset.withdraw), as: wd.dataset.peer === who ? who : who }, 'Offer taken back.');
    const cn = e.target.closest('[data-cancel]'); if (cn && confirm('Cancel this request?')) return act({ action: 'cancel', id: Number(cn.dataset.cancel), as: who }, 'Request cancelled.');
  });
  root.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-offer]'); if (!f) return;
    e.preventDefault();
    who = f.elements.peer.value; store.set(NAME_KEY, who);
    act({ action: 'offer', requestId: Number(f.dataset.offer), peer: f.elements.peer.value, note: f.elements.note.value }, 'Thank you: your offer is on the request.');
  });
}
