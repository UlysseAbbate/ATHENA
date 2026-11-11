// The Concessionometer (#/concessionometer, in the Whips Hub): every amendment marked WIN on a Bill's page, kept whether or not the Bill is still live.
// One grid with a narrow first column (just the Bill, and the date it was won), the portfolio of the Bill, and a wide column for the POLD Staff's notes about the concession.
// Notes are shown as ordinary text; the editing boxes (Bill, date won, notes) open only when Edit is pressed. The Bill's name links to the amendment (details on hover).
import { api } from '../api.js';
import { esc, fmtDate, loading, errorBox, empty, pageHeader } from '../ui.js';
import { can, savedName } from '../session.js';

const chips = (codes) => (codes || []).map((c) => `<a class="tag" href="#/portfolio/${esc(c)}">${esc(c)}</a>`).join(' ') || '<span class="muted">None</span>';
const dateOnly = (iso) => (iso ? String(iso).slice(0, 10) : '');
const keyOf = (c) => `${c.billId}-${c.stageId}-${c.amendmentId}`;

export async function renderConcessionometer(el) {
  el.innerHTML = `${pageHeader('Concessionometer', 'Every amendment we have won a concession on: the Bill and the date it was won, the Bill’s portfolio, and the Staff’s notes about the concession. Amendments are added with the WIN button on a Bill’s Amendments tab, and stay here after the Bill has passed.')}
    <div id="conc-root">${loading('Loading the concessions')}</div>`;
  const root = el.querySelector('#conc-root');
  let data;
  try { data = await api('concessions'); } catch (err) { root.innerHTML = errorBox(err); return; }
  if (!root.isConnected) return;
  const list = data.concessions || [];
  const edit = can('whips');
  const portfolios = [...new Set(list.flatMap((c) => c.portfolio))].sort();
  const editing = new Set();   // the rows whose editing boxes are open
  let only = '';

  const billCell = (c) => (editing.has(keyOf(c))
    ? `<label class="field"><span>Bill</span><input data-bill maxlength="200" value="${esc(c.billTitle)}"></label>
       <label class="field"><span>Date won</span><input type="date" data-won value="${esc(dateOnly(c.wonAt))}"></label>`
    : `<a class="conc-bill" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" title="Open the amendment${c.number ? `: ${esc(c.number)}` : ''}${c.place ? `, ${esc(c.place)}` : ''}${c.summary ? ` (${esc(c.summary)})` : ''}">${esc(c.billTitle || 'Bill')}</a>
       <br><span class="small muted">${c.wonAt ? esc(fmtDate(c.wonAt, { day: 'numeric', month: 'short', year: 'numeric' })) : 'date not set'}</span>`);

  const notesCell = (c) => {
    const open = editing.has(keyOf(c));
    if (!edit) return c.notes ? `<div class="conc-text">${esc(c.notes)}</div>` : '<span class="muted">No notes yet.</span>';
    return open
      ? `<textarea rows="8" maxlength="4000" aria-label="Notes on the concession" data-notes>${esc(c.notes)}</textarea>
         <p><button type="button" class="button button-small" data-save>Save</button> <button type="button" class="button button-quiet button-small" data-cancel>Cancel</button>
           <button type="button" class="button button-quiet button-small" data-remove title="Take this off the Concessionometer (it stops being marked WIN)">Remove from the Concessionometer</button> <span class="small muted" data-saved aria-live="polite"></span></p>`
      : `${c.notes ? `<div class="conc-text">${esc(c.notes)}</div>` : '<span class="muted">No notes yet.</span>'}
         <p><button type="button" class="button button-quiet button-small" data-edit>Edit</button> <span class="small muted" data-saved aria-live="polite">${c.updatedBy && c.notes ? `Last edited by ${esc(c.updatedBy)}` : ''}</span></p>`;
  };

  const draw = () => {
    const rows = list.filter((c) => !only || c.portfolio.includes(only));
    root.innerHTML = `<p class="small muted" data-status aria-live="polite">${list.length} concession${list.length === 1 ? '' : 's'}${only ? `, ${rows.length} in ${esc(only)}` : ''}.</p>
      ${portfolios.length > 1 ? `<label class="field field-narrow"><span>Portfolio</span><select data-portfolio><option value="">All</option>${portfolios.map((p) => `<option value="${esc(p)}" ${p === only ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>` : ''}
      ${rows.length ? `<div class="table-wrap"><table class="grid conc-table">
        <thead><tr><th scope="col" class="conc-col-bill">Bill</th><th scope="col" class="conc-col-port">Portfolio</th><th scope="col">Notes on the concession</th></tr></thead>
        <tbody>${rows.map((c) => `<tr data-key="${keyOf(c)}">
          <th scope="row" class="conc-col-bill">${billCell(c)}</th>
          <td class="conc-col-port">${chips(c.portfolio)}</td>
          <td class="conc-notes">${notesCell(c)}</td></tr>`).join('')}</tbody></table></div>`
      : empty(list.length ? 'No concessions in this portfolio.' : 'No concessions yet. Press WIN on an amendment on a Bill’s Amendments tab to add it here.')}`;
  };
  draw();

  const find = (tr) => { const [billId, stageId, amendmentId] = tr.dataset.key.split('-').map(Number); return list.find((x) => x.billId === billId && x.stageId === stageId && x.amendmentId === amendmentId); };
  root.addEventListener('change', (e) => { if (e.target.matches('[data-portfolio]')) { only = e.target.value; draw(); } });
  root.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-key]');
    if (!tr) return;
    const c = find(tr);
    if (e.target.closest('[data-edit]')) { editing.add(keyOf(c)); draw(); root.querySelector(`tr[data-key="${keyOf(c)}"] [data-notes]`)?.focus(); return; }
    if (e.target.closest('[data-cancel]')) { editing.delete(keyOf(c)); draw(); return; }
    if (e.target.closest('[data-remove]')) {
      if (!window.confirm('Take this off the Concessionometer? The amendment stops being marked WIN.')) return;
      try {
        await api('concessions', { method: 'POST', body: JSON.stringify({ action: 'win', on: false, billId: c.billId, stageId: c.stageId, amendmentId: c.amendmentId, author: savedName() }) });
        list.splice(list.indexOf(c), 1); editing.delete(keyOf(c)); draw();
      } catch (err) { tr.querySelector('[data-saved]').textContent = `Not removed: ${err.message}`; }
      return;
    }
    const save = e.target.closest('[data-save]');
    if (!save) return;
    const out = tr.querySelector('[data-saved]');
    const billTitle = tr.querySelector('[data-bill]').value.trim(), wonAt = tr.querySelector('[data-won]').value, notes = tr.querySelector('[data-notes]').value;
    if (!wonAt) { out.textContent = 'Give the date it was won.'; return; }
    save.disabled = true; out.textContent = 'Saving…';
    try {
      await api('concessions', { method: 'POST', body: JSON.stringify({ action: 'edit', billId: c.billId, stageId: c.stageId, amendmentId: c.amendmentId, billTitle, wonAt, notes, author: savedName() }) });
      Object.assign(c, { billTitle, wonAt: `${wonAt}T12:00:00Z`, notes, updatedBy: savedName() || c.updatedBy });
      editing.delete(keyOf(c)); draw();
    } catch (err) { out.textContent = `Not saved: ${err.message}`; save.disabled = false; }
  });
}
