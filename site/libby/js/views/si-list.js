// The Statutory instruments tab of the Legislation page (secondary legislation): the instruments before Parliament, from the SI API. Each opens its own page with its stages
// and documents. No amendments: an instrument is approved or annulled as a whole.
import { api } from '../api.js';
import { esc, loading, errorBox, empty } from '../ui.js';

const fmt = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

export async function renderStatutoryInstruments(box) {
  box.innerHTML = loading('Loading statutory instruments (Parliament’s service can take a little while)');
  let d;
  try { d = await api('statutory-instruments'); } catch (err) { box.innerHTML = errorBox(err); return; }
  const all = d.instruments || [];
  if (!all.length) {
    box.innerHTML = empty(d.empty
      ? 'The Statutory Instruments API returned nothing just now. That usually means Parliament’s service is having trouble, not that there are no instruments. Try again later.'
      : 'No statutory instruments are currently before Parliament.');
    return;
  }
  const procedures = [...new Set(all.map((s) => s.procedure).filter(Boolean))].sort();
  let q = '', proc = '';
  const draw = () => {
    const rows = all.filter((s) => (!proc || s.procedure === proc) && (!q || `${s.name} ${s.paper}`.toLowerCase().includes(q)));
    box.querySelector('[data-si-count]').textContent = String(rows.length);
    box.querySelector('[data-si-list]').innerHTML = rows.length ? `<div class="table-wrap"><table class="grid leg-table si-table">
      <thead><tr><th scope="col" class="col-bill">Instrument</th><th scope="col">Procedure</th><th scope="col">Laid</th></tr></thead>
      <tbody>${rows.map((s) => `<tr>
        <th scope="row" class="col-bill"><a href="#/si/${esc(s.id)}">${esc(s.name)}</a>${s.paper ? `<br><span class="small muted">${esc(s.paper)}</span>` : ''}</th>
        <td>${esc(s.procedure || '—')}</td>
        <td>${esc(fmt(s.laid) || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="state">No instruments match.</p>';
  };
  box.innerHTML = `<section><h2 class="h2-rule">Statutory instruments before Parliament <span class="count" data-si-count>${all.length}</span></h2>
    <div class="row"><label class="field"><span>Search by name</span><input type="search" data-si-q></label>
      <label class="field field-narrow"><span>Procedure</span><select data-si-proc><option value="">All</option>${procedures.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label></div>
    <div data-si-list></div>
    <p class="small muted">Secondary legislation is made under powers an Act gives. Open an instrument for its stages and documents. Which sections of an Act have been brought into force, or had their powers used, is on that Bill’s own page under “Secondary legislation”.</p></section>`;
  draw();
  box.querySelector('[data-si-q]').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
  box.querySelector('[data-si-proc]').addEventListener('change', (e) => { proc = e.target.value; draw(); });
}
