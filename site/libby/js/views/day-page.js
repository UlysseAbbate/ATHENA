// A day's business — used for "Today's business" and for every day in the calendar.
// When Staff have uploaded that day's Today's List the page is built from it, with estimated start times and the speakers (see ../day-list.js).
import { api } from '../api.js';
import { esc, hl, peer, fmtDate, todayIso, addDays, KIND, loading, errorBox, extLink, pageHeader } from '../ui.js';
import { liveStrip } from '../live-panel.js';
import { can } from '../session.js';
import { dutyWhipsHtml, computeEstimates, timeChipHtml, refreshTimes, speakersHtml, listAdminHtml, wireListAdmin, wireDayList, minutesText } from '../day-list.js';
import { estimateText } from '../docs/sitting-times.js';
import { loadGroupTimes, drawGroupTimes, stageFor } from '../group-times.js';

const peers = (list) => (list || []).map((p) => peer(p.name, p.ld)).join(', ');
// On a business item's right-hand side each peer goes on their own line (e.g. the Minister, then the regret-motion peer).
const peerLines = (list) => (list || []).map((p) => peer(p.name, p.ld)).join('<br>');
const tags = (item) => (item.portfolios || []).map((c) => `<a class="tag" href="#/portfolio/${esc(c)}">${esc(c)}</a>`).join('');

/** The link texts for an item: fixed ones, any direct links found for it, then Speakers. */
function linkParts(item, found = {}) {
  const out = [];
  if (item.link?.href) out.push(item.link.internal ? `<a href="${esc(item.link.href)}">${esc(item.link.label)}</a>` : extLink(item.link.href, item.link.label));
  if (item.secondaryLink?.href) out.push(extLink(item.secondaryLink.href, item.secondaryLink.label));
  for (const l of [found.instrument, found.report, found.library]) if (l?.href) out.push(extLink(l.href, l.label));
  if (item.speakersEventId) out.push(`<button type="button" class="linkish" data-speakers="${item.speakersEventId}">Speakers</button>`);
  else if (item.speakersUrl) out.push(extLink(item.speakersUrl, 'Speakers'));
  return out;
}

function links(item, i) {
  const out = linkParts(item);
  const waiting = item.lookup ? '<span class="small muted" data-checking>Checking links…</span>' : '';
  return out.length || waiting ? `<p class="item-links" data-links="${i}">${out.join('')}${waiting}</p>` : '';
}

function notes(item) {
  return item.notes?.length ? `<ul class="item-notes">${item.notes.map((n) => `<li>${hl(n)}</li>`).join('')}</ul>` : '';
}

function groupings(item) {
  if (!item.groupings?.length) return '';
  return `<details class="groupings"><summary>Groupings of amendments (${item.groupings.length} groups)</summary><ol>${
    item.groupings.map((g) => `<li>${g.map(esc).join(', ')}</li>`).join('')}</ol></details>`;
}

/** The kind label with the estimated start time under it. */
const kindCell = (item, chip) => `<span class="kind-cell"><span class="kind">${esc(KIND[item.kind] || 'Business')}</span>${chip}</span>`;
const limitChip = (item) => (item.timeLimited && item.minutes ? `<span class="chip" title="The list says this debate is time-limited">Time-limited \u00B7 ${esc(minutesText(item.minutes))}</span>` : '');

function guidance(item) {
  return item.guidance?.length
    ? `<details class="guidance"><summary>Speaking guidance</summary><ul>${item.guidance.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></details>` : '';
}

