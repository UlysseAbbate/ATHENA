// The Issues Tracker (#/issues-tracker, under Lib Dems 150): campaigns and long-standing issues, each in a portfolio (chosen with the buttons at the top).
// Anyone can add a campaign to the right portfolio, then add each thing that forms part of it (an oral question, a debate, legislation, an amendment ...), so the issue builds a
// long list of actions. Each action has what was done, the date, a link (Hansard or another system), the parliamentarian and the adviser or member of staff responsible, and notes.
import { api } from '../api.js';
import { esc, fmtDate, todayIso, loading, errorBox, empty, pageHeader } from '../ui.js';
import { loadPeers } from '../peer-list.js';
import { hasLevel } from '../session.js';

const KINDS = [['oral-question', 'Oral Question'], ['written-question', 'Written Question'], ['debate', 'Debate'], ['legislation', 'Legislation'], ['amendment', 'Amendment'],
  ['committee', 'Committee'], ['event', 'Event'], ['media', 'Media'], ['other', 'Other']];
const KIND_LABEL = Object.fromEntries(KINDS);
const NAME_KEY = 'issuesTrackerName';
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } },
};
const post = async (body) => {
  const res = await fetch('/api/libby/issues', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.login) { location.reload(); return new Promise(() => {}); }
  return { ok: res.ok, data };
};

