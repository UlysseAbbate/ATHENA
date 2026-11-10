// The Concessionometer (#/concessionometer, under Lib Dems 150): every amendment marked WIN on a Bill's page, kept whether or not the Bill is still live.
// One grid: the amendment (with a link to it on bills.parliament.uk), the portfolio of its Bill, and the POLD Staff's notes about the concession.
import { api } from '../api.js';
import { esc, fmtDate, loading, errorBox, empty, pageHeader } from '../ui.js';
import { can, savedName } from '../session.js';

const chips = (codes) => (codes || []).map((c) => `<a class="tag" href="#/portfolio/${esc(c)}">${esc(c)}</a>`).join(' ') || '<span class="muted">None</span>';

export async function renderConcessionometer(el) {
  el.innerHTML = `${pageHeader('Concessionometer', 'Every amendment we have won a concession on: the amendment, the portfolio of its Bill, and the POLD Staff’s notes about the concession. Amendments are added with the WIN button on a Bill’s Amendments tab, and stay here after the Bill has passed.')}
    <div id="conc-root">${loading('Loading the concessions')}</div>`;
  const root = el.querySelector('#conc-root');
  let data;
  try { data = await api('concessions'); } catch (err) { root.innerHTML = errorBox(err); return; }
  if (!root.isConnected) return;
  const list = data.concessions || [];
  const edit = can('whips');
  const portfolios = [...new Set(list.flatMap((c) => c.portfolio))].sort();
  let only = '';

  const draw = () => {
    const rows = list.filter((c) => !only || c.portfolio.includes(only));
    root.innerHTML = `<p class="small muted" data-status aria-live="polite">${list.length} concession${list.length === 1 ? '' : 's'}${only ? `, ${rows.length} in ${esc(only)}` : ''}.</p>
      ${portfolios.length > 1 ? `<label class="field field-narrow"><span>Portfolio</span><select data-portfolio><option value="">All</option>${portfolios.map((p) => `<option value="${esc(p)}" ${p === only ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>` : ''}
      ${rows.length ? `<div class="table-wrap"><table class="grid conc-table">
        <thead><tr><th scope="col">Amendment</th><th scope="col">Portfolio</th><th scope="col">Notes on the concession</th></tr></thead>
        <tbody>${rows.map((c) => `<tr data-key="${c.billId}-${c.stageId}-${c.amendmentId}">
          <th scope="row"><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Amendment ${esc(c.number || '(no number yet)')}${c.place ? `: ${esc(c.place)}` : ''}</a>
            ${c.summary ? `<br><span class="small">${esc(c.summary)}</span>` : ''}
            <br><span class="conc-meta muted">${esc(c.billTitle || 'Bill')} (<a href="${c.house === 'commons' ? '#/c/bill/' : '#/bill/'}${c.billId}">Bill page</a>)${c.wonAt ? ` · won ${esc(fmtDate(c.wonAt))}` : ''}</span></th>
          <td>${chips(c.portfolio)}</td>
          <td class="conc-notes">${edit
            ? `<textarea rows="3" maxlength="4000" aria-label="Notes on the concession" data-notes>${esc(c.notes)}</textarea>
               <p><button type="button" class="button button-small" data-save>Save notes</button> <span class="small muted" data-saved aria-live="polite">${c.updatedBy && c.notes ? `Last edited by ${esc(c.updatedBy)}` : ''}</span></p>`
            : (c.notes ? esc(c.notes).replace(/\n/g, '<br>') : '<span class="muted">No notes yet.</span>')}</td>
        </tr>`).join('')}</tbody></table></div>` : empty(list.length ? 'No concessions in this portfolio.' : 'No concessions yet. Press WIN on an amendment on a Bill’s Amendments tab to add it here.')}`;
  };
  draw();
  root.addEventListener('change', (e) => { if (e.target.matches('[data-portfolio]')) { only = e.target.value; draw(); } });
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-save]');
    if (!btn) return;
    const tr = btn.closest('tr'), [billId, stageId, amendmentId] = tr.dataset.key.split('-').map(Number);
    const note = tr.querySelector('[data-notes]').value, out = tr.querySelector('[data-saved]');
    btn.disabled = true; out.textContent = 'Saving…';
    try {
      await api('concessions', { method: 'POST', body: JSON.stringify({ action: 'note', billId, stageId, amendmentId, notes: note, author: savedName() }) });
      const c = list.find((x) => x.billId === billId && x.stageId === stageId && x.amendmentId === amendmentId);
      if (c) c.notes = note;
      out.textContent = 'Saved.';
    } catch (err) { out.textContent = `Not saved: ${err.message}`; } finally { btn.disabled = false; }
  });
}
