// A Bill's "Secondary legislation" tab: once the Bill has become an Act, each section with how it was brought into force (the commencement instrument and date)
// and the instruments that used a power the section gives. The data is legislation.gov.uk's (see lib/legislation-gov.js).
import { api } from '../api.js';
import { esc, loading, errorBox, empty } from '../ui.js';

const fmt = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;

export async function renderSecondarySection(box, billId) {
  box.innerHTML = loading('Looking up the instruments');
  let d;
  try { d = await api(`bills/${billId}/secondary`); } catch (err) { box.innerHTML = errorBox(err); return; }
  if (!d.isAct) { box.innerHTML = empty('This Bill has not become an Act yet, so there are no statutory instruments under it. They appear here once it has received Royal Assent.'); return; }
  if (!d.act) { box.innerHTML = empty('The Act could not be found on legislation.gov.uk yet.'); return; }
  const s = d.summary;
  let only = '';
  const draw = () => {
    const rows = d.sections.filter((x) => (only === 'uncommenced' ? !x.commencement.length : only === 'powers' ? x.powers.length : true));
    box.querySelector('[data-sec-body]').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid sec-table">
      <thead><tr><th scope="col">Section</th><th scope="col">Brought into force by</th><th scope="col">Powers used by</th></tr></thead>
      <tbody>${rows.map((x) => `<tr>
        <th scope="row">${link(`${d.act.uri}/section/${x.key}`, `s. ${x.label}`)} <span class="small">${esc(x.heading)}</span>${x.part ? `<br><span class="small muted">${esc(x.part)}</span>` : ''}</th>
        <td>${x.commencement.length ? x.commencement.map((c) => `${link(c.si.uri, c.si.title)}${c.date ? ` <span class="small muted">${esc(fmt(c.date))}${c.qualification && !/wholly/i.test(c.qualification) ? `, ${esc(c.qualification)}` : ''}</span>` : ''}`).join('<br>') : '<span class="muted">Not brought into force by an instrument</span>'}</td>
        <td>${x.powers.length ? x.powers.map((p) => link(p.uri, p.title)).join('<br>') : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>` : empty('No sections match.');
  };
  box.innerHTML = `<p class="small"><strong>${esc(d.act.title)}</strong> · ${link(d.act.uri, 'on legislation.gov.uk')} · ${s.commenced} of ${s.sections} sections brought into force by an instrument · ${s.instruments} instrument${s.instruments === 1 ? '' : 's'} found using its powers across ${s.powerSections} section${s.powerSections === 1 ? '' : 's'}.</p>
    <label class="field field-narrow"><span>Show</span><select data-sec-filter><option value="">All sections</option><option value="uncommenced">Not brought into force by an instrument</option><option value="powers">Sections whose powers have been used</option></select></label>
    <div data-sec-body></div>
    <p class="small muted">Sections that came into force on Royal Assent, or by the Act itself, show no instrument. Powers are read from each instrument's preamble, so a very recent instrument (still only a PDF on legislation.gov.uk) may be missing.${d.partial ? ' This is a quick look; the full list is renewed at 6am and 6pm.' : ''}</p>`;
  draw();
  box.querySelector('[data-sec-filter]').addEventListener('change', (e) => { only = e.target.value; draw(); });
}
