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

/** The House a Bill is in: the House of its current stage if the Bills API says, else the list it came from. */
const houseOf = (b) => (/commons/i.test(b.stageHouse || '') ? 'Commons' : /lords/i.test(b.stageHouse || '') ? 'Lords' : b.house);

/** One table of Bills, from either House. The Bill and Next Stage columns are narrow; the Current stage cell is green for a Bill in the Commons and red for one in the Lords. */
function table(bills, emptyText) {
  if (!bills.length) return `<p class="state">${esc(emptyText)}</p>`;
  return `<div class="table-wrap"><table class="grid leg-table">
    <thead><tr><th scope="col" class="col-bill">Bill</th><th scope="col">Portfolio</th><th scope="col">Current stage</th><th scope="col" class="col-next">Next Stage</th><th scope="col">Adviser</th></tr></thead>
    <tbody>${bills.map((b) => `
      <tr>
        <th scope="row" class="col-bill"><a href="${houseOf(b) === 'Commons' ? '#/c/bill/' : '#/bill/'}${b.id}">${esc(b.title)}</a></th>
        <td>${tags(b)}</td>
        <td class="leg-stage leg-stage-${houseOf(b) === 'Commons' ? 'commons' : 'lords'}">${esc(b.stage)}</td>
        <td class="col-next" data-next="${b.id}"><span class="muted small">Checking\u2026</span></td>
        <td data-adviser="${b.id}">${houseOf(b) === 'Commons' ? '<span class="muted">\u2014</span>' : ''}</td>
      </tr>`).join('')}</tbody></table></div>`;
}

/** Every live Bill in Parliament: the Lords' and the Commons' lists put together, each Bill marked with the House it is in. */
async function allBills() {
  const [lords, commons] = await Promise.all([api('bills'), api('commons/bills')]);
  const out = { government: [], privateMembers: [], other: [] };
  const seen = new Set();
  for (const [house, d] of [['Lords', lords], ['Commons', commons]]) {
    for (const k of Object.keys(out)) for (const bill of d[k] || []) {
      if (seen.has(bill.id)) continue;
      seen.add(bill.id);
      out[k].push({ ...bill, house });
    }
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

export async function renderLegislation(el) {
  el.innerHTML = `${pageHeader('Legislation', 'Every live Bill in Parliament, in the Commons and the Lords. Open a Bill for its stage dates, the documents and the amendments.')}
    <p class="small"><span class="legend legend-commons">In the Commons</span> <span class="legend legend-lords">In the Lords</span></p>
    <div id="bills">${loading('Loading Bills')}</div>`;
  const box = el.querySelector('#bills');
  let b;
  try {
    b = await allBills();
  } catch (err) {
    box.innerHTML = errorBox(err);
    return;
  }
  box.innerHTML = `
    <section><h2 class="h2-rule">Government Bills <span class="count">${b.government.length}</span></h2>${table(b.government, 'No Government Bills are currently live.')}</section>
    <section><h2 class="h2-rule">Private Members' Bills <span class="count">${b.privateMembers.length}</span></h2>${table(b.privateMembers, "No Private Members' Bills are currently live.")}</section>
    ${b.other.length ? `<section><h2 class="h2-rule">Other Bills <span class="count">${b.other.length}</span></h2>${table(b.other, '')}</section>` : ''}
    <p class="small muted">Next Stage is the next sitting published on bills.parliament.uk, or in the What's On calendar if that is sooner. "Not yet scheduled" means no sitting has been published for that Bill yet.</p>`;

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

  // 1. Advisers (the Lords Whips' Office's, so Commons Bills have none), plus dates found in the What's On calendar (one quick request).
  try {
    const extras = await api('bill-extras');
    box.querySelectorAll('[data-adviser]').forEach((td) => {
      const a = extras.advisers?.[td.dataset.adviser];
      if (td.innerHTML) return; // a Commons Bill has no adviser
      td.innerHTML = a?.name ? esc(a.name) : '<span class="muted">\u2014</span>';
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
