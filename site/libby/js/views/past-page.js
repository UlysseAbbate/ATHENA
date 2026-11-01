import { api } from '../api.js';
import { currentHouse } from '../session.js';
import { esc, hl, fmtShort, fmtDate, todayIso, loading, errorBox, empty, extLink, pageHeader, debounce } from '../ui.js';

// The same page serves both LIBBYs: Noble LIBBY (#/past, the Lords) and Honourable LIBBY (the Commons). H says which, while a page is drawn.
const LORDS = {
  base: '#/past', q: '', who: 'peers',
  pages: {
    votes: { title: 'Lords votes', lede: 'Divisions in the House of Lords, with how Lib Dem peers voted.' },
    questions: { title: 'Written questions', lede: 'Lords written questions and answers.' },
    statements: { title: 'Written statements', lede: 'Written ministerial statements laid in the Lords.' },
    committees: { title: 'Committees', lede: 'Lords, Commons and Joint committees, with their reports, ministerial correspondence and minutes.' },
    hansard: { title: 'Hansard', lede: 'The official report of each sitting day, Lords and Commons.' },
  },
  yes: 'Contents', no: 'Not contents', yes1: 'content', no1: 'not content',
};
const COMMONS = {
  base: '#/past', q: '&house=commons', who: 'MPs',
  pages: {
    votes: { title: 'Commons votes', lede: 'Divisions in the House of Commons, with how Lib Dem MPs voted.' },
    questions: { title: 'Written questions', lede: 'Commons written questions and answers.' },
    statements: { title: 'Written statements', lede: 'Written ministerial statements made in the Commons.' },
    committees: { title: 'Committees', lede: 'Commons, Lords and Joint committees, with their reports, ministerial correspondence and minutes.' },
    hansard: { title: 'Hansard', lede: 'The official report of each sitting day, Commons and Lords.' },
  },
  yes: 'Ayes', no: 'Noes', yes1: 'aye', no1: 'no',
};
let H = LORDS;
const crumbs = () => [[H.base, 'Past business']];

function searchBar(placeholder, extra = '') {
  return `<form class="search" role="search" data-search>
    <label class="field"><span>Search</span><input type="search" name="q" placeholder="${esc(placeholder)}"></label>
    ${extra}<button class="button" type="submit">Search</button></form>`;
}

/** Shared list page: search form, results, and a "Show more" button. */
function listPage(el, kind, renderRows, { placeholder, extra = '', step = 25, params = () => '' }) {
  el.insertAdjacentHTML('beforeend', `${searchBar(placeholder, extra)}<div data-results></div><p><button type="button" class="button button-quiet" data-more hidden>Show more</button></p>`);
  const results = el.querySelector('[data-results]');
  const more = el.querySelector('[data-more]');
  let skip = 0;
  let q = '';
  const load = async (reset) => {
    if (reset) { skip = 0; results.innerHTML = loading('Loading'); }
    try {
      const d = await api(`past/${kind}?skip=${skip}&q=${encodeURIComponent(q)}${params()}${H.q}`);
      if (reset) results.innerHTML = '';
      results.insertAdjacentHTML('beforeend', d.items.length ? renderRows(d.items) : (reset ? empty('Nothing found.') : ''));
      skip = d.nextSkip ?? skip + step;
      more.hidden = d.items.length === 0;
    } catch (err) { results.innerHTML = errorBox(err); more.hidden = true; }
  };
  el.querySelector('[data-search]').addEventListener('submit', (e) => { e.preventDefault(); q = new FormData(e.target).get('q').trim(); load(true); });
  el.querySelector('[data-search]').addEventListener('change', (e) => { if (e.target.type === 'checkbox') load(true); });
  more.addEventListener('click', () => load(false));
  load(true);
}

const votesRows = (items) => `<ul class="records">${items.map((v) => `
  <li class="record">
    <p class="record-title">${extLink(v.url, v.title)}</p>
    <p class="small">${esc(fmtDate(v.date))} · Division ${esc(v.number)} · ${H.yes} <strong>${esc(v.content)}</strong>, ${H.no} <strong>${esc(v.notContent)}</strong></p>
    <p class="small"><mark class="ld">Lib Dems</mark> ${v.ldContent == null ? '<span class="muted">not known</span>' : v.ldContent + v.ldNotContent ? `${v.ldContent} ${H.yes1}, ${v.ldNotContent} ${H.no1}` : 'did not vote'}</p>
  </li>`).join('')}</ul>`;

