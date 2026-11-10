// "Give me an Update" (a button on a Bill's page): everything one Bill's update document says, gathered in one place.
//   1 Intro                  the Bill's current stage, its next stage, and who the advisers and Bill leads are in each House
//   2 Summary                what the Bill does (the official summary and long title), its Parts (from legislation.gov.uk once it is an Act) and the official documents to read
//   3 Lib Dem activity       the amendments the Lib Dems have tabled, one line each; those the team has marked (voting, content, not content, win, or with a note) in more detail
//   4 Parliamentary activity the divisions on the Bill: what, where the Lib Dems voted, and the result
// The internal marks (flags, notes, concessions) are included only for people who may see them. The words of the summary are written by Claude from the official documents
// in a separate request (see functions/api/libby/bills/[id]/update-summary.js), so the document can still be produced if that fails.
import { bill as billById, billStages, billPublications, stageAmendments, ldMembers, ldMatcher, lordsDivisions, commonsDivisions } from './parliament.js';
import { sbSelect, supabaseConfigured } from './supabase.js';
import { safe, pick, htmlToText, londonToday } from './util.js';
import { secondaryForBill } from './act-instruments.js';

const stripHL = (t) => String(t || '').replace(/\s*\[HL\]\s*/gi, ' ').replace(/\s+/g, ' ').trim();
export const amendmentUrl = (billId, stageId, amendmentId) => `https://bills.parliament.uk/bills/${billId}/stages/${stageId}/amendments/${amendmentId}`;

/** Where an amendment goes in the Bill, in words ("Clause 3, page 2, line 14", "New Clause (after Clause 4)"). */
export function amendmentPlace(a) {
  const where = a.clause ? `Clause ${a.clause}` : a.schedule ? `Schedule ${a.schedule}` : '';
  const pl = a.page ? `page ${a.page}${a.line ? `, line ${a.line}` : ''}` : '';
  if (/^add/i.test(a.type || '')) return a.schedule ? `New Schedule (after Schedule ${a.schedule})` : `New Clause${a.clause ? ` (after Clause ${a.clause})` : ''}`;
  if (/delete/i.test(a.type || '')) return `${where || 'Clause'} stand part`;
  return [where, pl].filter(Boolean).join(', ');
}

/** The stages of a Bill that take amendments, in order. */
export const takesAmendments = (s) => /committee|report|consideration of lords|consideration of commons/i.test(s.description) && !/second reading committee/i.test(s.description);

/** The next sitting on or after `today`, across all stages. */
export function nextSitting(stages, today) {
  let best = null;
  for (const s of stages) for (const d of s.dates) if (d >= today && (!best || d < best.date)) best = { date: d, stage: s.description, house: s.house };
  return best;
}

/** How a division ended: Lords divisions are won by the Contents, Commons ones by the Ayes. A tie is "Tied". */
export const divisionResult = (d) => (d.content > d.notContent ? (d.house === 'Lords' ? 'Agreed (Contents won)' : 'Agreed (Ayes won)') : d.content < d.notContent ? (d.house === 'Lords' ? 'Disagreed (Not Contents won)' : 'Disagreed (Noes won)') : 'Tied');

