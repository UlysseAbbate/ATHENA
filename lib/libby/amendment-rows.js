// Turning the Bills API's amendments for one stage into the rows the site shows (shared by the Bill page and the public grids page).
export const DECISION_LABELS = {
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

export function location(a) {
  const where = a.clause ? `Clause ${a.clause}` : a.schedule ? `Schedule ${a.schedule}` : '';
  const pl = a.page ? `page ${a.page}${a.line ? `, line ${a.line}` : ''}` : '';
  if (/^add/i.test(a.type)) return a.schedule ? `New Schedule (after Schedule ${a.schedule})` : `New Clause${a.clause ? ` (after Clause ${a.clause})` : ''}`;
  if (/delete/i.test(a.type)) return `${where || 'Clause'} stand part / leave out`;
  return [where, pl].filter(Boolean).join(', ');
}

export const shorten = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}\u2026` : s);


/** One row for each amendment: its place in the Bill, who signed it (and whether each is a Liberal Democrat), its decision. `isLD` is a matcher from ldMatcher. */
export function amendmentRows(amendments, isLD) {
  return amendments.map((a) => {
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
      page: a.page ?? null,
      line: a.line ?? null,
      type: a.type || '',
      summary: a.summary,
      title: shorten(a.summary || place || 'Amendment', 160),
      decision: a.decision,
      decisionLabel: DECISION_LABELS[a.decision] || a.decision,
      decisionExplanation: a.decisionExplanation,
      sponsors,
      lead: lead.name,
      leadIsLD: !!lead.ld,
      ldSigned: sponsors.some((x) => x.ld),
    };
  });
}
