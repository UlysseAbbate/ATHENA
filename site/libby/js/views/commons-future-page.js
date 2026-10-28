// Honourable LIBBY: the coming four weeks in the House of Commons (#/c/future), day by day: the Chamber and Westminster Hall.
// Each day opens on its own page with everything, including the committees.
import { api } from '../api.js';
import { esc, fmtDate, todayIso, addDays, loading, errorBox, empty, pageHeader } from '../ui.js';
import { commonsItemHtml } from './commons-day-page.js';

const DAYS = 28;

export async function renderCommonsFuture(el, _params, query = {}) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : todayIso();
  el.innerHTML = `
    ${pageHeader('Coming up', 'The House of Commons in the coming weeks: the Chamber and Westminster Hall. Open a day for everything, including the committees.', [['#/c/business', 'Business']])}
    <nav class="day-nav" aria-label="Other weeks">
      <a href="#/c/future?from=${addDays(from, -DAYS)}">Earlier</a>
      ${from === todayIso() ? '' : '<a href="#/c/future">From today</a>'}
      <a href="#/c/future?from=${addDays(from, DAYS)}">Later</a>
    </nav>
    <div id="coming">${loading('Loading the coming business')}</div>`;
  const box = el.querySelector('#coming');
  let d;
  try { d = await api(`commons/coming?from=${from}&days=${DAYS}`); } catch (err) { box.innerHTML = errorBox(err); return; }
  if (!box.isConnected) return;
  if (!d.days.length) { box.innerHTML = empty('No Chamber or Westminster Hall business is published for these weeks yet.'); return; }
  box.innerHTML = d.days.map((day) => `
    <section class="future-day">
      <h2 class="h2-rule"><a href="#/c/day/${esc(day.date)}">${esc(fmtDate(day.date))}</a></h2>
      ${day.sections.map((s) => `<h3 class="h3-section">${esc(s.name)}</h3><ol class="items">${s.items.map(commonsItemHtml).join('')}</ol>`).join('')}
    </section>`).join('');
}
