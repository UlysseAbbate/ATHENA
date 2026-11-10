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

/** The two sections of the page and their tabs. Primary legislation is Bills; secondary legislation is statutory instruments. */
const SECTIONS = [
  { title: 'Primary legislation', tabs: [['live', 'Live Bills', '#/legislation'], ['previous', 'Previous Bills', '#/legislation/previous']] },
];
const nav = (tab) => SECTIONS.map((sec) => `<div class="leg-section"><h2 class="leg-section-title">${esc(sec.title)}</h2>
  <div class="toggle" role="group" aria-label="${esc(sec.title)}">${sec.tabs.map(([key, label, href]) => `<a href="${href}" ${key === tab ? 'aria-current="true"' : ''}>${esc(label)}</a>`).join('')}</div></div>`).join('');

const fmtRA = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

/** Previous Bills: every Bill that has received Royal Assent, newest first, each linking to its page here. */
async function renderPrevious(box) {
  box.innerHTML = loading('Loading previous Bills');
  let data;
  try { data = await api('previous-bills'); } catch (err) { box.innerHTML = errorBox(err); return; }
  const all = data.bills || [];
  const years = [...new Set(all.map((b) => b.royalAssent.slice(0, 4)))].sort().reverse();
  let q = '', year = '';
  const draw = () => {
    const rows = all.filter((b) => (!year || b.royalAssent.startsWith(year)) && (!q || b.title.toLowerCase().includes(q)));
    box.querySelector('[data-prev-list]').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid leg-table">
      <thead><tr><th scope="col" class="col-bill">Bill</th><th scope="col">Portfolio</th><th scope="col">Royal Assent</th></tr></thead>
      <tbody>${rows.map((b) => `<tr>
        <th scope="row" class="col-bill"><a href="${/commons/i.test(b.originatingHouse) ? '#/c/bill/' : '#/bill/'}${b.id}">${esc(b.title)}</a></th>
        <td>${(b.portfolios || []).map((c) => `<a class="tag" href="#/portfolio/${esc(c)}">${esc(c)}</a>`).join(' ')}</td>
        <td>${esc(fmtRA(b.royalAssent))}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="state">No Bills match.</p>';
    box.querySelector('[data-prev-count]').textContent = String(rows.length);
  };
  box.innerHTML = `<section><h2 class="h2-rule">Bills that have received Royal Assent <span class="count" data-prev-count>${all.length}</span></h2>
    <div class="row"><label class="field"><span>Search by title</span><input type="search" data-prev-q></label>
      <label class="field field-narrow"><span>Year of Royal Assent</span><select data-prev-year><option value="">All years</option>${years.map((y) => `<option>${esc(y)}</option>`).join('')}</select></label></div>
    <div data-prev-list></div>
    <p class="small muted">A Bill moves here when it receives Royal Assent. Open one for its stages, documents and amendments.</p></section>`;
  draw();
  box.querySelector('[data-prev-q]').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
  box.querySelector('[data-prev-year]').addEventListener('change', (e) => { year = e.target.value; draw(); });
}

async function renderLive(box) {
  box.innerHTML = loading('Loading Bills');
  let b;
  try {
    b = await allBills();
  } catch (err) {
    box.innerHTML = errorBox(err);
    return;
  }
  box.innerHTML = `<p class="small"><span class="legend legend-commons">In the Commons</span> <span class="legend legend-lords">In the Lords</span></p>
    <section><h2 class="h2-rule">Government Bills <span class="count">${b.government.length}</span></h2>${table(b.government, 'No Government Bills are currently live.')}</section>
    <section><h2 class="h2-rule">Private Members' Bills <span class="count">${b.privateMembers.length}</span></h2>${table(b.privateMembers, "No Private Members' Bills are currently live.")}</section>
    ${b.other.length ? `<section><h2 class="h2-rule">Other Bills <span class="count">${b.other.length}</span></h2>${table(b.other, '')}</section>` : ''}
    <p class="small muted">A Bill's portfolio is the department that sponsors it (a Private Members' Bill has no department, so it is placed by its subject).</p>`;
}

export async function renderLegislation(el, { tab = 'live' } = {}) {
  el.innerHTML = `${pageHeader('Legislation', 'Primary legislation: every live Bill in Parliament, and the Bills that have become Acts. Open a Bill for its next stage, who is looking after it, its stages, documents and amendments.')}
    ${nav(tab)}
    <div id="leg-body"></div>`;
  const box = el.querySelector('#leg-body');
  if (tab === 'previous') return renderPrevious(box);
  return renderLive(box);
}
