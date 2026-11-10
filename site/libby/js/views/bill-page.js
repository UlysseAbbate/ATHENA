import { api } from '../api.js';
import { esc, hl, peer, fmtShort, todayIso, loading, errorBox, empty, extLink, pageHeader, debounce } from '../ui.js';
import { authFieldsHtml, readAuth, rememberAuth, reopenPasscode, savedPasscode, can, hasLevel } from '../session.js';
import { loadLib } from '../docs/loader.js';
import { buildGridDoc, buildHymnDoc, downloadDoc, fileSafe } from '../docs/word.js';
import { assembleDay, getThemes } from '../docs/grid-data.js';
import { groupDocs, rankOfLabel } from '../doc-groups.js';
import { amendmentsHtml, wireAmendments } from '../amendments-table.js';

const stripTags = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent.trim(); };

const fmtWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
};

/* ------------------------------------------------------------------ Stages as nested dropdowns */
// Stage > a handful of dropdowns by kind of document (Notices of amendments, Written submissions...) > the documents.
// The kinds are in public/js/doc-groups.js.

function docLinks(doc) {
  const primary = doc.links?.[0];
  const extra = (doc.links || []).slice(1, 3);
  return `<li>${primary ? extLink(primary.url, doc.title) : esc(doc.title)}${doc.date ? ` <span class="muted small">${esc(fmtShort(doc.date))}</span>` : ''}${
    extra.length ? ` <span class="small">(${extra.map((l) => extLink(l.url, l.title)).join(', ')})</span>` : ''}</li>`;
}

const countText = (n) => `${n} ${n === 1 ? 'document' : 'documents'}`;

/** One kind of document at a stage (Explanatory Notes, Delegated Powers Memorandum...) as its own dropdown. */
function slotBlock(slot) {
  const n = slot.docs.length;
  let body = '';
  let meta = '';
  if (n) { body = `<ul class="docs">${slot.docs.map(docLinks).join('')}</ul>`; meta = countText(n); }
  else if (slot.external) { body = `<p class="small">${extLink(slot.external.href, slot.external.label)}</p>`; meta = 'search'; }
  else if (slot.fallback) { body = `<p class="small">${extLink(slot.fallback.href, slot.fallback.label)}</p>`; meta = 'see Today\u2019s Lists'; }
  else { body = '<p class="small muted">Not published yet.</p>'; meta = 'not published yet'; }
  return `<details class="slotd ${n ? 'is-found' : 'is-missing'}"><summary><span>${esc(slot.label)}</span> <span class="small muted">${esc(meta)}</span></summary>${body}</details>`;
}

/** Documents sorted into kinds, each kind its own dropdown. */
const docDropdowns = (docs) => groupDocs(docs).map((g) => slotBlock({ label: g.label, docs: g.docs })).join('');

/** A dropdown that holds documents sorted into kinds (for the documents that belong to no one stage). */
const otherDocsBlock = (label, docs) => `<details class="slotd"><summary><span>${esc(label)}</span> <span class="small muted">${countText(docs.length)}</span></summary><div class="slotlist">${docDropdowns(docs)}</div></details>`;

/**
 * Everything a Lords stage shows besides the Whips' Office documents: the documents the stage is expected to have (the slots,
 * which say "not published yet" when one is missing) and every other document sorted into kinds, in one order. A kind that is
 * also one of the slots (more marshalled lists) joins that slot's dropdown rather than making a second.
 */
function stageDropdowns(s) {
  const blocks = s.slots.map((slot, i) => ({ rank: rankOfLabel(slot.label), i, slot: { ...slot, docs: [...slot.docs] } }));
  const extra = [];
  for (const g of groupDocs(s.extraDocs)) {
    const mate = blocks.find((b) => b.rank === g.rank);
    if (mate) mate.slot.docs.push(...g.docs); else extra.push({ rank: g.rank, i: 100 + g.rank, slot: { label: g.label, docs: g.docs } });
  }
  return [...blocks, ...extra].sort((a, b) => a.rank - b.rank || a.i - b.i).map((b) => slotBlock(b.slot)).join('');
}

/** The stages we show, and which group they belong to. Anything else (programme motions, money
 *  resolutions, carry-over, committal, reintroduction, Royal Assent...) is left out. */
const STAGE_KINDS = [
  ['1R', /^(1st|first) reading/i],
  ['2R', /^(2nd|second) reading/i],
  ['CS', /^(committee stage|select committee stage|committee of the whole|public bill committee)/i],
  ['RS', /^report stage/i],
  ['3R', /^(3rd|third) reading/i],
];
const PINGPONG_RE = /^consideration of|ping.?pong|\b(lords|commons) (amendments|reasons)\b/i;

function classifyStage(description) {
  const d = String(description || '').trim();
  const hit = STAGE_KINDS.find(([, re]) => re.test(d));
  if (hit) return hit[0];
  return PINGPONG_RE.test(d) ? 'PP' : null;
}

