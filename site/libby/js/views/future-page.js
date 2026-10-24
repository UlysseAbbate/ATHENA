import { api } from '../api.js';
import { esc, hl, fmtDate, todayIso, addDays, KIND, loading, errorBox, pageHeader } from '../ui.js';

function mondayOf(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -wd);
}

function calendarHtml(data) {
  const byDate = Object.fromEntries(data.days.map((d) => [d.date, d]));
  const start = mondayOf(data.from);
  const weeks = [];
  for (let w = start; w <= data.to; w = addDays(w, 7)) weeks.push(w);
  const today = todayIso();
  return `
    ${data.fbLoaded ? '' : `<p class="state small">Forthcoming Business hasn't been loaded into the database yet, so only What's On is shown. See the README: "Run the ingestion workflows".</p>`}
    <div class="cal" role="table" aria-label="Sitting days">
      <div class="cal-row cal-headrow" role="row">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => `<div role="columnheader">${d}</div>`).join('')}</div>
      ${weeks.map((w) => `<div class="cal-row" role="row">${[0, 1, 2, 3, 4].map((i) => {
        const date = addDays(w, i);
        const day = byDate[date];
        const label = fmtDate(date, { day: 'numeric', month: 'short' });
        if (date < data.from || date > data.to) return '<div class="cal-cell is-out" role="cell"></div>';
        if (!day) return `<div class="cal-cell is-empty ${date === today ? 'is-today' : ''}" role="cell"><span class="cal-date">${esc(label)}</span><span class="small muted">No legislation listed</span></div>`;
        return `<a class="cal-cell ${date === today ? 'is-today' : ''}" role="cell" href="#/day/${date}">
          <span class="cal-date">${esc(label)}</span>
          ${day.highlights.length
            ? `<ul>${day.highlights.map((h) => `<li><span class="kind-dot kind-${esc(h.kind)}" title="${esc(KIND[h.kind] || '')}"></span>${hl(h.title.length > 70 ? `${h.title.slice(0, 68)}…` : h.title)}</li>`).join('')}</ul>`
            : '<span class="small muted">No legislation listed</span>'}
        </a>`;
      }).join('')}</div>`).join('')}
    </div>
    <p class="small muted">Primary legislation only, from Lords Whips' Forthcoming Business and What's On. Open a day for the full business.</p>`;
}

async function portfolioHtml() {
  const list = await api('portfolios');
  return `<ul class="portfolio-list">${list.map((p) => `<li><a href="#/portfolio/${esc(p.code)}"><span class="p-code">${esc(p.code)}</span><span>${esc(p.name)}</span></a></li>`).join('')}</ul>`;
}

export async function renderFuture(el, _params, query) {
  const view = query.view === 'portfolio' ? 'portfolio' : 'calendar';
  el.innerHTML = `
    ${pageHeader('Future business', 'What the Government expects the Lords to take over the coming weeks.')}
    <div class="toggle" role="group" aria-label="Show forthcoming business">
      <a href="#/future?view=calendar" ${view === 'calendar' ? 'aria-current="true"' : ''}>By calendar</a>
      <a href="#/future?view=portfolio" ${view === 'portfolio' ? 'aria-current="true"' : ''}>By portfolio</a>
    </div>
    <div id="future">${loading('Loading forthcoming business')}</div>`;
  const box = el.querySelector('#future');
  try {
    box.innerHTML = view === 'portfolio' ? await portfolioHtml() : calendarHtml(await api(`future?from=${todayIso()}&days=35`));
  } catch (err) {
    box.innerHTML = errorBox(err);
  }
}