export async function renderIssues(el, _params, query = {}) {
  const code = String(query.p || '').toUpperCase();
  el.innerHTML = `${pageHeader('Issues Tracker', 'Campaigns and long-standing issues, by portfolio. Add a campaign to its portfolio, then add everything that forms part of it (an Oral Question, a debate, legislation, an amendment ...), so each issue builds up a list of what has been done.')}
    <div id="iss-root">${loading('Loading the issues')}</div>`;
  const root = el.querySelector('#iss-root');
  let data, peers = [];
  try { [data, peers] = await Promise.all([api(`issues${code ? `?portfolio=${encodeURIComponent(code)}` : ''}`), loadPeers().catch(() => [])]); } catch (err) { root.innerHTML = errorBox(err); return; }
  if (!root.isConnected) return;
  const staff = hasLevel('staff');
  const who = () => store.get(NAME_KEY);
  const known = data.portfolios.find((p) => p.code === code);
  const link = (c) => `#/issues-tracker${c ? `?p=${c}` : ''}`;
  const total = data.portfolios.reduce((n, p) => n + p.count, 0);
  const people = `<datalist id="iss-people">${peers.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`;

  const actionRow = (a) => `<tr data-action="${a.id}">
    <td class="iss-date">${esc(fmtDate(a.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</td>
    <td>${esc(a.what)}<br><span class="tag">${esc(KIND_LABEL[a.kind] || 'Other')}</span></td>
    <td>${/^https?:\/\//.test(a.url) ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Open</a>` : '<span class="muted">—</span>'}</td>
    <td>${esc(a.parliamentarian || '—')}</td>
    <td>${esc(a.staff || '—')}</td>
    <td>${esc(a.notes || '')}${a.addedBy ? `<br><span class="small muted">Added by ${esc(a.addedBy)}</span>` : ''}</td>
    <td class="iss-btns"><button type="button" class="linkish small" data-edit-action="${a.id}">Edit</button>${staff ? ` <button type="button" class="linkish small" data-del-action="${a.id}">Delete</button>` : ''}</td></tr>`;

  const issueCard = (i) => `<article class="iss-card ${i.status === 'closed' ? 'iss-closed' : ''}" data-issue="${i.id}">
    <header><h3>${esc(i.title)}</h3>
      <span class="tag">${esc(i.portfolio)}</span> ${i.status === 'closed' ? '<span class="tag">Closed</span>' : ''}
      <span class="small muted">${i.actions.length} action${i.actions.length === 1 ? '' : 's'}</span></header>
    ${i.description ? `<p class="iss-desc">${esc(i.description)}</p>` : ''}
    ${i.actions.length ? `<div class="table-wrap"><table class="grid iss-table">
      <thead><tr><th scope="col">Date</th><th scope="col">What was done</th><th scope="col">Link</th><th scope="col">Parliamentarian</th><th scope="col">Adviser / Staff</th><th scope="col">Notes</th><th scope="col"><span class="sr-only">Edit</span></th></tr></thead>
      <tbody>${i.actions.map(actionRow).join('')}</tbody></table></div>` : '<p class="muted small">Nothing has been done on this yet. Add the first action.</p>'}
    <div class="iss-form-host" data-form-host="${i.id}"></div>
    <p class="iss-tools"><button type="button" class="button button-small" data-add-action="${i.id}">Add an action</button>
      <button type="button" class="button button-quiet button-small" data-toggle="${i.id}">${i.status === 'closed' ? 'Reopen' : 'Close this issue'}</button>
      <button type="button" class="linkish small" data-edit-issue="${i.id}">Edit the title and description</button>
      ${staff ? `<button type="button" class="linkish small" data-del-issue="${i.id}">Delete</button>` : ''}</p></article>`;

  const draw = () => {
    root.innerHTML = `<nav class="button-grid iss-portfolios" aria-label="Portfolio">
        <a class="button ${!code ? '' : 'button-quiet'}" href="${link('')}" ${!code ? 'aria-current="true"' : ''}>All <span class="count">${total}</span></a>
        ${data.portfolios.map((p) => `<a class="button ${p.code === code ? '' : 'button-quiet'}" href="${link(p.code)}" title="${esc(p.name)}" ${p.code === code ? 'aria-current="true"' : ''}>${esc(p.code)} <span class="count">${p.count}</span></a>`).join('')}</nav>
      <p class="small" data-status aria-live="polite"></p>
      <h2 class="h2-rule">${known ? esc(known.name) : 'All portfolios'} <span class="count">${data.issues.length}</span></h2>
      <p><button type="button" class="button" data-new-issue>Add a campaign or issue${known ? ` to ${esc(known.code)}` : ''}</button></p>
      <div id="iss-new" data-flat></div>
      <div id="iss-list" data-flat>${data.issues.length ? data.issues.map(issueCard).join('') : empty(known ? 'No campaigns or issues in this portfolio yet. Add the first one.' : 'No campaigns or issues yet. Pick a portfolio and add the first one.')}</div>${people}`;
  };
  draw();
  const status = () => root.querySelector('[data-status]');
  const refresh = async (msg) => { await renderIssues(el, _params, query); const s = el.querySelector('[data-status]'); if (s && msg) s.textContent = msg; };
  const act = async (body, ok) => {
    const r = await post({ ...body, author: who() });
    if (!r.ok) { status().textContent = r.data.error || 'That did not work.'; return false; }
    await refresh(ok);
    return true;
  };

  const issueForm = () => `<form class="ask-form" data-issue-form><h3>Add a campaign or issue</h3>
    <div class="row"><label class="field field-narrow"><span>Portfolio</span><select name="portfolio" required>${known ? '' : '<option value="">Choose…</option>'}${data.portfolios.map((p) => `<option value="${esc(p.code)}" ${p.code === code ? 'selected' : ''}>${esc(p.code)}: ${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Title</span><input name="title" required maxlength="160" placeholder="e.g. Water company regulation"></label></div>
    <label class="field"><span>What is it? (optional)</span><textarea name="description" rows="3" maxlength="2000"></textarea></label>
    <label class="field field-narrow"><span>Your name</span><input name="author" maxlength="80" value="${esc(who())}"></label>
    <p><button class="button" type="submit">Add</button> <button class="button button-quiet" type="button" data-close>Cancel</button></p></form>`;

  const actionForm = (issueId, a = null) => `<form class="ask-form" data-action-form="${issueId}" ${a ? `data-edit-id="${a.id}"` : ''}><h3>${a ? 'Edit the action' : 'Add an action'}</h3>
    <div class="row"><label class="field"><span>What was done</span><input name="what" required maxlength="600" value="${esc(a ? a.what : '')}" placeholder="e.g. Oral Question on sewage discharges"></label>
      <label class="field field-narrow"><span>Date</span><input type="date" name="date" required value="${esc(a ? a.date : todayIso())}"></label></div>
    <div class="row"><label class="field field-narrow"><span>Kind</span><select name="kind">${KINDS.map(([k, l]) => `<option value="${k}" ${a && a.kind === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label class="field"><span>Link (Hansard or another system)</span><input type="url" name="url" maxlength="500" value="${esc(a ? a.url : '')}" placeholder="https://hansard.parliament.uk/…"></label></div>
    <div class="row"><label class="field"><span>Parliamentarian responsible</span><input name="parliamentarian" list="iss-people" maxlength="100" value="${esc(a ? a.parliamentarian : '')}"></label>
      <label class="field"><span>Adviser or Staff responsible</span><input name="staff" maxlength="100" value="${esc(a ? a.staff : '')}"></label></div>
    <label class="field"><span>Notes (optional)</span><textarea name="notes" rows="2" maxlength="2000">${esc(a ? a.notes : '')}</textarea></label>
    <label class="field field-narrow"><span>Your name</span><input name="author" maxlength="80" value="${esc(who())}"></label>
    <p><button class="button" type="submit">${a ? 'Save' : 'Add'}</button> <button class="button button-quiet" type="button" data-close>Cancel</button></p></form>`;

  root.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-new-issue]')) { root.querySelector('#iss-new').innerHTML = issueForm(); root.querySelector('#iss-new [name="title"]').focus(); return; }
    if (t.closest('[data-close]')) { t.closest('form').remove(); return; }
    const add = t.closest('[data-add-action]');
    if (add) { const host = root.querySelector(`[data-form-host="${add.dataset.addAction}"]`); host.innerHTML = actionForm(Number(add.dataset.addAction)); host.querySelector('[name="what"]').focus(); return; }
    const ed = t.closest('[data-edit-action]');
    if (ed) {
      const issue = data.issues.find((i) => i.actions.some((a) => String(a.id) === ed.dataset.editAction));
      const a = issue.actions.find((x) => String(x.id) === ed.dataset.editAction);
      const host = root.querySelector(`[data-form-host="${issue.id}"]`); host.innerHTML = actionForm(issue.id, a); host.scrollIntoView({ block: 'nearest' }); return;
    }
    const tg = t.closest('[data-toggle]');
    if (tg) { const i = data.issues.find((x) => String(x.id) === tg.dataset.toggle); return act({ action: 'update-issue', id: i.id, status: i.status === 'closed' ? 'open' : 'closed' }, i.status === 'closed' ? 'Reopened.' : 'Closed.'); }
    const ei = t.closest('[data-edit-issue]');
    if (ei) {
      const i = data.issues.find((x) => String(x.id) === ei.dataset.editIssue);
      const title = window.prompt('Title', i.title); if (title === null) return;
      const description = window.prompt('Description', i.description); if (description === null) return;
      return act({ action: 'update-issue', id: i.id, title, description }, 'Saved.');
    }
    const da = t.closest('[data-del-action]');
    if (da) { if (window.confirm('Delete this action?')) await act({ action: 'delete-action', id: Number(da.dataset.delAction) }, 'Deleted.'); return; }
    const di = t.closest('[data-del-issue]');
    if (di) { if (window.confirm('Delete this issue and all its actions?')) await act({ action: 'delete-issue', id: Number(di.dataset.delIssue) }, 'Deleted.'); }
  });
  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, v = f.elements;
    if (v.author && v.author.value) store.set(NAME_KEY, v.author.value.trim());
    if (f.matches('[data-issue-form]')) return act({ action: 'issue', portfolio: v.portfolio.value, title: v.title.value, description: v.description.value }, 'Added.');
    if (f.matches('[data-action-form]')) {
      const body = { what: v.what.value, date: v.date.value, kind: v.kind.value, url: v.url.value, parliamentarian: v.parliamentarian.value, staff: v.staff.value, notes: v.notes.value };
      return f.dataset.editId ? act({ action: 'update-action', id: Number(f.dataset.editId), ...body }, 'Saved.') : act({ action: 'action', issueId: Number(f.dataset.actionForm), ...body }, 'Added.');
    }
  });
}
