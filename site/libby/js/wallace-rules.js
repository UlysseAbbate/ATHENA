// The rules of the Wallace Room booking system, shared by the page and the server so they always agree.
// Plain data and small functions only (no page code), because the server loads this file too.
//
// To change the opening hours or the limits, change the numbers at the top of this file: nothing else needs editing.

export const ROOM_NAME = 'Wallace Room';
export const SLOT_MINUTES = 30;                 // bookings are in 30-minute slots
export const OPEN_MINUTES = 8 * 60;             // first slot starts at 08:00
export const CLOSE_MINUTES = 21 * 60;           // the last booking ends by 21:00
export const MAX_DAYS_AHEAD = 400;              // how far ahead the room can be booked
export const MAX_BOOKINGS_PER_SERIES = 52;      // the most bookings one recurring booking can make
export const MAX_NOTE_LENGTH = 120;

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ------------------------------------------------------------------ times */

export const toMinutes = (hhmm) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
export const toTime = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** A time the room can start or end a booking at: on a half hour, within opening hours. */
export const validTime = (hhmm, { end = false } = {}) => {
  const m = toMinutes(hhmm);
  if (Number.isNaN(m) || m % SLOT_MINUTES) return false;
  return end ? m > OPEN_MINUTES && m <= CLOSE_MINUTES : m >= OPEN_MINUTES && m < CLOSE_MINUTES;
};

/** Every slot start of the day: ['08:00', '08:30', ... '20:30']. */
export const slotStarts = () => {
  const out = [];
  for (let m = OPEN_MINUTES; m < CLOSE_MINUTES; m += SLOT_MINUTES) out.push(toTime(m));
  return out;
};

/** The times a booking that starts at `start` could end at: ['09:30', ... '21:00']. */
export const endTimesAfter = (start) => {
  const out = [];
  for (let m = toMinutes(start) + SLOT_MINUTES; m <= CLOSE_MINUTES; m += SLOT_MINUTES) out.push(toTime(m));
  return out;
};

/** Do two bookings on the same day overlap? Back-to-back (one ends as the next starts) does not count. */
export const overlaps = (aStart, aEnd, bStart, bEnd) => toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);

/* ------------------------------------------------------------------ dates (YYYY-MM-DD, London) */

export const isoAddDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** 0 = Monday ... 6 = Sunday. */
export const weekdayOf = (iso) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
export const mondayOf = (iso) => isoAddDays(iso, -weekdayOf(iso));
export const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T12:00:00Z`).getTime());
export const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
export const addMonths = (iso, n) => {
  const d = new Date(`${monthStart(iso)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

/* ------------------------------------------------------------------ recurring bookings */

/**
 * The dates a booking makes when it repeats.
 *   start   the first date (YYYY-MM-DD)
 *   repeat  null for a single booking, or { every: 1-4 (weeks), days: [0-6, Monday is 0], until: 'YYYY-MM-DD' }
 * The first date is always included, and so is its weekday. Returns { dates, error? }.
 */
export function expandRecurrence(start, repeat) {
  if (!repeat || !repeat.until) return { dates: [start] };
  if (!isIso(repeat.until)) return { dates: [start], error: 'Choose a valid end date for the repeat.' };
  if (repeat.until < start) return { dates: [start], error: 'The end date is before the first booking.' };
  if (repeat.until > isoAddDays(start, MAX_DAYS_AHEAD)) return { dates: [start], error: `Bookings can only be made up to ${MAX_DAYS_AHEAD} days ahead.` };
  const every = Math.min(4, Math.max(1, Math.floor(Number(repeat.every)) || 1));
  const days = new Set((Array.isArray(repeat.days) ? repeat.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  days.add(weekdayOf(start));
  const order = [...days].sort((a, b) => a - b);
  const monday = mondayOf(start);
  const dates = [];
  for (let w = 0; dates.length <= MAX_BOOKINGS_PER_SERIES; w += every) {
    const weekStart = isoAddDays(monday, 7 * w);
    if (weekStart > repeat.until) break;
    for (const d of order) {
      const date = isoAddDays(weekStart, d);
      if (date >= start && date <= repeat.until) dates.push(date);
    }
  }
  if (dates.length > MAX_BOOKINGS_PER_SERIES) {
    return { dates: dates.slice(0, MAX_BOOKINGS_PER_SERIES), error: `That would make more than ${MAX_BOOKINGS_PER_SERIES} bookings. Choose an earlier end date.`, tooMany: true };
  }
  return { dates };
}

/** The repeat described in words, e.g. "Every week on Mon, Wed". */
export function describeRepeat(rule) {
  if (!rule) return '';
  const days = [...new Set([...(rule.days || []).map(Number), ...(rule.from ? [weekdayOf(rule.from)] : [])])].sort((a, b) => a - b);
  const names = days.map((d) => WEEKDAYS[d]);
  const weekdaysOnly = days.length === 5 && days.every((d, i) => d === i);
  const every = Number(rule.every) || 1;
  const when = weekdaysOnly ? 'weekday' : names.join(', ');
  if (weekdaysOnly && every === 1) return 'Every weekday (Mon to Fri)';
  return `${every === 1 ? 'Every week' : `Every ${every} weeks`} on ${when}`;
}
