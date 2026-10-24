// GET /api/portfolios/:code — the portfolio view, modelled on the department tabs of the
// Lords Business Dashboard: primary legislation, secondary legislation, forthcoming Lords
// debates and motions, and Lords committee reports. (Briefing links and Lib Dem motions
// from the spreadsheet are deliberately not reproduced; the page links to the policy library.)
// Every portfolio is saved by the scheduled job; the work itself is in lib/portfolio-view.js.

import { json, errorResponse } from '../../../../lib/libby/util.js';
import { PORTFOLIO_BY_CODE } from '../../../../lib/libby/portfolios.js';
import { snapshotted } from '../../../../lib/libby/snapshots.js';
import { buildPortfolio } from '../../../../lib/libby/portfolio-view.js';

export async function onRequestGet(ctx) {
  const p = PORTFOLIO_BY_CODE[String(ctx.params.code || '').toUpperCase()];
  if (!p) return json({ error: 'Unknown portfolio.' }, { status: 404 });
  try {
    return json(await snapshotted(ctx, `portfolio:${p.code}`, 900, () => buildPortfolio(ctx, p)), { maxAge: 900 });
  } catch (err) {
    return errorResponse(err);
  }
}
