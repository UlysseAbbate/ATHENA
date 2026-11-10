// GET /api/libby/bills/:id/update — everything the "Give me an Update" document says about one Bill (see lib/bill-update.js):
//   { generated, bill, team, next, summary: { official, parts, sources }, ldActivity: { stages: [ { house, stage, amendments: [...] } ], internal }, divisions }
// The team's internal marks on amendments (flags, notes, concessions) are included only for people who may see them (Whips and above).
import { json, errorResponse } from '../../../../../lib/libby/util.js';
import { billUpdateData } from '../../../../../lib/libby/bill-update.js';
import { levelFromRequest, atLeast } from '../../../../../lib/libby/access.js';

export async function onRequestGet(ctx) {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'Unknown Bill.' }, { status: 400 });
  try {
    const level = await levelFromRequest(ctx.request, ctx.env);
    return json(await billUpdateData(ctx, id, { internal: atLeast(level, 'whips') }), { maxAge: 0 });
  } catch (err) {
    return errorResponse(err);
  }
}
