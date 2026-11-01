import { api } from '../api.js';
import { esc, hl, fmtShort, KIND, loading, errorBox, empty, extLink, pageHeader } from '../ui.js';
import { currentHouse } from '../session.js';

/** The Primary legislation of a portfolio, with a drop-down to show Government legislation, other legislation or all of it. */
function primaryHtml(bills, where, commons) {
  if (!bills.length) return empty(`No live Bills in the ${where} for this portfolio.`);
  const href = (b) => `${commons ? '#/c/bill/' : '#/bill/'}${b.id}`;
  const rows = (cat) => bills.filter((b) => cat === 'all' || b.category === cat)
    .map((b) => `<li><a href="${href(b)}">${esc(b.title)}</a> <span class="muted small">${esc(b.stage)}</span> <span class="tag">${b.category === 'government' ? 'Government' : 'Other'}</span></li>`).join('');
  return `<label class="field field-narrow"><span>Show</span><select data-category aria-label="Kind of primary legislation">
      <option value="all">All primary legislation (${bills.length})</option>
      <option value="government">Government legislation (${bills.filter((b) => b.category === 'government').length})</option>
      <option value="other">Other legislation (${bills.filter((b) => b.category !== 'government').length})</option></select></label>
    <ul class="plain" data-bills>${rows('all')}</ul>
    <template data-rows-government>${rows('government')}</template><template data-rows-other>${rows('other')}</template>`;
}

function wirePrimary(root) {
  const sel = root.querySelector('[data-category]');
  if (!sel) return;
  const list = root.querySelector('[data-bills]');
  const all = list.innerHTML;
  sel.addEventListener('change', () => {
    const html = sel.value === 'all' ? all : root.querySelector(`[data-rows-${sel.value}]`).innerHTML;
    list.innerHTML = html || '<li class="muted">None.</li>';
  });
}

async function renderCommonsPortfolio(el, code) {
  let p;
  try { p = await api(`commons/portfolios/${code}`); } catch (err) { el.innerHTML = errorBox(err); return; }
  const oqs = p.oralQuestions.length
    ? `<div class="table-wrap"><table class="grid"><thead><tr><th scope="col">Date</th><th scope="col">Department</th></tr></thead><tbody>${
      p.oralQuestions.map((q) => `<tr><td class="nowrap"><a href="#/c/day/${q.date}">${esc(fmtShort(q.date))}</a></td><td>${esc(q.department)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('No Oral Questions to this department in the coming weeks.');
  const leg = p.legislation.length
    ? `<div class="table-wrap"><table class="grid"><thead><tr><th scope="col">Date</th><th scope="col">Business</th></tr></thead><tbody>${
      p.legislation.map((l) => `<tr><td class="nowrap"><a href="#/c/day/${l.date}">${esc(fmtShort(l.date))}</a></td><td>${l.billId ? `<a href="#/c/bill/${l.billId}">${esc(l.title)}</a>` : hl(l.title)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('No legislation on the order paper for this portfolio in the coming weeks.');
  el.innerHTML = `
    ${pageHeader(p.name, '', [['#/future?view=portfolio', 'Coming business'], ['#/future?view=portfolio', 'Portfolios']])}
    <p><a class="button" href="${esc(p.policyLink)}">Lib Dem policy on ${esc(p.name)}</a></p>
    <section><h2 class="h2-rule">Primary legislation</h2>${primaryHtml(p.primaryLegislation, 'Commons', true)}</section>
    <section><h2 class="h2-rule">Oral Questions</h2>${oqs}</section>
    <section><h2 class="h2-rule">Legislation in the coming weeks</h2>${leg}</section>
    <p class="small muted">Items are matched to portfolios by department and keywords, so check anything borderline.</p>`;
  wirePrimary(el);
}

export async function renderPortfolio(el, { code }) {
  el.innerHTML = loading('Loading the portfolio');
  if (currentHouse() === 'commons') return renderCommonsPortfolio(el, code);
  let p;
  try { p = await api(`portfolios/${code}`); } catch (err) { el.innerHTML = errorBox(err); return; }

  const bills = primaryHtml(p.primaryLegislation, 'Lords', false);

  const sis = p.secondaryLegislation.length
    ? `<div class="table-wrap"><table class="grid"><thead><tr><th scope="col">Instrument</th><th scope="col">Procedure</th><th scope="col">Laid</th><th scope="col">Lords date</th></tr></thead><tbody>${
      p.secondaryLegislation.map((s) => `<tr><th scope="row">${extLink(s.url, s.name)}</th><td>${esc(s.procedure)}</td><td class="nowrap">${esc(fmtShort(s.laid))}</td><td class="nowrap">${s.scheduled ? `<a href="#/day/${s.scheduled.date}">${esc(fmtShort(s.scheduled.date))}</a>` : '<span class="muted">Not yet scheduled</span>'}</td></tr>`).join('')}</tbody></table></div>`
    : empty('No instruments before the Lords for this department.');

  const debates = p.forthcoming.length
    ? `<div class="table-wrap"><table class="grid"><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Business</th></tr></thead><tbody>${
      p.forthcoming.map((f) => `<tr><td class="nowrap"><a href="#/day/${f.date}">${esc(fmtShort(f.date))}</a></td><td>${esc(KIND[f.kind] || '')}</td><td>${hl(f.title)}${f.detail ? ` <span class="muted">— ${hl(f.detail)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : empty('Nothing in this portfolio in the published forthcoming business.');

  const reports = p.committeeReports.length
    ? `<ul class="plain">${p.committeeReports.map((r) => `<li>${extLink(r.url, r.title)} <span class="muted small">${esc(r.committee)} · ${esc(fmtShort(r.date))}</span></li>`).join('')}</ul>`
    : empty('No Lords committee reports matched this portfolio in the last six months.');

  el.innerHTML = `
    ${pageHeader(p.name, '', [['#/future?view=portfolio', 'Future business'], ['#/future?view=portfolio', 'Portfolios']])}
    <p><a class="button" href="${esc(p.policyLink)}">Lib Dem policy on ${esc(p.name)}</a></p>
    ${p.notes.map((n) => `<p class="small muted">${esc(n)}</p>`).join('')}
    <section><h2 class="h2-rule">Primary legislation</h2>${bills}</section>
    <section><h2 class="h2-rule">Secondary legislation</h2>${sis}</section>
    <section><h2 class="h2-rule">Forthcoming Lords debates and motions</h2>${debates}</section>
    <section><h2 class="h2-rule">Lords committee reports</h2>${reports}</section>
    <p class="small muted">Items are matched to portfolios by department and keywords, so check anything borderline.</p>`;
  wirePrimary(el);
}
