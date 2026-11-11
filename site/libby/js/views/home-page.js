import { api } from '../api.js';
import { esc, fmtDate, todayIso } from '../ui.js';
import { annunciators } from '../live-panel.js';
import { currentLevel, hasLevel, currentHouse } from '../session.js';
import { menuFor, isRestricted } from '../pages.js';
import { bulletinHtml } from '../bulletin-box.js';

export async function renderHome(el) {
  el.innerHTML = `
    <header class="page-head home-head">
      <p class="dateline">${esc(fmtDate(todayIso()))}</p>
      <h1>Parliamentary business, in one place</h1>
    </header>
    <div id="live"></div>
    <div id="bulletin"></div>
    <nav class="index index-compact" aria-label="Sections">
      ${menuFor(currentLevel(), currentHouse()).map((s) => `
        <a class="index-row" href="${s.href}" title="${esc(s.text)}">
          <span class="index-title"><span class="swipe">${esc(s.title)}</span></span>
          <span class="index-text">${esc(s.text)}</span>
          <span class="index-hint" id="hint-${s.id}"></span>
        </a>`).join('')}
    </nav>`;

  if (isRestricted(currentLevel())) return;   // (for now the restricted levels have just the Data page)

  annunciators(el.querySelector('#live'));

  // The Whips' Office Bulletin: between the live panels and the sections. There is one for each House: the one for the House you are in shows, with a button for the other.
  // It is left out if it cannot be read or is empty.
  const showBulletin = (house) => api(`bulletin?house=${house}`).then((d) => {
    const box = el.querySelector('#bulletin');
    if (!box) return;
    const other = house === 'commons' ? 'lords' : 'commons';
    box.innerHTML = bulletinHtml(d.messages, { admin: hasLevel('staff'), house }) + `<p class="small bulletin-switch"><button type="button" class="linkish" data-bulletin="${other}">Show the ${other === 'commons' ? 'Commons' : 'Lords'} bulletin</button></p>`;
    box.querySelector('[data-bulletin]').addEventListener('click', (e) => showBulletin(e.currentTarget.dataset.bulletin));
  }).catch(() => {});
  showBulletin(currentHouse());

  api('day/today').then((d) => {
    const items = d.sections.flatMap((s) => s.items).filter((i) => i.kind !== 'prayers'); // Prayers are not business
    const n = items.length;
    const oqs = items.filter((i) => i.kind === 'oq').length;
    el.querySelector('#hint-today').textContent = n ? `${n} items today${oqs ? `, ${oqs} Oral Questions` : ''}` : 'The House is not sitting today';
  }).catch(() => {});
  api('bills').then((b) => {
    el.querySelector('#hint-legislation').textContent = `${b.government.length} Government Bills, ${b.privateMembers.length} Private Members' Bills`;
  }).catch(() => {});
  api('future?days=14').then((f) => {
    const next = f.days.find((d) => d.date > todayIso());
    if (next) el.querySelector('#hint-business').textContent = `Next sitting: ${fmtDate(next.date, { weekday: 'long', day: 'numeric', month: 'long' })}`;
  }).catch(() => {});
}