function oqItem(item, date, i, chip, e1) {
  return `
  <li class="item item-${item.kind}">
    <details class="oq" data-oq="${i}">
      <summary>
        ${kindCell(item, chip)}
        <span class="item-title">${hl(item.title)}</span>
        <span class="item-who">${peers(item.peers)}</span>
      </summary>
      <div class="oq-body">
        <p class="oq-meta">${peers(item.peers)} to ask ${item.askedOf ? hl(item.askedOf) : 'HMG'} ${hl(item.title)}${item.minister ? `<br><span class="muted">Answering: ${hl(item.minister)}${item.dept ? `, ${esc(item.dept)}` : ''}</span>` : ''}</p>
        ${can('whips') ? '<div class="suggest" aria-live="polite"></div>' : ''}
      </div>
    </details>
    ${speakersHtml(item, e1)}
  </li>`;
}

function plainItem(item, i, chip, e1) {
  const who = item.peers?.length ? `<span class="item-who">${peerLines(item.peers)}</span>` : '';
  const title = item.link?.internal ? `<a href="${esc(item.link.href)}">${hl(item.title)}</a>` : hl(item.title);
  const quiet = item.kind === 'prayers';
  return `
  <li class="item item-${item.kind}">
    <div class="item-row">
      ${kindCell(item, chip)}
      <span class="item-title">${title}${item.detail ? `<span class="item-detail"> \u2014 ${hl(item.detail)}</span>` : ''} ${limitChip(item)}</span>
      ${who}
    </div>
    ${item.minister ? `<p class="muted small">${hl(item.minister)}${item.dept ? `, ${esc(item.dept)}` : ''}</p>` : ''}
    ${notes(item)}${guidance(item)}${groupings(item)}${item.kind === 'legislation' && item.billId && can('whips') ? `<div class="group-times-host" data-group-item="${esc(item.key)}"></div>` : ''}${links(item, i)}${quiet ? '' : `<p class="tags">${tags(item)}</p>`}
    ${speakersHtml(item, e1)}
  </li>`;
}

/** The heading above a run of items that share one (Oral Questions, 40 minutes). */
function groupHead(group) {
  if (!group || !group.label || group.kind === 'introduction') return '';
  return `<li class="group-head"><h3>${esc(group.label)}${group.minutes ? ` <span class="muted">\u00B7 ${esc(minutesText(group.minutes))}</span>` : ''}</h3></li>`;
}

function suggestionsHtml(d) {
  if (!d.questions?.length) return '<p class="muted">No suggestions were returned.</p>';
  return `
    <p class="suggest-head">Suggested supplementaries${d.cached ? ' <span class="muted small">(saved earlier)</span>' : ''}</p>
    <ol class="suggest-list">${d.questions.map((q) => `
      <li><p class="suggest-q">${esc(q.question)}</p>
        ${q.basis ? `<p class="small muted">${esc(q.basis)}</p>` : ''}
        ${q.sources?.length ? `<p class="small">${q.sources.map((s) => extLink(s.url, s.title)).join(' · ')}</p>` : ''}</li>`).join('')}
    </ol>
    ${d.note ? `<p class="small muted">${esc(d.note)}</p>` : ''}
    <p class="small muted">Drafted by Claude from Parallel Parliament, Hansard and the policy library. Check the sources before use.
      <button type="button" class="linkish" data-regen>Draft again</button></p>`;
}

async function loadSuggestions(box, item, date, refresh = false) {
  box.innerHTML = loading('Finding Lib Dem precedents and drafting two supplementaries');
  try {
    const d = await api('oq-suggest', {
      method: 'POST',
      body: JSON.stringify({ date, peer: item.peers?.[0]?.name || '', question: item.title, minister: item.minister, dept: item.dept, refresh }),
    });
    box.innerHTML = suggestionsHtml(d);
    box.querySelector('[data-regen]')?.addEventListener('click', () => loadSuggestions(box, item, date, true));
  } catch (err) {
    box.innerHTML = errorBox(err);
  }
}

/**
 * Direct links (the instrument's own page, the committee report, the Lords Library briefing) are found one
 * item at a time after the page has appeared, so a slow lookup never holds the page up. If nothing is found
 * for an item, no link is shown for it.
 */
