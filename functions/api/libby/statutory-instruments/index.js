// GET /api/libby/statutory-instruments — the statutory instruments before Parliament (secondary legislation), from the SI API.
//   -> { instruments: [ { id, name, paper, laid, laidCommons, laidLords, made, procedure, url } ], total, empty }
// Every instrument whose parliamentary process is not concluded, newest laid first. `empty` is true when the API answered with nothing at all, which
// (for an API that is normally never empty) means Parliament's service is having trouble, not that there is no secondary legislation.
// Kept as a saved copy (renewed at 6am and 6pm). No amendments: an instrument is only approved or annulled, so the page is stages and documents.
import { json, errorResponse } from '../../../../lib/libby/util.js';
import { openInstruments } from '../../../../lib/libby/parliament.js';

export async function onRequestGet(ctx) {
  try {
    return json(await openInstruments(ctx), { maxAge: 600 });
  } catch (err) {
    return errorResponse(err);
  }
}
