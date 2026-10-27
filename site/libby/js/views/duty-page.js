// Duty Whips (Staff and Admin; on the Advisers page): a calendar with two Whips a day, chosen from lists grouped by the availability each
// Whip has given for that day. Changes save as soon as they are chosen.
import { api } from '../api.js';
import { esc, peer, fmtShort, loading, errorBox, pageHeader } from '../ui.js';
import { hasLevel, savedName } from '../session.js';
import { loadWhips } from '../peer-list.js';
import { WEEKS, STATUS_LABEL, rangeFrom, weeksGrid, calNav, availabilityMap } from '../whips-cal.js';

export async function renderDuty(el, _params, query) {
  const from = rangeFrom(query);
  const admin = hasLevel('staff'); // Staff and Admin choose the rota
  el.innerHTML = `${pageHeader('Duty Whips', admin
      ? 'Two Whips for each day. Choose from the lists: each Whip is grouped by the availability they have given for that day.'
      : 'The two Whips on duty each day, chosen by Staff.', [['#/advisers', 'Advisers']])}
    ${calNav('#/duty-whips', from)}
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