function fillDirectLinks(box, all) {
  const queue = all.map((item, i) => [item, i]).filter(([item]) => item.lookup);
  const settle = (i, found) => {
    const p = box.querySelector(`[data-links="${i}"]`);
    if (!p) return;
    const parts = linkParts(all[i], found);
    if (parts.length) p.innerHTML = parts.join(''); else p.remove();
  };
  const next = async () => {
    while (queue.length) {
      const [item, i] = queue.shift();
      if (!box.isConnected) return; // the person has moved to another page
      const q = new URLSearchParams();
      if (item.lookup.si?.length) q.set('si', item.lookup.si.join('|'));
      if (item.lookup.report) q.set('report', item.lookup.report);
      if (item.lookup.lib?.length) q.set('lib', item.lookup.lib.join('|'));
      try { settle(i, await api(`item-links?${q}`)); } catch { settle(i, {}); }
    }
  };
  Promise.all([next(), next(), next()]);
}

/** "Speakers" shows who is down to speak, in order, under the item: Liberal Democrats are marked. */
function wireSpeakers(box) {
  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-speakers]');
    if (!btn) return;
    e.preventDefault();
    const host = btn.closest('li.item');
    let out = host.querySelector('.speakers-list');
    if (out) { out.hidden = !out.hidden; return; }
    out = document.createElement('div');
    out.className = 'speakers-list';
    out.innerHTML = loading('Loading the speakers');
    host.appendChild(out);
    try {
      const d = await api(`event-speakers?id=${btn.dataset.speakers}`);
      out.innerHTML = d.speakers.length
        ? `<p class="small muted">${d.speakers.length} speakers${d.ldCount ? `, ${d.ldCount} Liberal Democrat` : ''}</p><ol class="speaker-order">${d.speakers.map((s) =>
          `<li>${peer(s.name, s.ld)} <span class="small muted">${esc(s.party)}</span></li>`).join('')}</ol>`
        : '<p class="small muted">No speakers have been listed yet.</p>';
    } catch (err) { out.innerHTML = errorBox(err); }
  });
}

