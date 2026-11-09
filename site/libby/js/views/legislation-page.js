// Legislation: every live Bill in Parliament, in the Commons and the Lords, in one list of three columns: the Bill, its portfolio and its current stage
// (green in the Commons, red in the Lords). Everything else about a Bill (the next stage, who is looking after it, the stages, documents and
// amendments) is on the Bill's own page.
import { api } from '../api.js';
import { esc, loading, errorBox, pageHeader } from '../ui.js';

/** The Bill's portfolio chips: the department that sponsors it. A Bill that no department or keyword placed is marked, so it can be settled in lib/portfolio-overrides.js. */
function tags(b) {
  const chips = (b.portfolios || []).map((c) => `<a class="tag" href="#/portfolio/${esc(c)}">${esc(c)}</a>`).join(' ');
  const guess = b.portfolioBy === 'default'
    ? ' <span class="muted small" title="No department or keyword matched this Bill, so it is shown under the Cabinet Office. Add it to lib/portfolio-overrides.js to place it.">(default)</span>' : '';
  return chips + guess;
}

/** The House a Bill is in: the House of its current stage if the Bills API says, else the list it came from. */
const houseOf = (b) => (/commons/i.test(b.stageHouse || '') ? 'Commons' : /lords/i.test(b.stageHouse || '') ? 'Lords' : b.house);

/** One table of Bills: the Bill, its portfolio, its current stage. The stage cell is green for a Bill in the Commons and red for one in the Lords. */
function table(bills, emptyText) {
  if (!bills.length) return `<p class="state">${esc(emptyText)}</p>`;
  return `<div class="table-wrap"><table class="grid leg-table">
    <thead><tr><th scope="col" class="col-bill">Bill</th><th scope="col">Portfolio</th><th scope="col">Current stage</th></tr></thead>
    <tbody>${bills.map((b) => `
      <tr>
        <th scope="row" class="col-bill"><a href="${houseOf(b) === 'Commons' ? '#/c/bill/' : '#/bill/'}${b.id}">${esc(b.title)}</a></th>
        <td>${tags(b)}</td>
        <td class="leg-stage leg-stage-${houseOf(b) === 'Commons' ? 'commons' : 'lords'}">${esc(b.stage)}</td>
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
  el.innerHTML = `${pageHeader('Legislation', 'Every live Bill in Parliament, in the Commons and the Lords. Open a Bill for its next stage, who is looking after it, its stages, documents and amendments.')}
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
    <p class="small muted">A Bill's portfolio is the department that sponsors it (a Private Members' Bill has no department, so it is placed by its subject).</p>`;
}
