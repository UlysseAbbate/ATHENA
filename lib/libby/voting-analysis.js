// Voting Data calculations. These follow the "Calculations" sheet of the Whips' Office Voting Data workbook:
//   Result        Content if Content >= Not Content, otherwise Not Content           (=IF(E<F,"Not Content","Content"))
//   Majority      the gap between the two sides
//   Intention     how a party voted: the side most of its members took; "Abstain" if none voted
//   Votes         how many of that party voted on that side
//   Gov win       Labour (the Government party) intention = result                   (=J=G)
//   LD+Con        Lib Dem intention = Conservative intention                         (=H=L)
//   LD+Lab        Lib Dem intention = Labour intention                               (=J=L)
//   LD alone      Lib Dem intention differs from both                                (=AND(H<>L,J<>L))
//   LD made the difference   LD intention = result, and the majority is less than twice the LD vote
//                             (so if the Lib Dems had voted the other way the result would have changed)
//   Con needed LD / Lab needed LD   the LD made the difference and that party voted the same way as the LD
//   LD with no other support        LD alone, and at least one LD voted
// "Party splits" (an empty column in the workbook) is filled in here: a party split when at least one of its
// members voted against the way most of the party voted.

import { classifyPortfolios } from './portfolios.js';

export const GOVERNMENT = 'lab'; // the party of Government: change if the Government changes

const PARTIES = {
  con: { name: 'Conservative', test: /^conservative/i },
  lab: { name: 'Labour', test: /^labour/i },
  ld: { name: 'Liberal Democrat', test: /liberal democrat/i },
};

/** Content / Not Content counts for one party, from the stored { "Party name": { c, nc } } map. */
function countsFor(parties, key) {
  let c = 0;
  let nc = 0;
  for (const [name, v] of Object.entries(parties || {})) {
    if (PARTIES[key].test.test(name)) { c += Number(v?.c) || 0; nc += Number(v?.nc) || 0; }
  }
  return { c, nc };
}

function intention({ c, nc }) {
  if (!c && !nc) return 'Abstain';
  if (c > nc) return 'Content';
  if (nc > c) return 'Not Content';
  return 'Split evenly';
}

const sideVotes = (counts, side) => (side === 'Content' ? counts.c : side === 'Not Content' ? counts.nc : 0);

/** Every column of the Calculations sheet for one stored division row. */
export function analyseDivision(row, departmentOf = (title) => classifyPortfolios(title, { max: 1 })[0] || '') {
  const content = Number(row.content) || 0;
  const notContent = Number(row.not_content) || 0;
  const result = content < notContent ? 'Not Content' : 'Content';
  const majority = Math.abs(content - notContent);
  const p = {};
  for (const key of Object.keys(PARTIES)) {
    const counts = countsFor(row.parties, key);
    const int = intention(counts);
    const votes = sideVotes(counts, int);
    p[key] = { intention: int, votes, content: counts.c, notContent: counts.nc, rebels: counts.c + counts.nc - votes };
  }
  const ldInt = p.ld.intention;
  const ldDiff = result === ldInt && majority < 2 * p.ld.votes;
  const ldAlone = p.con.intention !== ldInt && p.lab.intention !== ldInt;
  return {
    id: row.division_id,
    number: row.number ?? null,
    date: row.division_date,
    title: row.title,
    url: `https://votes.parliament.uk/votes/lords/division/${row.division_id}`,
    department: departmentOf(row.title),
    content, notContent, result, majority,
    parties: p,
    govWin: p[GOVERNMENT].intention === result,
    ldCon: p.con.intention === ldInt,
    ldLab: p.lab.intention === ldInt,
    ldAlone,
    ldDiff,
    conNeedLd: p.con.intention === ldInt && ldDiff,
    labNeedLd: p.lab.intention === ldInt && ldDiff,
    ldNoSupport: ldAlone && p.ld.votes > 0,
    splits: Object.keys(PARTIES).filter((k) => p[k].rebels > 0 && p[k].intention !== 'Abstain'),
  };
}

export const FLAGS = [
  ['govWin', 'Government wins'],
  ['ldCon', 'LD + Con'],
  ['ldLab', 'LD + Lab'],
  ['ldAlone', 'LD alone / abstain'],
  ['ldDiff', 'LD made the difference'],
  ['conNeedLd', 'Con needed LD'],
  ['labNeedLd', 'Lab needed LD'],
  ['ldNoSupport', 'LD with no other support'],
];

/** The TRUE counts for a set of divisions (one row of the workbook's month or TOTAL lines). */
export function tally(list) {
  const out = { divisions: list.length, govDefeats: list.filter((d) => !d.govWin).length, splits: list.filter((d) => d.splits.length).length };
  for (const [key] of FLAGS) out[key] = list.filter((d) => d[key]).length;
  return out;
}

/** Everything the Voting Data page shows, for stored rows in date order. */
export function votingData(rows, { departmentOf = (title) => classifyPortfolios(title, { max: 1 })[0] || '' } = {}) {
  const divisions = rows.map((row) => analyseDivision(row, departmentOf)).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const byMonth = new Map();
  const byDept = new Map();
  for (const d of divisions) {
    const m = d.date.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(d);
    const dept = d.department || 'Other';
    if (!byDept.has(dept)) byDept.set(dept, []);
    byDept.get(dept).push(d);
  }
  return {
    divisions,
    total: tally(divisions),
    months: [...byMonth.entries()].map(([month, list]) => ({ month, ...tally(list) })),
    departments: [...byDept.entries()].map(([department, list]) => ({ department, ...tally(list) }))
      .sort((a, b) => b.divisions - a.divisions),
    flags: FLAGS,
  };
}
