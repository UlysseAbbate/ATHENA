// Parliamentary process (#/parliamentary-process, under the Whips Hub): ask a question about procedure and get an answer drawn from Erskine May (read live) and the Lords Companion
// (uploaded by Staff as a PDF), with the passages it used listed so the answer can be checked. Every question and answer stays on a shared list.
import { api } from '../api.js';
import { esc, fmtDate, loading, errorBox, empty, pageHeader } from '../ui.js';
import { hasLevel, savedName } from '../session.js';
import { readPdfPages, chunkPages } from '../docs/companion-reader.js';

const HOUSES = { '': 'Not sure', lords: 'The Lords', commons: 'The Commons' };
const CONF = { clear: 'The passages answer this', partial: 'Partly answered by the passages', 'not found': 'Not found in the passages' };

/** The answer with its [1] [2] markers as small links to the sources list. */
const answerHtml = (text) => esc(text).replace(/\[(\d+)\]/g, '<sup><a href="#src-$1">[$1]</a></sup>').split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

function sourcesHtml(sources) {
  if (!sources.length) return '';
  return `<h3 class="h3-section">Passages used</h3><ol class="proc-sources">${sources.map((s) => `<li id="src-${s.n}" value="${s.n}">
    <strong>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.source)}${s.ref ? ` ${esc(s.ref)}` : ''}</a>` : `${esc(s.source)}${s.ref ? ` ${esc(s.ref)}` : ''}`}</strong>
    ${s.title ? `· ${esc(s.title)}` : ''} ${s.where ? `<span class="small muted">${esc(s.where)}</span>` : ''}
    ${s.excerpt ? `<br><span class="small muted">${esc(s.excerpt)}${s.excerpt.length >= 500 ? '…' : ''}</span>` : ''}</li>`).join('')}</ol>`;
}

export async function renderProcess(el) {
  el.innerHTML = `${pageHeader('Parliamentary process', 'Ask a question about procedure. It is answered from Erskine May and the Lords Companion, and the passages used are listed so you can check them. This is guidance from the books, not a ruling: for anything that matters, check the passages or ask the Clerks.')}
    <div id="proc-root">${loading('Loading')}</div>`;
  const root = el.querySelector('#proc-root');
  let data;
  try { data = await api('parliamentary-process'); } catch (err) { root.innerHTML = errorBox(err); return; }
  if (!root.isConnected) return;
  const staff = hasLevel('staff');

  const history = (qs) => (qs.length ? qs.map((q) => `<article class="proc-item"><header><h3>${esc(q.question)}</h3>
      <span class="small muted">${esc(q.askedBy || 'Someone')} · ${esc(fmtDate(q.createdAt, { day: 'numeric', month: 'short', year: 'numeric' }))}${q.house ? ` · ${esc(HOUSES[q.house])}` : ''}</span></header>
      <div class="proc-answer">${answerHtml(q.answer)}</div>
      ${q.sources.length ? `<p class="small muted">Sources: ${q.sources.map((s) => `${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.source)} ${esc(s.ref)}</a>` : `${esc(s.source)} ${esc(s.ref)}`}`).join('; ')}</p>` : ''}</article>`).join('')
    : empty('No questions have been asked yet.'));

  root.innerHTML = `<form class="ask-form" data-ask>
      <label class="field"><span>Your question</span><textarea name="question" rows="3" maxlength="1500" required placeholder="e.g. Can the Lords amend a Bill that the Commons has certified as a Money Bill?"></textarea></label>
      <div class="row"><label class="field field-narrow"><span>About</span><select name="house">${Object.entries(HOUSES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <label class="field field-narrow"><span>Your name</span><input name="asker" maxlength="80" value="${esc(savedName() || '')}"></label></div>
      <p><button class="button" type="submit">Ask</button> <span class="small" data-status aria-live="polite"></span></p></form>
    <div data-result aria-live="polite"></div>
    ${data.companion.loaded ? `<p class="small muted">Sources searched: Erskine May (live) and the Lords Companion (${esc(data.companion.edition || 'uploaded')}, ${data.companion.pieces} paragraphs).</p>`
      : '<p class="small muted">Sources searched: Erskine May (live). The Lords Companion has not been uploaded yet, so Lords-only questions rest on Erskine May alone.</p>'}
    <h2 class="h2-rule">Recent questions <span class="count">${data.questions.length}</span></h2>
    <div data-history data-flat>${history(data.questions)}</div>
    ${staff ? `<section class="proc-upload"><h2 class="h2-rule">The Lords Companion</h2>
      <p class="small">The Companion cannot be fetched automatically, so upload the PDF (Staff). It is read in your browser and only its text is kept, in pieces, so it can be searched. Uploading again replaces the old copy.</p>
      <form data-upload><div class="row"><label class="field"><span>PDF</span><input type="file" name="file" accept="application/pdf" required></label>
        <label class="field"><span>Edition</span><input name="edition" maxlength="120" placeholder="e.g. 2022 edition, updated February 2024" required></label></div>
        <p><button class="button button-quiet" type="submit">Upload the Companion</button> <span class="small" data-ustatus aria-live="polite"></span></p></form></section>` : ''}`;

  const status = root.querySelector('[data-status]');
  root.querySelector('[data-ask]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements, btn = e.target.querySelector('button');
    btn.disabled = true; status.textContent = 'Searching Erskine May and the Companion, then writing the answer… (about 20 seconds)';
    try {
      const out = await api('parliamentary-process', { method: 'POST', body: JSON.stringify({ question: f.question.value, house: f.house.value, asker: f.asker.value }) });
      status.textContent = '';
      root.querySelector('[data-result]').innerHTML = `<article class="proc-item proc-new"><header><span class="tag">${esc(CONF[out.confidence] || '')}</span></header>
        <div class="proc-answer">${answerHtml(out.answer)}</div>${out.note ? `<p class="small muted">${esc(out.note)}</p>` : ''}${sourcesHtml(out.sources.filter((s) => s.used).length ? out.sources.filter((s) => s.used) : out.sources)}</article>`;
      root.querySelector('[data-result]').scrollIntoView({ block: 'nearest' });
      const fresh = await api('parliamentary-process').catch(() => null);
      if (fresh) root.querySelector('[data-history]').innerHTML = history(fresh.questions);
    } catch (err) { status.textContent = err.message; } finally { btn.disabled = false; }
  });

  const up = root.querySelector('[data-upload]');
  if (up) up.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = root.querySelector('[data-ustatus]'), btn = up.querySelector('button');
    const edition = up.elements.edition.value.trim();
    btn.disabled = true;
    try {
      out.textContent = 'Reading the PDF…';
      const pages = await readPdfPages(up.elements.file.files[0], (n, total) => { out.textContent = `Reading the PDF… page ${n} of ${total}`; });
      const chunks = chunkPages(pages);
      if (chunks.length < 50) throw new Error(`Only ${chunks.length} numbered paragraphs were found, so this does not look like the Companion. Nothing was changed.`);
      out.textContent = `Uploading ${chunks.length} paragraphs…`;
      await api('process-companion', { method: 'POST', body: JSON.stringify({ action: 'start', edition }) });
      for (let i = 0; i < chunks.length; i += 250) {
        await api('process-companion', { method: 'POST', body: JSON.stringify({ action: 'add', edition, chunks: chunks.slice(i, i + 250) }) });
        out.textContent = `Uploading… ${Math.min(i + 250, chunks.length)} of ${chunks.length}`;
      }
      out.textContent = `Done: ${chunks.length} paragraphs of the Companion are searchable.`;
    } catch (err) { out.textContent = err.message; } finally { btn.disabled = false; }
  });
}
