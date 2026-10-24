// The parts of the Today page that come from the uploaded Today's List:
//   - the duty Whips at the top
//   - Staff's panel to upload a list, show or hide the estimated times, and change the sitting-time rules
//   - the estimated start time beside each piece of business (Staff can change it or hide it)
//   - the peers speaking in each piece of business (from the list, and added by Staff)
// The page itself (public/js/views/day-page.js) calls these. Estimating is in docs/sitting-times.js, reading the PDF in docs/pdf-lines.js.

import { api } from './api.js';
import { esc, peer, fmtDate, fmtShort, loading } from './ui.js';
import { can, savedName } from './session.js';
import { loadPeers } from './peer-list.js';
import { readPdfLines } from './docs/pdf-lines.js';
import { parseTodaysList } from './docs/list-parser.js';
import { estimateSection, estimateText, explain, hhmmToMinutes, minutesToHhmm, RULE_FIELDS, DEFAULT_RULES } from './docs/sitting-times.js';

/** 40 -> "40 minutes", 60 -> "1 hour", 150 -> "2½ hours". */
export function minutesText(m) {
  if (m === null || m === undefined || !Number.isFinite(Number(m))) return '';
  const n = Number(m);
  if (n >= 60 && n % 30 === 0) { const h = n / 60; return Number.isInteger(h) ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.floor(h)}½ hours`; }
  return `${Math.round(n)} minute${Math.round(n) === 1 ? '' : 's'}`;
}

/* ------------------------------------------------------------------ duty Whips */

/** The two duty Whips for the day, from the Whips page. Shown on every day. */
export function dutyWhipsHtml(data) {
  const names = data.dutyWhips || [];
  return `<aside class="duty-box" aria-label="Duty Whips">
    <span class="duty-label">Duty Whips</span>
    ${names.length ? names.map((n) => `<strong class="duty-name">${peer(n, true)}</strong>`).join('<span class="muted"> and </span>') : '<em class="muted">not yet chosen</em>'}
    ${can('whips') ? '<a class="small duty-link" href="#/whips/duty">Choose on the Whips page</a>' : ''}
  </aside>`;
}

/* ------------------------------------------------------------------ estimated times */

/** One estimate per item for every sitting: Map(section name -> { start, end, items: [ ... ] }). Empty when no list has been uploaded. */
export function computeEstimates(data) {
  const out = new Map();
  if (!data.list) return out;
  for (const s of data.sections) out.set(s.name, estimateSection(s, { settings: data.settings || {}, rules: data.rules || DEFAULT_RULES, weekday: data.weekday }));
  return out;
}

const visibleToAll = (data, item) => (data.settings || {}).show !== false && !((data.settings || {}).items || {})[item.key]?.hidden;

/** The "est. 3.20pm" beside a piece of business. Staff get a button that opens the editor; others get plain text (or nothing if it is hidden). */
export function timeChipHtml(data, item, est) {
  if (!est || !data.list) return '';
  const shown = visibleToAll(data, item);
  const staff = can('whips');
  if (!shown && !staff) return '';
  const title = `${explain(est, item)}${shown ? '' : ' Hidden from everyone but Staff.'}${staff ? ' Click to change.' : ''}`;
  const cls = `est${shown ? '' : ' est-hidden'}${est.fixed || est.how === 'set' ? ' est-set' : ''}`;
  const text = `${shown ? 'est.' : 'hidden'} ${estimateText(est.start)}`;
  return staff
    ? `<button type="button" class="${cls}" data-est-key="${esc(item.key)}" title="${esc(title)}" aria-expanded="false">${text}</button>`
    : `<span class="${cls}" data-est-key="${esc(item.key)}" title="${esc(title)}">${text}</span>`;
}

/** After a change: the chips, the sittings' estimated ends and the tool-tips follow the new estimates, without redrawing the page. */
export function refreshTimes(box, data) {
  const est = computeEstimates(data);
  for (const s of data.sections) {
    const e = est.get(s.name);
    if (!e) continue;
    s.items.forEach((item, i) => {
      const chip = box.querySelector(`[data-est-key="${item.key}"]`);
      if (!chip) return;
      const shown = visibleToAll(data, item);
      const staff = can('whips');
      chip.textContent = `${shown ? 'est.' : 'hidden'} ${estimateText(e.items[i].start)}`;
      chip.classList.toggle('est-hidden', !shown);
      chip.classList.toggle('est-set', e.items[i].fixed || e.items[i].how === 'set');
      chip.hidden = !shown && !staff;
      chip.title = `${explain(e.items[i], item)}${shown ? '' : ' Hidden from everyone but Staff.'}${staff ? ' Click to change.' : ''}`;
    });
    const end = box.querySelector(`[data-est-end="${s.name}"]`);
    if (end) {
      const show = (data.settings || {}).show !== false || can('whips');
      end.textContent = show ? `Estimated finish ${estimateText(e.end)}` : '';
      end.hidden = !show;
    }
  }
}

/** The small form that opens under a chip: start time, length, hide. */
function estimateEditor(data, item, est) {
  const mine = ((data.settings || {}).items || {})[item.key] || {};
  return `<form class="est-edit" data-est-form="${esc(item.key)}">
    <label>Starts at <input type="time" name="start" value="${esc(mine.start || minutesToHhmm(Math.round(est.start)))}"></label>
    <label>Lasts <input type="number" name="minutes" min="0" max="720" step="5" value="${esc(mine.minutes ?? Math.round(est.minutes))}"> minutes</label>
    <label class="est-hide"><input type="checkbox" name="hidden" ${mine.hidden ? 'checked' : ''}> Hide this time</label>
    <span class="est-edit-buttons"><button class="button button-small" type="submit">Save</button>
      <button class="button button-quiet button-small" type="button" data-est-reset>Put back</button>
      <button class="button button-quiet button-small" type="button" data-est-cancel>Cancel</button></span>
    <span class="small" data-est-status role="status" aria-live="polite"></span>
    <span class="small muted est-edit-note">Items after this one move with it. ${esc(explain(est, item))}</span>
  </form>`;
}

/* ------------------------------------------------------------------ speakers */

/** "Speakers (24)": the list from the Whips (with each speaker's limit), then anyone Staff have added. */
export function speakersHtml(item) {
  const staff = can('whips');
  const listed = item.speakers || [];
  const added = item.addedSpeakers || [];
  if (!listed.length && !added.length && !staff) return '';
  const limits = item.speechLimits;
  const limitOf = (full) => (limits ? (limits.byName && limits.byName[full]) ?? limits.default : null);
  const ld = [...listed, ...added].filter((s) => s.ld).length;
  const note = [
    listed.length && limits && limits.default ? `speeches are limited to ${limits.default} minutes except where shown` : '',
    item.noLimit ? `no official time limit${item.backbenchMinutes ? `; backbench speeches within ${item.backbenchMinutes} minutes` : ''}` : '',
  ].filter(Boolean).join(' · ');
  return `<details class="speakers" data-spk-key="${esc(item.key)}">
    <summary>${listed.length + added.length ? 'Speakers' : '+ Add speakers'} <span class="count" data-spk-count>${listed.length + added.length || ''}</span>${ld ? ` <span class="small muted">${ld} Lib Dem</span>` : ''}</summary>
    ${listed.length ? `<p class="small muted">From the Whips’ list${note ? ` · ${esc(note)}` : ''}</p>
      <ol class="spk-list">${listed.map((sp) => {
        const lim = limitOf(sp.full);
        return `<li class="spk${sp.ld ? ' spk-ld' : ''}"><span class="spk-n">${sp.n}</span>${peer(sp.full, sp.ld)}${lim ? ` <span class="spk-min">${esc(lim)} min</span>` : ''}</li>`;
      }).join('')}</ol>` : ''}
    <div data-spk-added>${addedHtml(added, staff)}</div>
    ${staff ? `<form class="spk-add" data-spk-add autocomplete="off">
        <label class="sr-only" for="spk-${esc(item.key)}">A peer who is speaking</label>
        <input id="spk-${esc(item.key)}" type="text" name="name" list="peer-names" maxlength="100" placeholder="Add a peer who is speaking" required>
        <button class="button button-small" type="submit">Add</button>
        <span class="small" data-spk-status role="status" aria-live="polite"></span>
      </form>
      <p class="small muted">Someone who is not on the list can still speak “in the gap” (Companion 4.26), expected to take no more than four minutes.</p>` : ''}
  </details>`;
}

function addedHtml(added, staff) {
  if (!added.length) return '';
  return `<p class="small muted">Added to speak</p>
    <ul class="spk-list spk-added">${added.map((sp) => `<li class="spk${sp.ld ? ' spk-ld' : ''}">${peer(sp.name, sp.ld)}${staff ? ` <button type="button" class="linkish small" data-spk-remove="${esc(sp.name)}">remove</button>` : ''}</li>`).join('')}</ul>`;
}

/* ------------------------------------------------------------------ wiring (estimates and speakers) */

/**
 * @param box    the element holding the business
 * @param state  { date, data }  data is the /api/day reply; it is changed in place as Staff edit
 */
export function wireDayList(box, state) {
  // The page can be drawn again (after an upload, say) into the same box: attach the handlers once, and read the data afresh each time.
  if (box.dataset.dayListWired) return;
  box.dataset.dayListWired = '1';
  const staff = can('whips');
  const settings = () => (state.data.settings ||= { show: true, sections: {}, items: {} });
  const itemByKey = (key) => state.data.sections.flatMap((s) => s.items).find((i) => i.key === key);
  const post = (payload) => api('todays-list', { method: 'POST', body: JSON.stringify({ date: state.date, author: savedName(), ...payload }) });

  if (staff) {
    // the names to offer when adding a speaker
    loadPeers().then((names) => {
      if (!document.getElementById('peer-names')) box.insertAdjacentHTML('beforeend', `<datalist id="peer-names">${names.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>`);
    }).catch(() => {});
  }

  box.addEventListener('click', (e) => {
    const chip = e.target.closest('button[data-est-key]');
    if (chip && staff) {
      e.preventDefault(); // the chip can sit inside an Oral Question's summary: do not open it
      const key = chip.dataset.estKey;
      const item = itemByKey(key);
      const li = chip.closest('li.item');
      const open = li.querySelector('[data-est-form]');
      if (open) { open.remove(); chip.setAttribute('aria-expanded', 'false'); return; }
      const est = computeEstimates(state.data).get(sectionOf(state.data, key));
      const e1 = est.items[state.data.sections.find((s) => s.name === sectionOf(state.data, key)).items.indexOf(item)];
      li.insertAdjacentHTML('beforeend', estimateEditor(state.data, item, e1));
      chip.setAttribute('aria-expanded', 'true');
      return;
    }
    const cancel = e.target.closest('[data-est-cancel]');
    if (cancel) { const form = cancel.closest('[data-est-form]'); const li = form.closest('li.item'); form.remove(); li.querySelector('[data-est-key]')?.setAttribute('aria-expanded', 'false'); return; }
    const reset = e.target.closest('[data-est-reset]');
    if (reset) { saveEstimate(reset.closest('[data-est-form]'), null); return; }
    const rm = e.target.closest('[data-spk-remove]');
    if (rm && staff) changeSpeaker(rm.closest('[data-spk-key]'), { remove: rm.dataset.spkRemove });
  });

  box.addEventListener('submit', (e) => {
    const est = e.target.closest('[data-est-form]');
    if (est) { e.preventDefault(); const f = est.elements; saveEstimate(est, { start: f.start.value, minutes: f.minutes.value === '' ? null : Number(f.minutes.value), hidden: f.hidden.checked }); return; }
    const add = e.target.closest('[data-spk-add]');
    if (add) { e.preventDefault(); const name = add.elements.name.value.trim(); if (name) changeSpeaker(add.closest('[data-spk-key]'), { add: name }); }
  });

  async function saveEstimate(form, patch) {
    const key = form.dataset.estForm;
    const status = form.querySelector('[data-est-status]');
    status.textContent = 'Saving…';
    try {
      let sent = null;
      if (patch) {
        sent = {};
        const item = itemByKey(key);
        const est = computeEstimates(state.data).get(sectionOf(state.data, key));
        const current = est.items[state.data.sections.find((s) => s.name === sectionOf(state.data, key)).items.indexOf(item)];
        // only what was changed by hand is saved: a start time left as it was, or a length left as estimated, stays an estimate
        if (patch.start && hhmmToMinutes(patch.start) !== null && hhmmToMinutes(patch.start) !== Math.round(current.start)) sent.start = patch.start;
        else if (((settings().items || {})[key] || {}).start && patch.start === ((settings().items || {})[key] || {}).start) sent.start = patch.start;
        if (patch.minutes !== null && Number.isFinite(patch.minutes) && patch.minutes !== Math.round(current.minutes)) sent.minutes = patch.minutes;
        else if (((settings().items || {})[key] || {}).minutes != null && patch.minutes === ((settings().items || {})[key] || {}).minutes) sent.minutes = patch.minutes;
        if (patch.hidden) sent.hidden = true;
        if (!Object.keys(sent).length) sent = null;
      }
      const r = await post({ action: 'item', key, patch: sent });
      state.data.settings = r.settings;
      refreshTimes(box, state.data);
      form.closest('li.item').querySelector('[data-est-key]')?.setAttribute('aria-expanded', 'false');
      form.remove();
    } catch (err) { status.textContent = err.message; }
  }

  async function changeSpeaker(panel, change) {
    const key = panel.dataset.spkKey;
    const status = panel.querySelector('[data-spk-status]') || panel.querySelector('summary');
    try {
      const r = await post({ action: 'speaker', key, ...change });
      state.data.settings = r.settings;
      const item = itemByKey(key);
      const names = ((r.settings.items || {})[key] || {}).speakers || [];
      const known = new Map((item.addedSpeakers || []).map((sp) => [sp.name.toLowerCase(), sp.ld]));
      item.addedSpeakers = names.map((sp) => ({ name: sp.name, ld: known.has(sp.name.toLowerCase()) ? known.get(sp.name.toLowerCase()) : ldGuess(sp.name) }));
      panel.querySelector('[data-spk-added]').innerHTML = addedHtml(item.addedSpeakers, staff);
      const total = (item.speakers || []).length + item.addedSpeakers.length;
      panel.querySelector('[data-spk-count]').textContent = total ? String(total) : '';
      panel.querySelector('summary').firstChild.textContent = total ? 'Speakers ' : '+ Add speakers ';
      panel.querySelector('[data-spk-add]')?.reset();
    } catch (err) { if (status) status.textContent = err.message; }
  }
}

const sectionOf = (data, key) => data.sections.find((s) => s.items.some((i) => i.key === key)).name;

/** Whether a name just added is a Lib Dem peer: the site's list of them is what highlights names everywhere (see ui.js hl). */
function ldGuess(name) {
  const probe = document.createElement('div');
  probe.innerHTML = peer(name, false);
  return !!probe.querySelector('mark.ld');
}

/* ------------------------------------------------------------------ Staff panel: upload, show / hide times, rules */

const WEEKDAY_LABEL = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday' };

export function listAdminHtml(state) {
  const { data, date } = state;
  const have = !!data.list;
  const show = (data.settings || {}).show !== false;
  const upl = have ? `${fmtShort(data.list.uploadedAt.slice(0, 10))} ${new Date(data.list.uploadedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}${data.list.uploadedBy ? ` by ${esc(data.list.uploadedBy)}` : ''}` : '';
  return `<details class="list-admin" ${have ? '' : 'open'}>
    <summary>Today’s List <span class="small muted">(Staff)</span> ${have ? '<span class="count">uploaded</span>' : ''}</summary>
    <div class="list-admin-body">
      <p class="small" data-list-state>${have ? `The business below comes from the Today’s List uploaded ${upl}.` : 'No Today’s List has been uploaded for this day. Upload the PDF from the Government Whips’ Office and the business, speakers’ lists and estimated times appear below.'}</p>
      <p class="list-buttons">
        <label class="button">${have ? 'Replace the list (PDF)' : 'Upload the list (PDF)'}<input type="file" accept="application/pdf,.pdf" data-list-file hidden></label>
        ${have ? `<button type="button" class="button button-quiet" data-list-remove>Remove the list</button>
          <button type="button" class="button button-quiet" data-times-toggle aria-pressed="${show}">Estimated times: ${show ? 'shown to everyone' : 'hidden'}</button>` : ''}
      </p>
      <div data-list-preview aria-live="polite"></div>
      ${have ? sittingTimesHtml(data) : ''}
      <details class="rules"><summary>How start times are estimated <span class="small muted">(the same for every day)</span></summary>${rulesHtml(data.rules || DEFAULT_RULES)}</details>
    </div>
  </details>`;
}

function sittingTimesHtml(data) {
  const est = computeEstimates(data);
  return `<form class="sitting-times" data-sitting-form><span class="small">Sitting times for this day:</span>
    ${data.sections.map((s) => {
      const mine = ((data.settings || {}).sections || {})[s.name];
      const e = est.get(s.name);
      return `<label>${esc(s.name)} starts <input type="time" name="${esc(s.name)}" value="${esc(mine ? mine.start : minutesToHhmm(Math.round(e.start)))}"></label>`;
    }).join('')}
    <button class="button button-small" type="submit">Save</button> <button type="button" class="button button-quiet button-small" data-sitting-reset>Put back</button>
    <span class="small" data-sitting-status role="status" aria-live="polite"></span></form>`;
}

function rulesHtml(rules) {
  const tag = { companion: 'Companion', list: 'the list', estimate: 'estimate' };
  return `<form class="rules-form" data-rules-form>
    <p class="small muted">Used when the list does not give a length. “Companion” figures are from the Companion to the Standing Orders (2025); “estimate” has no figure there and is for the Whips’ Office to set. Change one and Save.</p>
    <table class="grid rules-table"><thead><tr><th scope="col">Business</th><th scope="col">Minutes</th><th scope="col">Where it comes from</th></tr></thead><tbody>
    ${RULE_FIELDS.map(([key, label, source, ref]) => `<tr><th scope="row">${esc(label)}</th>
      <td><input type="number" name="${esc(key)}" min="0" max="600" step="1" value="${esc(rules[key])}" aria-label="${esc(label)} in minutes"></td>
      <td class="small"><span class="rule-src rule-${esc(source)}">${esc(tag[source])}</span> ${esc(ref)}</td></tr>`).join('')}
    </tbody></table>
    <p><button class="button button-small" type="submit">Save for every day</button>
      <button type="button" class="button button-quiet button-small" data-rules-reset>Put back the defaults</button>
      <span class="small" data-rules-status role="status" aria-live="polite"></span></p>
  </form>`;
}

/**
 * @param panel  the element holding listAdminHtml
 * @param state  { date, data }
 * @param hooks  { redraw(): draw the page again from state.data, reload(date): fetch and draw a day again }
 */
export function wireListAdmin(panel, state, hooks) {
  const post = (payload) => api('todays-list', { method: 'POST', body: JSON.stringify({ author: savedName(), ...payload }) });
  const preview = panel.querySelector('[data-list-preview]');
  const fileInput = panel.querySelector('[data-list-file]');
  let pending = null; // { list, lines, file } read from the PDF and waiting to be saved

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    preview.innerHTML = loading('Reading the PDF');
    try {
      const lines = await readPdfLines(file);
      const list = parseTodaysList(lines);
      if (!list.date) throw new Error('I could not find the date in that file (it should say, for example, TUESDAY 20 OCTOBER 2026). Is it the Today’s List?');
      if (!list.sections.length) throw new Error('I could not find any business in that file. Is it the Government Whips’ Office Today’s List?');
      pending = { list, lines, file };
      preview.innerHTML = previewHtml(list, file.name, state.date);
    } catch (err) {
      pending = null;
      preview.innerHTML = `<div class="state state-error" role="alert">${esc(err.message)}</div>`;
    }
  });

  panel.addEventListener('click', async (e) => {
    if (e.target.closest('[data-preview-cancel]')) { pending = null; preview.innerHTML = ''; return; }
    if (e.target.closest('[data-preview-save]') && pending) {
      const btn = e.target.closest('[data-preview-save]');
      btn.disabled = true;
      preview.querySelector('[data-preview-status]').textContent = 'Saving…';
      try {
        await post({ action: 'upload', date: pending.list.date, data: pending.list, rawText: pending.lines.map((l) => l.text).join('\n') });
        const date = pending.list.date;
        pending = null;
        hooks.reload(date);
      } catch (err) { btn.disabled = false; preview.querySelector('[data-preview-status]').textContent = err.message; }
      return;
    }
    if (e.target.closest('[data-list-remove]')) {
      if (!window.confirm('Remove the uploaded list for this day? The business will come from the other sources again, and the estimated times, added speakers and changes made for this day will be lost.')) return;
      try { await post({ action: 'remove', date: state.date }); hooks.reload(state.date); } catch (err) { panel.querySelector('[data-list-state]').textContent = err.message; }
      return;
    }
    const toggle = e.target.closest('[data-times-toggle]');
    if (toggle) {
      const show = toggle.getAttribute('aria-pressed') !== 'true';
      try {
        const r = await post({ action: 'show', date: state.date, show });
        state.data.settings = r.settings;
        toggle.setAttribute('aria-pressed', String(show));
        toggle.textContent = `Estimated times: ${show ? 'shown to everyone' : 'hidden'}`;
        hooks.times();
      } catch (err) { panel.querySelector('[data-list-state]').textContent = err.message; }
      return;
    }
    if (e.target.closest('[data-sitting-reset]')) {
      const status = panel.querySelector('[data-sitting-status]');
      try {
        let r;
        for (const s of state.data.sections) r = await post({ action: 'section', date: state.date, name: s.name, start: '' });
        state.data.settings = r.settings;
        hooks.reload(state.date);
      } catch (err) { status.textContent = err.message; }
      return;
    }
    if (e.target.closest('[data-rules-reset]')) {
      const form = panel.querySelector('[data-rules-form]');
      for (const [key] of RULE_FIELDS) form.elements.namedItem(key).value = DEFAULT_RULES[key];
      form.requestSubmit();
    }
  });

  panel.addEventListener('submit', async (e) => {
    const sitting = e.target.closest('[data-sitting-form]');
    if (sitting) {
      e.preventDefault();
      const status = sitting.querySelector('[data-sitting-status]');
      status.textContent = 'Saving…';
      try {
        const est = computeEstimates(state.data);
        let r;
        for (const s of state.data.sections) {
          const value = sitting.elements.namedItem(s.name).value;
          const same = hhmmToMinutes(value) === Math.round(est.get(s.name).start) && !((state.data.settings.sections || {})[s.name]);
          r = await post({ action: 'section', date: state.date, name: s.name, start: same ? '' : value });
        }
        state.data.settings = r.settings;
        hooks.times();
        status.textContent = 'Saved.';
      } catch (err) { status.textContent = err.message; }
      return;
    }
    const rules = e.target.closest('[data-rules-form]');
    if (rules) {
      e.preventDefault();
      const status = rules.querySelector('[data-rules-status]');
      status.textContent = 'Saving…';
      const changes = {};
      for (const [key] of RULE_FIELDS) changes[key] = Number(rules.elements.namedItem(key).value);
      try {
        const r = await post({ action: 'rules', rules: changes });
        state.data.rules = r.rules;
        hooks.times();
        status.textContent = 'Saved for every day.';
      } catch (err) { status.textContent = err.message; }
    }
  });
}

function previewHtml(list, fileName, pageDate) {
  const items = list.sections.reduce((n, s) => n + s.items.length, 0);
  const speakers = list.sections.flatMap((s) => s.items).filter((i) => i.speakers && i.speakers.length);
  const other = list.date !== pageDate;
  return `<div class="list-preview">
    <p><strong>${esc(fileName)}</strong>: ${esc(fmtDate(list.date))}</p>
    <ul class="small">${list.sections.map((s) => `<li>${esc(s.name)}${s.place ? ` (${esc(s.place)})` : ''} at ${esc(s.start)}: ${s.items.length} ${s.items.length === 1 ? 'item' : 'items'}${s.rising ? `, expected to rise ${esc(s.rising)}` : ''}</li>`).join('')}
      <li>${speakers.length ? `${speakers.length} speakers’ ${speakers.length === 1 ? 'list' : 'lists'} (${speakers.reduce((n, i) => n + i.speakers.length, 0)} speakers)` : 'No speakers’ lists'}</li></ul>
    ${other ? `<p class="small state state-warn">This list is for ${esc(fmtDate(list.date))}, not the day you are looking at. It will be saved for ${esc(fmtDate(list.date))}.</p>` : ''}
    <p><button type="button" class="button" data-preview-save>Save the list for ${esc(fmtShort(list.date))}</button>
      <button type="button" class="button button-quiet" data-preview-cancel>Cancel</button> <span class="small" data-preview-status role="status" aria-live="polite"></span></p>
    <p class="small muted">${items} items in all. Saving replaces any list already uploaded for that day; the times and speakers added by hand are kept.</p>
  </div>`;
}
