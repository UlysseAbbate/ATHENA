import { api } from '../api.js';
import { esc, hl, fmtShort, KIND, loading, errorBox, empty, extLink, pageHeader } from '../ui.js';

export async function renderPortfolio(el, { code }) {
  el.innerHTML = loading('Loading the portfolio');
  let p;
  try { p = await api(`portfolios/${code}`); } catch (err) { el.innerHTML = errorBox(err); return; }

  const bills = p.primaryLegislation.length
    ? `<ul class="plain">${p.primaryLegislation.map((b) => `<li><a href="#/bill/${b.id}">${esc(b.title)}</a> <span class="muted small">${esc(b.stage)}</span></li>`).join('')}</ul>`
    : empty('No live Bills in the Lords for this portfolio.');

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
}
