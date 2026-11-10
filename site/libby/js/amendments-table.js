// The list of amendments at a stage (Bill page > Amendments > Committee / Report): ONE table with every amendment, in four columns:
//   Signed peers (one per line)  |  # (the amendment's number, a dash while there is none)  |  Location (C3, P2, L14)  |  Member's explanatory statement  |  buttons
// The row above it holds the highlights (Lib Dem amendments, Lib Dem-signed, Voting, Content, Not Content) that narrow the table.
// The explanatory statements are fetched from the amendment API as rows scroll into view (a few at a time), and the whole
// text of the amendment, with the notes, opens under a row when it is clicked or its Note button is pressed. WIN marks an amendment as a concession won and sends it to the Concessionometer.
import { api } from './api.js';
import { esc, peer, empty, debounce } from './ui.js';
import { authFieldsHtml, readAuth, rememberAuth, reopenPasscode, savedName, can, hasLevel } from './session.js';

const fmtWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
};

/** "Clause 3, page 2, line 14" -> "C3, P2, L14" (other words, such as "After" or "Schedule 1", are left as they are). */
export const shortPlace = (s) => String(s || '')
  .replace(/\bClause\s+(\w+)/gi, 'C$1')
  .replace(/\bPage\s+(\d+)/gi, 'P$1')
  .replace(/\bLine\s+(\d+)/gi, 'L$1');

// The buttons the team can press on an amendment. Content and Not Content are the two positions, so setting one clears the other.
// `label` is what the highlights say; `short` is on the small button in the row (Vote, C, NC).
export const FLAG_DEFS = [
  { key: 'voting', label: 'Voting', short: 'Vote', colour: 'orange' },
  { key: 'content', label: 'Content', short: 'C', colour: 'green' },
  { key: 'notcontent', label: 'Not Content', short: 'NC', colour: 'red' },
];
// WIN is not one of the Vote / C / NC buttons: it has its own button beside Note, and sends the amendment to the Concessionometer (/api/libby/concessions)
export const WIN_DEF = { key: 'win', label: 'WIN', short: 'WIN', colour: 'win' };
const OPPOSITE = { content: 'notcontent', notcontent: 'content' };
const FLAG_ORDER = ['win', 'notcontent', 'content', 'voting'];   // an amendment with more than one takes the colour of the first of these
const topFlag = (list) => FLAG_ORDER.find((k) => (list || []).includes(k)) || '';
const rowClass = (list) => (topFlag(list) ? ` am-flag-${topFlag(list)}` : '');

const HIGHLIGHTS = [
  { key: 'ld', label: 'Lib Dem amendments', test: (a) => a.leadIsLD },
  { key: 'ldsigned', label: 'Lib Dem-signed', test: (a) => !a.leadIsLD && a.ldSigned },
];

export function commentsHtml(list) {
  const items = list || [];
  return `
    <h4>Notes</h4>
    ${items.length ? `<ul class="comment-list">${items.map((c) => `
      <li data-cid="${c.id}"><p>${esc(c.body)}</p>
        <p class="small muted">${esc(c.author || 'Unknown')}${c.at ? ` · ${esc(fmtWhen(c.at))}` : ''} · <button type="button" class="linkish" data-del>Delete</button></p></li>`).join('')}</ul>`
    : '<p class="small muted">No notes yet.</p>'}
    <form class="comment-form" data-cform>
      <label class="field"><span>Add a note</span><textarea name="body" rows="3" maxlength="2000" required></textarea></label>
      ${authFieldsHtml()}
      <button class="button" type="submit">Save note</button>
      <span class="small" data-cstatus aria-live="polite"></span>
    </form>`;
}

/** The buttons on a row, on two lines: Vote (orange), C (green) and NC (red); then Note (black) and WIN (orange accent). People who may only look see the flags as labels. */
function amendmentActions(n, flags) {
  if (can('whips')) {
    return `<span class="am-line">${FLAG_DEFS.map((f) => `<button type="button" class="button button-quiet button-small flag-btn flag-${f.colour}" data-flag="${f.key}" title="${f.label}" aria-label="${f.label}" aria-pressed="${(flags || []).includes(f.key)}">${f.short}</button>`).join('')}</span>
      <span class="am-line"><button type="button" class="button button-small comment-btn" data-comment-btn>${n ? `Note (${n})` : 'Note'}</button>
        <button type="button" class="button button-small win-btn" data-win title="Mark as a win: it goes to the Concessionometer" aria-label="WIN" aria-pressed="${(flags || []).includes('win')}">WIN</button></span>`;
  }
  return [...FLAG_DEFS, WIN_DEF].filter((f) => (flags || []).includes(f.key)).map((f) => `<span class="flag-tag flag-${f.colour}">${f.short}</span>`).join('');
}