function lordsStageBlock(s, { showHouse = false } = {}) {
  const dates = s.dates.map(fmtShort).join(', ');
  const fb = s.forthcoming.map((f) => `<li><strong>${esc(fmtShort(f.date))}</strong> \u2014 ${hl(f.text)}</li>`).join('');
  const whips = can('whips') && s.output && /grid/i.test(s.output) && !/ping/i.test(s.output)
    ? `<details class="slotd is-found" data-wdocs="${s.billStageId}" data-report="${/report/i.test(s.description) ? 1 : ''}"><summary><span>Whips' Office documents</span> <span class="small muted" data-wdocs-meta>checking\u2026</span></summary><div data-wdocs-body></div></details>`
    : '';
  const list = `${whips}${stageDropdowns(s)}`;
  return `
    <li class="stage stage-${s.status.replace(/\s/g, '-')}">
      <details class="stage-d">
        <summary><span class="stage-title">${esc(s.description)}</span><span class="stage-status">${esc(s.status)}</span>${showHouse ? '<span class="small muted">Lords</span>' : ''}${dates ? `<span class="small muted">${esc(dates)}</span>` : ''}</summary>
        ${fb ? `<p class="small muted">In Forthcoming Business:</p><ul class="small fb-list">${fb}</ul>` : ''}
        ${s.output ? `<p class="feeds small">Documents for the <strong>${esc(s.output)}</strong></p>` : ''}
        ${list ? `<div class="slotlist">${list}</div>` : '<p class="small muted">No documents are tracked for this stage.</p>'}
      </details>
    </li>`;
}

/** Share Commons documents between the Commons stages shown. Obvious titles ("...for Report", "Third Reading")
 *  go to that stage; otherwise a document belongs to the latest stage that began on or before it, and when
 *  two stages began the same day (Report and 3rd reading often do) the EARLIER one gets it. */
function placeCommonsDocs(items, docs) {
  const perStage = items.map(() => []);
  const unplaced = [];
  const indexOf = (kind) => items.findIndex((it) => it.kind === kind);
  for (const d of docs) {
    const t = d.title || '';
    let at = -1;
    if (/third reading|3rd reading/i.test(t)) at = indexOf('3R');
    else if (/\breport\b/i.test(t) && !/report from|library|research briefing/i.test(t)) at = indexOf('RS');
    if (at < 0 && d.date) {
      let bestStart = '';
      items.forEach((it, i) => { const st = it.stage.dates[0]; if (st && st <= d.date && st > bestStart) { bestStart = st; at = i; } });
    }
    if (at < 0) unplaced.push(d); else perStage[at].push(d);
  }
  return { perStage, unplaced };
}

function commonsStageBlock(s, docs, today) {
  const dates = s.dates.map(fmtShort).join(', ');
  const status = !s.dates.length ? 'not recorded' : s.dates.every((d) => d < today) ? 'done' : 'scheduled';
  return `
    <li class="stage stage-${status.replace(/\s/g, '-')}">
      <details class="stage-d">
        <summary><span class="stage-title">${esc(s.description)}</span><span class="stage-status">${esc(status)}</span><span class="small muted">Commons</span>${dates ? `<span class="small muted">${esc(dates)}</span>` : ''}</summary>
        ${docs.length ? `<div class="slotlist">${docDropdowns(docs)}</div>` : '<p class="small muted">No Commons documents matched this stage.</p>'}
      </details>
    </li>`;
}

const groupBlock = (name, rows) => (rows.length ? `
  <details class="tree-group"><summary>${esc(name)} <span class="count">${rows.length}</span></summary>
    <ol class="stages">${rows.join('')}</ol></details>` : '');

function stagesHtml(b) {
  const today = todayIso();
  const lordsFirst = /lords/i.test(b.originatingHouse);
  const pick = (stages, house) => stages.map((s) => ({ kind: classifyStage(s.description), stage: s, house })).filter((x) => x.kind);
  const commons = pick(b.commonsStages, 'Commons');
  const lords = pick(b.lordsStages, 'Lords');
  const { perStage, unplaced } = placeCommonsDocs(commons, b.commonsDocs);
  const commonsRow = (it, i) => commonsStageBlock(it.stage, perStage[i], today);
  const commonsMain = commons.map((it, i) => [it, i]).filter(([it]) => it.kind !== 'PP').map(([it, i]) => commonsRow(it, i));
  const lordsMain = lords.filter((it) => it.kind !== 'PP').map((it) => lordsStageBlock(it.stage));
  const pingpong = [
    ...commons.map((it, i) => ({ it, i })).filter(({ it }) => it.kind === 'PP').map(({ it, i }) => ({ date: it.stage.dates[0] || '9999', html: commonsRow(it, i) })),
    ...lords.filter((it) => it.kind === 'PP').map((it) => ({ date: it.stage.dates[0] || '9999', html: lordsStageBlock(it.stage, { showHouse: true }) })),
  ].sort((a, c) => a.date.localeCompare(c.date)).map((x) => x.html);

  const groups = lordsFirst
    ? [groupBlock('Lords', lordsMain), groupBlock('Commons', commonsMain), groupBlock('Ping Pong', pingpong)]
    : [groupBlock('Commons', commonsMain), groupBlock('Lords', lordsMain), groupBlock('Ping Pong', pingpong)];
  const total = commons.length + lords.length;
  return `
    ${total ? groups.join('') : empty('No stages recorded yet.')}
    ${unplaced.length ? otherDocsBlock('Other Commons documents', unplaced) : ''}
    ${b.otherDocs.length ? otherDocsBlock('Other documents', b.otherDocs) : ''}
    ${b.unassignedForthcoming.length ? `<p class="small">Also in Forthcoming Business: ${b.unassignedForthcoming.map((f) => `${esc(fmtShort(f.date))} \u2014 ${hl(f.text)}`).join('; ')}</p>` : ''}`;
}

