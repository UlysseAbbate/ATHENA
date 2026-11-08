// The Data page (Whips and above): #/data, #/data/votes?view=..., #/data/lords?d=...
//   Voting Data: the Whips' Office voting analysis, worked out from the Lords Votes API (see lib/voting-analysis.js).
//   Lords Data:  the House of Lords Library's data dashboards in one place.
// Each subpage shows one type of data at a time, chosen with the buttons along the top.
import { api } from '../api.js';
import { esc, fmtDate, todayIso, addDays, loading, errorBox, empty, extLink, pageHeader } from '../ui.js';
import { loadLib } from '../docs/loader.js';

const PARLIAMENT_START = '2024-07-09';
const crumbs = [['#/data', 'Data']];

/** A row of buttons, one per type of data; the current one is marked. */
function buttonRow(items, current, hrefFor) {
  return `<nav class="data-buttons button-grid" aria-label="Choose the data to show">${items.map(([key, label]) =>
    `<a class="button ${key === current ? '' : 'button-quiet'}" href="${esc(hrefFor(key))}" ${key === current ? 'aria-current="true"' : ''}>${esc(label)}</a>`).join('')}</nav>`;
}

/* ------------------------------------------------------------------ Landing */

function landing(el) {
  el.innerHTML = `${pageHeader('Data', 'Voting analysis and House of Lords data for the Whips\u2019 Office.')}
    <nav class="index index-small" aria-label="Data sections">
      <a class="index-row" href="#/data/votes"><span class="index-title"><span class="swipe">Voting Data</span></span>
        <span class="index-text">Every Lords division: Government wins and defeats, how the Lib Dems voted alongside the other parties, and where they made the difference.</span></a>
      <a class="index-row" href="#/data/lords"><span class="index-title"><span class="swipe">Lords Data</span></span>
        <span class="index-text">The House of Lords Library\u2019s data dashboards: membership, peerage creations, party strengths, sittings, delegated legislation and more.</span></a>
    </nav>`;
}

/* ------------------------------------------------------------------ Voting Data */

const VOTE_VIEWS = [
  ['summary', 'Summary'],
  ['months', 'Month by month'],
  ['divisions', 'All divisions'],
  ['defeats', 'Government defeats'],
  ['difference', 'Where Lib Dems made the difference'],
  ['splits', 'Party splits'],
  ['departments', 'By department'],
  ['download', 'Download spreadsheet'],
];

const tick = (b) => (b ? '<span class="data-yes" title="Yes">\u2713</span>' : '');
const partyCell = (p) => (p.intention === 'Abstain' ? '<span class="muted">Abstain</span>' : `${esc(p.intention)} <span class="muted">(${p.votes})</span>`);
const monthName = (m) => fmtDate(`${m}-01`, { month: 'long', year: 'numeric' });
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '\u2013');

function summaryTable(t) {
  const row = (label, n) => `<tr><th scope="row">${esc(label)}</th><td class="num">${n}</td><td class="num">${pct(n, t.divisions)}</td></tr>`;
  const group = (title) => `<tr class="data-group"><th scope="colgroup" colspan="3">${esc(title)}</th></tr>`;
  return `<div class="table-wrap"><table class="grid data-table data-table-sum">
    <thead><tr><th scope="col">Measure</th><th scope="col" class="num">Divisions</th><th scope="col" class="num">Share of all divisions</th></tr></thead>
    <tbody>
      <tr class="data-total"><th scope="row">All divisions</th><td class="num">${t.divisions}</td><td class="num">100%</td></tr>
      ${group('The Government')}
      ${row('Government wins', t.govWin)}${row('Government defeats', t.govDefeats)}
      ${group('How the Lib Dems voted')}
      ${row('Lib Dems voted with the Conservatives', t.ldCon)}${row('Lib Dems voted with Labour', t.ldLab)}${row('Lib Dems alone or abstaining', t.ldAlone)}
      ${group('Where the Lib Dems mattered')}
      ${row('Lib Dems made the difference', t.ldDiff)}${row('Conservatives needed the Lib Dems', t.conNeedLd)}${row('Labour needed the Lib Dems', t.labNeedLd)}${row('Lib Dems with no other support', t.ldNoSupport)}
      ${group('Party discipline')}
      ${row('Divisions with a party split', t.splits)}
    </tbody></table></div>
    <p class="small muted">The groups overlap, so the shares do not add up to 100%: for example, a division can be both a Government defeat and one where the Lib Dems made the difference.</p>`;
}