function amendmentRow(a, comments, flags) {
  const n = comments?.length || 0;
  return `
    <tr class="am-row${rowClass(flags)}" data-aid-row="${a.id}" data-flags="${esc((flags || []).join(' '))}">
      <td class="am-peers">${a.sponsors.map((s) => `<span class="am-peer">${peer(s.name, s.ld)}</span>`).join('') || '—'}</td>
      <td class="am-n">${esc(a.number || '—')}</td>
      <td class="place">${esc(shortPlace(a.place) || '—')}</td>
      <td class="mes-cell" data-mes><span class="muted small">Loading…</span></td>
      <td><div class="am-actions">${amendmentActions(n, flags)}</div></td>
    </tr>
    <tr class="am-more" data-aid-more="${a.id}" hidden>
      <td colspan="5">
        ${a.summary ? `<p><strong>${esc(a.summary)}</strong></p>` : ''}
        <div class="am-detail" data-detail></div>
        ${can('whips') ? `<div class="am-comments" data-comments>${commentsHtml(comments)}</div>` : ''}
      </td>
    </tr>`;
}

function allTable(d, comments, flags) {
  return `<div class="table-wrap"><table class="grid all-table am-table">
    <thead><tr><th scope="col">Signed peers</th><th scope="col">#</th><th scope="col">Location</th><th scope="col">Member’s explanatory statement</th><th scope="col"><span class="sr-only">Buttons</span></th></tr></thead>
    <tbody data-all>${d.all.map((a) => amendmentRow(a, comments[a.id], flags[a.id])).join('')}</tbody></table></div>`;
}

/** The row above the list: the highlights, each with how many amendments it holds, to show just those. */
function flagBar(d, flags, withFlags) {
  const countFlag = (key) => Object.values(flags).filter((l) => l.includes(key)).length;
  return `<div class="flag-bar" data-flagbar>
    <span class="small muted">Highlights:</span>
    <button type="button" class="flag-filter" data-flagfilter="" aria-pressed="true">All ${d.all.length}</button>
    ${HIGHLIGHTS.map((h) => `<button type="button" class="flag-filter" data-flagfilter="${h.key}" aria-pressed="false">${h.label} ${d.all.filter(h.test).length}</button>`).join('')}
    ${withFlags ? [...FLAG_DEFS, WIN_DEF].map((f) => `<button type="button" class="flag-filter flag-${f.colour}" data-flagfilter="${f.key}" aria-pressed="false">${f.label} <span data-fcount="${f.key}">${countFlag(f.key)}</span></button>`).join('') : ''}
    <span class="small" data-flagstatus role="status" aria-live="polite"></span>
  </div>`;
}

export function amendmentsHtml(d, comments, commentsError, flags, flagsError) {
  if (!d.all.length) return empty('No amendments have been tabled at this stage.');
  return `
    <p class="small muted">${d.total} amendments tabled at this stage.</p>
    ${commentsError ? `<p class="small muted">Notes could not be loaded (has the amendment_comments table been created in Supabase?): ${esc(commentsError)}</p>` : ''}
    ${flagsError ? `<p class="small muted">The Voting, Content, Not Content and WIN buttons could not be loaded: ${esc(flagsError)}</p>` : ''}
    ${flagBar(d, flags, hasLevel('whips') && !flagsError)}
    <label class="field"><span>Filter by number, peer, clause or words in the explanatory statement</span><input type="search" data-filter></label>
    ${allTable(d, comments, flags)}`;
}

