import { api } from '../api.js';
import { esc, fmtDate, loading, errorBox, pageHeader } from '../ui.js';

const DATE_FORMAT = { day: 'numeric', month: 'short', year: 'numeric' };
const BATCH = 100; // Bills asked about per request: the stages are saved, so one request normally answers for all of them

/** The Bill's portfolio chips. A Bill that no department or keyword placed is marked, so it can be settled in lib/portfolio-overrides.js. */
function tags(b) {
  const chips = (b.portfolios || []).map((c) => `<a class="tag" href="#/portfolio/${esc(c)}">${esc(c)}</a>`).join(' ');
  const guess = b.portfolioBy === 'default'
    ? ' <span class="muted small" title="No department or keyword matched this Bill, so it is shown under the Cabinet Office. Add it to lib/portfolio-overrides.js to place it.">(default)</span>' : '';
  return chips + guess;
}

/** One table of Bills. In Honourable LIBBY (the Commons) the Bills open on the Commons Bill page, and there is no Adviser column (the advisers are the Lords Whips' Office's). */
function table(bills, emptyText, commons) {
  if (!bills.length) return `<p class="state">${esc(emptyText)}</p>`;
  const here = commons ? /commons/i : /lords/i;
  return `<div class="table-wrap"><table class="grid">
    <thead><tr><th scope="col">Bill</th><th scope="col">Portfolio</th><th scope="col">Current stage</th><th scope="col">Date of next stage</th>${commons ? '' : '<th scope="col">Adviser</th>'}</tr></thead>
    <tbody>${bills.map((b) => `
      <tr>
        <th scope="row"><a href="${commons ? '#/c/bill/' : '#/bill/'}${b.id}">${esc(b.title)}</a></th>
        <td>${tags(b)}</td>
        <td>${esc(b.stage)}${b.stageHouse && !here.test(b.stageHouse) ? ` (${esc(b.stageHouse)})` : ''}</td>
        <td data-next="${b.id}"><span class="muted small">Checking…</span></td>
        ${commons ? '' : `<td data-adviser="${b.id}"></td>`}
      </tr>`).join('')}</tbody></table></div>`;
}

export async function renderLegislation(el, { house } = {}) {
  const commons = house === 'commons';
  const where = commons ? 'Commons' : 'Lords';
  el.innerHTML = `${pageHeader('Legislation', `Every live Bill currently in the House of ${where}. Open a Bill for its stage dates, the documents and the amendments.`)}
    <div id="bills">${loading('Loading Bills')}</div>`;
  const box = el.querySelector('#bills');
  let b;
  try {
    b = await api(commons ? 'commons/bills' : 'bills');
  } catch (err) {
    box.innerHTML = errorBox(err);
    return;
  }
  box.innerHTML = `
    <section><h2 class="h2-rule">Government Bills <span class="count">${b.government.length}</span></h2>${table(b.government, `No Government Bills are currently in the ${where}.`, commons)}</section>
    <section><h2 class="h2-rule">Private Members' Bills <span class="count">${b.privateMembers.length}</span></h2>${table(b.privateMembers, `No Private Members' Bills are currently in the ${where}.`, commons)}</section>
    ${b.other.length ? `<section><h2 class="h2-rule">Other Bills <span class="count">${b.other.length}</span></h2>${table(b.other, '', commons)}</section>` : ''}
    <p class="small muted">Date of next stage is the next sitting published on bills.parliament.uk, or in the What's On calendar if that is sooner. "Not yet scheduled" means no sitting has been published for that Bill yet.</p>`;

  const ids = [...b.government, ...b.privateMembers, ...b.other].map((x) => x.id);
  const next = {}; // billId -> { date, stage, house }: the earliest date found from either source

  const paintNext = (id) => {
    const td = box.querySelector(`[data-next="${id}"]`);
    const n = next[id];
    if (!td || !n) return;
    td.innerHTML = `<span class="nowrap">${esc(fmtDate(n.date, DATE_FORMAT))}</span>`;
  };
  const offer = (id, cand) => {
    if (!cand?.date) return;
    if (!next[id] || cand.date < next[id].date || (cand.date === next[id].date && !next[id].stage && cand.stage)) {
      next[id] = cand;
      paintNext(id);
    }
  };

  // 1. Advisers, plus dates found in the What's On calendar (one quick request). The Lords only: the advisers are the Lords Whips' Office's.
  if (!commons) try {
    const extras = await api('bill-extras');
    box.querySelectorAll('[data-adviser]').forEach((td) => {
      const a = extras.advisers?.[td.dataset.adviser];
      td.innerHTML = a?.name ? esc(a.name) : '<span class="muted">—</span>';
    });
    for (const [id, n] of Object.entries(extras.nextDates || {})) offer(id, n);
    const notes = (extras.notes || []).map((n) => `<p class="small muted">${esc(n)}</p>`).join('');
    if (notes) box.insertAdjacentHTML('beforeend', notes);
  } catch (err) {
    box.querySelectorAll('[data-adviser]').forEach((td) => { td.innerHTML = '<span class="muted">Unavailable</span>'; });
  }

  // 2. Dates from the Bills API. The server answers from its saved copies at once; any Bill it has to look up live
  //    (a new Bill, or after "Refresh now") comes back in `missing` and is asked for again, so rows fill in as answers arrive.
  let failedAny = false;
  let pending = ids;
  for (let round = 0; pending.length && round < 20; round++) {
    if (!box.isConnected) return; // the person has moved to another page
    try {
      const d = await api(`bill-next?ids=${pending.slice(0, BATCH).join(',')}`);
      for (const [id, n] of Object.entries(d.dates || {})) offer(id, n);
      if (d.failed?.length) failedAny = true;
      pending = [...(d.missing || []), ...pending.slice(BATCH)];
    } catch { failedAny = true; break; }
  }

  // 3. Anything still unresolved.
  box.querySelectorAll('[data-next]').forEach((td) => {
    if (!next[td.dataset.next]) td.innerHTML = `<span class="muted">${failedAny ? 'Not found' : 'Not yet scheduled'}</span>`;
  });
  if (failedAny) box.insertAdjacentHTML('beforeend', '<p class="small muted">Some dates could not be fetched from bills.parliament.uk just now; "Not found" rows may have a date. Refresh in a minute.</p>');
}
