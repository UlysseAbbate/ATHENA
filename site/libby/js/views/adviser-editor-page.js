// The adviser editor: a sheet where each live Bill, in either House, has four boxes: the Commons adviser, the Commons Bill lead, the Lords adviser and the Lords
// Bill lead. Typing a name and leaving the box (or pressing Enter) saves it, and it then shows at the top of the Bill's own page. Staff and Admin only (see lib/access.js).
import { api } from '../api.js';
import { esc, loading, errorBox, empty, pageHeader, debounce, fmtDate } from '../ui.js';
import { authFieldsHtml, readAuth, rememberAuth, reopenPasscode, savedPasscode } from '../session.js';
import { loadLib } from '../docs/loader.js';
import { parseGroupingXml, parseGroupingText, parseRefs, refsToText, matchGroups } from '../docs/grouping.js';
import { assembleDay, getThemes } from '../docs/grid-data.js';

const store = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: just ask again next time */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// the four boxes: the field the API saves, and the field of the saved team it is read from
const FIELDS = [
  ['commonsAdviser', 'Commons adviser', 'commonsAdviser'],
  ['commonsLead', 'Commons Bill lead', 'commonsLead'],
  ['adviser', 'Lords adviser', 'name'],
  ['lordsLead', 'Lords Bill lead', 'lordsLead'],
];

function table(bills, team) {
  if (!bills.length) return empty('No Bills in this group.');
  return `<div class="table-wrap"><table class="grid">
    <thead><tr><th scope="col">Bill</th><th scope="col">Current stage</th>${FIELDS.map(([, label]) => `<th scope="col">${label}</th>`).join('')}<th scope="col">Status</th></tr></thead>
    <tbody>${bills.map((b) => `
      <tr data-row data-title="${esc(b.title.toLowerCase())}">
        <th scope="row"><a href="${b.house === 'Commons' ? '#/c/bill/' : '#/bill/'}${b.id}">${esc(b.title)}</a></th>
        <td>${esc(b.stage)}</td>
        ${FIELDS.map(([field, label, key]) => `<td><label class="field"><span class="sr-only">${label} for ${esc(b.title)}</span>
          <input type="text" maxlength="200" data-bill="${b.id}" data-field="${field}" data-saved="${esc(team[b.id]?.[key] || '')}" value="${esc(team[b.id]?.[key] || '')}" placeholder="Type a name" autocomplete="off" disabled></label></td>`).join('')}
        <td class="small" data-status="${b.id}" aria-live="polite"></td>
      </tr>`).join('')}</tbody></table></div>`;
}