const questionRows = (items) => `<ul class="records">${items.map((q) => `
  <li class="record">
    <p class="record-title">${extLink(q.url, q.heading || `Question ${q.uin}`)}</p>
    <p class="small">${hl(q.asker)} · ${esc(q.department)} · tabled ${esc(fmtShort(q.tabled))}${q.answered ? ` · answered ${esc(fmtShort(q.answered))}` : ' · awaiting answer'}</p>
    <p>${esc(q.question)}</p>
    ${q.answer ? `<details class="small"><summary>Answer</summary><p>${esc(q.answer)}</p></details>` : ''}
  </li>`).join('')}</ul>`;

const statementRows = (items) => `<ul class="records">${items.map((s) => `
  <li class="record">
    <p class="record-title">${extLink(s.url, s.title)}</p>
    <p class="small">${esc(fmtDate(s.date))} · ${esc(s.department)} · ${hl(s.minister)}</p>
    <details class="small"><summary>Extract</summary><p>${esc(s.text)}${s.text.length >= 1200 ? '…' : ''}</p></details>
  </li>`).join('')}</ul>`;

const COMMITTEE_GROUPS = {
  lords: 'House of Lords committees',
  commons: 'House of Commons Select Committees',
  joint: 'Joint Committees',
  other: 'Other Committees',
};

// The four headings shown when a committee is opened.
const PUBLICATION_HEADINGS = [
  ['reports', 'Reports (and Government responses)'],
  ['correspondence', 'Ministerial correspondence'],
  ['minutes', 'Minutes of meetings'],
  ['other', 'Other information'],
];

/** Landing page: four links, one per group of committees. */
function committeeLanding(el) {
  el.insertAdjacentHTML('beforeend', `
    <nav class="index index-small" aria-label="Committee groups">${Object.entries(COMMITTEE_GROUPS).map(([key, title]) => `
      <a class="index-row" href="${H.base}/committees/${key}">
        <span class="index-title"><span class="swipe">${esc(title)}</span></span>
        <span class="index-text" data-count="${key}"></span>
      </a>`).join('')}</nav>`);
  // Counts are a nicety — the four links work without them.
  api('past/committees').then((d) => {
    for (const c of d.categories) {
      const cell = el.querySelector(`[data-count="${c.key}"]`);
      if (cell) cell.textContent = `${c.count} ${c.count === 1 ? 'committee' : 'committees'}`;
    }
  }).catch(() => {});
}

function publicationHeadingsHtml(groups) {
  return PUBLICATION_HEADINGS.map(([key, label]) => {
    const items = groups[key] || [];
    return `<details class="browse" style="margin-left:1.1rem">
      <summary>${esc(label)} <span class="count">${items.length}</span></summary>
      ${items.length ? `<ul class="plain">${items.map((p) => `
        <li>${extLink(p.url, p.title)}
          <span class="small muted">${p.date ? esc(fmtDate(p.date, { day: 'numeric', month: 'short', year: 'numeric' })) : ''}${p.isResponse ? ' · Government response' : ''}</span></li>`).join('')}</ul>`
        : empty('Nothing published under this heading.')}
    </details>`;
  }).join('');
}

/** One group's page: a filterable list of committees, each opening into the four headings. */
async function committeeGroup(el, key) {
  el.insertAdjacentHTML('beforeend', `<div data-c>${loading('Loading committees')}</div>`);
  const box = el.querySelector('[data-c]');
  try {
    const { committees: list } = await api(`past/committees?category=${key}`);
    if (!list.length) { box.innerHTML = empty('No current committees in this group.'); return; }
    box.innerHTML = `
      <label class="field"><span>Filter committees by name</span><input type="search" data-filter placeholder="e.g. constitution"></label>
      <p class="small muted">${list.length} committees. Open one to see its reports, correspondence, minutes and other papers.</p>
      <ul class="records" data-list>${list.map((c) => `
        <li class="record" data-name="${esc(c.name.toLowerCase())}"><details data-committee="${c.id}">
          <summary class="record-title">${esc(c.name)}</summary>
          <p class="small">${extLink(c.url, 'Committee website')}</p>
          <div data-pubs></div>
        </details></li>`).join('')}</ul>`;

    box.querySelector('[data-filter]').addEventListener('input', debounce((e) => {
      const q = e.target.value.trim().toLowerCase();
      box.querySelectorAll('[data-list] > li').forEach((li) => { li.hidden = !!q && !li.dataset.name.includes(q); });
    }, 150));

    box.querySelectorAll('[data-committee]').forEach((d) => d.addEventListener('toggle', async () => {
      const target = d.querySelector('[data-pubs]');
      if (!d.open || target.dataset.loaded) return;
      target.dataset.loaded = '1';
      target.innerHTML = loading('Loading publications');
      try {
        const { groups } = await api(`past/committees?committee=${d.dataset.committee}`);
        target.innerHTML = publicationHeadingsHtml(groups);
      } catch (err) { delete target.dataset.loaded; target.innerHTML = errorBox(err); }
    }));
  } catch (err) { box.innerHTML = errorBox(err); }
}

