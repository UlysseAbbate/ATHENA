import { api } from '../api.js';
import { esc, loading, errorBox, empty, pageHeader } from '../ui.js';

// Server extracts contain <mark> around matched words; escape everything else.
const extractHtml = (s) => esc(s).replace(/&lt;mark&gt;/g, '<mark>').replace(/&lt;\/mark&gt;/g, '</mark>');
const typeLabel = (t) => (t === 'policy_paper' ? 'Policy paper' : 'Conference motion');

function resultsHtml(results, q) {
  if (!results.length) return empty(`No motions or policy papers mention “${q}”. Try fewer or broader words.`);
  return `<p class="small muted">${results.length} documents, best match first.</p>
    <ol class="results">${results.map((r) => `
      <li><a class="result" href="${esc(r.source_url)}" target="_blank" rel="noopener">
        <blockquote class="extract">…${extractHtml(r.extract_text)}…</blockquote>
        <span class="result-title">${esc(r.title)}</span>
        <span class="result-meta">${esc(typeLabel(r.doc_type))}${r.date_label ? `, ${esc(r.date_label)}` : ''}${r.status ? ` · ${esc(r.status)}` : ''}</span>
      </a></li>`).join('')}</ol>`;
}

function browseHtml(docs, portfolios, open) {
  const byCode = Object.fromEntries(portfolios.map((p) => [p.code, []]));
  const untagged = [];
  for (const d of docs) {
    const codes = (d.portfolios || []).filter((c) => byCode[c]);
    if (!codes.length) untagged.push(d);
    codes.forEach((c) => byCode[c].push(d));
  }
  const list = (items) => `<ul class="plain">${items.map((d) => `<li><a href="${esc(d.source_url)}" target="_blank" rel="noopener">${esc(d.title)}</a> <span class="small muted">${esc(typeLabel(d.doc_type))}${d.date_label ? `, ${esc(d.date_label)}` : ''}</span></li>`).join('')}</ul>`;
  return `${portfolios.map((p) => `
    <details class="browse" id="p-${esc(p.code)}" ${open === p.code ? 'open' : ''}>
      <summary><span class="p-code">${esc(p.code)}</span> ${esc(p.name)} <span class="count">${byCode[p.code].length}</span></summary>
      ${byCode[p.code].length ? list(byCode[p.code]) : empty('Nothing tagged to this portfolio yet.')}
    </details>`).join('')}
    ${untagged.length ? `<details class="browse"><summary>Not yet tagged <span class="count">${untagged.length}</span></summary>${list(untagged)}</details>` : ''}`;
}

export async function renderPolicy(el, _params, query) {
  const portfolio = (query.portfolio || '').toUpperCase();
  const portfolios = await api('portfolios').catch(() => []);
  const scope = portfolios.find((p) => p.code === portfolio);
  el.innerHTML = `
    ${pageHeader('Liberal Democrat policy', 'Conference motions and policy papers. Older motions may not reflect current policy.')}
    <form class="search search-big" role="search" data-search>
      <label class="field"><span>Search motions and policy papers</span>
        <input type="search" name="q" value="${esc(query.q || '')}" placeholder='e.g. carers, "social rent", proportional representation' autocomplete="off"></label>
      <label class="field field-narrow"><span>Portfolio</span>
        <select name="portfolio"><option value="">All portfolios</option>${portfolios.map((p) => `<option value="${esc(p.code)}" ${p.code === portfolio ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <button class="button" type="submit">Search</button>
    </form>
    <div id="results" aria-live="polite"></div>
    <h2 class="h2-rule">By portfolio</h2>
    <div id="browse">${loading('Loading the policy library')}</div>`;

  el.querySelector('[data-search]').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const params = new URLSearchParams();
    if (f.get('q').trim()) params.set('q', f.get('q').trim());
    if (f.get('portfolio')) params.set('portfolio', f.get('portfolio'));
    location.hash = `#/policy${params.toString() ? `?${params}` : ''}`;
  });

  const results = el.querySelector('#results');
  if (query.q) {
    results.innerHTML = loading('Searching');
    api(`policy/search?q=${encodeURIComponent(query.q)}${portfolio ? `&portfolio=${portfolio}` : ''}`)
      .then((d) => { results.innerHTML = `${scope ? `<p class="small">Showing ${esc(scope.name)} only.</p>` : ''}${resultsHtml(d.results, query.q)}`; })
      .catch((err) => { results.innerHTML = errorBox(err); });
  }

  const browse = el.querySelector('#browse');
  try {
    const { documents } = await api('policy/documents');
    browse.innerHTML = documents.length ? browseHtml(documents, portfolios, portfolio) : empty('The library is empty. Run the “Ingest Lib Dem policy” workflow in GitHub Actions to fill it.');
    if (portfolio && !query.q) el.querySelector(`#p-${portfolio}`)?.scrollIntoView({ block: 'start' });
  } catch (err) {
    browse.innerHTML = errorBox(err);
  }
}