/** Every live Bill in Parliament (the Lords' list and the Commons' list), in the three groups. */
async function allBills() {
  const [lords, commons] = await Promise.all([api('bills'), api('commons/bills')]);
  const out = { government: [], privateMembers: [], other: [] };
  const seen = new Set();
  for (const [house, d] of [['Lords', lords], ['Commons', commons]]) for (const k of Object.keys(out)) for (const bill of d[k] || []) {
    if (!seen.has(bill.id)) { seen.add(bill.id); out[k].push({ ...bill, house }); }
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

async function renderAdvisers(el) {
  el.innerHTML = `${pageHeader('Bill advisers and leads',
    'Name the adviser and the Bill lead for each live Bill, in the Commons and in the Lords. They appear at the top of the Bill’s own page.',
    [['#/legislation', 'Legislation']])}
    <div id="editor">${loading('Loading Bills')}</div>`;
  const box = el.querySelector('#editor');

  let bills; let extras;
  try {
    [bills, extras] = await Promise.all([allBills(), api('bill-extras').catch(() => ({ advisers: {}, notes: [] }))]);
  } catch (err) { box.innerHTML = errorBox(err); return; }

  const team = extras.advisers || {};
  box.innerHTML = `
    <div class="search">
      <label class="field field-narrow"><span>Your name (so we know who changed what)</span><input type="text" name="editor" maxlength="80" autocomplete="name"></label>
    </div>
    <p class="small" data-lockmsg aria-live="polite">Type a name in a Bill's box and press Enter, or click out of the box, to save.</p>
    ${(extras.notes || []).map((n) => `<p class="small muted">${esc(n)}</p>`).join('')}
    <label class="field"><span>Filter Bills by name</span><input type="search" data-filter placeholder="e.g. railways"></label>
    <section><h2 class="h2-rule">Government Bills <span class="count">${bills.government.length}</span></h2>${table(bills.government, team)}</section>
    <section><h2 class="h2-rule">Private Members' Bills <span class="count">${bills.privateMembers.length}</span></h2>${table(bills.privateMembers, team)}</section>
    ${bills.other.length ? `<section><h2 class="h2-rule">Other Bills <span class="count">${bills.other.length}</span></h2>${table(bills.other, team)}</section>` : ''}`;

  const editorInput = box.querySelector('input[name="editor"]');
  const passcode = savedPasscode();
  box.querySelectorAll('input[data-bill]').forEach((i) => { i.disabled = false; });
  editorInput.value = store.get('adviserEditor');
  editorInput.addEventListener('change', () => store.set('adviserEditor', editorInput.value.trim()));

  // Save one box as soon as it changes.
  box.addEventListener('change', async (e) => {
    const input = e.target.closest('input[data-bill]');
    if (!input || input.disabled) return;
    const status = box.querySelector(`[data-status="${input.dataset.bill}"]`);
    const value = input.value.trim();
    if (value === input.dataset.saved) return;
    status.textContent = 'Saving…';
    try {
      const res = await api('advisers', {
        method: 'POST',
        body: JSON.stringify({ passcode, billId: Number(input.dataset.bill), [input.dataset.field]: value, editor: editorInput.value.trim() }),
      });
      input.value = res[input.dataset.field];
      input.dataset.saved = res[input.dataset.field];
      status.textContent = 'Saved ✓';
    } catch (err) {
      status.textContent = `Not saved: ${err.message}`;
    }
  });

  box.querySelector('[data-filter]').addEventListener('input', debounce((e) => {
    const q = e.target.value.trim().toLowerCase();
    box.querySelectorAll('[data-row]').forEach((tr) => { tr.hidden = !!q && !tr.dataset.title.includes(q); });
  }, 150));
}

/* ------------------------------------------------------------------ Groupings */

const toggle = (tab) => `<div class="toggle" role="group" aria-label="Editor sections">
  <a href="#/adviser-editor" ${tab === 'advisers' ? 'aria-current="true"' : ''}>Advisers</a>
  <a href="#/adviser-editor?tab=groupings" ${tab === 'groupings' ? 'aria-current="true"' : ''}>Groupings</a></div>`;

const simple = (s) => String(s || '').toLowerCase().replace(/\[hl\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function renderGroupings(el, query) {
  el.innerHTML = `${pageHeader('Adviser editor', 'Upload the Government Whips\u2019 grouping for a sitting day. It is matched to the published amendments, and the grid and hymn sheet then appear on the Bill page under that stage\u2019s \u201cWhips\u2019 Office documents\u201d.', [['#/legislation', 'Legislation']])}
    ${toggle('groupings')}<div id="gbox">${loading('Loading Bills')}</div>`;
  const box = el.querySelector('#gbox');
  let bills;
  try { bills = await api('bills'); } catch (err) { box.innerHTML = errorBox(err); return; }
  const all = [...bills.government, ...bills.privateMembers, ...bills.other];

  box.innerHTML = `
    <div class="search">
      <label class="field"><span>Bill</span><select data-bill><option value="">Choose a Bill</option>${all.map((b) => `<option value="${b.id}">${esc(b.title)}</option>`).join('')}</select></label>
      <label class="field field-narrow"><span>Stage</span><select data-stage disabled></select></label>
    </div>
    <div data-saved></div>
    <section data-work hidden>
      <h2 class="h2-rule">Add or replace a sitting day</h2>
      <div class="search">
        <label class="field"><span>Grouping document (.docx)</span><input type="file" accept=".docx" data-file></label>
        <label class="field field-narrow"><span>Day</span><input type="number" min="1" step="1" data-day></label>
        <label class="field field-narrow"><span>Sitting date</span><input type="date" data-date></label>
      </div>
      <details><summary>Or paste the grouping table from Word</summary>
        <label class="field"><span>Pasted grouping</span><textarea data-paste rows="6" style="width:100%"></textarea></label>
        <p><button class="button button-quiet" type="button" data-read-paste>Read pasted text</button></p></details>
      <p class="small" data-msg aria-live="polite"></p>
      <div data-preview></div>
    </section>`;

  const $ = (sel) => box.querySelector(sel);
  const msg = (t) => { $('[data-msg]').textContent = t; };
  const st = { bill: null, stage: null, amendments: [], groups: [], title: '' };

  const renderPreview = () => {
    const { groups: matched, unmatched } = matchGroups(st.groups, st.amendments);
    const total = matched.reduce((n, g) => n + g.refs.filter((r) => !r.debated).length, 0);
    $('[data-preview]').innerHTML = st.groups.length ? `
      <p class="small"><strong>${total - unmatched.length} of ${total}</strong> amendments found in the amendments published for this stage.${unmatched.length ? ` Not found: ${esc(unmatched.join(', '))}. They will show in the grid marked \u201cnot found\u201d \u2013 check the numbers, or save again once they are published.` : ''}</p>
      <div class="table-wrap"><table class="grid"><thead><tr><th scope="col">Group</th><th scope="col">Amendments</th><th scope="col">Topic</th><th scope="col">Check</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead>
      <tbody>${matched.map((g, i) => `<tr data-i="${i}">
        <td><input type="text" data-f="number" value="${esc(g.number)}" size="3"></td>
        <td><input type="text" data-f="refs" value="${esc(refsToText(g.refs))}" style="width:100%"></td>
        <td><input type="text" data-f="topic" value="${esc(g.topic)}" style="width:100%"></td>
        <td class="small">${g.refs.filter((r) => !r.debated && !r.matches.length).length ? `<span style="color:var(--red)">${g.refs.filter((r) => !r.debated && !r.matches.length).length} not found</span>` : '\u2713'}</td>
        <td><button type="button" class="linkish" data-remove>Remove</button></td></tr>`).join('')}</tbody></table></div>
      <p><button type="button" class="button button-quiet" data-add>Add a group</button></p>
      <div class="search">${authFieldsHtml()}<button class="button" type="button" data-save>Save grouping and prepare the grid</button></div>` : '';
  };

  const loadParsed = (parsed, source) => {
    st.groups = parsed.groups.map((g) => ({ number: g.number, topic: g.topic, refs: g.refs }));
    st.title = parsed.title || '';
    if (parsed.day) $('[data-day]').value = parsed.day;
    if (parsed.date) $('[data-date]').value = parsed.date;
    const warn = [];
    if (parsed.title && st.bill && !simple(st.bill.title).includes(simple(parsed.title).slice(0, 25))) warn.push(`The document is headed \u201c${parsed.title}\u201d: is this the right Bill?`);
    if (parsed.stage && st.stage && !new RegExp(parsed.stage, 'i').test(st.stage.description)) warn.push(`The document looks like ${parsed.stage} business, but ${st.stage.description} is selected.`);
    msg(`${source}: ${st.groups.length} groups read. Check them below, correct anything, then save.${warn.length ? ` Warning: ${warn.join(' ')}` : ''}`);
    renderPreview();
  };

  const loadSaved = async () => {
    const target = $('[data-saved]');
    target.innerHTML = loading('Loading saved groupings');
    try {
      const { groupings } = await api(`groupings?bill=${st.bill.id}&stage=${st.stage.billStageId}`);
      st.saved = groupings;
      target.innerHTML = groupings.length ? `<h2 class="h2-rule">Saved sitting days</h2><ul class="plain">${groupings.map((g) => `
        <li>Day ${esc(g.day)}${g.sitting_date ? ` \u00b7 ${esc(fmtDate(g.sitting_date))}` : ''} \u00b7 ${g.groups.length} groups${g.updated_by ? ` \u00b7 saved by ${esc(g.updated_by)}` : ''}
          \u00b7 <button type="button" class="linkish" data-open="${g.id}">Open to edit</button> \u00b7 <button type="button" class="linkish" data-del="${g.id}">Delete</button></li>`).join('')}</ul>
        <p class="small"><a href="#/bill/${st.bill.id}">Open the Bill page</a> to download the grids${/report/i.test(st.stage.description) ? ' and hymn sheets' : ''}.</p>`
        : '<p class="small muted">No sitting days saved for this stage yet.</p>';
    } catch (err) { target.innerHTML = errorBox(err); }
  };

  const chooseStage = async (stageId) => {
    st.stage = st.stages.find((s) => String(s.billStageId) === String(stageId)) || null;
    st.groups = []; renderPreview(); msg('');
    $('[data-work]').hidden = !st.stage;
    if (!st.stage) return;
    try { st.amendments = (await api(`bills/${st.bill.id}/amendments?stage=${st.stage.billStageId}`)).all; }
    catch (err) { st.amendments = []; msg(`The amendments for this stage could not be loaded (${err.message}), so nothing can be matched yet.`); }
    loadSaved();
  };

  const chooseBill = async (billId) => {
    st.bill = all.find((b) => String(b.id) === String(billId)) || null;
    const sel = $('[data-stage]');
    sel.innerHTML = ''; sel.disabled = true; $('[data-work]').hidden = true; $('[data-saved]').innerHTML = '';
    if (!st.bill) return;
    try {
      const b = await api(`bills/${st.bill.id}`);
      st.stages = b.lordsStages.filter((s) => s.takesAmendments && /committee|report/i.test(s.description));
      sel.innerHTML = st.stages.length ? `<option value="">Choose a stage</option>${st.stages.map((s) => `<option value="${s.billStageId}">${esc(s.description)}</option>`).join('')}` : '<option value="">No Committee or Report stage yet</option>';
      sel.disabled = !st.stages.length;
      if (query.stage && st.stages.some((s) => String(s.billStageId) === String(query.stage))) { sel.value = query.stage; await chooseStage(query.stage); query.stage = ''; }
    } catch (err) { msg(err.message); }
  };

  $('[data-bill]').addEventListener('change', (e) => chooseBill(e.target.value));
  $('[data-stage]').addEventListener('change', (e) => chooseStage(e.target.value));

  $('[data-file]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    msg('Reading the document\u2026');
    try {
      const JSZip = await loadLib('JSZip');
      const zip = await JSZip.loadAsync(file);
      const xml = await zip.file('word/document.xml')?.async('string');
      if (!xml) throw new Error('This does not look like a Word (.docx) file.');
      const parsed = parseGroupingXml(xml);
      if (!parsed.groups.length) throw new Error('No groups were found in the document. Try pasting the table instead.');
      loadParsed(parsed, file.name);
    } catch (err) { msg(err.message); }
  });
  $('[data-read-paste]').addEventListener('click', () => {
    const parsed = parseGroupingText($('[data-paste]').value);
    if (!parsed.groups.length) { msg('No groups were found in the pasted text.'); return; }
    loadParsed(parsed, 'Pasted text');
  });

  // Edits in the preview table.
  box.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr || !e.target.dataset.f) return;
    const g = st.groups[Number(tr.dataset.i)];
    if (e.target.dataset.f === 'refs') g.refs = parseRefs(e.target.value);
    else g[e.target.dataset.f] = e.target.value.trim();
    renderPreview();
  });

  box.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-remove]')) { st.groups.splice(Number(t.closest('tr').dataset.i), 1); renderPreview(); return; }
    if (t.closest('[data-add]')) { st.groups.push({ number: String(st.groups.length + 1), topic: '', refs: [] }); renderPreview(); return; }
    if (t.dataset.open) {
      const g = st.saved.find((x) => String(x.id) === t.dataset.open);
      st.groups = g.groups.map((x) => ({ ...x }));
      $('[data-day]').value = g.day; $('[data-date]').value = g.sitting_date || '';
      msg(`Day ${g.day} loaded. Edit below and save again to replace it.`);
      renderPreview(); return;
    }
    if (t.dataset.del) {
      if (!window.confirm('Delete this sitting day\u2019s grouping?')) return;
      const passcode = savedPasscode() || window.prompt('Passcode:') || '';
      try { await api('groupings', { method: 'POST', body: JSON.stringify({ passcode, action: 'delete', id: Number(t.dataset.del) }) }); loadSaved(); }
      catch (err) { msg(err.message); }
      return;
    }
    if (t.closest('[data-save]')) {
      const form = $('[data-preview]');
      const { passcode, author } = readAuth(form);
      const day = Number($('[data-day]').value);
      if (!day) { msg('Give the sitting day number first.'); return; }
      t.disabled = true;
      try {
        msg('Saving\u2026');
        const r = await api('groupings', { method: 'POST', body: JSON.stringify({
          passcode, action: 'save', billId: st.bill.id, stageId: st.stage.billStageId, stageName: st.stage.description,
          day, sittingDate: $('[data-date]').value, title: st.title, groups: st.groups, author,
        }) });
        rememberAuth(passcode, author);
        const d = await assembleDay({ api, billId: st.bill.id, stageId: st.stage.billStageId, grouping: r.grouping, amendments: st.amendments, passcode, onProgress: msg });
        if (/report/i.test(st.stage.description)) { msg('Writing the hymn sheet themes\u2026'); await getThemes({ api, grouping: r.grouping, groups: d.groups, passcode, refresh: true }); }
        msg(`Saved. ${d.generated} grid lines written${d.fallbacks ? `, ${d.fallbacks} using the explanatory statement instead` : ''}${d.warning ? ` (${d.warning})` : ''}. The documents are ready on the Bill page.`);
        loadSaved();
      } catch (err) {
        msg(err.message);
        if (/passcode/i.test(err.message)) reopenPasscode(form);
      } finally { t.disabled = false; }
    }
  });

  if (query.bill) { $('[data-bill]').value = query.bill; await chooseBill(query.bill); }
}

export async function renderAdviserEditor(el, _params = {}, query = {}) {
  if (query.tab === 'groupings') { await renderGroupings(el, query); return; }
  const done = renderAdvisers(el);
  el.querySelector('.page-head')?.insertAdjacentHTML('afterend', toggle('advisers'));
  await done;
}