const tallyHead = '<th scope="col">Divisions</th><th scope="col">Gov wins</th><th scope="col">Gov defeats</th><th scope="col">LD + Con</th><th scope="col">LD + Lab</th><th scope="col">LD alone</th><th scope="col">LD made the difference</th><th scope="col">Con needed LD</th><th scope="col">Lab needed LD</th><th scope="col">LD no other support</th>';
const tallyCells = (t) => [t.divisions, t.govWin, t.govDefeats, t.ldCon, t.ldLab, t.ldAlone, t.ldDiff, t.conNeedLd, t.labNeedLd, t.ldNoSupport].map((n) => `<td class="num">${n}</td>`).join('');

function monthsTable(d) {
  return `<div class="table-wrap"><table class="grid data-table"><thead><tr><th scope="col">Month</th>${tallyHead}</tr></thead><tbody>
    ${d.months.map((m) => `<tr><th scope="row">${esc(monthName(m.month))}</th>${tallyCells(m)}</tr>`).join('')}
    <tr class="data-total"><th scope="row">Total</th>${tallyCells(d.total)}</tr></tbody></table></div>`;
}

function departmentsTable(d) {
  return `<div class="table-wrap"><table class="grid data-table"><thead><tr><th scope="col">Department</th>${tallyHead}</tr></thead><tbody>
    ${d.departments.map((x) => `<tr><th scope="row">${/^[A-Z]+$/.test(x.department) ? `<a href="#/portfolio/${esc(x.department)}">${esc(x.department)}</a>` : esc(x.department)}</th>${tallyCells(x)}</tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">A division's title is the Bill's (or instrument's) name. Its department comes from the corrections in lib/portfolio-overrides.js, then the department of the live Bill of that name, then keywords (the same matching as the portfolio pages). A division none of these places is under Other: add its title to lib/portfolio-overrides.js.</p>`;
}

/* ------------------------------------------------------------------ Month-by-month line graph */

const CHART_SERIES = [
  ['divisions', 'Divisions', '#1F3864', true],
  ['govDefeats', 'Government defeats', '#C00000', true],
  ['ldDiff', 'Lib Dems made the difference', '#E97132', true],
  ['govWin', 'Government wins', '#6b7a99', false],
  ['ldCon', 'LD + Con', '#8e5ea2', false],
  ['ldLab', 'LD + Lab', '#2e8b57', false],
  ['ldAlone', 'LD alone / abstain', '#b8860b', false],
];

