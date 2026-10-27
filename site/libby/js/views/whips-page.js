// The Whips page (Whips and above): #/whips
//   Availability           a calendar where each Whip marks days green (prefer), amber (no preference) or red (not free).
//                          The names are the people given the Whip role on the Roles page. Whips and above only (pages.js).
// (Duty Whips, where Staff choose the rota, is on the Advisers page: duty-page.js.)
import { api } from '../api.js';
import { esc, fmtShort, addDays, loading, errorBox, pageHeader } from '../ui.js';
import { loadWhips, surnameKey } from '../peer-list.js';
import { WEEKS, STATUS_LABEL, rangeFrom, weeksGrid, calNav, availabilityMap, legendHtml } from '../whips-cal.js';

const NAME_KEY = 'whipAvailabilityName';
const remembered = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const remember = (n) => { try { localStorage.setItem(NAME_KEY, n); } catch { /* not remembered */ } };

async function availabilityPage(el, query) {
  const from = rangeFrom(query);
  el.innerHTML = `${pageHeader('Availability for Whipping', 'Choose your name, then mark each day: green to prefer being duty whip, amber for no preference, red if you are not free.')}
    <div class="search"><label class="field field-narrow"><span>Your name</span><select name="who" data-who></select></label></div>
    ${legendHtml()}${calNav('#/whips', from)}
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

export async function renderWhips(el, _params, query) {
  return availabilityPage(el, query);
}
