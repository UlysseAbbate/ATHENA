// The House of Commons' business, as Honourable LIBBY shows it: What's On events (lib/libby/lordsbusiness.js eventsFromApi, house 'Commons')
// turned into sections and items in the same shape the Lords pages use.

const ORDER = ['Chamber', 'Westminster Hall', 'General Committees', 'Committees'];
const RISING = /^estimated rising time$/i;

/** What kind of business an event is, from the calendar's own category. */
export function commonsKind(e) {
  const c = String(e.category || '').toLowerCase();
  if (e.section === 'Committees') return 'committee';
  if (/oral question/.test(c)) return 'oq';
  if (/urgent question/.test(c)) return 'uq';
  if (/statement/.test(c)) return 'statement';
  if (e.billId || /legislation|bill|reading|committee stage|report stage|consideration of lords/.test(c)) return 'legislation';
  if (/order|regulation|statutory instrument|delegated legislation/.test(c)) return 'si';
  if (/debate|motion|adjournment|ten minute|estimates|opposition/.test(c)) return 'motion';
  return 'other';
}

/** A day's events as sections: { sections: [ { name, start, items } ], rising: { section: time } }. */
export function commonsSections(events, isLD = () => false) {
  const by = new Map();
  const rising = {};
  for (const e of events) {
    if (RISING.test(String(e.category || '').trim())) { if (e.start) rising[e.section] = e.start; continue; }
    if (!e.title) continue;
    const item = {
      kind: commonsKind(e), category: e.category || '', title: e.title,
      detail: e.section === 'Committees' ? [e.category, e.location].filter(Boolean).join(' · ') : (e.location && e.section !== 'Chamber' ? e.location : ''),
      start: e.start || null, end: e.end || null,
      peers: (e.members || []).map((m) => ({ name: m.name, party: m.party || '', ld: isLD({ id: m.id, name: m.name, party: m.party }) })),
      billId: e.billId || null, eventUrl: e.eventUrl || '',
      link: e.billId ? { href: `#/c/bill/${e.billId}`, label: 'Open Bill page', internal: true } : null,
    };
    if (!by.has(e.section)) by.set(e.section, { name: e.section, start: null, items: [] });
    by.get(e.section).items.push(item);
  }
  const sections = [...by.values()].sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
  for (const s of sections) {
    s.items.sort((a, b) => (a.start || '99').localeCompare(b.start || '99'));
    s.start = s.items.find((i) => i.start)?.start || null;
  }
  return { sections, rising };
}
