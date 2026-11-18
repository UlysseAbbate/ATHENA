// Hymn Sheets (#/hymn-sheets, in the Whips Hub): the hymn sheets the advisers prepare, for the Whips to download.
// Whips and above read and download; Staff and Admin (the Whips' Office features) upload and delete. Word or PDF, up to 4 MB.
// The details are in the hymn_sheets table and the file (as text) in hymn_sheet_files (functions/api/libby/hymn-sheets.js).
import { api } from '../api.js';
import { esc, fmtDate, loading, errorBox, empty, pageHeader } from '../ui.js';
import { can, authFieldsHtml, readAuth, rememberAuth } from '../session.js';

const STAGES = ['Report Stage', 'Ping Pong', 'Committee Stage', 'Third Reading', 'Other'];
const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function sheetHtml(s, admin) {
  const meta = [s.stage, s.day_number ? `Day ${s.day_number}` : '', s.sitting_date ? `sitting ${fmtDate(s.sitting_date, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''].filter(Boolean).join(' \u00b7 ');
  return `<li class="record" data-id="${esc(s.id)}">
    <p class="record-title"><a href="/api/libby/hymn-sheets?id=${esc(s.id)}&download=1">${esc(s.title)}</a></p>
    <p class="hymn-meta">${esc(meta)}${meta ? ' \u00b7 ' : ''}${esc(s.file_name)} (${esc(size(s.size_bytes || 0))}) \u00b7 uploaded ${esc(fmtDate(s.uploaded_at, { day: 'numeric', month: 'short', year: 'numeric' }))}${s.uploaded_by ? ` by ${esc(s.uploaded_by)}` : ''}</p>
    ${admin ? '<p><button type="button" class="button button-quiet" data-delete>Delete</button></p>' : ''}</li>`;
}

export async function renderHymnSheets(el) {
  const admin = can('staff'); // Staff and Admin upload and delete
  el.innerHTML = `${pageHeader('Hymn Sheets', admin ? 'Upload the hymn sheets for the Whips to download.' : 'The hymn sheets prepared by Staff.')}
    <div id="hymns">${loading('Loading the hymn sheets')}</div>`;
  const box = el.querySelector('#hymns');
  let sheets; let bills = null;
  try {
    [{ sheets }, bills] = await Promise.all([api('hymn-sheets'), admin ? api('bills').catch(() => null) : Promise.resolve(null)]);
  } catch (err) { box.innerHTML = errorBox(err); return; }
  if (!box.isConnected) return;

  const billList = bills ? [...bills.government, ...bills.privateMembers, ...bills.other].sort((a, b) => a.title.localeCompare(b.title)) : [];
  const uploadForm = admin ? `<details class="hymn-upload" ${sheets.length ? '' : 'open'}><summary class="h2-rule" style="cursor:pointer">Upload a hymn sheet</summary>
    <form class="hymn-form" data-upload>
      <div class="row">
        <label class="field"><span>Bill</span><select name="bill"><option value="">Other (not tied to a Bill)</option>${billList.map((b) => `<option value="${esc(b.id)}">${esc(b.title)}</option>`).join('')}</select></label>
        <label class="field field-narrow"><span>Stage</span><select name="stage">${STAGES.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>
      </div>
      <div class="row">
        <label class="field field-narrow"><span>Day (optional)</span><input type="number" name="day" min="1" max="20" placeholder="e.g. 2"></label>
        <label class="field field-narrow"><span>Sitting date (optional)</span><input type="date" name="sittingDate"></label>
      </div>
      <label class="field"><span>Title (optional: made from the Bill, stage and day if left blank)</span><input type="text" name="title" maxlength="200"></label>
      <label class="field"><span>File (Word or PDF, up to 4 MB)</span><input type="file" name="file" accept=".docx,.doc,.pdf" required></label>
      <div class="row">${authFieldsHtml()}</div>
      <p><button class="button" type="submit">Upload</button> <span class="small" data-upload-status aria-live="polite"></span></p>
    </form></details>` : '';

  const draw = (filter = '') => {
    const q = filter.trim().toLowerCase();
    const shown = sheets.filter((s) => !q || `${s.title} ${s.bill_title || ''} ${s.stage || ''}`.toLowerCase().includes(q));
    const groups = new Map();
    for (const s of shown) { const k = s.bill_title || 'Other'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
    const list = box.querySelector('[data-list]');
    list.innerHTML = shown.length
      ? [...groups.entries()].sort(([a], [b]) => (a === 'Other') - (b === 'Other') || a.localeCompare(b)).map(([bill, items]) =>
        `<section class="hymn-group"><h3>${esc(bill)}</h3><ul class="records">${items.map((s) => sheetHtml(s, admin)).join('')}</ul></section>`).join('')
      : empty(sheets.length ? 'No hymn sheets match.' : 'No hymn sheets have been uploaded yet.');
  };
  box.innerHTML = `${uploadForm}
    ${sheets.length ? '<label class="field field-narrow"><span>Filter</span><input type="search" data-filter placeholder="Bill or stage"></label>' : ''}
    <div data-list></div>`;
  draw();
  box.querySelector('[data-filter]')?.addEventListener('input', (e) => draw(e.target.value));
  if (!admin) return;

  const form = box.querySelector('[data-upload]');
  const upStatus = box.querySelector('[data-upload-status]');
  const field = (name) => form.elements.namedItem(name); // not form.title and the like: a form has built-in properties with some of these names
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = field('file').files[0];
    if (!file) { upStatus.textContent = 'Choose a file first.'; return; }
    if (file.size > 4 * 1024 * 1024) { upStatus.textContent = 'That file is over 4 MB. Save it as a smaller file and try again.'; return; }
    const { author } = readAuth(form);
    const fd = new FormData();
    fd.set('file', file);
    fd.set('billId', field('bill').value);
    fd.set('billTitle', field('bill').value ? field('bill').options[field('bill').selectedIndex].text : '');
    fd.set('stage', field('stage').value);
    fd.set('day', field('day').value);
    fd.set('sittingDate', field('sittingDate').value);
    fd.set('title', field('title').value);
    fd.set('author', author);
    upStatus.textContent = 'Uploading\u2026';
    try {
      const res = await fetch('/api/libby/hymn-sheets', { method: 'POST', body: fd });
      const out = await res.json().catch(() => ({}));
      if (res.status === 401 && out.login) { location.reload(); return; }
      if (!res.ok) throw new Error(out.error || `The server returned ${res.status}.`);
      rememberAuth('', author);
      upStatus.textContent = `Uploaded: ${out.title}`;
      ({ sheets } = await api('hymn-sheets'));
      form.reset();
      draw(box.querySelector('[data-filter]')?.value || '');
    } catch (err) { upStatus.textContent = err.message; }
  });
  box.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-delete]');
    if (!del) return;
    const id = Number(del.closest('[data-id]').dataset.id);
    const sheet = sheets.find((s) => s.id === id);
    if (!window.confirm(`Delete "${sheet?.title || 'this hymn sheet'}"? This cannot be undone.`)) return;
    try {
      await api('hymn-sheets', { method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
      sheets = sheets.filter((s) => s.id !== id);
      draw(box.querySelector('[data-filter]')?.value || '');
    } catch (err) { upStatus.textContent = err.message; }
  });
}