/* ------------------------------------------------------------------ Amendments: drafting */

const draftPlainText = (a) => [a.title, a.location, ...a.text, a.mes ? `MES: ${a.mes}` : '', a.notes.length ? ['Internal notes \u2014 not for tabling', ...a.notes.map((n) => `- ${n}`)].join('\n') : '']
  .filter(Boolean).join('\n\n');

function draftResultHtml(r) {
  return `
    ${r.amendments.map((a, i) => `
      <article class="draft" data-i="${i}">
        <h4 class="draft-title">${esc(a.title)}</h4>${a.type ? ` <span class="small muted">(${esc(a.type)})</span>` : ''}
        ${a.location ? `<p>${esc(a.location)}</p>` : ''}
        ${a.text.map((t) => `<p>${esc(t)}</p>`).join('')}
        ${a.mes ? `<p class="mes"><em>MES: ${esc(a.mes)}</em></p>` : ''}
        ${a.notes.length ? `<p class="draft-notes-head">Internal notes \u2014 not for tabling</p><ul>${a.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        <p><button type="button" class="button button-quiet button-small" data-copy-draft>Copy this amendment</button> <span class="small muted" data-copied aria-live="polite"></span></p>
      </article>`).join('')}
    ${r.consequential.length ? `<h3 class="h3-section">Consequential amendments needed</h3><ul class="plain">${r.consequential.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    ${r.assumptions.length ? `<h3 class="h3-section">Assumptions and references to confirm</h3><ul class="plain">${r.assumptions.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    <p class="small muted">Drafted by Claude following the Lords Guide to Amendment Style. Check the Bill wording, page and line references and the explanatory statement before tabling.</p>`;
}

async function renderDraftTab(panel, ctx) {
  const { billId, title, committee, reportAvailable, loadStage } = ctx;
  let sources = [];
  if (committee) {
    try {
      const { d } = await loadStage(committee.billStageId);
      sources = [...d.ours.flatMap((g) => g.amendments), ...d.supported];
    } catch { /* the drafting form still works without the list */ }
  }
  panel.innerHTML = `
    <h3 class="h3-section">Draft amendments</h3>
    <p class="small muted">Describe what you want an amendment to do and Claude will draft it in House of Lords style (location line, text, explanatory statement and internal notes) following the Whips' Office drafting instructions. It is a starting point: check everything before tabling.</p>
    <form class="draft-form" data-draft>
      <div class="row">
        <label class="field field-narrow"><span>Stage the amendment is for</span>
          <select name="stage"><option value="committee" ${reportAvailable ? '' : 'selected'}>Committee</option><option value="report" ${reportAvailable ? 'selected' : ''}>Report</option></select></label>
        <label class="field field-narrow"><span>Lead peer (optional)</span><input type="text" name="peer" maxlength="100" placeholder="e.g. Sarah Ludford"></label>
      </div>
      <label class="field"><span>What should the amendment achieve?</span><textarea name="aim" rows="4" maxlength="3000" required></textarea></label>
      <label class="field"><span>Where in the Bill? (optional)</span><input type="text" name="where" maxlength="300" placeholder='e.g. after Clause 12, or Clause 5, subsection (2)'></label>
      ${sources.length ? `<label class="field"><span>Redraft an earlier Committee amendment (optional)</span>
        <select name="source"><option value="">None: a new amendment</option>${sources.map((a) => `<option value="${a.id}">Am ${esc(a.number)} (${esc(a.lead)}) \u2014 ${esc(a.place || a.title)}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Bill wording this relates to (optional, paste it in)</span><textarea name="billWording" rows="5" maxlength="12000" placeholder="Paste the clause or subsection being amended, and say which print it is from. Without it, page and line references are left as [page X, line Y \u2013 to confirm]."></textarea></label>
      <label class="field"><span>Background notes (optional: Hansard, briefings, meeting notes)</span><textarea name="notes" rows="3" maxlength="4000"></textarea></label>
      <div class="row">${authFieldsHtml()}</div>
      <p><button class="button" type="submit">Draft amendment</button> <span class="small" data-dstatus aria-live="polite"></span></p>
    </form>
    <div data-draft-out></div>`;

  const form = panel.querySelector('[data-draft]');
  const out = panel.querySelector('[data-draft-out]');
  const status = panel.querySelector('[data-dstatus]');
  let last = null;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = (n) => form.querySelector(`[name="${n}"]`)?.value.trim() || '';
    const { passcode, author } = readAuth(form);
    status.textContent = 'Drafting. This can take up to a minute\u2026';
    out.innerHTML = '';
    try {
      let source = null;
      const sid = f('source');
      if (sid && committee) {
        const a = sources.find((x) => String(x.id) === sid);
        const det = await api(`bills/${billId}/amendment?stage=${committee.billStageId}&aid=${sid}`);
        source = { number: a?.number, lead: a?.lead, location: det.location || a?.place, text: det.text, mes: det.explanatoryStatement };
      }
      last = await api('draft-amendment', {
        method: 'POST',
        body: JSON.stringify({ passcode, stage: f('stage'), billTitle: title, peer: f('peer'), aim: f('aim'), where: f('where'), billWording: f('billWording'), notes: f('notes'), source }),
      });
      rememberAuth(passcode, author);
      status.textContent = '';
      out.innerHTML = draftResultHtml(last);
    } catch (err) {
      status.textContent = err.message;
      if (/passcode/i.test(err.message)) reopenPasscode(form);
    }
  });

  out.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy-draft]');
    if (!btn) return;
    const art = btn.closest('[data-i]');
    const msg = art.querySelector('[data-copied]');
    try { await navigator.clipboard.writeText(draftPlainText(last.amendments[Number(art.dataset.i)])); msg.textContent = 'Copied.'; }
    catch { msg.textContent = 'Your browser blocked copying; select the text instead.'; }
  });
}

/* ------------------------------------------------------------------ Stakeholders */
// Who we have heard from on a Bill: organisation, contact, their position, and their briefing (typed in, uploaded, or both).
// Whips and above can read; the Whips' Office features (can('whips')) add, edit and delete. Files are Word or PDF, up to 4 MB.

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isEmail = (t) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);

function stakeholderForm(st = {}) {
  const editing = !!st.id;
  return `
    <form class="stake-form" data-sform ${editing ? `data-edit="${st.id}"` : ''}>
      <div class="row">
        <label class="field"><span>Stakeholder organisation *</span><input type="text" name="organisation" maxlength="200" required value="${esc(st.organisation || '')}"></label>
        <label class="field"><span>Name</span><input type="text" name="contactName" maxlength="150" autocomplete="off" value="${esc(st.contact_name || '')}"></label>
        <label class="field"><span>Contact (email, phone)</span><input type="text" name="contact" maxlength="300" autocomplete="off" value="${esc(st.contact || '')}"></label>
      </div>
      <label class="field"><span>Their position, in a line or two</span><input type="text" name="position" maxlength="400" value="${esc(st.position || '')}" placeholder="e.g. Supports the Bill but wants Clause 12 narrowed"></label>
      <label class="field"><span>Briefing: type it here, or upload it below (or both)</span><textarea name="briefing" rows="6" maxlength="20000">${esc(st.briefing || '')}</textarea></label>
      <div class="row">
        <label class="field"><span>${st.file_name ? 'Replace the uploaded briefing' : 'Upload a briefing'} (Word or PDF, up to 4 MB)</span><input type="file" name="file" accept=".pdf,.doc,.docx"></label>
        ${authFieldsHtml()}
      </div>
      ${st.file_name ? `<label class="small"><input type="checkbox" name="removeFile" value="1"> Remove the uploaded file (${esc(st.file_name)})</label>` : ''}
      <p><button class="button" type="submit">${editing ? 'Save changes' : 'Add stakeholder'}</button>
        ${editing ? '<button class="button button-quiet" type="button" data-cancel>Cancel</button>' : ''}
        <span class="small" data-sstatus aria-live="polite"></span></p>
    </form>`;
}

function stakeholderCard(st, edit) {
  const contact = [st.contact_name, st.contact && (isEmail(st.contact) ? `<a href="mailto:${esc(st.contact)}">${esc(st.contact)}</a>` : esc(st.contact))]
    .map((x, i) => (i === 0 ? (x ? esc(x) : '') : x)).filter(Boolean).join(' \u00B7 ');
  const long = (st.briefing || '').length > 400;
  return `
    <li class="stake" data-sid="${st.id}">
      <div class="stake-head">
        <h3 class="stake-org">${esc(st.organisation)}</h3>
        ${edit ? '<span class="stake-actions"><button type="button" class="button button-quiet button-small" data-sedit>Edit</button> <button type="button" class="button button-quiet button-small" data-sdelete>Delete</button></span>' : ''}
      </div>
      ${contact ? `<p class="small stake-contact">${contact}</p>` : ''}
      ${st.position ? `<p class="stake-position"><strong>Position:</strong> ${esc(st.position)}</p>` : ''}
      ${st.briefing ? `<details class="stake-briefing" ${long ? '' : 'open'}><summary>Briefing</summary><p>${esc(st.briefing)}</p></details>` : ''}
      ${st.file_name ? `<p class="small"><a href="/api/libby/bill-stakeholders?id=${st.id}&download=1">${esc(st.file_name)}</a> <span class="muted">(${esc(fmtSize(st.size_bytes || 0))})</span></p>` : ''}
      ${!st.briefing && !st.file_name && !st.position ? '<p class="small muted">No briefing or position recorded yet.</p>' : ''}
      <p class="small muted">Added${st.created_by ? ` by ${esc(st.created_by)}` : ''} ${esc(fmtWhen(st.created_at))}${st.updated_at && st.updated_at !== st.created_at && fmtWhen(st.updated_at) !== fmtWhen(st.created_at) ? ` \u00B7 updated${st.updated_by ? ` by ${esc(st.updated_by)}` : ''} ${esc(fmtWhen(st.updated_at))}` : ''}</p>
    </li>`;
}

async function renderStakeholders(panel, { billId }) {
  const edit = can('whips');
  panel.innerHTML = loading('Loading the stakeholders');
  let list;
  try { list = (await api(`bill-stakeholders?bill=${billId}`)).stakeholders; } catch (err) { panel.innerHTML = errorBox(err); return; }

  panel.innerHTML = `
    <p class="small muted">Who we have heard from on this Bill, how to reach them, what they want, and their briefing.${edit ? '' : ' You can read these; adding and editing is limited to the Whips\u2019 Office team.'}</p>
    ${edit ? `<details class="stake-add" ${list.length ? '' : 'open'}><summary class="h3-section">Add a stakeholder</summary>${stakeholderForm()}</details>` : ''}
    <div data-slist></div>`;
  const out = panel.querySelector('[data-slist]');

  const draw = (q = '') => {
    const needle = q.trim().toLowerCase();
    const shown = needle ? list.filter((st) => [st.organisation, st.contact_name, st.contact, st.position, st.briefing, st.file_name].join(' ').toLowerCase().includes(needle)) : list;
    out.innerHTML = `
      <h3 class="h3-section">Stakeholders <span class="count">${list.length}</span></h3>
      ${list.length > 4 ? '<label class="field"><span>Filter by organisation, name or anything in the notes</span><input type="search" data-sfilter></label>' : ''}
      ${shown.length ? `<ul class="stakes">${shown.map((st) => stakeholderCard(st, edit)).join('')}</ul>` : empty(list.length ? 'No stakeholder matches.' : 'No stakeholders have been recorded for this Bill yet.')}`;
    const f = out.querySelector('[data-sfilter]');
    if (f) { f.value = q; f.addEventListener('input', debounce(() => draw(f.value), 150)); }
  };
  draw();

  /** Send the form: a new stakeholder, or (with data-edit) changes to one. */
  async function save(form) {
    const status = form.querySelector('[data-sstatus]');
    const field = (name) => form.elements.namedItem(name);
    const file = field('file').files[0];
    if (file && file.size > 4 * 1024 * 1024) { status.textContent = 'That file is over 4 MB. Save it as a smaller file and try again.'; return null; }
    const { author } = readAuth(form);
    const fd = new FormData();
    fd.set('billId', billId);
    if (form.dataset.edit) fd.set('id', form.dataset.edit);
    for (const n of ['organisation', 'contactName', 'contact', 'position', 'briefing']) fd.set(n, field(n).value);
    if (file) fd.set('file', file);
    if (field('removeFile')?.checked) fd.set('removeFile', '1');
    fd.set('author', author);
    status.textContent = file ? 'Uploading\u2026' : 'Saving\u2026';
    try {
      const r = await api('bill-stakeholders', { method: 'POST', body: fd });
      rememberAuth('', author);
      return r.stakeholder;
    } catch (err) { status.textContent = err.message; return null; }
  }

  panel.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-sform]');
    if (!form) return;
    e.preventDefault();
    const saved = await save(form);
    if (!saved) return;
    const at = list.findIndex((st) => st.id === saved.id);
    if (at >= 0) list[at] = saved; else list.push(saved);
    list.sort((x, y) => x.organisation.localeCompare(y.organisation));
    if (!form.dataset.edit) { form.reset(); form.querySelector('[data-sstatus]').textContent = `Added ${saved.organisation}.`; }
    draw(out.querySelector('[data-sfilter]')?.value || '');
  });

  panel.addEventListener('click', async (e) => {
    const card = e.target.closest('[data-sid]');
    if (!card) return;
    const st = list.find((x) => String(x.id) === card.dataset.sid);
    if (e.target.closest('[data-sedit]')) {
      card.innerHTML = stakeholderForm(st);
    } else if (e.target.closest('[data-cancel]')) {
      draw(out.querySelector('[data-sfilter]')?.value || '');
    } else if (e.target.closest('[data-sdelete]')) {
      if (!window.confirm(`Delete the notes and briefing for ${st.organisation}? This cannot be undone.`)) return;
      try {
        await api('bill-stakeholders', { method: 'POST', body: JSON.stringify({ action: 'delete', id: st.id }) });
        list.splice(list.indexOf(st), 1);
        draw(out.querySelector('[data-sfilter]')?.value || '');
      } catch (err) { window.alert(err.message); }
    }
  });
}

/* ------------------------------------------------------------------ The page */

export async function renderBill(el, { id, house }, query = {}) {
  // Honourable LIBBY (the Commons) shows the amendments at the Commons stages, with Lib Dem MPs marked; the Lords drafting tool is the Lords'.
  const commons = house === 'commons';
  const base = commons ? '#/c' : '#';
  el.innerHTML = loading('Loading the Bill');
  let b;
  try { b = await api(`bills/${id}`); } catch (err) { el.innerHTML = errorBox(err); return; }

  // The Amendments section shows one House's amendments at a time, with a button to switch (it starts on the House whose page this is).
  let amCommons = commons;
  let committee, report, tabs;
  const usable = (s) => !!s && s.status !== 'not yet scheduled';
  const setAmHouse = (c) => {
    amCommons = c;
    const stageOf = (re) => (c ? b.commonsStages : b.lordsStages).find((s) => s.takesAmendments && re.test(s.description));
    committee = stageOf(/committee/i);
    report = stageOf(/report/i);
    tabs = [
      { key: 'committee', label: 'Committee', stage: committee },
      { key: 'report', label: 'Report', stage: report },
      { key: 'draft', label: 'Draft amendments' },
    ].filter((t) => t.key !== 'draft' || (can('whips') && !c));
  };
  setAmHouse(commons);
  const tabsHtml = () => tabs.map((t) => `<button type="button" role="tab" aria-selected="false" data-tab="${t.key}">${esc(t.label)}</button>`).join('');

  // The three sections, one button each. Stakeholders are for the Whips' Office team and above.
  const stageCount = b.commonsStages.length + b.lordsStages.length;
  const sections = [
    { key: 'stages', label: 'Stages', count: stageCount },
    { key: 'amendments', label: 'Amendments' },
    ...(hasLevel('whips') ? [{ key: 'stakeholders', label: 'Stakeholders' }] : []),
  ];

  el.innerHTML = `
    ${pageHeader(b.title, esc(b.longTitle), [[`${base}/legislation`, 'Legislation']])}
    <p class="bill-meta small">Current stage: <strong>${esc(b.currentStage)}</strong> \u00B7 Started in the ${esc(b.originatingHouse)} \u00B7
      ${extLink(b.url, 'Bill page on bills.parliament.uk')}</p>
    ${b.sponsors.length ? `<p class="small">Sponsors: ${b.sponsors.map((s) => `${peer(s.name, s.ld)}${s.department ? ` <span class="muted">(${esc(s.department)})</span>` : ''}`).join('; ')}</p>` : ''}
    <p class="small" data-next-stage>Next stage: <span class="muted">checking…</span></p>
    <div class="bill-team" aria-label="Who is looking after this Bill">
      ${['commons', 'lords'].map((h) => `<section class="bill-team-house bill-team-${h}" aria-labelledby="team-${h}">
        <h3 id="team-${h}" class="team-title">${h === 'commons' ? 'Commons' : 'Lords'}</h3>
        <dl><div><dt>Adviser</dt><dd data-team="${h}-adviser"><span class="muted">…</span></dd></div><div><dt>Bill lead</dt><dd data-team="${h}-lead"><span class="muted">…</span></dd></div></dl>
      </section>`).join('')}
    </div>
    ${b.summary ? `<details class="summary-box"><summary>Summary</summary><p>${esc(stripTags(b.summary))}</p></details>` : ''}

    <div class="sections" role="tablist" aria-label="Sections of this Bill">${sections.map((x) => `<button type="button" role="tab" id="sec-btn-${x.key}" aria-controls="sec-${x.key}" aria-selected="false" data-sec="${x.key}">${esc(x.label)}${x.count ? ` <span class="count">${x.count}</span>` : ''}</button>`).join('')}</div>

    <section id="sec-stages" role="tabpanel" aria-labelledby="sec-btn-stages" hidden>${stagesHtml(b)}</section>
    <section id="sec-amendments" role="tabpanel" aria-labelledby="sec-btn-amendments" hidden>
      <div class="toggle am-house" role="group" aria-label="Whose amendments">
        <button type="button" data-amhouse="lords" aria-pressed="${!commons}" ${!commons ? 'aria-current="true"' : ''}>Lords amendments</button>
        <button type="button" data-amhouse="commons" aria-pressed="${commons}" ${commons ? 'aria-current="true"' : ''}>Commons amendments</button>
      </div>
      <div class="tabs" role="tablist" aria-label="Amendments" id="am-tabs">${tabsHtml()}</div>
      <div id="ams" role="tabpanel"></div>
    </section>
    ${sections.some((x) => x.key === 'stakeholders') ? '<section id="sec-stakeholders" role="tabpanel" aria-labelledby="sec-btn-stakeholders" hidden></section>' : ''}`;

  // The Bill's team (who is the adviser and the Bill lead in each House) and its next stage: both are on this page, not on the Legislation list.
  api(`bill-team?bill=${id}`).then((t) => {
    for (const h of ['commons', 'lords']) {
      el.querySelector(`[data-team="${h}-adviser"]`).innerHTML = t[h].adviser ? esc(t[h].adviser) : '<span class="muted">Not named yet</span>';
      el.querySelector(`[data-team="${h}-lead"]`).innerHTML = t[h].lead ? hl(t[h].lead) : '<span class="muted">Not named yet</span>';
    }
  }).catch(() => el.querySelectorAll('[data-team]').forEach((d) => { d.innerHTML = '<span class="muted">Unavailable</span>'; }));
  api(`bill-next?ids=${id}`).then((d) => {
    const n = (d.dates || {})[id];
    el.querySelector('[data-next-stage]').innerHTML = n && n.date ? `Next stage: <strong>${esc(fmtShort(n.date))}</strong>${n.stage ? ` · ${esc(n.stage)}${n.house ? ` (${esc(n.house)})` : ''}` : ''}` : 'Next stage: <span class="muted">not yet scheduled</span>';
  }).catch(() => { const p = el.querySelector('[data-next-stage]'); if (p) p.innerHTML = 'Next stage: <span class="muted">unavailable</span>'; });

  const panel = el.querySelector('#ams');
  const cache = new Map();
  const loadStage = (stageId) => {
    const house = amCommons ? 'commons' : 'lords';
    const key = `${house}:${stageId}`;
    if (!cache.has(key)) {
      const none = Promise.resolve({ comments: {} });
      const p = Promise.all([
        api(`bills/${id}/amendments?stage=${stageId}${amCommons ? '&house=commons' : ''}`),
        (can('whips') ? api(`comments?bill=${id}&stage=${stageId}`) : none).then((r) => ({ comments: r.comments || {} })).catch((err) => ({ comments: {}, error: err.message })),
        (hasLevel('whips') ? api(`amendment-flags?bill=${id}&stage=${stageId}`) : Promise.resolve({ flags: {} })).then((r) => ({ flags: r.flags || {} })).catch((err) => ({ flags: {}, error: err.message })),
      ]).then(([d, c, f]) => ({ d, comments: c.comments, commentsError: c.error, flags: f.flags, flagsError: f.error }));
      p.catch(() => cache.delete(key));
      cache.set(key, p);
    }
    return cache.get(key);
  };

  // Whips' Office documents: one entry per saved sitting day, with Word downloads.
  const wdocs = [...el.querySelectorAll('[data-wdocs]')];
  if (wdocs.length) {
    api(`groupings?bill=${id}`).then(({ groupings }) => {
      for (const box of wdocs) {
        const mine = groupings.filter((g) => String(g.stage_id) === box.dataset.wdocs);
        const editLink = `#/adviser-editor?tab=groupings&bill=${id}&stage=${box.dataset.wdocs}`;
        box.querySelector('[data-wdocs-meta]').textContent = mine.length ? `${mine.length} sitting ${mine.length === 1 ? 'day' : 'days'}` : 'none yet';
        box.querySelector('[data-wdocs-body]').innerHTML = mine.length ? `<ul class="docs">${mine.map((g) => `
          <li>Day ${esc(g.day)}${g.sitting_date ? ` \u00B7 ${esc(fmtShort(g.sitting_date))}` : ''} \u00B7 ${g.groups.length} groups:
            <button type="button" class="linkish" data-dl="grid" data-gid="${g.id}">${box.dataset.report ? 'Report' : 'Committee'} Stage Grid (Word)</button>
            ${box.dataset.report ? ` \u00B7 <button type="button" class="linkish" data-dl="hymn" data-gid="${g.id}">Hymn Sheet (Word)</button>` : ''}
            <span class="small muted" data-dlstatus="${g.id}" aria-live="polite"></span></li>`).join('')}</ul>
          <p class="small"><a href="${editLink}">Add or edit a grouping in the adviser editor</a></p>`
          : `<p class="small muted">No grouping saved for this stage yet. Advisers can <a href="${editLink}">add one in the adviser editor</a>.</p>`;
        box._groupings = mine;
      }
    }).catch((err) => {
      for (const box of wdocs) { box.querySelector('[data-wdocs-meta]').textContent = 'unavailable'; box.querySelector('[data-wdocs-body]').innerHTML = `<p class="small muted">${esc(err.message)}</p>`; }
    });
    el.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-dl]');
      if (!btn) return;
      const box = btn.closest('[data-wdocs]');
      const g = box._groupings.find((x) => String(x.id) === btn.dataset.gid);
      const status = box.querySelector(`[data-dlstatus="${g.id}"]`);
      const stageWord = box.dataset.report ? 'Report' : 'Committee';
      const docTitle = b.title.replace(/\s*\[HL\]\s*$/i, '');
      try {
        status.textContent = 'Preparing\u2026';
        const D = await loadLib('docx');
        const { d } = await loadStage(Number(box.dataset.wdocs));
        const day = await assembleDay({ api, billId: id, stageId: box.dataset.wdocs, grouping: g, amendments: d.all, passcode: savedPasscode(), onProgress: (t) => { status.textContent = t; } });
        let doc;
        if (btn.dataset.dl === 'grid') doc = buildGridDoc(D, { billTitle: docTitle, stageWord, day: g.day, groups: day.groups });
        else {
          const t = await getThemes({ api, grouping: g, groups: day.groups, passcode: savedPasscode() });
          g.themes = t.themes;
          doc = buildHymnDoc(D, { billTitle: docTitle, day: g.day, groups: day.groups.map((x) => ({ number: x.number, refsLabel: x.refsLabel, theme: t.themes[x.number] })) });
        }
        await downloadDoc(D, doc, `${fileSafe(docTitle)}_${stageWord}_${btn.dataset.dl === 'grid' ? 'Stage_Grid' : 'Hymn_Sheet'}_Day${g.day}.docx`);
        status.textContent = day.unmatched.length ? `Downloaded. Not found in the published amendments: ${day.unmatched.join(', ')}.` : 'Downloaded.';
      } catch (err) { status.textContent = err.message; }
    });
  }

  let token = 0;
  const show = async (key) => {
    const mine = ++token;
    el.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === key)));
    const tab = tabs.find((t) => t.key === key);
    panel.innerHTML = loading(key === 'draft' ? 'Preparing the drafting form' : 'Loading amendments');
    if (key === 'draft') {
      const holder = document.createElement('div');
      await renderDraftTab(holder, { billId: id, title: b.title, committee: usable(committee) ? committee : null, reportAvailable: usable(report), loadStage });
      if (mine === token) { panel.innerHTML = ''; panel.appendChild(holder); }
      return;
    }
    if (!usable(tab.stage)) {
      panel.innerHTML = empty(`${tab.label} stage has not started, so there are no amendments yet.`);
      return;
    }
    try {
      const state = await loadStage(tab.stage.billStageId);
      if (mine !== token) return;
      // A fresh wrapper per render, so switching tabs never stacks up duplicate event handlers.
      const wrap = document.createElement('div');
      wrap.innerHTML = amendmentsHtml(state.d, state.comments, state.commentsError, state.flags, state.flagsError);
      panel.innerHTML = '';
      panel.appendChild(wrap);
      wireAmendments(wrap, id, tab.stage.billStageId, state, { house: amCommons ? 'commons' : 'lords' });
    } catch (err) { if (mine === token) panel.innerHTML = errorBox(err); }
  };

  const wireTabs = () => el.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
  const firstTab = () => (usable(report) ? 'report' : usable(committee) ? 'committee' : (can('whips') && !amCommons ? 'draft' : 'committee'));
  wireTabs();
  el.querySelectorAll('[data-amhouse]').forEach((btn) => btn.addEventListener('click', () => {
    const c = btn.dataset.amhouse === 'commons';
    if (c === amCommons) return;
    setAmHouse(c);
    el.querySelectorAll('[data-amhouse]').forEach((x) => { const on = x === btn; x.setAttribute('aria-pressed', String(on)); if (on) x.setAttribute('aria-current', 'true'); else x.removeAttribute('aria-current'); });
    el.querySelector('#am-tabs').innerHTML = tabsHtml();
    wireTabs();
    show(firstTab());
  }));

  // Each section is drawn the first time it is opened. The one showing is kept in the address (?tab=) so it can be shared.
  const opened = new Set();
  const openSection = (key) => {
    el.querySelectorAll('[data-sec]').forEach((btn) => btn.setAttribute('aria-selected', String(btn.dataset.sec === key)));
    el.querySelectorAll('section[role="tabpanel"][id^="sec-"]').forEach((sec) => { sec.hidden = sec.id !== `sec-${key}`; });
    try { history.replaceState(null, '', `${base}/bill/${id}${key === 'stages' ? '' : `?tab=${key}`}`); } catch { /* the address is a convenience */ }
    if (opened.has(key)) return;
    opened.add(key);
    if (key === 'amendments') show(firstTab());
    if (key === 'stakeholders') renderStakeholders(el.querySelector('#sec-stakeholders'), { billId: id });
  };
  el.querySelectorAll('[data-sec]').forEach((btn) => btn.addEventListener('click', () => openSection(btn.dataset.sec)));
  openSection(sections.some((x) => x.key === query.tab) ? query.tab : 'stages');
}
