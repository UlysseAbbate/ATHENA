// GET /api/bills/:id — one Bill: summary, sponsors, every stage with dates, the documents
// each Lords stage needs (following the "DOCUMENTS" briefing instructions), and any
// dates advertised in the Lords Whips' Forthcoming Business.

import { json, errorResponse, safe, pick, norm, londonToday, addDays } from '../../../../../lib/libby/util.js';
import { bill, billStages, billPublications, ldPeers, ldMatcher } from '../../../../../lib/libby/parliament.js';
import { fbRows } from '../../../../../lib/libby/supabase.js';

// Each Lords stage, the briefing output it feeds, and the source documents that output needs.
const STAGE_TEMPLATES = [
  {
    key: '2R', test: /2nd reading|second reading/i, output: '2nd Reading Briefing',
    slots: [
      { label: 'Bill as brought from the Commons / as introduced', test: /(as brought from|as introduced|as first printed|^bill\b|hl bill)/i, type: /^bill$/i },
      { label: 'Explanatory Notes', test: /explanatory notes/i },
      { label: 'House of Lords Library Briefing', external: (t) => `https://lordslibrary.parliament.uk/?s=${encodeURIComponent(t)}`, test: /lords library/i },
      { label: 'Commons Library Briefing', external: (t) => `https://commonslibrary.parliament.uk/?s=${encodeURIComponent(t)}`, test: /commons library|research briefing/i, commonsOnly: true },
      { label: 'Delegated Powers Memorandum', test: /delegated powers/i },
      { label: 'Impact Assessment', test: /impact assessment/i },
    ],
  },
  {
    key: 'CS', test: /committee/i, output: 'Committee Stage Grid',
    slots: [
      { label: 'Marshalled List(s) of Amendments', test: /marshalled/i, not: /supplementary|motions/i },
      { label: 'Supplementary Marshalled List(s)', test: /supplementary/i },
      { label: 'Running List(s) of Amendments', test: /running list/i },
      { label: 'Grouping(s) of Amendments', test: /grouping/i, fallback: { href: 'https://www.lordswhips.org.uk/todays-lists', label: "Groupings appear on the Whips' Today's Lists" } },
    ],
  },
  {
    key: 'RS', test: /report/i, output: 'Report Stage Grid and Hymn Sheet',
    slots: [
      { label: 'Bill as amended in Committee', test: /as amended/i },
      { label: 'Marshalled List(s) of Amendments', test: /marshalled/i, not: /supplementary|motions/i },
      { label: 'Supplementary Marshalled List(s)', test: /supplementary/i },
      { label: 'Running List(s) of Amendments', test: /running list/i },
      { label: 'Grouping(s) of Amendments', test: /grouping/i, fallback: { href: 'https://www.lordswhips.org.uk/todays-lists', label: "Groupings appear on the Whips' Today's Lists" } },
    ],
  },
  {
    key: '3R', test: /3rd reading|third reading/i, output: null,
    slots: [
      { label: 'Marshalled List(s) of Amendments', test: /marshalled/i, not: /motions/i },
      { label: 'Grouping(s) of Amendments', test: /grouping/i },
    ],
  },
  {
    key: 'PP', test: /consideration of commons|commons amendments|commons reasons|ping pong/i, output: 'Ping Pong Grid and Hymn Sheet',
    slots: [
      { label: 'Marshalled List of Motions', test: /motions/i, not: /grouping/i },
      { label: 'Grouping of Motions', test: /grouping/i },
      { label: 'Commons Amendments / Reasons', test: /commons (amendments|reasons)|reasons/i },
    ],
  },
];

const templateFor = (stage) => STAGE_TEMPLATES.find((t) => t.test.test(stage.description));

/** Which Lords stage a publication most likely belongs to. */
function stageKeyForPublication(p, lordsStages) {
  const t = p.title;
  if (/motions|commons (amendments|reasons)|consideration of commons/i.test(t)) return 'PP';
  if (/third reading|3rd reading/i.test(t)) return '3R';
  if (/report/i.test(t) && !/impact assessment|delegated powers/i.test(t)) return 'RS';
  if (/committee/i.test(t) && !/committee report|scrutiny committee/i.test(t)) return 'CS';
  if (/as amended/i.test(t)) return 'RS';
  if (/explanatory notes|as brought from|as introduced|delegated powers|impact assessment|library/i.test(t) || /^bill$/i.test(p.type)) return '2R';
  // Otherwise: an amendment paper belongs to the next Lords stage on or after its date.
  if (p.date) {
    const next = lordsStages.find((s) => s.dates.some((d) => d >= p.date));
    if (next) return templateFor(next)?.key || null;
  }
  return null;
}

