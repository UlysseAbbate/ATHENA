// The Concessionometer (#/concessionometer, in the Whips Hub): every amendment marked WIN on a Bill's page, kept whether or not the Bill is still live.
// One grid with a narrow first column (just the Bill, and the date it was won), the portfolio of the Bill, and a wide column for the POLD Staff's notes about the concession.
// Notes are shown as ordinary text; the editing boxes (Bill, date won, notes) open only when Edit is pressed. The Bill's name links to the amendment (details on hover).
import { api } from '../api.js';
import { esc, fmtDate, loading, errorBox, empty, pageHeader } from '../ui.js';
import { norm } from '../../../shared/import/sheet.js';
import { can, savedName } from '../session.js';
import { mountImport } from '../../../shared/import/panel.js';
import { IMPORTERS } from '../../../shared/import/importers.js';

const chips = (codes) => (codes || []).map((c) => `<a class="tag" href="#/portfolio/${esc(c)}">${esc(c)}</a>`).join(' ') || '<span class="muted">None</span>';
const portPicker = (c) => `<fieldset class="conc-ports"><legend class="small">Portfolio</legend>${(PORTS || []).map((p) => `<label class="small" title="${esc(p.name)}"><input type="checkbox" data-port value="${esc(p.code)}" ${c.portfolio.includes(p.code) ? 'checked' : ''}> ${esc(p.code)}</label>`).join(' ')}</fieldset>`;
let PORTS = [];
const dateOnly = (iso) => (iso ? String(iso).slice(0, 10) : '');
const keyOf = (c) => `${c.billId}-${c.stageId}-${c.amendmentId}`;

