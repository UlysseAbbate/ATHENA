// The Commons Data part of the Data page.
//   GET /api/data/commons-members  -> { date, total, parties: [ { name, abbreviation, colour, male, female, total } ], ldMps: [ { id, name } ], library }
// The state of the parties in the House of Commons today (the Members API) and the Lib Dem MPs. The Commons Library publishes its own data dashboards, but its website
// refuses automated reading (a bot challenge), so they cannot be listed or shown here: `library` is the address to open them on the Library's site.
import { json, errorResponse, londonToday, getJSON, pick, safe } from '../../../../lib/libby/util.js';
import { snapshotted } from '../../../../lib/libby/snapshots.js';
import { ldMPs } from '../../../../lib/libby/parliament.js';

const MEMBERS = 'https://members-api.parliament.uk/api';
const LIBRARY = 'https://commonslibrary.parliament.uk/type/data-dashboard/';

export async function onRequestGet(ctx) {
  try {
    const data = await snapshotted(ctx, 'commons-data-v1', 6 * 3600, async () => {
      const date = londonToday();
      const state = await getJSON(`${MEMBERS}/Parties/StateOfTheParties/1/${date}`);
      const parties = (pick(state, 'items') || []).map((it) => {
        const v = pick(it, 'value') || it;
        const p = pick(v, 'party') || {};
        return { name: pick(p, 'name') || '', abbreviation: pick(p, 'abbreviation') || '', colour: pick(p, 'backgroundColour') || '', male: pick(v, 'male') || 0, female: pick(v, 'female') || 0, nonBinary: pick(v, 'nonBinary') || 0, total: pick(v, 'total') || 0 };
      }).filter((p) => p.total).sort((a, b) => b.total - a.total);
      const mps = await safe(ldMPs(ctx), []);
      return { date, total: parties.reduce((n, p) => n + p.total, 0), parties, ldMps: mps.map((m) => ({ id: m.id, name: m.name })).sort((a, b) => a.name.localeCompare(b.name)), library: LIBRARY };
    });
    return json(data, { maxAge: 3600 });
  } catch (err) {
    return errorResponse(err);
  }
}