export async function onRequestGet(ctx) {
  const { params, env } = ctx;
  const id = Number(params.id);
  if (!id) return json({ error: 'Unknown Bill.' }, { status: 400 });
  try {
    const today = londonToday();
    const [detail, stages, pubs, peers] = await Promise.all([
      bill(id), billStages(id), safe(billPublications(id), []), safe(ldPeers(ctx), []),
    ]);
    const title = pick(detail, 'shortTitle') || '';
    const originatingHouse = pick(detail, 'originatingHouse') || '';
    const isLD = ldMatcher(peers);

    // Forthcoming Business entries that mention this Bill (next eight weeks).
    const fb = await safe(fbRows(env, today, addDays(today, 56)), []);
    const titleKey = norm(title);
    const scheduled = fb.filter((r) => norm(r.text).includes(titleKey)).map((r) => ({ date: r.business_date, text: r.text }));

    const lordsStages = stages.filter((s) => /lords/i.test(s.house));
    const commonsStages = stages.filter((s) => /commons/i.test(s.house));

    // Slot every publication into a Lords stage template.
    const byStage = {};
    const commonsDocs = [];
    const otherDocs = [];
    for (const p of pubs) {
      const isCommons = /commons/i.test(p.house) && !/lords/i.test(p.title);
      if (isCommons && !/explanatory notes|library/i.test(p.title)) { commonsDocs.push(p); continue; }
      const key = stageKeyForPublication(p, lordsStages);
      if (key) (byStage[key] ||= []).push(p); else otherDocs.push(p);
    }

    const lords = lordsStages.map((s) => {
      const tpl = templateFor(s);
      const fbForStage = scheduled.filter((f) => {
        const t = f.text.toLowerCase();
        if (tpl?.key === 'CS') return /committee/.test(t) && !/report/.test(t);
        if (tpl?.key === 'RS') return /report/.test(t);
        if (tpl?.key === '3R') return /third reading|3rd reading/.test(t);
        if (tpl?.key === '2R') return /second reading|2nd reading/.test(t);
        if (tpl?.key === 'PP') return /consideration|commons amendments|commons reasons/.test(t);
        return false;
      });
      const docs = tpl ? byStage[tpl.key] || [] : [];
      const used = new Set();
      const slots = (tpl?.slots || [])
        .filter((slot) => !(slot.commonsOnly && /lords/i.test(originatingHouse)))
        .map((slot) => {
          const matches = docs.filter((d) => {
            const hay = `${d.title} ${d.type}`;
            return (slot.test.test(hay) || (slot.type && slot.type.test(d.type))) && !(slot.not && slot.not.test(hay));
          });
          matches.forEach((m) => used.add(m.id));
          return {
            label: slot.label,
            docs: matches.map((m) => ({ title: m.title, type: m.type, date: m.date, links: m.links })),
            external: slot.external ? { href: slot.external(title), label: `Search for the ${slot.label}` } : null,
            fallback: slot.fallback || null,
          };
        });
      const extra = docs.filter((d) => !used.has(d.id)).map((m) => ({ title: m.title, type: m.type, date: m.date, links: m.links }));
      const allDates = [...s.dates, ...fbForStage.map((f) => f.date)];
      const status = s.dates.length && s.dates.every((d) => d < today) && !fbForStage.length ? 'done'
        : allDates.some((d) => d >= today) ? 'scheduled' : s.dates.length ? 'in progress' : 'not yet scheduled';
      return {
        billStageId: s.billStageId,
        description: s.description,
        abbreviation: s.abbreviation,
        dates: s.dates,
        forthcoming: fbForStage,
        status,
        output: tpl?.output || null,
        takesAmendments: ['CS', 'RS', '3R', 'PP'].includes(tpl?.key),
        slots,
        extraDocs: extra,
      };
    });

    const sponsors = (pick(detail, 'sponsors') || []).map((sp) => {
      const m = pick(sp, 'member') || {};
      const org = pick(sp, 'organisation') || {};
      const name = pick(m, 'name') || '';
      const party = pick(m, 'party') || '';
      return { name, party, house: pick(m, 'house') || '', department: pick(org, 'name') || '', ld: isLD({ id: pick(m, 'memberId'), name, party }) };
    });

    return json({
      id,
      title,
      longTitle: pick(detail, 'longTitle') || '',
      summary: pick(detail, 'summary') || '',
      originatingHouse,
      currentStage: pick(pick(detail, 'currentStage') || {}, 'description') || '',
      sponsors,
      url: `https://bills.parliament.uk/bills/${id}`,
      // (the Commons stages say which take amendments, so Honourable LIBBY can show the amendments at Committee and Report)
      commonsStages: commonsStages.map((s) => {
        const status = s.dates.length && s.dates.every((d) => d < today) ? 'done' : s.dates.some((d) => d >= today) ? 'scheduled' : s.dates.length ? 'in progress' : 'not yet scheduled';
        return { billStageId: s.billStageId, description: s.description, dates: s.dates, status,
          takesAmendments: /committee|report|consideration of lords/i.test(s.description) && !/second reading committee/i.test(s.description) };
      }),
      lordsStages: lords,
      unassignedForthcoming: scheduled.filter((f) => !lords.some((l) => l.forthcoming.includes(f))),
      commonsDocs: commonsDocs.map((m) => ({ title: m.title, type: m.type, date: m.date, links: m.links })),
      otherDocs: otherDocs.map((m) => ({ title: m.title, type: m.type, date: m.date, links: m.links })),
      ldPeers: peers.map((p) => p.name),
    }, { maxAge: 600 });
  } catch (err) {
    return errorResponse(err);
  }
}
