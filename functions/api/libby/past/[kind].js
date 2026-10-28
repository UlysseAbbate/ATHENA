// GET /api/past/:kind
// Add &house=commons for the House of Commons (Commons divisions, Commons written questions and statements).
//   votes       ?skip=&q=            Lords divisions (lordsvotes-api) with the Lib Dem split
//   questions   ?skip=&q=&ld=1       Lords written questions (questions-statements-api)
//   statements  ?skip=&q=            Lords written ministerial statements
//   committees  ?category=  |  ?committee=:id   committee groups, the committees in a group, or one committee's publications
//   hansard     ?month=YYYY-MM       sitting days with links to Lords and Commons Hansard

import { json, errorResponse, safe, londonToday } from '../../../../lib/libby/util.js';
import { lordsDivisions, commonsDivisions, writtenQuestions, writtenStatements, allCommittees, committeePublications, publicationGroup, isGovernmentResponse, COMMITTEE_CATEGORIES, whatsOn, isLDParty } from '../../../../lib/libby/parliament.js';
import { weekdays } from '../../../../lib/libby/business.js';
import { snapshotted } from '../../../../lib/libby/snapshots.js';

/**
 * The first page with no search is what most people open, so it is saved and renewed by the scheduled job.
 * A later page or a search is looked up live, as before.
 */
function firstPage(ctx, name, skip, searchTerm, producer) {
  return skip === 0 && !searchTerm ? snapshotted(ctx, `past:${name}`, 600, producer) : producer();
}

/** The sitting days of one month (Lords and Commons). Looks at every day of the month, so it is saved for the current and last month. */
async function hansardMonth(ctx, month) {
  const today = londonToday();
  const first = `${month}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const last = [`${month}-${String(lastDay).padStart(2, '0')}`, today].sort()[0];
  const [lords, commons] = await Promise.all([
    safe(whatsOn(first, last, 'Lords', ctx), null),
    safe(whatsOn(first, last, 'Commons', ctx), null),
  ]);
  const sat = (events, d) => (events ? events.some((e) => e.date === d && e.section === 'Chamber') : null);
  const days = weekdays(first, last).reverse().map((d) => ({
    date: d,
    lordsSat: sat(lords, d),
    commonsSat: sat(commons, d),
    lordsUrl: `https://hansard.parliament.uk/lords/${d}`,
    commonsUrl: `https://hansard.parliament.uk/commons/${d}`,
  }));
  return { month, days };
}

export async function onRequestGet(ctx) {
  const { params, request } = ctx;
  const q = new URL(request.url).searchParams;
  const skip = Math.max(0, Number(q.get('skip')) || 0);
  const searchTerm = (q.get('q') || '').slice(0, 100);
  const commons = q.get('house') === 'commons';
  const house = commons ? 'Commons' : 'Lords';
  const saved = (name) => (commons ? `commons:${name}` : name);

  try {
    switch (params.kind) {
      case 'votes':
        return json({ items: await firstPage(ctx, saved('votes'), skip, searchTerm, () => (commons ? commonsDivisions : lordsDivisions)({ skip, take: 25, searchTerm })), skip }, { maxAge: 600 });

      case 'questions': {
        const ldOnly = q.get('ld') === '1';
        // When filtering to Lib Dems, over-fetch so a page still has useful rows.
        const items = await firstPage(ctx, saved(ldOnly ? 'questions-ld' : 'questions'), skip, searchTerm, () => writtenQuestions({ skip, take: ldOnly ? 100 : 25, searchTerm, house }));
        return json({ items: ldOnly ? items.filter((i) => isLDParty(i.askerParty)) : items, skip, nextSkip: skip + (ldOnly ? 100 : 25) }, { maxAge: 600 });
      }

      case 'statements':
        return json({ items: await firstPage(ctx, saved('statements'), skip, searchTerm, () => writtenStatements({ skip, take: 25, searchTerm, house })), skip }, { maxAge: 600 });

      case 'committees': {
        // ?committee=ID  → one committee's publications, grouped under the four headings
        const id = Number(q.get('committee'));
        if (id) {
          const groups = { reports: [], correspondence: [], minutes: [], other: [] };
          for (const p of await committeePublications(id)) {
            groups[publicationGroup(p)].push({ ...p, isResponse: isGovernmentResponse(p) });
          }
          return json({ groups }, { maxAge: 1800 });
        }
        const all = await allCommittees(ctx);
        // ?category=lords|commons|joint|other  → the committees in that group
        const category = q.get('category');
        if (COMMITTEE_CATEGORIES[category]) {
          return json({ category, title: COMMITTEE_CATEGORIES[category], committees: all.filter((c) => c.category === category) }, { maxAge: 3600 });
        }
        // no parameters → the four groups, with a count for each
        return json({
          categories: Object.entries(COMMITTEE_CATEGORIES).map(([key, title]) => ({ key, title, count: all.filter((c) => c.category === key).length })),
        }, { maxAge: 3600 });
      }

      case 'hansard': {
        const today = londonToday();
        const month = /^\d{4}-\d{2}$/.test(q.get('month') || '') ? q.get('month') : today.slice(0, 7);
        // This month and last month are saved; any other month is worked out live.
        const lastMonth = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
        lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
        const saved = month === today.slice(0, 7) || month === lastMonth.toISOString().slice(0, 7);
        const data = saved ? await snapshotted(ctx, `past:hansard:${month}`, 3600, () => hansardMonth(ctx, month)) : await hansardMonth(ctx, month);
        return json(data, { maxAge: 3600 });
      }

      default:
        return json({ error: 'Unknown section.' }, { status: 404 });
    }
  } catch (err) {
    return errorResponse(err);
  }
}
