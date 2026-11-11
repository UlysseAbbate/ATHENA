// Spreadsheet import, the screen: a folded "Import from a spreadsheet" box that a page puts where its data is entered.
//   mountImport(host, { importer, lookups, commit, after, controls })
//     importer  one of IMPORTERS (importers.js): the fields it expects, and how a row is read
//     lookups   () => the page's lists the rows are checked against (portfolios, roles, levels ...), fetched fresh when a file is chosen
//     commit    async (entries, progress) => { added, skipped, failed: [ { summary, error } ] }  saves the good rows using the page's own API
//     after     () => called once rows were saved, to redraw the page
//     controls  optional extra HTML in the box (e.g. the program to invite to) and a function to read it: { html, read: (box) => extra lookups }
// The file is read in the browser (nothing is uploaded until Confirm), shows what was understood (with a drop-down on every field to correct it), and lists any row it cannot use.
import { readWorkbook, matchColumns, fitScore } from './sheet.js';
import { analyse } from './importers.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
let xlsxLoading;
export function loadXLSX() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  xlsxLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../../libby/vendor/xlsx.full.min.js', import.meta.url).href;
    s.onload = () => (globalThis.XLSX ? resolve(globalThis.XLSX) : reject(new Error('The spreadsheet reader did not load.')));
    s.onerror = () => { xlsxLoading = null; reject(new Error('The spreadsheet reader could not be loaded.')); };
    document.head.appendChild(s);
  });
  return xlsxLoading;
}

