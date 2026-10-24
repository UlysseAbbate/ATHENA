// Sorts a Bill's documents into groups, so a stage shows a handful of dropdowns (Notices of amendments, Written submissions...)
// instead of one long list. A document goes in the first group whose pattern matches its title or its publication type.
// To move a kind of document, change the pattern here. Anything that matches no group goes under "Other documents".

export const DOC_GROUPS = [
  { key: 'bill', label: 'Bill text', title: /\bas (introduced|brought from|amended|first printed|agreed)\b|\bhl bill\b|^(the )?bill\b/i, type: /^bill$/i },
  { key: 'notes', label: 'Explanatory Notes', title: /explanatory notes?/i },
  { key: 'marshalled', label: 'Marshalled lists', title: /marshalled/i },
  { key: 'running', label: 'Running lists', title: /running list/i },
  { key: 'groupings', label: 'Groupings', title: /grouping/i },
  { key: 'otherhouse', label: 'Amendments and reasons from the other House', title: /\b(commons|lords) (amendments|reasons)\b|consideration of (commons|lords)|ping.?pong/i },
  { key: 'notices', label: 'Notices of amendments', title: /notices? of (amendments?|new clauses|motions?)|amendments? papers?|tabled amendments|\bnew clauses\b|government amendments|^amendments?\b|amendments? (for|to be moved|tabled)/i, type: /amendment/i },
  { key: 'evidence', label: 'Written submissions and evidence', title: /written (evidence|submissions?)|\bsubmissions?\b|evidence (submitted|from|to|received)|oral evidence|call for evidence|public bill committee.*evidence/i, type: /evidence|submission/i },
  { key: 'briefings', label: 'Library and research briefings', title: /(library|research|commons library|lords library) briefing|briefing paper|library (note|paper)|\bin focus\b|\binsight\b/i, type: /briefing/i },
  { key: 'memoranda', label: 'Memoranda and committee scrutiny', title: /delegated powers|memorand(um|a)|\bechr\b|human rights|henry viii|scrutiny|dprrc|constitution committee|\bjchr\b|legislative reform|report (of|from) the .* committee/i },
  { key: 'impact', label: 'Impact assessments', title: /impact assessment|equalit(y|ies) (impact|analysis|statement)|economic note|regulatory impact|cost.benefit/i },
  { key: 'letters', label: 'Letters, statements and government papers', title: /\bletters?\b|correspondence|government response|\bministerial\b|\bstatement\b|policy paper|fact ?sheet|guidance|q ?& ?a|programme motion|timetable|response to/i },
];
const OTHER = { key: 'other', label: 'Other documents' };

/** The group a document belongs to (its `key`). */
export function groupOf(doc) {
  const title = String((doc && doc.title) || '');
  const type = String((doc && doc.type) || '');
  const hit = DOC_GROUPS.find((g) => g.title.test(title) || (g.type && g.type.test(type)));
  return hit ? hit.key : OTHER.key;
}

/** Where a dropdown with this label sits in the order above (a stage's own slots, such as "Marshalled List(s) of Amendments", use it too). */
export function rankOfLabel(label) {
  const i = DOC_GROUPS.findIndex((g) => g.title.test(String(label || '')));
  return i < 0 ? DOC_GROUPS.length : i;
}

const byNewest = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));

/** Documents sorted into groups: [ { key, label, rank, docs } ], in the order above, each group newest first, empty groups left out. */
export function groupDocs(docs) {
  const buckets = new Map();
  for (const d of docs || []) {
    const key = groupOf(d);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(d);
  }
  return [...DOC_GROUPS, OTHER]
    .map((g, rank) => ({ key: g.key, label: g.label, rank, docs: buckets.get(g.key) || [] }))
    .filter((g) => g.docs.length)
    .map((g) => ({ ...g, docs: g.docs.sort(byNewest) }));
}
