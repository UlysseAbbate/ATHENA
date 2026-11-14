// The public "Groupings and grids" page (/grids/): no sign-in, reached only through a link that carries a secret key. This is its whole server side.
//   GET /api/grids?do=bills                              -> { bills: [ { id, title } ] }              the live Lords Bills
//   GET /api/grids?do=stages&bill=ID                     -> { title, stages: [ { billStageId, description } ] }   its Committee and Report stages
//   GET /api/grids?do=amendments&bill=ID&stage=STAGEID   -> { amendments: [ ... ] }                  every amendment at the stage (who signed, place in the Bill)
//   GET /api/grids?do=amendment&bill=ID&stage=STAGEID&aid=ID -> { explanatoryStatement, text, location }   one amendment's text
// The key goes in the header `x-grid-key` and is checked against the GRID_LINK_KEY setting in Cloudflare (Pages -> Settings -> Variables); without that setting the page
// is switched off. Wrong keys are slowed down like wrong access codes (lib/libby/throttle.js). It reads public Parliament data only, saves nothing, calls no paid service,
// and its answers are never cached for others (the cache is keyed on nothing, so a shared copy could be seen without the key).
import { json, errorResponse, safe } from '../../../lib/libby/util.js';
import { sameSecret } from '../../../lib/libby/auth.js';
import { tooManyFailures, recordFailure, WINDOW_MINUTES } from '../../../lib/libby/throttle.js';
import { activeBills, billStages, bill, stageAmendments, amendmentDetail, ldMembers, ldMatcher } from '../../../lib/libby/parliament.js';
import { amendmentRows } from '../../../lib/libby/amendment-rows.js';

const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 1e8 ? n : 0; };
const fail = (message, status = 400) => json({ error: message }, { status });

/** Null if the request carries the right key, otherwise the Response to send back. */
export async function keyProblem(request, env) {
  const key = String(env.GRID_LINK_KEY || '');
  if (key.length < 16) return fail('This page has not been switched on: the site needs a GRID_LINK_KEY setting of at least 16 characters.', 503);
  if (await tooManyFailures(request, env)) return fail(`Too many wrong keys from this connection. Wait ${WINDOW_MINUTES} minutes.`, 429);
  const given = request.headers.get('x-grid-key') || '';
  if (!given || !(await sameSecret(given, key))) {
    await Promise.all([recordFailure(request, env), new Promise((r) => setTimeout(r, 600))]);
    return fail('This link is not right. Ask for the link again.', 401);
  }
  return null;
}

export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const refused = await keyProblem(request, env);
  if (refused) return refused;
  const q = new URL(request.url).searchParams;
  try {
    switch (q.get('do')) {
      case 'bills': {
        const bills = await activeBills(ctx, 'Lords');
        return json({ bills: bills.map((b) => ({ id: b.id, title: b.title })).sort((a, b) => a.title.localeCompare(b.title)) });
      }
      case 'stages': {
        const id = posInt(q.get('bill'));
        if (!id) return fail('Choose a Bill.');
        const [b, stages] = await Promise.all([safe(bill(id), null), billStages(id)]);
        return json({ title: (b && (b.shortTitle || b.ShortTitle)) || '',
          stages: stages.filter((s) => /lords/i.test(s.house) && /committee|report/i.test(s.description) && !/programme|recommit/i.test(s.description)).map((s) => ({ billStageId: s.billStageId, description: s.description })) });
      }
      case 'amendments': {
        const id = posInt(q.get('bill')), stage = posInt(q.get('stage'));
        if (!id || !stage) return fail('Choose a Bill and a stage.');
        const [amendments, peers] = await Promise.all([stageAmendments(id, stage), safe(ldMembers(ctx, 'lords'), [])]);
        return json({ amendments: amendmentRows(amendments, ldMatcher(peers)) });
      }
      case 'amendment': {
        const id = posInt(q.get('bill')), stage = posInt(q.get('stage')), aid = posInt(q.get('aid'));
        if (!id || !stage || !aid) return fail('Unknown amendment.');
        return json(await amendmentDetail(id, stage, aid));
      }
      default:
        return fail('Unknown request.');
    }
  } catch (err) {
    return errorResponse(err);
  }
}