export async function renderDay(el, { date }) {
  const isToday = date === todayIso();
  el.innerHTML = `
    ${pageHeader(isToday ? "Today's business" : fmtDate(date), isToday ? esc(fmtDate(date)) : '', isToday ? [] : [['#/future', 'Future business']])}
    <nav class="day-nav" aria-label="Other days">
      <a href="#/day/${addDays(date, -1)}">Previous day</a>
      ${isToday ? '' : '<a href="#/today">Today</a>'}
      <a href="#/day/${addDays(date, 1)}">Next day</a>
    </nav>
    <div id="duty"></div>
    ${isToday ? '<div id="live"></div>' : ''}
    <div id="listadmin"></div>
    <div id="business">${loading('Loading the day’s business')}</div>`;
  if (isToday) liveStrip(el.querySelector('#live'));

  const box = el.querySelector('#business');
  const state = { date, data: null };

  /** Fetch the day and draw it. `again` is true when redrawing after a change, so the browser's own copy is not used. */
  async function load() {
    let data;
    try { data = await api(`day/${date}`); } catch (err) { box.innerHTML = errorBox(err); return; }
    state.data = data;
    draw();
  }

  /** Where the list just uploaded belongs: this page if it is for this day, otherwise that day's page. */
  const hooks = {
    reload(listDate) {
      if (listDate !== date) { location.hash = listDate === todayIso() ? '#/today' : `#/day/${listDate}`; return; }
      load();
    },
    times() { refreshTimes(box, state.data); redrawGroups(); },
  };

  /** Where each legislation item is expected to start, for the group timings under it. */
  const startsOf = () => {
    const out = {};
    const est = computeEstimates(state.data);
    for (const s of state.data.sections) { const e = est.get(s.name); if (e) s.items.forEach((it, n) => { out[it.key] = e.items[n].start; }); }
    return out;
  };
  /** Group timings (Whips and above): the placeholders are tied to their Bill's saved grouping once the plans arrive. */
  function attachGroups(data) {
    if (!can('whips')) return;
    const items = data.sections.flatMap((s) => s.items).filter((it) => it.kind === 'legislation' && it.billId);
    if (!items.length) return;
    loadGroupTimes(box, date, startsOf).then(() => {
      for (const it of items) {
        const stage = stageFor(it, box._groupStages || []);
        const host = box.querySelector(`[data-group-item="${it.key}"]`);
        if (stage && host) host.setAttribute('data-group-times', `${stage.billId}-${stage.stageId}`), host.setAttribute('data-item-key', it.key);
      }
      redrawGroups();
    });
  }
  function redrawGroups() {
    if (box._groupStages) { box._groupStarts = startsOf(); drawGroupTimes(box, box._groupStages, box._groupStarts, date); }
  }

  function draw() {
    const data = state.data;
    el.querySelector('#duty').innerHTML = dutyWhipsHtml(data);
    const adminBox = el.querySelector('#listadmin');
    adminBox.innerHTML = can('whips') ? listAdminHtml(state) : '';
    if (can('whips')) wireListAdmin(adminBox.firstElementChild, state, hooks); // a new element each time, so its handlers never pile up

    const problem = data.listProblem ? `<p class="state state-warn">${esc(data.listProblem)}</p>` : '';
    if (!data.sections.length) {
      box.innerHTML = `${problem}<p class="state">No Lords business is published for this day yet. It may be a non-sitting day, or the business has not been announced. Check the <a href="#/future">calendar</a>${can('whips') ? ', or upload the Today\u2019s List above' : ''}.</p>`;
      return;
    }

    const estimates = computeEstimates(data);
    const all = [];
    box.innerHTML = `
      ${problem}
      ${data.source ? `<p class="source small muted">Source: ${data.source.url ? extLink(data.source.url, data.source.label) : esc(data.source.label)}${data.otherSources?.length ? ` \u00B7 also: ${data.otherSources.map((o) => extLink(o.url, o.label)).join(', ')}` : ''}</p>` : ''}
      ${data.sections.map((s) => {
        const est = estimates.get(s.name);
        let lastGroup = null;
        return `
      <section class="chamber" aria-labelledby="sec-${esc(s.name).replace(/\W/g, '')}">
        <div class="chamber-head">
          <h2 id="sec-${esc(s.name).replace(/\W/g, '')}">${esc(s.name)}</h2>
          <p class="small muted">${s.start ? `Sits at ${esc(s.start)}${s.place ? ` in the ${esc(s.place)}` : ''}` : ''}${data.rising?.[s.name] ? ` \u00B7 expected to rise ${esc(data.rising[s.name])}` : ''}${est ? ' \u00B7 <span data-est-end="' + esc(s.name) + '"></span>' : ''}</p>
        </div>
        <ol class="items">${s.items.map((item, n) => {
          const i = all.push(item) - 1;
          const head = item.group && item.group.label !== lastGroup ? groupHead(item.group) : '';
          lastGroup = item.group ? item.group.label : null;
          const chip = timeChipHtml(data, item, est && est.items[n]);
          const e1 = est && est.items[n];
          return head + (item.kind === 'oq' || item.kind === 'pnq' ? oqItem(item, date, i, chip, e1) : plainItem(item, i, chip, e1));
        }).join('')}</ol>
      </section>`;
      }).join('')}`;

    refreshTimes(box, data);
    wireDayList(box, state, hooks);
    wireSpeakers(box);
    fillDirectLinks(box, all);
    attachGroups(data);
    box.querySelectorAll('details[data-oq]').forEach((d) => {
      d.addEventListener('toggle', () => {
        const target = d.querySelector('.suggest');
        if (d.open && target && !target.dataset.loaded) {
          target.dataset.loaded = '1';
          loadSuggestions(target, all[Number(d.dataset.oq)], date);
        }
      });
    });
  }

  await load();
}