export function wireAmendments(box, billId, stageId, state, { house = 'lords' } = {}) {
  const byId = new Map(state.d.all.map((a) => [String(a.id), a]));
  const rowOf = (aid) => box.querySelector(`[data-aid-row="${aid}"]`);
  const moreOf = (aid) => box.querySelector(`[data-aid-more="${aid}"]`);

  /* ---- the explanatory statements and amendment text: one request per amendment, a few at a time, cached for this page */
  const details = new Map();
  const detail = (aid) => {
    if (!details.has(aid)) {
      const p = api(`bills/${billId}/amendment?stage=${stageId}&aid=${aid}`);
      p.catch(() => details.delete(aid));
      details.set(aid, p);
    }
    return details.get(aid);
  };
  const paintDetail = (aid, a) => {
    const cell = rowOf(aid)?.querySelector('[data-mes]');
    const mes = (a.explanatoryStatement || '').trim();
    if (cell) cell.innerHTML = mes ? `<div class="mes-text">${esc(mes)}</div>` : '<span class="muted small">None given.</span>';
    const target = moreOf(aid)?.querySelector('[data-detail]');
    if (target) target.innerHTML = `
      ${a.location ? `<p class="am-location">${esc(a.location)}</p>` : ''}
      ${a.text?.length ? `<div class="am-text">${a.text.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
      ${mes ? `<p class="mes"><strong>Member's explanatory statement:</strong> ${esc(mes)}</p>` : ''}
      ${a.note ? `<p class="small muted">${esc(a.note)}</p>` : ''}`;
  };
  const queue = [];
  let running = 0;
  const pump = () => {
    while (running < 4 && queue.length) {
      const aid = queue.shift();
      const cell = rowOf(aid)?.querySelector('[data-mes]');
      if (!cell || cell.dataset.state) continue;
      cell.dataset.state = 'loading';
      running++;
      detail(aid).then((a) => { paintDetail(aid, a); cell.dataset.state = 'done'; })
        .catch(() => { cell.innerHTML = '<span class="muted small">Could not be loaded. Click the row to try again.</span>'; delete cell.dataset.state; })
        .finally(() => { running--; pump(); });
    }
  };
  const want = (aid) => { queue.push(aid); pump(); };
  if (typeof IntersectionObserver === 'function') {
    const seen = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { seen.unobserve(e.target); want(e.target.dataset.aidRow); }
    }, { rootMargin: '300px' });
    box.querySelectorAll('[data-aid-row]').forEach((tr) => seen.observe(tr));
  } else {
    box.querySelectorAll('[data-aid-row]').forEach((tr) => want(tr.dataset.aidRow));
  }

  /* ---- what is shown: the highlight chosen, and the words typed in the filter */
  let showOnly = '';
  let words = '';
  const matches = (a, aid) => {
    if (showOnly) {
      const h = HIGHLIGHTS.find((x) => x.key === showOnly);
      if (h ? !h.test(a) : !(state.flags[aid] || []).includes(showOnly)) return false;
    }
    return !words || rowOf(aid).textContent.toLowerCase().includes(words) || (moreOf(aid)?.dataset.open === '1' && moreOf(aid).textContent.toLowerCase().includes(words));
  };
  const applyFilter = () => {
    for (const [aid, a] of byId) {
      const show = matches(a, aid);
      rowOf(aid).hidden = !show;
      moreOf(aid).hidden = !(show && moreOf(aid).dataset.open === '1');
    }
    box.querySelectorAll('[data-flagfilter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.flagfilter === showOnly)));
  };
  const filter = box.querySelector('[data-filter]');
  filter?.addEventListener('input', debounce(() => { words = filter.value.trim().toLowerCase(); applyFilter(); }, 150));

  const openRow = (aid, open) => {
    const more = moreOf(aid);
    more.dataset.open = open ? '1' : '0';
    more.hidden = !open || rowOf(aid).hidden;
    if (open) { const cell = rowOf(aid).querySelector('[data-mes]'); if (!cell.dataset.state) want(aid); }
  };

  const refresh = (aid) => {
    moreOf(aid).querySelector('[data-comments]').innerHTML = commentsHtml(state.comments[aid]);
    const n = state.comments[aid]?.length || 0;
    rowOf(aid).querySelector('[data-comment-btn]').textContent = n ? `Note (${n})` : 'Note';
  };

  /* ---- the buttons: the colour of the row, the pressed buttons and the counts follow state.flags */
  const paintFlags = (aid) => {
    const list = state.flags[aid] || [];
    const tr = rowOf(aid);
    if (tr) {
      tr.className = `am-row${rowClass(list)}`;
      tr.dataset.flags = list.join(' ');
      tr.querySelectorAll('[data-flag]').forEach((b) => b.setAttribute('aria-pressed', String(list.includes(b.dataset.flag))));
      tr.querySelectorAll('[data-win]').forEach((b) => b.setAttribute('aria-pressed', String(list.includes('win'))));
    }
    for (const f of [...FLAG_DEFS, WIN_DEF]) {
      const out = box.querySelector(`[data-fcount="${f.key}"]`);
      if (out) out.textContent = String(Object.values(state.flags).filter((l) => l.includes(f.key)).length);
    }
    if (showOnly) applyFilter();
  };

  async function toggleFlag(btn) {
    const aid = btn.closest('[data-aid-row]').dataset.aidRow;
    const flag = btn.dataset.flag;
    const status = box.querySelector('[data-flagstatus]');
    const before = state.flags[aid] || [];
    const on = !before.includes(flag);
    let after = on ? [...before, flag] : before.filter((k) => k !== flag);
    if (on && OPPOSITE[flag]) {
      after = after.filter((k) => k !== OPPOSITE[flag]);   // Content and Not Content cannot both be set
      if (!after.includes('voting')) after.push('voting');   // and a position on an amendment means it is one to vote on
    }
    state.flags[aid] = after;
    if (!after.length) delete state.flags[aid];
    paintFlags(aid);
    btn.disabled = true;
    if (status) status.textContent = '';
    try {
      await api('amendment-flags', { method: 'POST', body: JSON.stringify({ billId: Number(billId), stageId: Number(stageId), amendmentId: Number(aid), flag, on, author: savedName() }) });
    } catch (err) { // not saved: put it back as it was
      if (before.length) state.flags[aid] = before; else delete state.flags[aid];
      paintFlags(aid);
      if (status) status.textContent = `Not saved: ${err.message}`;
    } finally { btn.disabled = false; }
  }

  /** WIN: marks the amendment as a concession won and sends it to the Concessionometer (or takes it off again). The server keeps a snapshot of the Bill's title and portfolio. */
  async function toggleWin(btn) {
    const aid = btn.closest('[data-aid-row]').dataset.aidRow;
    const status = box.querySelector('[data-flagstatus]');
    const before = state.flags[aid] || [];
    const on = !before.includes('win');
    const a = byId.get(String(aid)) || {};
    state.flags[aid] = on ? [...before, 'win'] : before.filter((k) => k !== 'win');
    if (!state.flags[aid].length) delete state.flags[aid];
    paintFlags(aid);
    btn.disabled = true;
    if (status) status.textContent = '';
    try {
      await api('concessions', { method: 'POST', body: JSON.stringify({ action: 'win', on, billId: Number(billId), stageId: Number(stageId), amendmentId: Number(aid), house,
        number: a.number || '', place: shortPlace(a.place) || '', summary: a.summary || '', author: savedName() }) });
      if (status) status.textContent = on ? 'Marked as a win: it is now in the Concessionometer.' : 'Taken out of the Concessionometer.';
    } catch (err) {
      if (before.length) state.flags[aid] = before; else delete state.flags[aid];
      paintFlags(aid);
      if (status) status.textContent = `Not saved: ${err.message}`;
    } finally { btn.disabled = false; }
  }

  // Clicking a row (or Note) opens the amendment's text and notes under it; the flag buttons switch a flag on or off.
  box.addEventListener('click', async (e) => {
    const flagBtn = e.target.closest('[data-flag]');
    if (flagBtn) { e.preventDefault(); toggleFlag(flagBtn); return; }
    const winBtn = e.target.closest('[data-win]');
    if (winBtn) { e.preventDefault(); toggleWin(winBtn); return; }
    const filterBtn = e.target.closest('[data-flagfilter]');
    if (filterBtn) { showOnly = filterBtn.dataset.flagfilter; applyFilter(); return; }
    const commentBtn = e.target.closest('[data-comment-btn]');
    if (commentBtn) {
      e.preventDefault();
      const aid = commentBtn.closest('[data-aid-row]').dataset.aidRow;
      openRow(aid, true);
      moreOf(aid).querySelector('textarea')?.focus();
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const more = del.closest('[data-aid-more]');
      const aid = more.dataset.aidMore;
      const li = del.closest('[data-cid]');
      if (!window.confirm('Delete this note?')) return;
      const form = more.querySelector('[data-cform]');
      let { passcode } = readAuth(form);
      if (!passcode) passcode = window.prompt('Passcode to delete notes:') || '';
      try {
        await api('comments', { method: 'POST', body: JSON.stringify({ passcode, action: 'delete', id: Number(li.dataset.cid) }) });
        state.comments[aid] = (state.comments[aid] || []).filter((c) => String(c.id) !== li.dataset.cid);
        refresh(aid);
      } catch (err) { more.querySelector('[data-cstatus]').textContent = err.message; }
      return;
    }
    if (e.target.closest('a, button, input, textarea, select, label, form')) return;
    const row = e.target.closest('[data-aid-row]');
    if (row) openRow(row.dataset.aidRow, moreOf(row.dataset.aidRow).dataset.open !== '1');
    else { const more = e.target.closest('[data-aid-more]'); if (more && !e.target.closest('.am-comments')) openRow(more.dataset.aidMore, false); }
  });

  box.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-cform]');
    if (!form) return;
    e.preventDefault();
    const aid = form.closest('[data-aid-more]').dataset.aidMore;
    const status = form.querySelector('[data-cstatus]');
    const text = form.querySelector('textarea').value.trim();
    if (!text) { status.textContent = 'Type a note first.'; return; }
    const { passcode, author } = readAuth(form);
    status.textContent = 'Saving…';
    try {
      const r = await api('comments', {
        method: 'POST',
        body: JSON.stringify({ passcode, action: 'add', billId: Number(billId), stageId: Number(stageId), amendmentId: Number(aid), body: text, author }),
      });
      rememberAuth(passcode, author);
      (state.comments[aid] ||= []).push(r.comment);
      refresh(aid);
    } catch (err) {
      status.textContent = err.message;
      if (/passcode/i.test(err.message)) reopenPasscode(form);
    }
  });
}
