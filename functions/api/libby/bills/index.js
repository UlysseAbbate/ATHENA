// GET /api/bills — every live Bill currently in the House of Lords,
// split into Government Bills and Private Members' Bills. Each Bill carries its portfolio(s): `portfolios` and `portfolioBy`.

import { json, errorResponse, safe } from '../../../../lib/libby/util.js';
import { activeLordsBillsTagged, billTypes } from '../../../../lib/libby/parliament.js';

export async function onRequestGet(ctx) {
  try {
    const [bills, types] = await Promise.all([activeLordsBillsTagged(ctx), safe(billTypes(ctx), [])]);
    const typeName = Object.fromEntries(types.map((t) => [t.id, t.name]));
    const groups = { government: [], privateMembers: [], other: [] };
    for (const b of bills) {
      const name = typeName[b.billTypeId] || '';
      const bill = { ...b, typeName: name };
      if (/government/i.test(name)) groups.government.push(bill);
      else if (/private member/i.test(name) || /ballot|ten minute|presentation/i.test(name)) groups.privateMembers.push(bill);
      else groups.other.push(bill);
    }
    for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.title.localeCompare(b.title));
    return json(groups, { maxAge: 600 });
  } catch (err) {
    return errorResponse(err);
  }
}