/** The divisions that are about this Bill: the voting APIs are searched by the Bill's title, then the title is checked. */
export async function billDivisions(title, since = '') {
  const short = stripHL(title);
  if (short.length < 5) return [];
  const [lords, commons] = await Promise.all([
    safe(lordsDivisions({ take: 60, searchTerm: short }), []),
    safe(commonsDivisions({ take: 60, searchTerm: short }), []),
  ]);
  // the title must start with the Bill's ("Health Bill" would otherwise also catch "Mental Health Bill"), and the division must be since the Bill began
  const same = (d) => stripHL(d.title).toLowerCase().startsWith(short.toLowerCase()) && (!since || d.date >= since);
  return [...lords.map((d) => ({ ...d, house: 'Lords' })), ...commons.map((d) => ({ ...d, house: 'Commons' }))]
    .filter(same)
    .map((d) => ({ house: d.house, date: d.date, title: d.title, content: d.content, notContent: d.notContent, ldContent: d.ldContent, ldNotContent: d.ldNotContent, url: d.url, result: divisionResult(d) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Official documents worth reading (explanatory notes, Commons Library briefing, delegated powers memorandum, committee reports), newest of each kind. */
export function summarySources(billId, pubs) {
  const want = [['Explanatory Notes', /explanatory notes/i], ['Library briefing', /briefing/i], ['Delegated Powers Memorandum', /delegated powers/i], ['Committee report', /select committee report|committee report/i]];
  const out = [];
  for (const [label, test] of want) {
    const hit = (pubs || []).filter((p) => test.test(`${p.type} ${p.title}`)).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (hit) out.push({ label, title: hit.title, url: hit.url, fileUrl: hit.fileUrl || '' });
  }
  return out;
}

async function publications(billId) {
  const list = await safe(billPublications(billId), []);
  return (list || []).map((p) => {
    const file = (p.links || []).find((l) => /\.pdf$/i.test(l.title || '') || /Download$/.test(l.url || ''));
    return { type: p.type || '', title: p.title || '', date: p.date || '', url: `https://bills.parliament.uk/publications/${p.id}`, fileUrl: file ? file.url : '' };
  });
}

export async function billUpdateData(ctx, billId, { internal = false } = {}) {
  const env = ctx && ctx.env;
  const today = londonToday();
  const b = await billById(billId);
  const title = pick(b, 'shortTitle') || '';
  const stages = await safe(billStages(billId), []);
  const isAct = !!pick(b, 'isAct');
  const currentStage = pick(pick(b, 'currentStage') || {}, 'description') || '';
  const currentHouse = pick(pick(b, 'currentStage') || {}, 'house') || pick(b, 'currentHouse') || '';

  const team = { lords: { adviser: '', lead: '' }, commons: { adviser: '', lead: '' } };
  if (supabaseConfigured(env)) {
    const [r] = await safe(sbSelect(env, 'bill_advisers', `select=advisers,lords_lead,commons_adviser,commons_lead&bill_id=eq.${billId}`), []);
    if (r) { team.lords = { adviser: r.advisers || '', lead: r.lords_lead || '' }; team.commons = { adviser: r.commons_adviser || '', lead: r.commons_lead || '' }; }
  }

  // Lib Dem amendments at each stage that takes them (peers in the Lords, MPs in the Commons)
  const [peers, mps] = await Promise.all([safe(ldMembers(ctx, 'lords'), []), safe(ldMembers(ctx, 'commons'), [])]);
  const matchers = { Lords: ldMatcher(peers), Commons: ldMatcher(mps) };
  const marks = { flags: {}, notes: {}, concessions: {} };
  if (internal && supabaseConfigured(env)) {
    const [flags, notes, concessions] = await Promise.all([
      safe(sbSelect(env, 'amendment_flags', `select=amendment_id,flag&bill_id=eq.${billId}`), []),
      safe(sbSelect(env, 'amendment_comments', `select=amendment_id,body,author&bill_id=eq.${billId}&order=created_at.asc`), []),
      safe(sbSelect(env, 'concessions', `select=amendment_id,notes&bill_id=eq.${billId}`), []),
    ]);
    for (const f of flags) (marks.flags[f.amendment_id] ||= []).push(f.flag);
    for (const n of notes) (marks.notes[n.amendment_id] ||= []).push(n.body);
    for (const c of concessions) marks.concessions[c.amendment_id] = c.notes || '';
  }
  const ldStages = [];
  for (const s of stages.filter(takesAmendments)) {
    if (!s.dates.length || s.dates[0] > today) continue;   // not started: nothing tabled to report
    const isLD = matchers[/commons/i.test(s.house) ? 'Commons' : 'Lords'];
    const all = await safe(stageAmendments(billId, s.billStageId), []);
    const mine = all.filter((a) => {
      const lead = a.sponsors.find((x) => x.isLead) || a.sponsors[0];
      return lead && isLD({ id: lead.memberId, name: lead.name, party: lead.party });
    }).map((a) => {
      const lead = a.sponsors.find((x) => x.isLead) || a.sponsors[0];
      const flags = marks.flags[a.id] || [];
      return {
        id: a.id, number: a.number, place: amendmentPlace(a), summary: a.summary, lead: lead ? lead.name : '', decision: a.decision, url: amendmentUrl(billId, s.billStageId, a.id),
        flags, notes: marks.notes[a.id] || [], concession: a.id in marks.concessions, concessionNotes: marks.concessions[a.id] || '',
        noteworthy: flags.length > 0 || (marks.notes[a.id] || []).length > 0 || a.id in marks.concessions,
      };
    });
    if (!all.length) continue;
    ldStages.push({ house: s.house, stage: s.description, billStageId: s.billStageId, totalTabled: all.length, amendments: mine });
  }

  const firstDate = stages.flatMap((x) => x.dates).sort()[0];
  const since = firstDate ? new Date(Date.parse(firstDate) - 14 * 864e5).toISOString().slice(0, 10) : '';
  const [divisions, pubs] = await Promise.all([billDivisions(title, since), publications(billId)]);
  let parts = [];
  if (isAct) {
    const sec = await safe(secondaryForBill(ctx, billId), null);
    const by = new Map();
    for (const x of (sec && sec.sections) || []) {
      const key = x.part || 'Sections';
      if (!by.has(key)) by.set(key, { part: key, first: x.label, last: x.label, count: 0, headings: [] });
      const p = by.get(key);
      p.last = x.label; p.count += 1; if (p.headings.length < 4) p.headings.push(x.heading);
    }
    parts = [...by.values()];
  }

  return {
    generated: today,
    bill: { id: billId, title, longTitle: pick(b, 'longTitle') || '', originatingHouse: pick(b, 'originatingHouse') || '', isAct, currentStage, currentHouse, url: `https://bills.parliament.uk/bills/${billId}` },
    team, next: nextSitting(stages, today),
    summary: { official: htmlToText(pick(b, 'summary') || ''), parts, sources: summarySources(billId, pubs) },
    ldActivity: { stages: ldStages, internal },
    divisions,
  };
}
