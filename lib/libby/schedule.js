// When the saved copy of the Parliament data is renewed. London times, every day.
// This is the ONE place the times are written: the scheduled job (.github/workflows/refresh-data.yml) asks
// scripts/refresh-window.mjs, which reads this list, and the site's "next update" message reads it too.
// To change the times, change the list below and nothing else.

export const REFRESH_HOURS = [8, 10, 12, 14, 16, 18];

/** London hour and minute for a moment. */
export function londonClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value) % 24;
  return { hour: get('hour'), minute: get('minute') };
}

/** True if it is one of the update hours in London (GitHub's timer can run late, so the whole hour counts). */
export function isRefreshHour(date = new Date()) {
  return REFRESH_HOURS.includes(londonClock(date).hour);
}

/** The next update after this moment: { hour, tomorrow } (London time). */
export function nextRefresh(date = new Date()) {
  const { hour, minute } = londonClock(date);
  const now = hour * 60 + minute;
  const later = REFRESH_HOURS.find((h) => h * 60 > now);
  return later === undefined ? { hour: REFRESH_HOURS[0], tomorrow: true } : { hour: later, tomorrow: false };
}

// What the scheduled job saves, so the routes and the job always agree.
/** Days with a saved copy on the Today / day page: today and this many days after it. */
export const SAVED_DAYS_AHEAD = 7;
/** Lengths (in days) of the calendar on the Future page that have a saved copy (home page 14, default 28, Future page 35). */
export const SAVED_FUTURE_LENGTHS = [14, 28, 35];