/** Every month from the first to the last, with zero for months with no divisions (recesses). */
function monthRange(months) {
  if (!months.length) return [];
  const byMonth = Object.fromEntries(months.map((m) => [m.month, m]));
  const out = [];
  let [y, m] = months[0].month.split('-').map(Number);
  const last = months[months.length - 1].month;
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(byMonth[key] || { month: key, divisions: 0, govWin: 0, govDefeats: 0, ldCon: 0, ldLab: 0, ldAlone: 0, ldDiff: 0 });
    if (key >= last) break;
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

const shortMonth = (m) => fmtDate(`${m}-01`, { month: 'short', year: '2-digit' });

/** A tidy step for the vertical axis: 1, 2, 5, 10, 20, 25, 50, 100 ... giving about six gridlines. */
function niceStep(top) {
  return [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500].find((s) => top / s <= 6) || 1000;
}

/** The figures to plot: each month's own figure, or the running total up to and including that month. */
function plotted(months, cumulative) {
  const run = {};
  return months.map((m) => {
    const out = { month: m.month };
    for (const [k] of CHART_SERIES) { run[k] = (run[k] || 0) + (m[k] || 0); out[k] = cumulative ? run[k] : m[k] || 0; }
    return out;
  });
}

function chartSvg(allMonths, shown, cumulative) {
  const months = plotted(allMonths, cumulative);
  const W = 960; const H = 420; const L = 52; const R = 24; const T = 24; const B = 74;
  const lines = CHART_SERIES.filter(([k]) => shown.has(k));
  const top = Math.max(5, ...lines.flatMap(([k]) => months.map((m) => m[k])));
  const step = niceStep(top);
  const max = Math.ceil(top / step) * step;
  const x = (i) => L + (months.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (months.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const every = months.length > 24 ? 3 : months.length > 14 ? 2 : 1;
  const grid = [];
  for (let v = 0; v <= max; v += step) grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#d9dde6"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="12">${v}</text>`);
  const ticks = months.map((m, i) => (i % every ? '' : `<text transform="translate(${x(i)} ${H - B + 16}) rotate(-40)" text-anchor="end" font-size="12">${esc(shortMonth(m.month))}</text>`)).join('');
  const paths = lines.map(([k, label, colour]) => {
    const pts = months.map((m, i) => `${x(i).toFixed(1)},${y(m[k]).toFixed(1)}`).join(' ');
    const dots = months.map((m, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(m[k]).toFixed(1)}" r="4" fill="${colour}"><title>${esc(label)}, ${cumulative ? 'up to the end of ' : ''}${esc(monthName(m.month))}: ${m[k]}${cumulative ? ' in total' : ''}</title></circle>`).join('');
    return `<polyline points="${pts}" fill="none" stroke="${colour}" stroke-width="2.5" stroke-linejoin="round"/>${dots}`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line graph of divisions by month${cumulative ? ' (cumulative)' : ''}">
    ${grid.join('')}<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="#444"/>
    <text transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" font-size="12">${cumulative ? 'Divisions so far (running total)' : 'Divisions in the month'}</text>
    ${ticks}${paths}</svg>`;
}

function monthChart(box, d) {
  const months = monthRange(d.months);
  if (months.length < 2) return;
  const shown = new Set(CHART_SERIES.filter((x) => x[3]).map((x) => x[0]));
  let cumulative = false;
  box.insertAdjacentHTML('beforeend', `<section class="data-chart" aria-label="Month by month graph">
    <h2 class="h2-rule">Month by month graph</h2>
    <div class="data-chart-mode" role="radiogroup" aria-label="How to plot the lines">
      <label><input type="radio" name="chart-mode" value="month" checked> Each month</label>
      <label><input type="radio" name="chart-mode" value="total"> Cumulative (running total)</label>
    </div>
    <div class="data-chart-key" role="group" aria-label="Choose the lines to show">${CHART_SERIES.map(([k, label, colour]) =>
      `<label><input type="checkbox" value="${k}" ${shown.has(k) ? 'checked' : ''}><span class="swatch" style="background:${colour}"></span>${esc(label)}</label>`).join('')}</div>
    <div data-svg></div>
    <p class="small muted" data-chart-note></p></section>`);
  const svg = box.querySelector('[data-svg]');
  const note = box.querySelector('[data-chart-note]');
  const draw = () => {
    svg.innerHTML = chartSvg(months, shown, cumulative);
    note.textContent = cumulative
      ? 'Each line adds up every month so far, so it only ever rises. Hover over a point to see the running total.'
      : 'Months with no divisions (such as recesses) show as zero. Hover over a point to see its figure.';
  };
  box.querySelector('.data-chart-key').addEventListener('change', (e) => {
    if (e.target.checked) shown.add(e.target.value); else shown.delete(e.target.value);
    draw();
  });
  box.querySelector('.data-chart-mode').addEventListener('change', (e) => { cumulative = e.target.value === 'total'; draw(); });
  draw();
}

/** The divisions table (the workbook's Calculations sheet). `cols` picks the flag columns to show. */
function divisionsTable(list, cols = ['govWin', 'ldCon', 'ldLab', 'ldAlone', 'ldDiff', 'conNeedLd', 'labNeedLd', 'ldNoSupport']) {
  if (!list.length) return empty('No divisions match.');
  const labels = { govWin: 'Gov win', ldCon: 'LD + Con', ldLab: 'LD + Lab', ldAlone: 'LD alone', ldDiff: 'LD made the difference', conNeedLd: 'Con needed LD', labNeedLd: 'Lab needed LD', ldNoSupport: 'LD no other support' };
  return `<p class="small muted">${list.length} division${list.length === 1 ? '' : 's'}. Party columns show how most of the party voted, with that number of votes in brackets.</p>
    <div class="table-wrap"><table class="grid data-table"><thead><tr>
      <th scope="col">Date</th><th scope="col">Division</th><th scope="col">Dept</th><th scope="col">Result</th><th scope="col">Majority</th>
      <th scope="col">Conservative</th><th scope="col">Labour</th><th scope="col">Lib Dem</th>
      ${cols.map((c) => `<th scope="col">${esc(labels[c])}</th>`).join('')}</tr></thead><tbody>
    ${list.map((x) => `<tr>
      <td class="nowrap">${esc(fmtDate(x.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</td>
      <td>${extLink(x.url, x.title)} <span class="small muted">#${esc(x.id)}</span></td>
      <td>${esc(x.department)}</td>
      <td class="nowrap">${esc(x.result)} <span class="muted small">${x.content}\u2013${x.notContent}</span></td>
      <td class="num">${x.majority}</td>
      <td>${partyCell(x.parties.con)}</td><td>${partyCell(x.parties.lab)}</td><td>${partyCell(x.parties.ld)}</td>
      ${cols.map((c) => `<td class="num">${tick(x[c])}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>`;
}

function splitsTable(list) {
  const rows = list.filter((x) => x.splits.length);
  if (!rows.length) return empty('No party splits in this period.');
  const names = { con: 'Conservative', lab: 'Labour', ld: 'Lib Dem' };
  return `<p class="small muted">${rows.length} divisions where at least one Conservative, Labour or Lib Dem peer voted against the way most of their party voted.</p>
    <div class="table-wrap"><table class="grid data-table"><thead><tr><th scope="col">Date</th><th scope="col">Division</th><th scope="col">Conservative</th><th scope="col">Labour</th><th scope="col">Lib Dem</th></tr></thead><tbody>
    ${rows.map((x) => `<tr><td class="nowrap">${esc(fmtDate(x.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</td><td>${extLink(x.url, x.title)}</td>
      ${['con', 'lab', 'ld'].map((k) => { const p = x.parties[k]; return `<td>${p.rebels && p.intention !== 'Abstain' ? `<strong>${p.content} content / ${p.notContent} not content</strong>` : `<span class="muted">${p.intention === 'Abstain' ? 'Did not vote' : 'United'}</span>`}</td>`; }).join('')}
    </tr>`).join('')}</tbody></table></div>
    <p class="small muted">${Object.values(names).join(', ')}: "United" means every member who voted took the same side.</p>`;
}

function divisionsWithFilter(box, list) {
  box.innerHTML = `<form class="search" data-filter-form role="search">
      <label class="field"><span>Filter by title</span><input type="search" name="q" placeholder="e.g. Planning and Infrastructure Bill"></label>
      <label class="field field-narrow"><span>Show</span><select name="flag">
        <option value="">All divisions</option><option value="govWin">Government wins</option><option value="defeat">Government defeats</option>
        <option value="ldCon">LD + Con</option><option value="ldLab">LD + Lab</option><option value="ldAlone">LD alone / abstain</option>
        <option value="ldDiff">LD made the difference</option><option value="conNeedLd">Con needed LD</option><option value="labNeedLd">Lab needed LD</option>
        <option value="ldNoSupport">LD with no other support</option></select></label>
    </form><div data-table></div>`;
  const form = box.querySelector('[data-filter-form]');
  const out = box.querySelector('[data-table]');
  const draw = () => {
    const q = form.elements.namedItem('q').value.trim().toLowerCase();
    const flag = form.elements.namedItem('flag').value;
    out.innerHTML = divisionsTable(list.filter((x) => (!q || x.title.toLowerCase().includes(q))
      && (!flag || (flag === 'defeat' ? !x.govWin : x[flag]))));
  };
  form.addEventListener('input', draw);
  form.addEventListener('submit', (e) => { e.preventDefault(); draw(); });
  draw();
}

/** The workbook's layout, as a download (Divisions, Months and Departments sheets). */
async function downloadSpreadsheet(d, status) {
  status.textContent = 'Preparing the spreadsheet\u2026';
  try {
    const XLSX = await loadLib('XLSX');
    const yes = (b) => (b ? 'TRUE' : 'FALSE');
    const divisions = d.divisions.map((x) => ({
      'Division Number': x.id, 'Vote Link': x.url, 'Vote Name': x.title, Date: x.date, Department: x.department,
      Content: x.content, 'Not Content': x.notContent, Result: x.result,
      'Tory Intention': x.parties.con.intention, 'Tory Votes': x.parties.con.votes,
      'Labour Intention': x.parties.lab.intention, 'Labour Votes': x.parties.lab.votes,
      'Lib Dem Intention': x.parties.ld.intention, 'Lib Dem Vote': x.parties.ld.votes,
      Majority: x.majority, 'Government Win or Loss': yes(x.govWin), 'LD+Con': yes(x.ldCon), 'LD+Lab': yes(x.ldLab),
      'LD Alone/Abstain': yes(x.ldAlone), 'LD Made the Difference': yes(x.ldDiff), 'Cons need LD': yes(x.conNeedLd),
      'Lab Need LD': yes(x.labNeedLd), 'LDs and no other support': yes(x.ldNoSupport),
      'Party Splits': x.splits.map((k) => ({ con: 'Con', lab: 'Lab', ld: 'LD' }[k])).join(', '),
    }));
    const tallyRow = (label, t) => ({
      [label[0]]: label[1], Divisions: t.divisions, 'Government wins': t.govWin, 'Government defeats': t.govDefeats, 'LD+Con': t.ldCon, 'LD+Lab': t.ldLab,
      'LD Alone/Abstain': t.ldAlone, 'LD Made the Difference': t.ldDiff, 'Cons need LD': t.conNeedLd, 'Lab Need LD': t.labNeedLd, 'LDs and no other support': t.ldNoSupport,
    });
    const wb = XLSX.utils.book_new();
    const add = (rows, name, widths) => {
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = widths.map((w) => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    add(divisions, 'Divisions', [10, 48, 48, 11, 10, 8, 10, 11, 13, 9, 14, 11, 14, 10, 9, 12, 8, 8, 10, 12, 11, 11, 12, 10]);
    add([...d.months.map((m) => tallyRow(['Month', monthName(m.month)], m)), tallyRow(['Month', 'TOTAL'], d.total)], 'Months', [18, 10, 10, 10, 8, 8, 10, 12, 11, 11, 12]);
    add(d.departments.map((x) => tallyRow(['Department', x.department], x)), 'Departments', [12, 10, 10, 10, 8, 8, 10, 12, 11, 11, 12]);
    XLSX.writeFile(wb, `Lords_Voting_Data_${d.from}_to_${d.to}.xlsx`);
    status.textContent = 'Downloaded.';
  } catch (err) {
    status.textContent = `The spreadsheet could not be made: ${err.message}`;
  }
}

let votesCache = { key: '', data: null };

async function votingPage(el, query) {
  const view = VOTE_VIEWS.some(([k]) => k === query.view) ? query.view : 'summary';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : PARLIAMENT_START;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : todayIso();
  const params = (extra) => { const p = new URLSearchParams({ view, ...(query.from ? { from } : {}), ...(query.to ? { to } : {}), ...extra }); return `#/data/votes?${p}`; };

  el.innerHTML = `${pageHeader('Voting Data', 'Lords divisions analysed the Whips\u2019 Office way: Government wins and defeats, who the Lib Dems voted with, and where they made the difference.', crumbs)}
    <form class="search data-range" data-range>
      <label class="field field-narrow"><span>From</span><input type="date" name="from" value="${esc(from)}"></label>
      <label class="field field-narrow"><span>To</span><input type="date" name="to" value="${esc(to)}"></label>
      <button class="button" type="submit">Show</button>
      <span class="small data-presets">Quick ranges:
        <a href="${esc(params({ from: PARLIAMENT_START, to: todayIso() }))}">Whole Parliament</a>
        <a href="${esc(params({ from: addDays(todayIso(), -365), to: todayIso() }))}">Last 12 months</a>
        <a href="${esc(params({ from: `${todayIso().slice(0, 4)}-01-01`, to: todayIso() }))}">This year</a>
        <a href="${esc(params({ from: `${todayIso().slice(0, 7)}-01`, to: todayIso() }))}">This month</a></span>
    </form>
    ${buttonRow(VOTE_VIEWS, view, (k) => params({ view: k }))}
    <div id="data-body">${loading('Loading the divisions')}</div>`;

  el.querySelector('[data-range]').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    location.hash = params({ from: f.get('from') || PARLIAMENT_START, to: f.get('to') || todayIso() });
  });

  const box = el.querySelector('#data-body');
  const key = `${from}|${to}`;
  let d = votesCache.key === key ? votesCache.data : null;
  if (!d) {
    try { d = await api(`data/votes?from=${from}&to=${to}`); votesCache = { key, data: d }; }
    catch (err) { box.innerHTML = errorBox(err); return; }
  }
  if (!box.isConnected) return;
  const period = `${fmtDate(d.from, { day: 'numeric', month: 'long', year: 'numeric' })} to ${fmtDate(d.to, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  const foot = `<p class="small muted">Source: ${extLink('https://votes.parliament.uk/votes/lords', 'Lords Votes')}, copied each morning${d.updated ? ` (last copied ${esc(fmtDate(d.updated, { day: 'numeric', month: 'short', year: 'numeric' }))})` : ''}. A party's "intention" is the way most of its peers voted. The Government party is Labour.</p>`;
  if (!d.divisions.length) {
    box.innerHTML = `${empty(`No divisions are stored for ${period}.`)}<p class="small muted">If this is unexpected, run the \u201cIngest Lords votes\u201d workflow in GitHub Actions.</p>`;
    return;
  }

  const heading = (t) => `<h2 class="h2-rule">${esc(t)} <span class="small muted">${esc(period)}</span></h2>`;
  if (view === 'summary') box.innerHTML = `${heading('Summary')}${summaryTable(d.total)}${foot}`;
  if (view === 'months') { box.innerHTML = `${heading('Month by month')}${monthsTable(d)}${foot}`; monthChart(box, d); }
  if (view === 'departments') box.innerHTML = `${heading('By department')}${departmentsTable(d)}${foot}`;
  if (view === 'defeats') box.innerHTML = `${heading('Government defeats')}${divisionsTable(d.divisions.filter((x) => !x.govWin), ['ldCon', 'ldLab', 'ldDiff'])}${foot}`;
  if (view === 'difference') box.innerHTML = `${heading('Where Lib Dems made the difference')}<p class="small muted">The result went the Lib Dems\u2019 way and the majority was smaller than twice the Lib Dem vote, so the Lib Dems voting the other way would have changed it.</p>${divisionsTable(d.divisions.filter((x) => x.ldDiff), ['govWin', 'conNeedLd', 'labNeedLd', 'ldNoSupport'])}${foot}`;
  if (view === 'splits') box.innerHTML = `${heading('Party splits')}${splitsTable(d.divisions)}${foot}`;
  if (view === 'divisions') { box.innerHTML = `${heading('All divisions')}<div data-all></div>${foot}`; divisionsWithFilter(box.querySelector('[data-all]'), d.divisions); }
  if (view === 'download') {
    box.innerHTML = `${heading('Download spreadsheet')}
      <p>An Excel workbook in the same layout as the Voting Data spreadsheet: a Divisions sheet (one row per division, with every calculation), a Months sheet with totals, and a Departments sheet.</p>
      <p><button class="button" type="button" data-dl>Download (${d.divisions.length} divisions)</button> <span class="small" data-status aria-live="polite"></span></p>${foot}`;
    box.querySelector('[data-dl]').addEventListener('click', () => downloadSpreadsheet(d, box.querySelector('[data-status]')));
  }
}

/* ------------------------------------------------------------------ Lords Data */

const slugOf = (url) => String(url).replace(/^https:\/\/lordslibrary\.parliament\.uk\//, '').replace(/\/$/, '');

// The dashboards known in October 2026: short name for the button, full title, one-line description.
// These are used first, so the page shows clean names whatever the list read from the Library looks like.
const DASHBOARDS = {
  'house-of-lords-data-dashboard-membership-of-the-house': ['Current membership of the House', 'House of Lords data dashboard: Current membership of the House', 'The size of the House and breakdowns by party, gender, age and length of service.'],
  'house-of-lords-data-dashboard-peerage-creations': ['Peerage creations', 'House of Lords data dashboard: Peerage creations', 'The creation of life peerages.'],
  'house-of-lords-data-dashboard-party-and-group-strengths-and-voting': ['Party and group strengths and voting', 'House of Lords data dashboard: Party and group strengths and voting', 'The relative sizes of the largest parties and groups, with selected statistics on voting behaviour.'],
  'lords-reform-membership-attendance-voting-and-participation-data-2019-2024-parliament': ['Lords reform: membership, attendance, voting and participation (2019\u201324)', 'Lords reform: Membership, attendance, voting and participation data (2019\u20132024 parliament)', 'Member activity over the 2019\u201324 Parliament: attendance, votes, debates, written questions and roles.'],
  'house-of-lords-data-dashboard-business-and-sittings-of-the-house': ['Business and sittings of the House', 'House of Lords data dashboard: Business and sittings of the House', 'The business of the House and the length of sittings.'],
  'house-of-lords-largest-votes-and-government-defeats': ['Largest votes and government defeats', 'House of Lords: Largest votes and government defeats', 'Divisions since 1999 in which 500 or more members voted, and government defeats.'],
  'house-of-lords-data-dashboard-delegated-legislation': ['Delegated legislation', 'House of Lords data dashboard: Delegated legislation', 'Delegated legislation in the House of Lords.'],
  'regional-representation-in-the-house-of-lords': ['Regional representation', 'House of Lords data dashboard: Regional representation in the House of Lords', 'Regional representation in the House of Lords.'],
};
const humanise = (slug) => { const t = slug.replace(/-/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
const sane = (t, max) => t && t.length <= max && !/data dashboard .*data dashboard/i.test(t);
const labelOf = (x) => DASHBOARDS[slugOf(x.url)]?.[0] || (sane(x.short, 90) ? x.short : humanise(slugOf(x.url)));
const titleOf = (x) => DASHBOARDS[slugOf(x.url)]?.[1] || (sane(x.title, 150) ? x.title : humanise(slugOf(x.url)));
const descOf = (x) => (sane(x.description, 300) ? x.description : DASHBOARDS[slugOf(x.url)]?.[2] || '');

// How tall the dashboard is, as a percentage of its width. The Library shows its dashboards tall and nearly
// portrait (about 1 wide to 1.5 high), so that is the starting point; "Shorter" and "Taller" adjust it for a
// dashboard with a different shape, and the choice is remembered for that dashboard in this browser.
const EMBED_DEFAULT = 150;
const embedKey = (slug) => `dataEmbedHeight:${slug}`;
const savedHeight = (slug) => { try { const n = Number(localStorage.getItem(embedKey(slug))); return n >= 50 && n <= 300 ? n : EMBED_DEFAULT; } catch { return EMBED_DEFAULT; } };
const saveHeight = (slug, n) => { try { if (n === EMBED_DEFAULT) localStorage.removeItem(embedKey(slug)); else localStorage.setItem(embedKey(slug), String(n)); } catch { /* private mode: not remembered */ } };

/** Load the dashboard only once it is scrolled into view, so it can never pull the page down to itself. */
function mountEmbedWhenVisible(holder, src, title) {
  let done = false;
  const mount = () => {
    if (done || !holder.isConnected) return;
    done = true;
    const top = window.scrollY;
    let userMoved = false;
    const mark = () => { userMoved = true; };
    ['wheel', 'touchmove', 'keydown', 'mousedown'].forEach((ev) => window.addEventListener(ev, mark, { once: true, passive: true }));
    holder.classList.remove('data-embed-wait');
    // Positioned by inline style (not the stylesheet), so the frame always fills ITS OWN box and nothing else.
    holder.innerHTML = `<iframe src="${esc(src)}" title="${esc(title)}" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%;border:0"></iframe>`;
    // Some embedded reports scroll the page when they finish loading: put it back unless the person has scrolled.
    holder.querySelector('iframe').addEventListener('load', () => {
      [0, 300, 1000].forEach((ms) => setTimeout(() => { if (!userMoved && Math.abs(window.scrollY - top) > 100) window.scrollTo(0, top); }, ms));
    });
  };
  if (typeof IntersectionObserver === 'undefined') { mount(); return; }
  const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); mount(); } }, { rootMargin: '0px 0px 200px 0px' });
  io.observe(holder);
}

async function lordsPage(el, query) {
  el.innerHTML = `${pageHeader('Lords Data', 'The House of Lords Library\u2019s data dashboards in one place. Choose a dashboard to open it here.', crumbs)}
    <div id="data-body">${loading('Loading the dashboards')}</div>`;
  const box = el.querySelector('#data-body');
  let list;
  try { list = await api('data/lords'); } catch (err) { box.innerHTML = errorBox(err); return; }
  if (!box.isConnected) return;
  const dashboards = list.dashboards || [];
  const current = dashboards.find((x) => slugOf(x.url) === query.d) || null;

  box.innerHTML = `${list.note ? `<p class="small muted">${esc(list.note)}</p>` : ''}
    ${buttonRow(dashboards.map((x) => [slugOf(x.url), labelOf(x)]), current ? slugOf(current.url) : '', (k) => `#/data/lords?d=${encodeURIComponent(k)}`)}
    <div data-dash>${current ? loading('Opening the dashboard') : `<ul class="records">${dashboards.map((x) => `
      <li class="record"><p class="record-title"><a href="#/data/lords?d=${esc(encodeURIComponent(slugOf(x.url)))}">${esc(titleOf(x))}</a></p>
        ${descOf(x) ? `<p class="small">${esc(descOf(x))}</p>` : ''}${x.date ? `<p class="small muted">Updated ${esc(x.date)}</p>` : ''}</li>`).join('')}</ul>`}</div>
    <p class="small muted">Source: ${extLink('https://lordslibrary.parliament.uk/type/data-dashboard/', 'House of Lords Library data dashboards')}. The dashboards are the Library\u2019s own and update on their own schedule.</p>
    <div data-embed></div>`;
  if (!current) return;

  const target = box.querySelector('[data-dash]');
  const embedBox = box.querySelector('[data-embed]');
  let detail = {};
  try { detail = await api(`data/lords?page=${encodeURIComponent(current.url)}`); } catch { /* fall back to links only */ }
  if (!target.isConnected) return;
  target.innerHTML = `<h2 class="h2-rule">${esc(titleOf(current))}</h2>
    ${descOf(current) ? `<p>${esc(descOf(current))}</p>` : ''}${current.date ? `<p class="small muted">Published ${esc(current.date)}</p>` : ''}
    <p class="item-links">${extLink(current.url, 'Open on the Lords Library website')}${detail.embed ? extLink(detail.embed, 'Open full screen') : ''}${detail.excel ? extLink(detail.excel, 'Download the data (Excel)') : ''}</p>`;
  if (detail.embed) {
    // The dashboard sits at the bottom of the page, at the width of the page like the Library's own page, and loads when scrolled to.
    const slug = slugOf(current.url);
    let height = savedHeight(slug);
    embedBox.innerHTML = `<div class="data-embed-size" role="group" aria-label="Dashboard height">
        <span class="muted">Dashboard height:</span>
        <button type="button" class="button button-quiet" data-size="-10">Shorter</button>
        <button type="button" class="button button-quiet" data-size="10">Taller</button>
        <button type="button" class="button button-quiet" data-size="0">Reset</button></div>
      <div class="data-embed data-embed-wait" data-holder style="position:relative;width:100%;min-height:30rem;aspect-ratio:100 / ${height}"><span>The dashboard loads as you scroll down\u2026</span></div>`;
    const holder = embedBox.querySelector('[data-holder]');
    embedBox.querySelector('.data-embed-size').addEventListener('click', (e) => {
      const b = e.target.closest('[data-size]');
      if (!b) return;
      const step = Number(b.dataset.size);
      height = step === 0 ? EMBED_DEFAULT : Math.min(300, Math.max(50, height + step));
      holder.style.aspectRatio = `100 / ${height}`;
      saveHeight(slug, height);
    });
    mountEmbedWhenVisible(holder, detail.embed, titleOf(current));
  } else {
    embedBox.innerHTML = '<p class="state">This dashboard could not be shown here. Use the link above to open it on the Lords Library website.</p>';
  }
}

/* ------------------------------------------------------------------ Router entry */

export async function renderData(el, { sub }, query) {
  if (sub === 'votes') return votingPage(el, query);
  if (sub === 'lords') return lordsPage(el, query);
  return landing(el);
}
