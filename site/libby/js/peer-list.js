// The list of Liberal Democrat peers, in alphabetical order ignoring the title, for the name drop-downs
// (Whips availability and duty rota, Wallace Room bookings).
import { api } from './api.js';

/** "Baroness Brinton" sorts as "brinton", "Lord Purvis of Tweed" as "purvis of tweed". */
export const surnameKey = (n) => String(n).replace(/^(The\s+)?(Lord|Baroness|Lady|Viscount|Earl|Countess|Marquess|Duke|Bishop)\s+/i, '').toLowerCase();

let cache = null;
export async function loadPeers() {
  if (!cache) cache = (await api('ld-peers')).filter(Boolean).sort((a, b) => surnameKey(a).localeCompare(surnameKey(b)));
  return cache;
}

let roster = null;
/** Everyone in the directory with their role: { roles: [ { id, label } ], people: [ { name, role, onList } ] } (Whips and above). */
export function loadRoster() {
  if (!roster) roster = api('people-roles').catch((err) => { roster = null; throw err; });
  return roster;
}
/** Forget the roster, so the next page asks again (after the Roles page has changed someone). */
export const clearRoster = () => { roster = null; };

/**
 * The Whips, for the Whips pages (duty rota, availability for whipping): the people given the Whip role on the Roles page.
 * Until someone has been given that role the list would be empty, so every Lib Dem peer is offered instead (`assigned` is false).
 */
export async function loadWhips() {
  try {
    const { people } = await loadRoster();
    const whips = people.filter((p) => p.role === 'whips' && p.house !== 'commons')   // the duty rota and availability are the Lords Whips'
      .map((p) => p.name).sort((a, b) => surnameKey(a).localeCompare(surnameKey(b)));
    if (whips.length) return { names: whips, assigned: true };
  } catch { /* the directory could not be read: fall back to the peers */ }
  return { names: await loadPeers().catch(() => []), assigned: false };
}
