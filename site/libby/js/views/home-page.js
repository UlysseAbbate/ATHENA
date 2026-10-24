import { api } from '../api.js';
import { esc, fmtDate, todayIso } from '../ui.js';
import { liveStrip } from '../live-panel.js';
import { currentLevel, hasLevel } from '../session.js';
import { menuFor } from '../pages.js';
import { bulletinHtml } from '../bulletin-box.js';

export async function renderHome(el) {
  el.innerHTML = `
    <header class="page-head home-head">
      <p class="dateline">${esc(fmtDate(todayIso()))}</p>
      <h1>Lords business, in one place</h1>
    </header>
    <div id="live"></div>
    <div id="bulletin"></div>
    <nav class="index" aria-label="Sections">
      ${menuFor(currentLevel()).map((s) => `
        <a class="index-row" href="${s.href}">
          <span class="index-title"><span class="swipe">${esc(s.title)}</span></span>
          <span class="index-text">${esc(s.text)}</span>
          <span class="index-hint" id="hint-${s.id}"></span>
        </a>`).join('')}
    </nav>`;

  liveStrip(el.querySelector('#live'), { compact: true });

  // The Whips' Office Bulletin: between the live panels and the sections. It is left out if it cannot be read or is empty.
  api('bulletin').then((d) => {
    const box = el.querySelector('#bulletin');
    if (box) box.innerHTML = bulletinHtml(d.messages, { admin: hasLevel('staff') });
  }).catch(() => {});

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
