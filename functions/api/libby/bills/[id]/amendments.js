// GET /api/bills/:id/amendments?stage=:billStageId
// Amendments at one stage, organised the way the Whips' Office stage plans are
// (see the "AMENDMENTS" instructions):
//   - ours:      Lib Dem-led amendments, grouped by lead peer
//   - supported: other amendments Lib Dem peers have signed
//   - all:       every amendment at the stage (shown as a table: who signed, place in the Bill, title)
// Suggested treatments have been removed; the team's own comments (see /api/comments) replace them.

import { json, errorResponse, safe } from '../../../../../lib/libby/util.js';
import { stageAmendments, ldPeers, ldMatcher } from '../../../../../lib/libby/parliament.js';

const DECISION_LABELS = {
  NoDecision: 'Not yet decided',
  QuestionProposed: 'Question proposed',
  Agreed: 'Agreed',
  AgreedOnDivision: 'Agreed on division',
  Disagreed: 'Disagreed',
  NegativedOnDivision: 'Disagreed on division',
  Withdrawn: 'Withdrawn after debate',
  WithdrawnBeforeDebate: 'Withdrawn before debate',
  NotMoved: 'Not moved',
  NotCalled: 'Not called',
  NotSelected: 'Not selected',
  Preempted: 'Pre-empted',
  StoodPart: 'Clause stood part',
  NotStoodPart: 'Clause did not stand part',
};

function location(a) {
  const where = a.clause ? `Clause ${a.clause}` : a.schedule ? `Schedule ${a.schedule}` : '';
  const pl = a.page ? `page ${a.page}${a.line ? `, line ${a.line}` : ''}` : '';
  if (/^add/i.test(a.type)) return a.schedule ? `New Schedule (after Schedule ${a.schedule})` : `New Clause${a.clause ? ` (after Clause ${a.clause})` : ''}`;
  if (/delete/i.test(a.type)) return `${where || 'Clause'} stand part / leave out`;
  return [where, pl].filter(Boolean).join(', ');
}

const shorten = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}\u2026` : s);

export async function onRequestGet(ctx) {
  const { params, request } = ctx;
  const billId = Number(params.id);
  const stage = Number(new URL(request.url).searchParams.get('stage'));
  if (!billId || !stage) return json({ error: 'Pass ?stage=<billStageId>.' }, { status: 400 });

  try {
    const [amendments, peers] = await Promise.all([stageAmendments(billId, stage), safe(ldPeers(ctx), [])]);
    const isLD = ldMatcher(peers);

    const rows = amendments.map((a) => {
      const sponsors = a.sponsors.map((s) => ({ name: s.name, lead: s.isLead, ld: isLD({ id: s.memberId, name: s.name, party: s.party }) }));
      const lead = sponsors.find((s) => s.lead) || sponsors[0] || { name: 'Unknown', ld: false };
      const place = location(a);
      return {
        id: a.id,
        number: a.number,
        location: place,
        place,
        clause: a.clause ?? null,
        schedule: a.schedule ?? null,
        type: a.type || '',
        summary: a.summary,
        title: shorten(a.summary || place || 'Amendment', 160),
        decision: a.decision,
        decisionLabel: DECISION_LABELS[a.decision] || a.decision,
        decisionExplanation: a.decisionExplanation,
        sponsors,
        lead: lead.name,
        leadIsLD: !!lead.ld,
        ldSigned: sponsors.some((s) => s.ld),
      };
    });

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
