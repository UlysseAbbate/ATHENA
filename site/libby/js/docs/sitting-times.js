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
  openingWinding: 20, // Companion 4.42: members opening or winding up are expected to keep within 20 minutes
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
  ['speaker', 'A backbench speech in a debate with no time limit', 'companion', '4.42: expected to keep within 15 minutes'],
  ['openingWinding', 'Opening or winding up in such a debate', 'companion', '4.42: expected to keep within 20 minutes'],
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
  let t = startSetting ?? section.startMinutes ?? usualStart ?? 14 * 60 + 30;
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
    out.push({ start: begin, end: t, minutes, how, fixed: fixed !== null });
  });
  return { start, end: t, items: out };
}

/** Adds up what each speaker on the list may take: the limit the list gives them, else 20 minutes to open or wind up and 15 for the rest (Companion 4.42). */
export function speakersMinutes(item, rules = DEFAULT_RULES) {
  const limits = item.speechLimits || { default: null, byName: {} };
  const n = item.speakers.length;
  const backbench = item.backbenchMinutes || rules.speaker;
  return item.speakers.reduce((sum, sp, i) => {
    const named = limits.byName && limits.byName[sp.full];
    const own = named ?? limits.default ?? ((i === 0 || i === n - 1) ? rules.openingWinding : backbench);
    return sum + own;
  }, 0);
}

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
    case 'speakers': return `${first}Adds up the speaking limits of the ${item.speakers.length} speakers (Companion 4.42: 20 minutes to open or wind up, 15 for the rest, unless the list sets limits).`;
    default: return `${first}Estimated at ${len} by the sitting-time rules (nothing in the list times it).`;
  }
}
