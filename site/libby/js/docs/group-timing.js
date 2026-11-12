// Timing the groups of amendments at Committee and Report stage in the Lords (Whips and above only).
//
// BEFORE the day: how long each group is expected to last, from who signed its amendments (the groupings come from the Groupings upload on the
// adviser editor; the signatories from the Bills API):
//   1. Each peer speaks once. The exception is a Minister who opens the group (a Government amendment): they speak again to reply.
//   2. The opening speech, by the lead signatory of the group's first amendment, takes 15 minutes.
//   3. Every other speaker takes 10 minutes (and the Minister's reply, when they opened, 10).
//   4. The speakers are the signatories of the group's amendments; a peer who signed several amendments in the group speaks once.
// DURING the day: Staff note when each group actually started. A group's real length divided by its expected length is its pace
// (30 minutes against an expected 60 is 0.5, "50% faster"); the average pace of the groups so far is applied to the groups still to come.
//
// Plain functions, no browser objects: the Today page, the server and the tests all use them.

export const GROUP_RULES = { opening: 15, speaker: 10, windUp: 10, fallback: 20 };

/** The rules with any numbers from `rules` (the sitting rules) laid over the defaults. */
export function groupRules(rules = {}) {
  const out = { ...GROUP_RULES };
  for (const [k, from] of [['opening', 'groupOpening'], ['speaker', 'groupSpeaker'], ['windUp', 'groupWindUp'], ['fallback', 'groupFallback']]) {
    const v = rules && rules[from];
    if (Number.isFinite(Number(v)) && v !== null && v !== '' && Number(v) >= 0 && Number(v) <= 240) out[k] = Number(v);
  }
  return out;
}

const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const who = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * @param groups     the saved grouping's groups: [ { number, topic, refs: [ { ref, num, gov } ] } ]
 * @param amendments the stage's amendments: [ { number, sponsors: [ { name, isLead } ] } ]
 * @returns          [ { number, topic, speakers: [ { name, minutes, role } ], minutes, matched, noSignatories, minister } ]
 *   role: 'opening' | 'speaker' | 'reply' (the Minister speaking again)
 */
export function planGroups(groups, amendments, rules = {}) {
  const r = groupRules(rules);
  const byNumber = new Map();
  for (const a of amendments || []) if (key(a.number)) byNumber.set(key(a.number), a);
  return (groups || []).map((g, i) => {
    const found = [];
    for (const ref of g.refs || []) {
      const a = byNumber.get(key(ref.ref)) || (ref.num ? byNumber.get(key(ref.num)) : null);
      if (a && !found.includes(a)) found.push(a);
    }
    const first = found[0];
    const opener = first && ((first.sponsors || []).find((s) => s.isLead) || (first.sponsors || [])[0]);
    const minister = !!(g.refs && g.refs[0] && g.refs[0].gov);   // a Government amendment comes first: a Minister opens
    const speakers = [];
    const seen = new Set();
    const add = (name, minutes, role) => { speakers.push({ name, minutes, role }); seen.add(who(name)); };
    if (opener && opener.name) add(opener.name, r.opening, 'opening');
    for (const a of found) for (const s of a.sponsors || []) if (s.name && !seen.has(who(s.name))) add(s.name, r.speaker, 'speaker');
    if (minister && opener && opener.name) speakers.push({ name: opener.name, minutes: r.windUp, role: 'reply' });
    const noSignatories = !speakers.length;
    return {
      number: String(g.number || i + 1), topic: g.topic || '', speakers, matched: found.length, noSignatories, minister,
      minutes: noSignatories ? r.fallback : speakers.reduce((n, s) => n + s.minutes, 0),
    };
  });
}

/**
 * Starts and ends for each group, using what has actually happened so far.
 * @param plans  planGroups(...) in the order the groups are taken
 * @param opts   { start: when the first group is expected to start (minutes after midnight), actuals: { groupNumber: minutes after midnight when it really started } }
 * @returns      { groups: [ { number, topic, minutes (expected), adjusted (with the pace), start, end, actual, state: 'done' | 'current' | 'next' | 'later' } ],
 *                 pace: { factor, measured, percent, direction } }
 *   pace.factor is real length over expected length, averaged over the groups already finished (1 when there are none): 0.5 is "50% faster".
 */
export function timeline(plans, { start = 0, actuals = {} } = {}) {
  const n = plans.length;
  const a = plans.map((p) => (Number.isFinite(Number(actuals[p.number])) && actuals[p.number] !== null && actuals[p.number] !== '' ? Number(actuals[p.number]) : null));
  // a group is finished once a later group has started; the stretch between two known starts is shared out by the groups in it
  const ratios = [];
  let k = a.findIndex((x) => x !== null);
  while (k >= 0 && k < n) {
    let j = k + 1;
    while (j < n && a[j] === null) j++;
    if (j >= n) break;
    const expected = plans.slice(k, j).reduce((s, p) => s + p.minutes, 0);
    const real = a[j] - a[k];
    if (expected > 0 && real >= 0) for (let g = k; g < j; g++) ratios.push(real / expected);
    k = j;
  }
  const factor = ratios.length ? ratios.reduce((s, x) => s + x, 0) / ratios.length : 1;
  const lastKnown = a.reduce((m, x, i) => (x !== null ? i : m), -1);

  const groups = [];
  let t = start;
  plans.forEach((p, i) => {
    const known = a[i] !== null;
    if (known) t = a[i];
    const finished = i < lastKnown;
    // a finished group lasted as long as it really did (a stretch between two known starts is shared out evenly); the rest take their expected length at the average pace
    let adjusted = p.minutes * factor;
    if (finished) { const j = a.findIndex((x, q) => q > i && x !== null); adjusted = Math.max(0, (a[j] - t) / (j - Math.max(i, a.slice(0, i + 1).reduce((m, x, q) => (x !== null ? q : m), 0)))); }
    groups.push({ number: p.number, topic: p.topic, minutes: p.minutes, adjusted, start: t, end: t + adjusted, actual: known ? a[i] : null,
      state: finished ? 'done' : i === lastKnown ? 'current' : i === lastKnown + 1 ? 'next' : 'later' });
    t += adjusted;
  });
  const percent = Math.round(Math.abs(1 - factor) * 100);
  return { groups, pace: { factor, measured: ratios.length, percent, direction: factor < 0.995 ? 'faster' : factor > 1.005 ? 'slower' : 'as expected' } };
}

/** "Running 20% faster than expected (3 groups so far)". */
export function paceText(pace) {
  if (!pace || !pace.measured) return 'No group has finished yet, so the times are the plain prediction.';
  const g = `${pace.measured} group${pace.measured === 1 ? '' : 's'} so far`;
  return pace.direction === 'as expected' ? `Running to time (${g}).` : `Running ${pace.percent}% ${pace.direction} than expected (${g}).`;
}