export function mountImport(host, { importer, lookups = async () => ({}), commit, after = () => {}, controls = null }) {
  const id = `imp-${importer.id}`;
  host.innerHTML = `<details class="import-box" data-import="${esc(importer.id)}"><summary>Import ${esc(importer.title)} from a spreadsheet</summary>
    <p class="small">${esc(importer.blurb)}</p>
    <p class="small muted">Excel or CSV. Your own headings are fine: the page matches them to its fields and shows what it understood before anything is saved.</p>
    ${controls ? controls.html : ''}
    <div class="import-pick"><label class="field"><span>Spreadsheet</span><input type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" data-file></label>
      <button type="button" class="linkish small" data-template>Download a blank template</button></div>
    <p class="small" data-status role="status" aria-live="polite"></p>
    <div data-body></div></details>`;
  const box = host.querySelector('.import-box'), status = host.querySelector('[data-status]'), body = host.querySelector('[data-body]');
  let XLSX, book, sheetIdx = 0, mapping, lk;

  const run = () => {
    const sheet = book.sheets[sheetIdx];
    const res = analyse(sheet, importer, lk, mapping);
    const colOpts = (sel) => `<option value="-1">— not in the sheet —</option>${sheet.headers.map((h, c) => (h ? `<option value="${c}" ${c === sel ? 'selected' : ''}>${esc(h)}</option>` : '')).join('')}`;
    const good = res.entries.filter((e) => !e.fatal);
    body.innerHTML = `${book.sheets.length > 1 ? `<label class="field field-narrow"><span>Sheet</span><select data-sheet>${book.sheets.map((s, i) => `<option value="${i}" ${i === sheetIdx ? 'selected' : ''}>${esc(s.name)} (${s.rows.length} rows)</option>`).join('')}</select></label>` : ''}
      <h3 class="h3-section">What I understood</h3>
      <div class="table-wrap"><table class="grid import-map"><thead><tr><th scope="col">The page needs</th><th scope="col">From the column</th></tr></thead><tbody>
      ${importer.fields.map((fld) => `<tr><th scope="row">${esc(fld.label)}${fld.required ? ' <span class="muted small">(needed)</span>' : ''}</th>
        <td><select data-map="${esc(fld.key)}" aria-label="Column for ${esc(fld.label)}">${colOpts(mapping[fld.key])}</select></td></tr>`).join('')}</tbody></table></div>
      <h3 class="h3-section">Rows <span class="count">${res.entries.length}</span></h3>
      <p class="small" data-counts>${good.length} ready to add${res.counts.fatal ? `, <strong>${res.counts.fatal} cannot be used</strong> (shown below)` : ''}${res.skipped ? `, ${res.skipped} empty row${res.skipped === 1 ? '' : 's'} ignored` : ''}.</p>
      ${res.entries.length ? `<div class="table-wrap"><table class="grid import-preview"><thead><tr><th scope="col">Row</th><th scope="col"></th><th scope="col">What will be added</th><th scope="col">Problems</th></tr></thead><tbody>
        ${res.entries.slice(0, 200).map((e) => `<tr class="${e.fatal ? 'import-bad' : e.problems.length ? 'import-warn' : ''}"><td>${e.row}</td><td>${e.fatal ? '✗' : e.problems.length ? '!' : '✓'}</td><td>${esc(e.summary)}</td><td>${esc(e.problems.join('; '))}</td></tr>`).join('')}</tbody></table></div>
        ${res.entries.length > 200 ? `<p class="small muted">Showing the first 200 rows; all ${good.length} good rows will be added.</p>` : ''}` : ''}
      <p><button type="button" class="button" data-confirm ${good.length ? '' : 'disabled'}>Add ${good.length} ${esc(importer.noun)}${good.length === 1 ? '' : 's'}</button> <span class="small" data-result aria-live="polite"></span></p>`;
    body.querySelector('[data-sheet]')?.addEventListener('change', (e) => { sheetIdx = Number(e.target.value); remap(); });
    body.querySelectorAll('[data-map]').forEach((s) => s.addEventListener('change', () => { mapping[s.dataset.map] = Number(s.value); run(); }));
    body.querySelector('[data-confirm]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget, out = body.querySelector('[data-result]');
      btn.disabled = true; out.textContent = 'Adding…';
      try {
        const r = await commit(good.map((x) => x.entry), (done, total) => { out.textContent = `Adding… ${done} of ${total}`; });
        out.textContent = `Done: ${r.added} added${r.skipped ? `, ${r.skipped} already there (left as they were)` : ''}${r.failed && r.failed.length ? `, ${r.failed.length} failed: ${r.failed.slice(0, 3).map((x) => `${x.summary} (${x.error})`).join('; ')}` : ''}.`;
        status.textContent = '';
        if (r.added) after();
      } catch (err) { out.textContent = err.message; btn.disabled = false; }
    });
  };
  const remap = () => {
    const sheet = book.sheets[sheetIdx];
    mapping = matchColumns(sheet.headers, sheet.rows, importer.fields).mapping;
    run();
  };

  host.querySelector('[data-file]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    status.textContent = 'Reading the spreadsheet…'; body.innerHTML = '';
    try {
      XLSX = await loadXLSX();
      book = readWorkbook(XLSX, new Uint8Array(await file.arrayBuffer()));
      if (!book.sheets.length) throw new Error('I could not find a table with headings and rows in that file.');
      lk = { ...(await lookups()), ...(controls ? controls.read(box) : {}) };
      // start on the sheet this importer fits best
      sheetIdx = book.sheets.map((s, i) => ({ i, fit: fitScore(matchColumns(s.headers, s.rows, importer.fields), importer.fields) })).sort((a, b) => b.fit - a.fit)[0].i;
      status.textContent = `${file.name}: ${book.sheets.reduce((n, s) => n + s.rows.length, 0)} rows. Check what was understood, then add.`;
      remap();
    } catch (err) { status.textContent = err.message; }
  });
  controls?.onChange?.(box, () => { if (book) { lk = { ...lk, ...controls.read(box) }; run(); } });
  host.querySelector('[data-template]').addEventListener('click', async () => {
    const X = await loadXLSX();
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([importer.fields.map((fld) => fld.label)]), importer.title.slice(0, 30));
    X.writeFile(wb, `${importer.id}-template.xlsx`);
  });
}