export async function renderConcessionometer(el) {
  el.innerHTML = `${pageHeader('Concessionometer', 'Every amendment we have won a concession on: the Bill and the date it was won, the Bill’s portfolio, and the Staff’s notes about the concession. Amendments are added with the WIN button on a Bill’s Amendments tab, and stay here after the Bill has passed.')}
    <div id="conc-import"></div>
    <div id="conc-root">${loading('Loading the concessions')}</div>`;
  const root = el.querySelector('#conc-root');
  let data;
  try { data = await api('concessions'); } catch (err) { root.innerHTML = errorBox(err); return; }
  if (!root.isConnected) return;
  const list = data.concessions || [];
  PORTS = data.portfolios || [];
  const edit = can('whips');
  const portfolios = [...new Set(list.flatMap((c) => c.portfolio))].sort();
  const editing = new Set();   // the rows whose editing boxes are open
  let only = '';

  const billCell = (c) => (editing.has(keyOf(c))
    ? `<label class="field"><span>Concession name</span><input data-name maxlength="200" value="${esc(c.name)}"></label>
       <label class="field"><span>Bill</span><input data-bill maxlength="200" value="${esc(c.billTitle)}"></label>
       <label class="field"><span>Date won</span><input type="date" data-won value="${esc(dateOnly(c.wonAt))}"></label>`
    : `${c.name ? `<strong class="conc-name">${esc(c.name)}</strong><br>` : ''}${c.url ? `<a class="conc-bill" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" title="Open the amendment${c.number ? `: ${esc(c.number)}` : ''}${c.place ? `, ${esc(c.place)}` : ''}${c.summary ? ` (${esc(c.summary)})` : ''}">${esc(c.billTitle || 'Bill')}</a>` : `<span class="conc-bill">${esc(c.billTitle || 'Bill')}</span>`}
       <br><span class="small muted">${c.period ? esc(c.period) : c.wonAt ? esc(fmtDate(c.wonAt, { day: 'numeric', month: 'short', year: 'numeric' })) : 'date not set'}</span>`);

  const notesCell = (c) => {
    const open = editing.has(keyOf(c));
    if (!edit) return c.notes ? `<div class="conc-text">${esc(c.notes)}</div>` : '<span class="muted">No notes yet.</span>';
    return open
      ? `<textarea rows="8" maxlength="4000" aria-label="Notes on the concession" data-notes>${esc(c.notes)}</textarea>
         <p><button type="button" class="button button-small" data-save>Save</button> <button type="button" class="button button-quiet button-small" data-cancel>Cancel</button>
           <button type="button" class="button button-quiet button-small" data-remove title="Delete this concession for good (an amendment marked WIN stops being marked WIN)">Delete</button> <span class="small muted" data-saved aria-live="polite"></span></p>`
      : `${c.notes ? `<div class="conc-text">${esc(c.notes)}</div>` : '<span class="muted">No notes yet.</span>'}
         <p><button type="button" class="button button-quiet button-small" data-edit>Edit</button> <button type="button" class="button button-quiet button-small" data-remove title="Delete this concession for good (an amendment marked WIN stops being marked WIN)">Delete</button> <span class="small muted" data-saved aria-live="polite">${c.updatedBy && c.notes ? `Last edited by ${esc(c.updatedBy)}` : ''}</span></p>`;
  };

  const draw = () => {
    const rows = list.filter((c) => !only || c.portfolio.includes(only));
    root.innerHTML = `<p class="small muted" data-status aria-live="polite">${list.length} concession${list.length === 1 ? '' : 's'}${only ? `, ${rows.length} in ${esc(only)}` : ''}.</p>
      ${portfolios.length > 1 ? `<label class="field field-narrow"><span>Portfolio</span><select data-portfolio><option value="">All</option>${portfolios.map((p) => `<option value="${esc(p)}" ${p === only ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>` : ''}
      ${rows.length ? `<div class="table-wrap"><table class="grid conc-table">
        <thead><tr><th scope="col" class="conc-col-bill">Bill</th><th scope="col" class="conc-col-port">Portfolio</th><th scope="col">Notes on the concession</th></tr></thead>
        <tbody>${rows.map((c) => `<tr data-key="${keyOf(c)}">
          <th scope="row" class="conc-col-bill">${billCell(c)}</th>
          <td class="conc-col-port">${editing.has(keyOf(c)) ? portPicker(c) : chips(c.portfolio)}</td>
          <td class="conc-notes">${notesCell(c)}</td></tr>`).join('')}</tbody></table></div>`
      : empty(list.length ? 'No concessions in this portfolio.' : 'No concessions yet. Press WIN on an amendment on a Bill’s Amendments tab to add it here.')}`;
  };
  draw();
  // Import from a spreadsheet: one row per concession (Bill, when, portfolio, notes). Concessions already here (same Bill and name) are left as they are.
  if (edit) {
    const known = data.portfolios || [];
    mountImport(el.querySelector('#conc-import'), {
      importer: IMPORTERS.concessions,
      lookups: async () => ({ portfolios: known }),
      after: () => renderConcessionometer(el),
      commit: async (entries, progress) => {
        const have = new Set(list.map((c) => `${norm(c.billTitle)}|${norm(c.name)}`));
        let added = 0, skipped = 0, done = 0; const failed = [];
        for (const e of entries) {
          try {
            const key = `${norm(e.bill)}|${norm(e.name)}`;
            if (have.has(key)) skipped++;
            else {
              await api('concessions', { method: 'POST', body: JSON.stringify({ action: 'add', billTitle: e.bill, name: e.name, portfolio: e.portfolio, notes: e.notes, wonAt: e.wonAt, period: e.period, author: savedName() }) });
              have.add(key); added++;
            }
          } catch (err) { failed.push({ summary: `${e.bill}${e.name ? ` · ${e.name}` : ''}`, error: err.message }); }
          progress(++done, entries.length);
        }
        return { added, skipped, failed };
      },
    });
  }

  const find = (tr) => { const [billId, stageId, amendmentId] = tr.dataset.key.split('-').map(Number); return list.find((x) => x.billId === billId && x.stageId === stageId && x.amendmentId === amendmentId); };
  root.addEventListener('change', (e) => { if (e.target.matches('[data-portfolio]')) { only = e.target.value; draw(); } });
  root.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-key]');
    if (!tr) return;
    const c = find(tr);
    if (e.target.closest('[data-edit]')) { editing.add(keyOf(c)); draw(); root.querySelector(`tr[data-key="${keyOf(c)}"] [data-notes]`)?.focus(); return; }
    if (e.target.closest('[data-cancel]')) { editing.delete(keyOf(c)); draw(); return; }
    if (e.target.closest('[data-remove]')) {
      if (!window.confirm('Delete this concession for good? If it came from an amendment marked WIN, the amendment stops being marked WIN.')) return;
      try {
        await api('concessions', { method: 'POST', body: JSON.stringify({ action: 'remove', billId: c.billId, stageId: c.stageId, amendmentId: c.amendmentId, author: savedName() }) });
        list.splice(list.indexOf(c), 1); editing.delete(keyOf(c)); draw();
      } catch (err) { tr.querySelector('[data-saved]').textContent = `Not removed: ${err.message}`; }
      return;
    }
    const save = e.target.closest('[data-save]');
    if (!save) return;
    const out = tr.querySelector('[data-saved]');
    const portfolio = [...tr.querySelectorAll('[data-port]:checked')].map((x) => x.value), billTitle = tr.querySelector('[data-bill]').value.trim(), name = tr.querySelector('[data-name]').value.trim(), wonAt = tr.querySelector('[data-won]').value, notes = tr.querySelector('[data-notes]').value;
    if (!wonAt) { out.textContent = 'Give the date it was won.'; return; }
    save.disabled = true; out.textContent = 'Saving…';
    try {
      await api('concessions', { method: 'POST', body: JSON.stringify({ action: 'edit', billId: c.billId, stageId: c.stageId, amendmentId: c.amendmentId, billTitle, name, portfolio, wonAt, notes, author: savedName() }) });
      Object.assign(c, { billTitle, name, portfolio, period: dateOnly(c.wonAt) === wonAt ? c.period : '', wonAt: `${wonAt}T12:00:00Z`, notes, updatedBy: savedName() || c.updatedBy });
      editing.delete(keyOf(c)); draw();
    } catch (err) { out.textContent = `Not saved: ${err.message}`; save.disabled = false; }
  });
}
