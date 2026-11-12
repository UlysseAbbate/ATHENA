// Estimating when each piece of business will start.
//
// Where a piece of business has a length the Whips' list gives ("Oral Questions (40 minutes)", "Time-limited to 2½ hours") that length
// is used. Anything the list does not time uses the RULES below, which Staff and Admin can change on the Today page (they are saved for
// the whole site). A start time can also be fixed by hand for one item, and everything after it moves with it.
//
// Where a rule comes from the Companion to the Standing Orders (2025) its paragraph is given in RULE_FIELDS. The rules marked
// 'estimate' have no figure in the Companion (or in the Whips' list) and are placeholders for the Whips' Office to set.
//
// Plain functions, no browser objects: the Today page and the tests both use them.

import { minutesToClock } from './list-parser.js';

export const DEFAULT_RULES = {
  prayers: 5,        // the lists give it: "Prayers (5 minutes)"
  introduction: 5,   // estimate
  oq: 40,            // Companion 6.24: question time is 40 minutes; each question is limited to ten minutes (6.17)
  pnq: 15,           // Companion 6.38: proceedings on a PNQ are limited to 15 minutes
  statement: 40,     // Companion 6.7: front benches 20 minutes, then backbench questions not more than 20
  uq: 15,            // Companion 6.11: a repeated urgent question is followed by 10 minutes of questions
  brief: 5,          // estimate: each item under "business expected to be brief"
  si: 60,            // Companion 6.67: debates on delegated legislation in the Chamber are time limited to 60 minutes
  qsd: 90,           // Companion 6.47: a question for short debate taken as last business is time limited to 1½ hours (60 minutes in a lunch or dinner break)
  qsdBreak: 60,
  legislation: 120,  // estimate: the Companion gives no length for a stage of a Bill (see 4.41 for speech lengths)
  motion: 90,        // estimate, used only when the list gives no time limit and no speakers
  other: 30,         // estimate
  speaker: 15,       // Companion 4.42: other speakers in a debate with no formal limit are expected to keep within 15 minutes
  openingWinding: 20, // Companion 4.42: members opening or winding up are expected to keep within 20 minutes (used only when a debate's own advisory time is not known)
  ministerSpeech: 15,   // a Minister's speech in a debate with a speakers' list
  frontbenchSpeech: 15, // the Conservative and Liberal Democrat frontbench speeches next to the Minister's (straight after it, or straight before it)
  groupOpening: 15,   // Committee and Report: the opening speech of a group of amendments (the first amendment's lead signatory)
  groupSpeaker: 10,   // ... every other speaker in the group
  groupWindUp: 10,    // ... a Minister who opened a group speaking again to reply
  groupFallback: 20,  // ... a group whose signatories could not be found
  grandCommitteeMax: 300, // Companion 3.18: the afternoon Grand Committee sits for a maximum of five hours
  // Used only when a list gives no time: the usual times (Companion 3.1, 3.17).
  sittingStart: { monday: 870, tuesday: 870, wednesday: 900, thursday: 660, friday: 600 },
  grandCommitteeStart: { monday: 945, tuesday: 945, wednesday: 975, thursday: 735 },
  usualRising: { monday: 1320, tuesday: 1320, wednesday: 1320, thursday: 1140, friday: 900 },
};

