// GET /api/libby/previous-bills — every Bill that has received Royal Assent (all sessions), newest first, for the Previous Bills tab on the Legislation page.
//   -> { bills: [ { id, title, originatingHouse, session, royalAssent: 'YYYY-MM-DD', portfolios: ['HO'], typeName } ] }
// Kept in the saved copy (renewed at 6am and 6pm), so the tab opens at once. A Bill arrives here when it gets Royal Assent and leaves the live lists.
import { json, errorResponse, safe } from '../../../lib/libby/util.js';
import { previousBills, billTypes } from '../../../lib/libby/parliament.js';

export async function onRequestGet(ctx) {
  try {
    const [bills, types] = await Promise.all([previousBills(ctx), safe(billTypes(ctx), [])]);
    const typeName = Object.fromEntries(types.map((t) => [t.id, t.name]));
    return json({ bills: bills.map((b) => ({ ...b, typeName: typeName[b.billTypeId] || '' })) }, { maxAge: 3600 });
  } catch (err) {
    return errorResponse(err);
  }
}
