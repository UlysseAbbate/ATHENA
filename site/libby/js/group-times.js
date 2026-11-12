// The expected timing of each group of amendments at Committee and Report stage, under the Bill's item on the Today page (Whips and above only).
// Before the day it is a prediction from who signed the amendments; during the day Staff note when each group really started, and the groups still
// to come are re-timed at the average pace of the groups so far (see docs/group-timing.js for the rules).
import { api } from './api.js';
import { esc } from './ui.js';
import { can, savedName } from './session.js';
import { hhmmToMinutes, minutesToHhmm, estimateText } from './docs/sitting-times.js';
import { timeline, paceText } from './docs/group-timing.js';

/** Which saved grouping belongs to a legislation item: the same Bill, and the stage named in the item (Committee or Report). */
export function stageFor(item, stages) {
  if (item.kind !== 'legislation' || !item.billId) return null;
  const mine = stages.filter((s) => s.billId === item.billId && s.plans.length);
  if (mine.length <= 1) return mine[0] || null;
  const text = `${item.title} ${item.detail || ''}`.toLowerCase();
  const word = /committee/.test(text) ? 'committee' : /report/.test(text) ? 'report' : '';
  return mine.find((s) => word && s.stageName.toLowerCase().includes(word)) || mine[0];
}

const lenText = (m) => `${Math.round(m)} min`;

function tableHtml(stage, start) {
  const actuals = Object.fromEntries(Object.entries(stage.actuals || {}).map(([n, t]) => [n, hhmmToMinutes(t)]));
  const tl = timeline(stage.plans, { start, actuals });
  const staff = can('staff');
  const label = { done: 'finished', current: 'now', next: 'next', later: '' };
  return `<summary>Group timings <span class="small muted">(Whips and above)</span> <span class="small" data-pace>${esc(paceText(tl.pace))}</span></summary>
    <p class="small muted">Expected from who signed each group’s amendments: the opening speech 15 minutes, every other signatory 10, each peer once (a Minister who opens replies once more). ${staff ? 'Press “Started now” when a group begins and the groups after it are re-timed at the pace so far.' : ''}</p>
    <div class="table-wrap"><table class="grid group-table"><thead><tr><th scope="col">Group</th><th scope="col">Expected start</th><th scope="col">Length</th><th scope="col">Speakers</th>${staff ? '<th scope="col">Started</th>' : ''}</tr></thead><tbody>
    ${tl.groups.map((g, i) => {
      const plan = stage.plans[i];
      let t = g.start;
      const scale = plan.minutes ? g.adjusted / plan.minutes : 1;
      const spk = plan.speakers.map((s) => { const at = t; t += s.minutes * scale; return `<li>${esc(s.name)}${s.role === 'reply' ? ' (reply)' : ''} <span class="spk-min">${esc(estimateText(at))}</span></li>`; }).join('');
      return `<tr data-group="${esc(g.number)}" class="group-${g.state}"><th scope="row">${esc(g.number)}${plan.topic ? `<br><span class="small muted">${esc(plan.topic)}</span>` : ''}${label[g.state] ? `<br><span class="chip">${label[g.state]}</span>` : ''}</th>
        <td>${g.actual !== null ? `<strong title="Noted as started">${esc(estimateText(g.actual))}</strong>` : esc(estimateText(g.start))}</td>
        <td title="Expected ${esc(lenText(plan.minutes))}${g.adjusted !== plan.minutes ? `, ${esc(lenText(g.adjusted))} at the pace so far` : ''}">${esc(lenText(g.adjusted))}${g.adjusted !== plan.minutes ? `<br><span class="small muted">was ${esc(lenText(plan.minutes))}</span>` : ''}</td>
        <td>${plan.noSignatories ? `<span class="small muted">${stage.signatoriesFound ? 'No signatories found for these amendments' : 'The amendments could not be read'}: ${esc(lenText(plan.minutes))} assumed</span>` : `<details><summary class="small">${plan.speakers.length} speeches</summary><ol class="spk-list">${spk}</ol></details>`}</td>
        ${staff ? `<td class="act"><input type="time" aria-label="Group ${esc(g.number)} started at" value="${esc(stage.actuals[g.number] || minutesToHhmm(Math.round(g.start)))}" data-g-time>
          <button type="button" class="button button-small" data-g-set>Set</button> <button type="button" class="button button-quiet button-small" data-g-now>Started now</button>
          ${g.actual !== null ? '<button type="button" class="linkish small" data-g-clear>clear</button>' : ''} <span class="small" data-g-status role="status" aria-live="polite"></span></td>` : ''}</tr>`;
    }).join('')}</tbody></table></div>`;
}

/** Draws the timings under each legislation item that has a saved grouping; `starts` gives each item's expected start (minutes). Safe to call again when the estimates change. */
export function drawGroupTimes(box, stages, starts, date) {
  box.querySelectorAll('[data-group-times]').forEach((host) => {
    const stage = stages.find((s) => `${s.billId}-${s.stageId}` === host.dataset.groupTimes);
    if (!stage) return;
    const start = starts[host.dataset.itemKey];
    if (start === undefined) return;
    const open = host.querySelector('details')?.open;
    host.innerHTML = `<details class="group-times"${open ? ' open' : ''}>${tableHtml(stage, start)}</details>`;
  });
  if (box.dataset.groupWired) return;
  box.dataset.groupWired = '1';
  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-g-set], [data-g-now], [data-g-clear]');
    if (!btn) return;
    const row = btn.closest('tr[data-group]');
    const host = btn.closest('[data-group-times]');
    const stage = box._groupStages.find((s) => `${s.billId}-${s.stageId}` === host.dataset.groupTimes);
    const status = row.querySelector('[data-g-status]');
    const group = row.dataset.group;
    try {
      const base = { date, billId: stage.billId, stageId: stage.stageId, group, author: savedName() };
      if (btn.matches('[data-g-clear]')) { await api('legislative-timing', { method: 'POST', body: JSON.stringify({ action: 'clear', ...base }) }); delete stage.actuals[group]; }
      else {
        const time = btn.matches('[data-g-set]') ? row.querySelector('[data-g-time]').value : '';
        if (btn.matches('[data-g-set]') && !time) { status.textContent = 'Choose the time.'; return; }
        const r = await api('legislative-timing', { method: 'POST', body: JSON.stringify({ action: 'start', time, ...base }) });
        stage.actuals[group] = r.time;
      }
      drawGroupTimes(box, box._groupStages, box._groupStarts, date);
    } catch (err) { status.textContent = err.message; }
  });
}

/** Fetches the day's group plans (Whips and above) and draws them. `starts` is a function giving { itemKey: expected start } from the current estimates. */
export async function loadGroupTimes(box, date, starts) {
  if (!can('whips') || !box.querySelector('[data-group-item]')) return;
  let data;
  try { data = await api('legislative-timing?date=' + date); } catch { return; }   // no grouping saved, or not allowed: the item simply shows no timings
  box._groupStages = data.stages || [];
  box._groupStarts = starts();
  drawGroupTimes(box, box._groupStages, box._groupStarts, date);
}
