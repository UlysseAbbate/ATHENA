// GET /api/data/votes?from=YYYY-MM-DD&to=YYYY-MM-DD[&house=commons]
// Voting Data for the Data page: every Lords (or, with house=commons, Commons) division in the range with the Whips' Office calculations
// (see lib/voting-analysis.js), month-by-month and department totals. Whips and above only (lib/access.js).
// The divisions are copied from the Lords Votes API by scripts/libby/ingest_votes.py, and from the Commons Votes API by scripts/libby/ingest_commons_votes.py (tables lords_divisions and
// commons_divisions), in the 6am and 6pm update. The Commons calculations are the same, with Aye / No for Content / Not Content.

import { json, errorResponse, isIsoDate, londonToday, safe } from '../../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../../lib/libby/supabase.js';
import { votingData } from '../../../../lib/libby/voting-analysis.js';
import { snapshotted } from '../../../../lib/libby/snapshots.js';
import { activeLordsBillsTagged, activeBillsTagged } from '../../../../lib/libby/parliament.js';
import { titleTagger } from '../../../../lib/libby/bill-tags.js';

const PARLIAMENT_START = '2024-07-09';

/** The whole answer for a date range. Reads the divisions a page at a time, several pages together. */
async function buildVotes(ctx, from, to, house = 'lords') {
  const { env } = ctx;
  const table = house === 'commons' ? 'commons_divisions' : 'lords_divisions';
  const PAGE = 1000; // Supabase returns at most 1,000 rows at a time
  const url = (offset) => `select=division_id,number,division_date,title,content,not_content,parties&division_date=gte.${from}&division_date=lte.${to}&order=division_date.asc,division_id.asc&limit=${PAGE}&offset=${offset}`;
  const rows = [];
  // Five pages at a time, instead of one after another (the Parliament so far is a few thousand divisions).
  for (let offset = 0; offset < 20000; offset += PAGE * 5) {
    const pages = await Promise.all([0, 1, 2, 3, 4].map((i) => sbSelect(env, table, url(offset + i * PAGE))));
    for (const page of pages) rows.push(...page);
    if (pages.some((pg) => pg.length < PAGE)) break;
  }
  const latest = await sbSelect(env, table, 'select=division_date,fetched_at&order=fetched_at.desc&limit=1').catch(() => []);
  // A vote's title is a Bill's name: its department comes from the overrides, then the live Bill of that name, then keywords.
  const departmentOf = titleTagger(house === 'commons' ? [...await safe(activeBillsTagged(ctx, 'Commons'), []), ...await safe(activeLordsBillsTagged(ctx), [])] : await safe(activeLordsBillsTagged(ctx), []));
  return { from, to, updated: latest[0]?.fetched_at || null, ...votingData(rows, { departmentOf, house }) };
}

export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const q = new URL(request.url).searchParams;
  const today = londonToday();
  const from = isIsoDate(q.get('from')) ? q.get('from') : PARLIAMENT_START;
  const to = isIsoDate(q.get('to')) ? q.get('to') : today;
  const house = q.get('house') === 'commons' ? 'commons' : 'lords';
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });
  try {
    // The whole Parliament up to today is what the page opens with: saved, and renewed by the scheduled job.
    const wholeParliament = from === PARLIAMENT_START && to === today;
    const data = wholeParliament ? await snapshotted(ctx, house === 'commons' ? 'data:votes:commons' : 'data:votes', 600, () => buildVotes(ctx, from, to, house)) : await buildVotes(ctx, from, to, house);
    return json(data, { maxAge: 600 });
  } catch (err) {
    if (/(lords|commons)_divisions/.test(String(err.message)) && /does not exist|relation/.test(String(err.message))) {
      return json({ error: `The ${house}_divisions table has not been created yet: run its migration in Supabase, then the "Ingest Lords votes" workflow.` }, { status: 503 });
    }
    return errorResponse(err);
  }
}
