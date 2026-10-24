// The uploaded "Today's List": checking what the browser sends, turning it into the day's business, and the advisers' settings for the day.
// The PDF is read in the browser (public/js/docs/list-parser.js); the server keeps only the parsed result and the text it came from.

import { itemKey, hhmmToMinutes } from '../../site/libby/js/docs/sitting-times.js';
import { classifyPortfolios } from './portfolios.js';

const KINDS = new Set(['prayers', 'introduction', 'oq', 'pnq', 'statement', 'uq', 'legislation', 'si', 'motion', 'qsd', 'other']);
const SECTIONS = new Set(['Chamber', 'Grand Committee']);
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max);
const num = (v, lo, hi) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < lo || Number(v) > hi ? null : Number(v));
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);

/** Rebuilds an uploaded list from only the fields the site uses, with sizes capped. Throws an Error (with a plain message) if it is not a list. */
export function sanitizeList(data) {
  if (!data || typeof data !== 'object') throw new Error('That does not look like a Today’s List.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) throw new Error('The list has no date I can read (it should say, for example, TUESDAY 20 OCTOBER 2026).');
  const sections = list(data.sections, 4).filter((s) => s && SECTIONS.has(s.name)).map((s) => ({
    name: s.name,
    place: text(s.place, 80),
    start: text(s.start, 12),
    startMinutes: num(s.startMinutes, 0, 1439),
    rising: text(s.rising, 200),
    risingText: text(s.risingText, 300),
    risingMinutes: num(s.risingMinutes, 0, 1439),
    items: list(s.items, 150).filter((it) => it && KINDS.has(it.kind) && text(it.title, 1).length).map((it) => ({
      kind: it.kind,
      title: text(it.title, 1200),
      detail: text(it.detail, 600),
      peers: list(it.peers, 6).map((p) => text(p, 100)).filter(Boolean),
      minister: text(it.minister, 120),
      dept: text(it.dept, 40),
      askedOf: text(it.askedOf, 120),
      minutes: num(it.minutes, 0, 720),
      timeLimited: !!it.timeLimited,
      noLimit: !!it.noLimit,
      backbenchMinutes: num(it.backbenchMinutes, 0, 120),
      notes: list(it.notes, 10).map((n) => text(n, 400)).filter(Boolean),
      guidance: list(it.guidance, 12).map((n) => text(n, 500)).filter(Boolean),
      groupings: Array.isArray(it.groupings) ? it.groupings.slice(0, 60).map((g) => list(g, 80).map((r) => text(r, 14)).filter(Boolean)).filter((g) => g.length) : null,
      speakers: Array.isArray(it.speakers) ? it.speakers.slice(0, 150).map((sp, i) => ({ n: i + 1, name: text(sp && sp.name, 80), full: text(sp && sp.full, 100) })).filter((sp) => sp.full) : null,
      speechLimits: it.speechLimits && typeof it.speechLimits === 'object' ? {
        default: num(it.speechLimits.default, 0, 120),
        byName: Object.fromEntries(Object.entries(it.speechLimits.byName || {}).slice(0, 20).map(([k, v]) => [text(k, 100), num(v, 0, 120)]).filter(([k, v]) => k && v !== null)),
      } : null,
      group: it.group && typeof it.group === 'object' ? { kind: text(it.group.kind, 20), label: text(it.group.label, 200), minutes: num(it.group.minutes, 0, 720) } : null,
    })),
  })).filter((s) => s.items.length);
  if (!sections.length) throw new Error('I could not find any business in that file. Is it the Government Whips’ Office Today’s Lists?');
  return { date: data.date, weekday: text(data.weekday, 12), sections };
}

/** The settings the advisers have made for a day, checked: { show, sections: { name: { start } }, items: { key: { start, minutes, hidden, speakers: [ { name } ] } } }. */
export function cleanSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const out = { show: s.show !== false, sections: {}, items: {} };
  for (const [name, v] of Object.entries(s.sections || {})) if (SECTIONS.has(name) && hhmmToMinutes(v && v.start) !== null) out.sections[name] = { start: v.start };
  for (const [key, v] of Object.entries(s.items || {}).slice(0, 300)) {
    if (!v || typeof v !== 'object' || !/^[a-z0-9:#-]{1,90}$/.test(key)) continue;
    const mine = {};
    if (hhmmToMinutes(v.start) !== null) mine.start = v.start;
    if (num(v.minutes, 0, 720) !== null) mine.minutes = num(v.minutes, 0, 720);
    if (v.hidden === true) mine.hidden = true;
    const speakers = list(v.speakers, 60).map((sp) => ({ name: text(sp && sp.name, 100) })).filter((sp) => sp.name);
    if (speakers.length) mine.speakers = speakers;
    if (Object.keys(mine).length) out.items[key] = mine;
  }
  return out;
}

/**
 * The stored list as the day's sections, in the shape the Today page already draws (see lib/business.js), with a `key` on each item
 * and the portfolio of questions and motions worked out from the department. Bills and statutory instruments are given their links and
 * portfolios afterwards by enrichSections.
 */
export function listToSections(clean) {
  return clean.sections.map((s) => {
    const seen = new Map();
    return {
      name: s.name, place: s.place, start: s.start, startMinutes: s.startMinutes, rising: s.rising, risingText: s.risingText, risingMinutes: s.risingMinutes,
      items: s.items.map((it) => {
        const item = { ...it, key: itemKey(s.name, it, seen), notes: [...it.notes] };
        if (['oq', 'pnq', 'statement', 'uq', 'motion', 'qsd'].includes(it.kind)) item.portfolios = classifyPortfolios(`${it.title}${it.dept ? ` (${it.dept})` : ''}`);
        return item;
      }),
    };
  });
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const weekdayOf = (isoDate) => WEEKDAYS[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];
