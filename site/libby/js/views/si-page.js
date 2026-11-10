// One statutory instrument (#/si/:id): who laid it, its procedure and dates, the Acts it is made under, its stages and its documents. No amendments (an instrument is
// approved or annulled as a whole), so the page is stages and documents only.
import { api } from '../api.js';
import { esc, loading, errorBox, pageHeader } from '../ui.js';

const fmt = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const ext = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? u : '');

export async function renderSI(el, { id }) {
  el.innerHTML = loading('Loading the instrument (Parliament’s service can take a little while)');
  let s;
  try { s = await api(`statutory-instruments/${encodeURIComponent(id)}`); } catch (err) { el.innerHTML = errorBox(err); return; }
  const facts = [
    ['Laid by', s.layingBody], ['Paper', s.paper], ['Procedure', s.procedure], ['Made', fmt(s.made)],
    ['Laid in the Commons', fmt(s.laidCommons)], ['Laid in the Lords', fmt(s.laidLords)],
    ['Comes into force', [fmt(s.comingIntoForce), s.comingIntoForceNote].filter(Boolean).join(': ')],
    ['Replaces', s.precededBy], ['Replaced by', s.followedBy],
  ].filter(([, v]) => v);
  const stages = [...s.timelines.map((t) => ({ date: t.date, text: t.name })), ...s.steps.flatMap((b) => (b.steps.length ? b.steps : ['Business item']).map((t) => ({ date: b.date, text: t, link: safeUrl(b.link) })))]
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  el.innerHTML = `${pageHeader(s.name, 'A statutory instrument: secondary legislation made under an Act. It is approved or annulled as a whole, so there are no amendments here, only its stages and documents.', [['#/legislation/statutory-instruments', 'Statutory instruments']])}
    <dl class="si-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <section><h2 class="h2-rule">Made under</h2>${s.enablingActs.length
      ? `<ul class="plain">${s.enablingActs.map((a) => `<li>${safeUrl(a.link) ? ext(a.link, a.name) : esc(a.name)}</li>`).join('')}</ul>` : '<p class="muted">The API names no enabling Act.</p>'}</section>
    <section><h2 class="h2-rule">Stages <span class="count">${stages.length}</span></h2>${stages.length
      ? `<ol class="si-stages">${stages.map((x) => `<li><span class="si-date">${esc(fmt(x.date) || 'Date to come')}</span> ${x.link ? ext(x.link, x.text) : esc(x.text)}</li>`).join('')}</ol>` : '<p class="muted">No stages recorded yet.</p>'}</section>
    <section><h2 class="h2-rule">Documents</h2><ul class="plain">
      <li>${ext(s.url, 'This instrument on the Statutory Instruments website')} (the text, explanatory memorandum and every stage)</li>
      ${(s.reports || []).map((r) => `<li>${ext(r.url, r.title)} <span class="small muted">${esc([r.committee, r.type, fmt(r.date)].filter(Boolean).join(' · '))}</span></li>`).join('')}
    </ul>${(s.reports || []).length ? '' : '<p class="small muted">No committee reports or correspondence found that name this instrument.</p>'}</section>`;
}
