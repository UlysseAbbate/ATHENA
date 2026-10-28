// Honourable LIBBY: one day of House of Commons business (#/c/today and #/c/day/YYYY-MM-DD), from the What's On calendar:
// the Chamber, Westminster Hall, the general committees and the select committees, with the times, the members (Lib Dem MPs marked)
// and a link to each Bill's page.
import { api } from '../api.js';
import { esc, peer, fmtDate, todayIso, addDays, KIND, loading, errorBox, extLink, pageHeader } from '../ui.js';

const time = (i) => (i.start ? `${esc(i.start)}${i.end ? `–${esc(i.end)}` : ''}` : '');

export function commonsItemHtml(i) {
  const title = i.link?.internal ? `<a href="${esc(i.link.href)}">${esc(i.title)}</a>` : esc(i.title);
  const who = i.peers?.length
    ? `<span class="item-who">${i.peers.map((p) => `${peer(p.name, p.ld)}${p.party ? ` <span class="small muted">${esc(p.party)}</span>` : ''}`).join('<br>')}</span>` : '';
  return `<li class="item item-${esc(i.kind)}">
    <div class="item-row">
      <span class="kind-cell"><span class="kind">${esc(KIND[i.kind] || i.category || 'Business')}</span>${time(i) ? `<span class="chip">${time(i)}</span>` : ''}</span>
      <span class="item-title">${title}${i.detail ? `<span class="item-detail"> — ${esc(i.detail)}</span>` : ''}</span>
      ${who}
    </div>
    ${i.eventUrl ? `<p class="item-links">${extLink(i.eventUrl, 'What’s On')}</p>` : ''}
  </li>`;
}

export async function renderCommonsDay(el, { date }) {
  const isToday = date === todayIso();
  el.innerHTML = `
    ${pageHeader(isToday ? "Today's business" : fmtDate(date), isToday ? `House of Commons · ${esc(fmtDate(date))}` : 'House of Commons', isToday ? [] : [['#/c/future', 'Coming up']])}
    <nav class="day-nav" aria-label="Other days">
      <a href="#/c/day/${addDays(date, -1)}">Previous day</a>
      ${isToday ? '' : '<a href="#/c/today">Today</a>'}
      <a href="#/c/day/${addDays(date, 1)}">Next day</a>
    </nav>
    <div id="business">${loading('Loading the day’s business')}</div>`;
  const box = el.querySelector('#business');
  let d;
  try { d = await api(`commons/day/${date}`); } catch (err) { box.innerHTML = errorBox(err); return; }
  if (!box.isConnected) return;
  if (!d.sections.length) {
    box.innerHTML = '<p class="state">No House of Commons business is published for this day. It may be a non-sitting day, or the business has not been announced. See what is <a href="#/c/future">coming up</a>.</p>';
    return;
  }
  box.innerHTML = `<p class="source small muted">Source: ${extLink(d.source.url, d.source.label)}</p>
    ${d.sections.map((s) => `
    <section class="chamber">
      <div class="chamber-head"><h2>${esc(s.name)}</h2>
        <p class="small muted">${s.start ? `From ${esc(s.start)}` : ''}${d.rising?.[s.name] ? ` · expected to rise ${esc(d.rising[s.name])}` : ''}</p></div>
      <ol class="items">${s.items.map(commonsItemHtml).join('')}</ol>
    </section>`).join('')}`;
}
