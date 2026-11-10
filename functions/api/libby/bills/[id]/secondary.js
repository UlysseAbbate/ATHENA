// GET /api/libby/bills/:id/secondary — the secondary-legislation tracker for a Bill that has become an Act:
//   { billId, isAct, title, act: { type, year, number, title, uri } | null,
//     sections: [ { label, key, heading, part, commencement: [ { si: { title, uri }, date, qualification } ], powers: [ { title, uri } ] } ],
//     summary: { sections, commenced, powerSections, instruments }, partial }
// A Bill that is not an Act yet has no instruments: { isAct: false }. The data comes from legislation.gov.uk (see lib/legislation-gov.js).
import { json, errorResponse } from '../../../../../lib/libby/util.js';
import { secondaryForBill } from '../../../../../lib/libby/act-instruments.js';

export async function onRequestGet(ctx) {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'Unknown Bill.' }, { status: 400 });
  try {
    return json(await secondaryForBill(ctx, id), { maxAge: 1800 });
  } catch (err) {
    return errorResponse(err);
  }
}
