// GET /api/bills/:id/amendments?stage=:billStageId[&house=commons]
// Amendments at one stage, organised the way the Whips' Office stage plans are
// (see the "AMENDMENTS" instructions):
//   - ours:      Lib Dem-led amendments, grouped by lead peer
//   - supported: other amendments Lib Dem peers have signed
//   - all:       every amendment at the stage (shown as a table: who signed, place in the Bill, title)
// Suggested treatments have been removed; the team's own comments (see /api/comments) replace them.

import { json, errorResponse, safe } from '../../../../../lib/libby/util.js';
import { stageAmendments, ldMembers, ldMatcher } from '../../../../../lib/libby/parliament.js';
import { amendmentRows } from '../../../../../lib/libby/amendment-rows.js';

export async function onRequestGet(ctx) {
  const { params, request } = ctx;
  const billId = Number(params.id);
  const stage = Number(new URL(request.url).searchParams.get('stage'));
  const house = new URL(request.url).searchParams.get('house') === 'commons' ? 'commons' : 'lords';   // whose Lib Dems are marked: peers or MPs
  if (!billId || !stage) return json({ error: 'Pass ?stage=<billStageId>.' }, { status: 400 });

  try {
    const [amendments, peers] = await Promise.all([stageAmendments(billId, stage), safe(ldMembers(ctx, house), [])]);
    const isLD = ldMatcher(peers);

    const rows = amendmentRows(amendments, isLD);

    const byPeer = new Map();
    for (const r of rows.filter((x) => x.leadIsLD)) {
      if (!byPeer.has(r.lead)) byPeer.set(r.lead, []);
      byPeer.get(r.lead).push(r);
    }
    const supported = rows.filter((r) => !r.leadIsLD && r.ldSigned);

    return json({
      billId,
      billStageId: stage,
      total: rows.length,
      ours: [...byPeer.entries()].map(([peer, list]) => ({ peer, amendments: list })),
      supported,
      all: rows,
    }, { maxAge: 900 });
  } catch (err) {
    return errorResponse(err);
  }
}