/** What each rule is for, for the editing form: [ key, label, 'companion' | 'list' | 'estimate', where it comes from ]. */
export const RULE_FIELDS = [
  ['prayers', 'Prayers', 'list', 'the length the Whips\u2019 list gives'],
  ['introduction', 'Introductions', 'estimate', 'no figure in the Companion'],
  ['oq', 'Oral Questions (all of them together)', 'companion', '6.24: question time is 40 minutes; 6.17: each question is limited to ten minutes'],
  ['pnq', 'Private Notice Question', 'companion', '6.38: limited to 15 minutes'],
  ['statement', 'Questions on a Commons Oral Statement', 'companion', '6.7: front benches 20 minutes, then backbench questions not more than 20'],
  ['uq', 'A repeated Commons urgent question', 'companion', '6.11: followed by 10 minutes of questions'],
  ['brief', 'Each item of business expected to be brief', 'estimate', 'the Whips\u2019 own heading; no figure in the Companion'],
  ['si', 'A debate on delegated legislation (a statutory instrument)', 'companion', '6.67: time limited to 60 minutes'],
  ['qsd', 'A Question for Short Debate as last business', 'companion', '6.47: one and a half hours'],
  ['qsdBreak', 'A Question for Short Debate in a lunch or dinner break', 'companion', '6.47: a maximum of one hour'],
  ['legislation', 'A stage of a Bill, when the list gives no time', 'estimate', 'no figure in the Companion'],
  ['motion', 'A motion or debate with no time limit and no speakers\u2019 list', 'estimate', 'no figure in the Companion'],
  ['other', 'Any other business', 'estimate', 'no figure in the Companion'],
  ['speaker', 'A backbench speech when the debate gives no advisory time', 'companion', '4.42: expected to keep within 15 minutes (the debate\u2019s own advisory time is used when it has one)'],
  ['openingWinding', 'Opening or winding up when the debate gives no advisory time', 'companion', '4.42: expected to keep within 20 minutes'],
  ['ministerSpeech', 'A Minister\u2019s speech in a debate', 'estimate', 'set by the Whips\u2019 Office'],
  ['frontbenchSpeech', 'A Conservative or Liberal Democrat frontbench speech next to the Minister\u2019s', 'estimate', 'set by the Whips\u2019 Office'],
  ['groupOpening', 'Committee and Report: opening a group of amendments', 'estimate', 'set by the Whips\u2019 Office'],
  ['groupSpeaker', 'Committee and Report: each other speaker in a group', 'estimate', 'set by the Whips\u2019 Office'],
  ['groupWindUp', 'Committee and Report: a Minister who opened a group, replying', 'estimate', 'set by the Whips\u2019 Office'],
  ['groupFallback', 'Committee and Report: a group whose signatories are not known', 'estimate', 'set by the Whips\u2019 Office'],
];

export const slug = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * A name for an item that stays the same when the same list is read again, so changes made by hand (a fixed start time, the peers added
 * to speak) stay with the right piece of business. `seen` is a Map the caller keeps for one section, to tell apart two identical titles.
 */
export function itemKey(sectionName, item, seen = new Map()) {
  const base = `${slug(sectionName)}:${item.kind}:${slug(item.title).slice(0, 48)}`;
  const n = (seen.get(base) || 0) + 1;
  seen.set(base, n);
  return n > 1 ? `${base}#${n}` : base;
}

