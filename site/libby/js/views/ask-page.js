// Ask a Parliamentarian (#/ask-parliamentarian): anyone submits a request for help (attend an AGM, work experience support, speak at an event ...) with a date
// they need an answer by. Every request goes on one list that everyone can see, soonest first, and a parliamentarian or their staff can answer it by offering support.
import { api } from '../api.js';
import { esc, fmtDate, todayIso, loading, errorBox, empty, pageHeader } from '../ui.js';
import { loadPeers } from '../peer-list.js';
import { hasLevel } from '../session.js';

const KINDS = [['agm', 'Attend an AGM'], ['work-experience', 'Work experience support'], ['event', 'Speak at an event'], ['visit', 'A visit or tour'], ['other', 'Something else']];
const KIND_LABEL = Object.fromEntries(KINDS);
const NAME_KEY = 'askParliamentarianName';
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } },
};

async function post(body) {
  const res = await fetch('/api/libby/ask-parliamentarian', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.login) { location.reload(); return new Promise(() => {}); }
  return { ok: res.ok, data };
}

export async function renderAsk(el, _params, query = {}) {
  const today = todayIso();
  const show = query.show === 'answered' ? 'answered' : query.show === 'all' ? 'all' : 'open';
  const past = query.past === '1';
  const kind = KIND_LABEL[query.kind] ? query.kind : '';
  const link = (o) => `#/ask-parliamentarian?${new URLSearchParams({ show, ...(past ? { past: '1' } : {}), ...(kind ? { kind } : {}), ...o })}`;
  el.innerHTML = `${pageHeader('Ask a Parliamentarian', 'Ask for help: to attend an AGM, work experience support, a speaker for an event. Say by when you need an answer. Everyone can see every request, and parliamentarians and their staff answer by offering support.')}
    <div id="ask-root">
      <div class="ask-bar">
        <div class="toggle" role="group" aria-label="Which requests">
          <a href="${link({ show: 'open' })}" ${show === 'open' ? 'aria-current="true"' : ''}>Needing an answer</a>
          <a href="${link({ show: 'answered' })}" ${show === 'answered' ? 'aria-current="true"' : ''}>Answered</a>
          <a href="${link({ show: 'all' })}" ${show === 'all' ? 'aria-current="true"' : ''}>All</a>
        </div>
        <label class="field field-narrow"><span>Kind of help</span><select data-kind><option value="">Any</option>${KINDS.map(([k, l]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" data-past ${past ? 'checked' : ''}> Include requests whose date has passed</label>
        <button type="button" class="button" data-new>Ask for help</button>
      </div>
      <p class="small" data-status aria-live="polite"></p>
      <div id="ask-panel" aria-live="polite" data-flat></div>
      <div id="ask-list" data-flat>${loading('Loading the requests')}</div>
    </div>`;
  const root = el.querySelector('#ask-root');
  const list = root.querySelector('#ask-list'), panel = root.querySelector('#ask-panel'), status = root.querySelector('[data-status]');
  let data, peers = [];
  try { [data, peers] = await Promise.all([api(`ask-parliamentarian${past ? '?past=1' : ''}`), loadPeers().catch(() => [])]); } catch (err) { list.innerHTML = errorBox(err); return; }
  if (!root.isConnected) return;
  const staff = hasLevel('staff');
  let who = store.get(NAME_KEY);

  const all = data.requests || [];
  const rows = all.filter((r) => (!kind || r.kind === kind) && (show === 'all' || (show === 'answered' ? r.offers.length : !r.offers.length)));
  list.innerHTML = `<h2 class="h2-rule">Requests <span class="count">${rows.length}</span></h2>` + (rows.length ? rows.map((r) => {
    const late = r.neededBy < today;
    return `<article class="ask-card" id="ask-${r.id}">
      <header><h3>${esc(r.title)}</h3>
        <span class="tag">${esc(KIND_LABEL[r.kind] || 'Something else')}</span>
        <span class="ask-by ${late ? 'is-late' : ''}">Needed by <strong>${esc(fmtDate(r.neededBy, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</strong>${late ? ' (passed)' : ''}</span></header>
      <p class="small muted">Asked by ${esc(r.requester)}${r.contact ? ` (${esc(r.contact)})` : ''}${r.eventDate ? ` · the event is on ${esc(fmtDate(r.eventDate, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}` : ''}</p>
      ${r.details ? `<p class="ask-details">${esc(r.details)}</p>` : ''}
      ${r.offers.length ? `<ul class="plain ask-offers">${r.offers.map((o) => `<li><strong>${esc(o.who)}</strong> can help${o.note ? `: ${esc(o.note)}` : ''} <button type="button" class="linkish small" data-withdraw="${o.id}" data-who="${esc(o.who)}">Take back</button></li>`).join('')}</ul>`
        : '<p class="muted small">Nobody has offered yet.</p>'}
      <form class="ask-offer" data-offer="${r.id}">
        <label class="field"><span>Offer support, as</span><input name="who" list="ask-people" required maxlength="100" value="${esc(who)}" placeholder="a parliamentarian or their staff"></label>
        <label class="field"><span>What you can do (optional)</span><input name="note" maxlength="400"></label>
        <button class="button button-quiet" type="submit">I can help</button>
        ${staff || r.requester === who ? `<button class="button button-quiet" type="button" data-cancel="${r.id}">Delete request</button>` : ''}
      </form></article>`;
  }).join('') : empty(show === 'open' ? 'Nothing is waiting for an answer.' : 'Nothing here.')) + `<datalist id="ask-people">${peers.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`;

  const act = async (body, ok) => {
    const r = await post(body);
    if (!r.ok) { status.textContent = r.data.error || 'That did not work.'; return; }
    status.textContent = ok;
    renderAsk(el, _params, query);
  };
  const openForm = () => {
    panel.innerHTML = `<form class="ask-form" data-request><h2 class="h2-rule">Ask for help</h2>
      <div class="row"><label class="field"><span>Who is asking</span><input name="requester" required maxlength="80" value="${esc(who)}"></label>
        <label class="field"><span>Contact (optional)</span><input name="contact" maxlength="120" placeholder="email or phone"></label></div>
      <div class="row"><label class="field"><span>Kind of help</span><select name="kind">${KINDS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span>What you need</span><input name="title" required maxlength="140" placeholder="e.g. a Peer to speak at our AGM"></label></div>
      <div class="row"><label class="field field-narrow"><span>Needed by</span><input type="date" name="neededBy" required min="${today}"></label>
        <label class="field field-narrow"><span>Date of the event (optional)</span><input type="date" name="eventDate" min="${today}"></label></div>
      <label class="field"><span>More detail (optional)</span><textarea name="details" rows="3" maxlength="1500"></textarea></label>
      <p><button class="button" type="submit">Send the request</button> <button class="button button-quiet" type="button" data-close>Cancel</button></p></form>`;
    panel.querySelector('[data-close]').addEventListener('click', () => { panel.innerHTML = ''; });
    panel.querySelector('[data-request]').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target.elements;
      who = f.requester.value.trim(); store.set(NAME_KEY, who);
      act({ action: 'request', requester: f.requester.value, contact: f.contact.value, kind: f.kind.value, title: f.title.value, neededBy: f.neededBy.value, eventDate: f.eventDate.value, details: f.details.value }, 'Request sent: it is on the list below.');
    });
    panel.scrollIntoView({ block: 'nearest' });
  };
  root.querySelector('[data-new]').addEventListener('click', openForm);
  root.querySelector('[data-kind]').addEventListener('change', (e) => { location.hash = link({ kind: e.target.value }).slice(1); });
  root.querySelector('[data-past]').addEventListener('change', (e) => { const h = new URLSearchParams(link({}).split('?')[1]); if (e.target.checked) h.set('past', '1'); else h.delete('past'); location.hash = `#/ask-parliamentarian?${h}`.slice(1); });
  root.addEventListener('click', (e) => {
    const wd = e.target.closest('[data-withdraw]'); if (wd) return act({ action: 'withdraw', offerId: Number(wd.dataset.withdraw), as: who }, 'Offer taken back.');
    const cn = e.target.closest('[data-cancel]'); if (cn && confirm('Delete this request for good, with the offers on it?')) return act({ action: 'cancel', id: Number(cn.dataset.cancel), as: who }, 'Request deleted.');
  });
  root.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-offer]'); if (!f) return;
    e.preventDefault();
    who = f.elements.who.value.trim(); store.set(NAME_KEY, who);
    act({ action: 'offer', requestId: Number(f.dataset.offer), who: f.elements.who.value, note: f.elements.note.value }, 'Thank you: your offer is on the request.');
  });
}