async function hansard(el, month) {
  el.insertAdjacentHTML('beforeend', `
    <form class="search" data-month><label class="field"><span>Month</span><input type="month" name="month" value="${esc(month)}" max="${todayIso().slice(0, 7)}"></label><button class="button" type="submit">Show</button></form>
    <p class="small">${extLink('https://hansard.parliament.uk/lords', 'Lords Hansard')} · ${extLink('https://hansard.parliament.uk/commons', 'Commons Hansard')} · ${extLink('https://hansard.parliament.uk/search', 'Search Hansard')}</p>
    <div data-h>${loading('Loading sitting days')}</div>`);
  el.querySelector('[data-month]').addEventListener('submit', (e) => { e.preventDefault(); location.hash = `${H.base}/hansard?month=${new FormData(e.target).get('month')}`; });
  const box = el.querySelector('[data-h]');
  try {
    const d = await api(`past/hansard?month=${month}`);
    const cell = (sat, url, house) => (sat === false ? `<td class="muted">Not sitting</td>` : `<td>${extLink(url, sat ? `${house} Hansard` : `${house} (check)`)}</td>`);
    box.innerHTML = d.days.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th scope="col">Day</th><th scope="col">Lords</th><th scope="col">Commons</th></tr></thead><tbody>${
      d.days.map((x) => `<tr><th scope="row">${esc(fmtDate(x.date, { weekday: 'short', day: 'numeric', month: 'long' }))}</th>${cell(x.lordsSat, x.lordsUrl, 'Lords')}${cell(x.commonsSat, x.commonsUrl, 'Commons')}</tr>`).join('')}</tbody></table></div>`
      : empty('No sitting days in this month so far.');
  } catch (err) { box.innerHTML = errorBox(err); }
}

export async function renderPast(el, { kind, sub, house }, query) {
  H = (house || currentHouse()) === 'commons' ? COMMONS : LORDS;
  if (!kind) {
    el.innerHTML = `${pageHeader('Past business', 'What the House has already done.')}
      <nav class="index index-small" aria-label="Past business sections">${Object.entries(H.pages).map(([k, p]) => `
        <a class="index-row" href="${H.base}/${k}"><span class="index-title"><span class="swipe">${esc(p.title)}</span></span><span class="index-text">${esc(p.lede)}</span></a>`).join('')}</nav>`;
    return;
  }
  const page = H.pages[kind];
  if (!page) { el.innerHTML = empty('Unknown section.'); return; }
  if (kind === 'committees' && sub) {
    if (!COMMITTEE_GROUPS[sub]) { el.innerHTML = empty('Unknown committee group.'); return; }
    el.innerHTML = pageHeader(COMMITTEE_GROUPS[sub], 'Open a committee to see its reports, ministerial correspondence, minutes and other information.',
      [...crumbs(), [`${H.base}/committees`, 'Committees']]);
    await committeeGroup(el, sub);
    return;
  }
  el.innerHTML = pageHeader(page.title, esc(page.lede), crumbs());
  if (kind === 'votes') listPage(el, kind, votesRows, { placeholder: 'e.g. Railways Bill' });
  if (kind === 'questions') listPage(el, kind, questionRows, {
    placeholder: 'e.g. social care', step: 25,
    extra: `<label class="check"><input type="checkbox" name="ld"> Lib Dem ${H.who} only</label>`,
    params: () => (el.querySelector('input[name="ld"]')?.checked ? '&ld=1' : ''),
  });
  if (kind === 'statements') listPage(el, kind, statementRows, { placeholder: 'e.g. NHS' });
  if (kind === 'committees') committeeLanding(el);
  if (kind === 'hansard') await hansard(el, /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : todayIso().slice(0, 7));
}
