// The public "Groupings and grids" page: pick a Lords Bill and stage, upload the Government Whips' Office grouping of amendments, check it, download the grid (Word).
// It has no sign-in: it is reached only through a link that carries a secret key (?k=...), which the server checks (functions/api/grids/index.js). Nothing is saved anywhere.
// The reading of the grouping and the making of the grid are the same code the signed-in adviser pages use (site/libby/js/docs/).
import { loadLib } from '../libby/js/docs/loader.js';
import { parseGroupingXml, parseGroupingText, matchGroups, refsToText } from '../libby/js/docs/grouping.js';
import { assembleDay } from '../libby/js/docs/grid-data.js';
import { buildGridDoc, downloadDoc, docFileName } from '../libby/js/docs/word.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const key = new URLSearchParams(location.search).get('k') || '';
const app = document.getElementById('app');

async function api(what, params = {}) {
  const res = await fetch(`/api/grids?${new URLSearchParams({ do: what, ...params })}`, { headers: { 'x-grid-key': key, accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
  return data;
}

if (!key) {
  app.innerHTML = '<p class="state state-warn">This page opens only from its link. Ask for the link again.</p>';
} else {
  start().catch((err) => { app.innerHTML = `<p class="state state-error" role="alert">${esc(err.message)}</p>`; });
}

async function start() {
  const { bills } = await api('bills');
  const st = { bill: null, stages: [], stage: null, amendments: [], groups: [], day: '', stageWord: 'Committee' };
  app.innerHTML = `<div class="ask-form" data-form>
      <h2 class="h2-rule">1. The Bill and stage</h2>
      <div class="row"><label class="field"><span>Bill</span><select data-bill><option value="">Choose a Bill&hellip;</option>${bills.map((b) => `<option value="${b.id}">${esc(b.title)}</option>`).join('')}</select></label>
        <label class="field field-narrow"><span>Stage</span><select data-stage disabled><option value="">Choose a Bill first</option></select></label></div>
      <div data-work hidden>
        <h2 class="h2-rule">2. The grouping of amendments</h2>
        <div class="row"><label class="field"><span>Upload the grouping (Word, .docx)</span><input type="file" data-file accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label></div>
        <details><summary class="small">Or paste the grouping as text</summary>
          <label class="field"><span>One group per line, for example &ldquo;1. 1, 2, 3 &ndash; Votes at 16&rdquo;</span><textarea rows="6" data-paste></textarea></label>
          <p><button type="button" class="button button-quiet button-small" data-read-text>Read this text</button></p></details>
        <div data-preview aria-live="polite"></div>
      </div>
      <p class="small" data-msg role="status" aria-live="polite"></p>
    </div>`;
  const $ = (sel) => app.querySelector(sel);
  const msg = (t) => { $('[data-msg]').textContent = t; };

  $('[data-bill]').addEventListener('change', async (e) => {
    st.bill = bills.find((b) => String(b.id) === e.target.value) || null;
    const sel = $('[data-stage]');
    sel.innerHTML = '<option value="">Choose a Bill first</option>'; sel.disabled = true; $('[data-work]').hidden = true; st.groups = []; msg('');
    if (!st.bill) return;
    msg('Loading the stages…');
    try {
      const d = await api('stages', { bill: st.bill.id });
      st.stages = d.stages;
      sel.innerHTML = st.stages.length ? `<option value="">Choose a stage</option>${st.stages.map((s) => `<option value="${s.billStageId}">${esc(s.description)}</option>`).join('')}` : '<option value="">No Committee or Report stage yet</option>';
      sel.disabled = !st.stages.length;
      msg(st.stages.length ? '' : 'This Bill has no Committee or Report stage in the Lords yet.');
    } catch (err) { msg(err.message); }
  });
  $('[data-stage]').addEventListener('change', async (e) => {
    st.stage = st.stages.find((s) => String(s.billStageId) === e.target.value) || null;
    st.groups = []; $('[data-preview]').innerHTML = ''; $('[data-work]').hidden = !st.stage;
    if (!st.stage) return;
    st.stageWord = /report/i.test(st.stage.description) ? 'Report' : 'Committee';
    msg('Loading the amendments for this stage…');
    try { st.amendments = (await api('amendments', { bill: st.bill.id, stage: st.stage.billStageId })).amendments; msg(`${st.amendments.length} amendments are published for this stage.`); }
    catch (err) { st.amendments = []; msg(`The amendments for this stage could not be loaded (${err.message}), so nothing can be matched yet.`); }
  });

  const take = (parsed) => {
    if (!parsed.groups.length) { st.groups = []; msg('I could not find any groups in that document. Check it is the Government Whips’ Office grouping of amendments, or paste the text instead.'); $('[data-preview]').innerHTML = ''; return; }
    st.groups = parsed.groups;
    if (parsed.day) st.day = String(parsed.day);
    if (parsed.stage === 'report' || parsed.stage === 'committee') st.stageWord = parsed.stage === 'report' ? 'Report' : 'Committee';
    msg('');
    preview();
  };
  const preview = () => {
    const { groups, unmatched } = matchGroups(st.groups, st.amendments);
    $('[data-preview]').innerHTML = `<h2 class="h2-rule">3. Check it, then download</h2>
      <div class="table-wrap"><table class="grid"><thead><tr><th scope="col">Group</th><th scope="col">Topic</th><th scope="col">Amendments</th><th scope="col">Found</th></tr></thead><tbody>
      ${groups.map((g) => `<tr><th scope="row">${esc(g.number)}</th><td>${esc(g.topic)}</td><td>${esc(refsToText(g.refs))}</td><td>${g.refs.filter((r) => !r.debated && r.matches.length).length} of ${g.refs.filter((r) => !r.debated).length}</td></tr>`).join('')}</tbody></table></div>
      ${unmatched.length ? `<p class="small state state-warn">Not found in the amendments published for this stage: ${esc(unmatched.join(', '))}. They will appear in the grid marked as not found: check the marshalled list.</p>` : ''}
      <div class="row"><label class="field field-narrow"><span>Stage</span><select data-stageword><option ${st.stageWord === 'Committee' ? 'selected' : ''}>Committee</option><option ${st.stageWord === 'Report' ? 'selected' : ''}>Report</option></select></label>
        <label class="field field-narrow"><span>Day</span><input data-day maxlength="3" value="${esc(st.day)}" placeholder="e.g. 2"></label></div>
      <p><button type="button" class="button" data-download>Download the grid (Word)</button> <span class="small" data-dlstatus role="status" aria-live="polite"></span></p>`;
  };

  $('[data-file]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    msg('Reading the document…');
    try {
      const JSZip = await loadLib('JSZip');
      const zip = await JSZip.loadAsync(file);
      const xml = await zip.file('word/document.xml')?.async('string');
      if (!xml) throw new Error('This does not look like a Word (.docx) file.');
      take(parseGroupingXml(xml));
    } catch (err) { msg(err.message); }
  });
  $('[data-read-text]').addEventListener('click', () => take(parseGroupingText($('[data-paste]').value)));

  app.addEventListener('change', (e) => {
    if (e.target.matches('[data-stageword]')) st.stageWord = e.target.value;
    if (e.target.matches('[data-day]')) st.day = e.target.value.replace(/\D/g, '');
  });
  app.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-download]');
    if (!btn) return;
    const out = $('[data-dlstatus]');
    btn.disabled = true;
    try {
      out.textContent = 'Preparing…';
      const D = await loadLib('docx');
      // the explanatory statements come from the public Bills API through this page's own server route; no paid text-writing service is used on this page
      const shim = async (path) => {
        const m = /^bills\/(\d+)\/amendment\?stage=(\d+)&aid=(\d+)$/.exec(path);
        if (!m) throw new Error('not available');
        return api('amendment', { bill: m[1], stage: m[2], aid: m[3] });
      };
      const day = await assembleDay({ api: shim, billId: st.bill.id, stageId: st.stage.billStageId, grouping: { groups: st.groups }, amendments: st.amendments, passcode: '', onProgress: (t) => { out.textContent = t; } });
      const title = st.bill.title.replace(/\s*\[HL\]\s*$/i, '');
      await downloadDoc(D, buildGridDoc(D, { billTitle: title, stageWord: st.stageWord, day: st.day, groups: day.groups }), docFileName({ billTitle: title, house: 'Lords', stage: st.stageWord, title: 'Grid' }));
      out.textContent = day.unmatched.length ? `Downloaded. Not found in the published amendments: ${day.unmatched.join(', ')}.` : 'Downloaded.';
    } catch (err) { out.textContent = err.message; } finally { btn.disabled = false; }
  });
}