/** "14:30" -> 870 (null if it is not a time). */
export function hhmmToMinutes(text) {
  const m = String(text || '').match(/^(\d{1,2}):(\d{2})$/);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export const minutesToHhmm = (mins) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(Math.round(mins) % 60).padStart(2, '0')}`;

/** The rules with any changes laid over the defaults. */
const PER_DAY = ['sittingStart', 'grandCommitteeStart', 'usualRising']; // rules that have a value for each weekday
export function mergeRules(changes) {
  const rules = { ...DEFAULT_RULES };
  for (const k of PER_DAY) rules[k] = { ...DEFAULT_RULES[k] };
  for (const [k, v] of Object.entries(changes || {})) {
    if (PER_DAY.includes(k)) { for (const [day, mins] of Object.entries(v || {})) if (day in DEFAULT_RULES[k] && Number.isFinite(Number(mins)) && Number(mins) >= 0 && Number(mins) < 1440) rules[k][day] = Number(mins); }
    else if (k in DEFAULT_RULES && Number.isFinite(Number(v)) && v !== null && v !== '' && Number(v) >= 0 && Number(v) <= 600) rules[k] = Number(v);
  }
  return rules;
}

/** Display: to the nearest 5 minutes, since these are estimates ("3.20pm"). */
export const estimateText = (mins) => minutesToClock(Math.round(mins / 5) * 5);

/**
 * @param section  { name, startMinutes, risingMinutes, items: [ { key, kind, minutes, group, ... } ] }
 * @param opts     { settings: the day's settings, rules: mergeRules(...), weekday: 'thursday' }
 * @returns        { start, end, items: [ { start, end, minutes, how, fixed } ] }  one entry per item, in order
 *   how: 'fixed' (start set by hand), 'set' (length set by hand), 'list' (length from the list), 'share' (a share of a group's time),
 *        'rising' (to the rising time), 'rule' (one of the rules)
 */
export function estimateSection(section, { settings = {}, rules = DEFAULT_RULES, weekday = '' } = {}) {
  const itemSettings = settings.items || {};
  const grand = section.name === 'Grand Committee';
  const startSetting = hhmmToMinutes(settings.sections && settings.sections[section.name] && settings.sections[section.name].start);
  const usualStart = grand ? (rules.grandCommitteeStart || DEFAULT_RULES.grandCommitteeStart)[weekday] : (rules.sittingStart || DEFAULT_RULES.sittingStart)[weekday];
  let t = startSetting ?? section.startMinutes ?? hhmmToMinutes(section.start) ?? usualStart ?? 14 * 60 + 30;   // (a day with no list may still have a sitting time from the calendar)
  const start = t;

  // how many items share each group's time (4 oral questions share the 40 minutes)
  const shared = new Map();
  for (const it of section.items) if (it.group && it.group.minutes && it.minutes == null) shared.set(it.group.label, (shared.get(it.group.label) || 0) + 1);

  const out = [];
  section.items.forEach((it, i) => {
    const mine = itemSettings[it.key] || {};
    const fixed = hhmmToMinutes(mine.start);
    if (fixed !== null) t = fixed;
    const begin = t;
    const last = i === section.items.length - 1;

    let minutes; let how;
    if (mine.minutes !== null && mine.minutes !== undefined && mine.minutes !== '' && Number.isFinite(Number(mine.minutes)) && Number(mine.minutes) >= 0) { minutes = Number(mine.minutes); how = 'set'; }
    else if (it.minutes != null) { minutes = it.minutes; how = 'list'; }
    else if (it.group && it.group.minutes && shared.get(it.group.label)) { minutes = it.group.minutes / shared.get(it.group.label); how = shared.get(it.group.label) > 1 ? 'share' : 'list'; }
    else if (last && section.risingMinutes != null && section.risingMinutes > begin) { minutes = section.risingMinutes - begin; how = 'rising'; }
    else if (it.speakers && it.speakers.length && !it.timeLimited) { minutes = speakersMinutes(it, rules); how = 'speakers'; }
    else if (last && !grand && (rules.usualRising || DEFAULT_RULES.usualRising)[weekday] > begin) { minutes = (rules.usualRising || DEFAULT_RULES.usualRising)[weekday] - begin; how = 'usualrising'; }
    else if (last && grand) { minutes = rules.grandCommitteeMax; how = 'grandmax'; }
    else if (it.group && it.group.kind === 'brief') { minutes = rules.brief; how = 'rule'; }
    else if (it.kind === 'qsd' && it.group && it.group.kind === 'dinner') { minutes = rules.qsdBreak; how = 'rule'; }
    else { minutes = rules[it.kind] ?? rules.other; how = 'rule'; }

    t = begin + minutes;
    const entry = { start: begin, end: t, minutes, how, fixed: fixed !== null };
    if (it.speakers && it.speakers.length) entry.speakers = speakerPlan(it, rules).speakers.map((sp) => ({ ...sp, start: begin + sp.offset }));   // when each peer is expected to rise
    out.push(entry);
  });
  return { start, end: t, items: out };
}

const nameKey = (x) => String(x || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
const sameName = (a, b) => { const x = nameKey(a), y = nameKey(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

/**
 * Who speaks when in a debate with a speakers' list, and for how long each:
 *   - a speaker the list gives a limit for takes that limit;
 *   - the Minister takes `ministerSpeech` (15), and so do the two frontbenchers (Conservative and Liberal Democrat) next to the Minister's speech:
 *     straight after it when the Minister opens, straight before it when the Minister winds up;
 *   - everyone else takes the debate's advisory backbench time (from the list, or uploaded with the speakers), else the Companion's 15 minutes.
 * If the Minister is not in the list but the debate names one, their speech is added at the end, with the last two listed speakers as the frontbenchers.
 * Returns { speakers: [ { n, full, name, minutes, role: 'minister' | 'frontbench' | 'backbench' | 'limit', offset, added } ], total, advisory }.
 */
export function speakerPlan(item, rules = DEFAULT_RULES) {
  const limits = item.speechLimits || { default: null, byName: {} };
  const advisory = item.advisoryMinutes || item.backbenchMinutes || rules.speaker;
  const list = (item.speakers || []).map((sp, i) => ({ n: sp.n || i + 1, full: sp.full || sp.name || '', name: sp.name || sp.full || '', ld: sp.ld, src: i }));
  const mini = item.minister || '';
  const opens = item.openingBy && list.length && !sameName(list[0].full, item.openingBy) ? item.openingBy : '';
  let added = false;
  if (opens) list.unshift({ n: 0, full: opens, name: opens, src: null, opening: true });   // the Minister who moved the debate opens it, and is not in the list of those who follow
  const ministerAt = (i) => !!mini && sameName(list[i].full, mini);
  let mAt = -1;
  for (let i = 0; i < list.length; i++) if (ministerAt(i)) mAt = i;   // the last time the Minister speaks
  if (mini && mAt < 0 && list.length) { list.push({ n: list.length + 1, full: mini, name: mini, src: null, added: true }); mAt = list.length - 1; added = true; }
  const front = new Set();
  const firstReal = list.findIndex((sp) => !sp.opening);
  if (mAt >= 0 && mAt === list.length - 1) { front.add(mAt - 1); front.add(mAt - 2); }   // the Minister winds up: the pair straight before them
  else if (mAt >= 0 && mAt === firstReal && mAt === 0) { front.add(1); front.add(2); }   // the Minister opens (and is in the list): the pair straight after them
  else if (mAt < 0 && list.length > 2) { front.add(list.length - 1); front.add(list.length - 2); }   // no Minister to go by: the winding-up pair at the end
  let offset = 0;
  const speakers = list.map((sp, i) => {
    const named = limits.byName && limits.byName[sp.full];
    let minutes; let role;
    if (named !== null && named !== undefined) { minutes = named; role = 'limit'; }
    else if (ministerAt(i) || sp.added) { minutes = rules.ministerSpeech ?? 15; role = 'minister'; }
    else if (limits.default !== null && limits.default !== undefined) { minutes = limits.default; role = 'limit'; }   // a limit the list sets for everyone beats the frontbench assumption
    else if (front.has(i)) { minutes = rules.frontbenchSpeech ?? 15; role = 'frontbench'; }
    else { minutes = advisory; role = 'backbench'; }
    const out = { n: sp.n, full: sp.full, name: sp.name, ld: sp.ld, minutes, role, offset, src: sp.src, opening: !!sp.opening, added: !!sp.added };
    offset += minutes;
    return out;
  });
  return { speakers, total: offset, advisory, ministerAdded: added };
}

/** Adds up what the speakers in a debate take (see speakerPlan). */
export function speakersMinutes(item, rules = DEFAULT_RULES) { return speakerPlan(item, rules).total; }

/** The sentence under a start time that says where it comes from. */
export function explain(est, item) {
  const m = Math.round(est.minutes);
  const len = `${m} minute${m === 1 ? '' : 's'}`;
  const first = est.fixed ? 'Start time set by hand. ' : '';
  switch (est.how) {
    case 'set': return `${first}Length set by hand: ${len}.`;
    case 'list': return `${first}The list gives this ${len}${item.timeLimited ? ' (time-limited)' : ''}.`;
    case 'share': return `${first}${len}: a share of the ${item.group.minutes} minutes the list gives ${item.group.label}.`;
    case 'rising': return `${first}Runs to the rising time the list gives.`;
    case 'usualrising': return `${first}Runs to the usual rising time (Companion 3.1), since the list gives none.`;
    case 'grandmax': return `${first}A Grand Committee sitting is at most five hours (Companion 3.18); the list gives no rising time.`;
    case 'speakers': return `${first}Adds up the ${item.speakers.length} speeches: ${item.advisoryMinutes || item.backbenchMinutes ? `${item.advisoryMinutes || item.backbenchMinutes} minutes each (the advisory time)` : 'the Companion\u2019s 15 minutes each (no advisory time is known)'}, except the Minister and the two frontbench speeches next to theirs (15 minutes each) and any limit the list gives a speaker.`;
    default: return `${first}Estimated at ${len} by the sitting-time rules (nothing in the list times it).`;
  }
}
