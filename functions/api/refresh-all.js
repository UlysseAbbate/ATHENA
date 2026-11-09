// POST /api/refresh-all  -> starts the "Run everything" workflow on GitHub (every action on the site: LOVELACE, LUCIEN and LIBBY data).
// The button at the foot of every page calls this. Anyone signed in to Athena may press it; it does nothing if a run is already going.
// Needs (Cloudflare Pages -> Settings -> Variables): GITHUB_TOKEN, a fine-grained token for the repository with "Actions: read and write";
// optional GITHUB_REPO (default UlysseAbbate/ATHENA) and GITHUB_REF (default main). SUPABASE_URL etc. are used to check the sign-in.

import { json } from '../../lib/libby/util.js';
import { identityFromRequest, AuthUnavailable } from '../../lib/libby/identity.js';

const WORKFLOW = 'run-all.yml';

export async function onRequestPost({ request, env }) {
  let who;
  try { who = await identityFromRequest(request, env); } catch (e) {
    if (e instanceof AuthUnavailable) return json({ error: 'The sign-in service cannot be reached. Try again in a minute.' }, { status: 503 });
    throw e;
  }
  if (!who) return json({ error: 'Please sign in to refresh the data.' }, { status: 401 });
  if (!env.GITHUB_TOKEN) return json({ error: 'The refresh button is not set up yet: the site needs a GITHUB_TOKEN setting.' }, { status: 503 });

  const repo = env.GITHUB_REPO || 'UlysseAbbate/ATHENA';
  const gh = (path, init = {}) => fetch(`https://api.github.com/repos/${repo}/${path}`, {
    ...init, signal: AbortSignal.timeout(10000),
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.GITHUB_TOKEN}`, 'user-agent': 'athena-site', 'x-github-api-version': '2022-11-28', ...init.headers } });

  try {
    // already going? (queued or running): do not start a second one
    for (const status of ['in_progress', 'queued']) {
      const r = await gh(`actions/workflows/${WORKFLOW}/runs?status=${status}&per_page=1`);
      if (r.ok && (await r.json()).total_count > 0) return json({ started: false, running: true, message: 'The update is already running. It takes a few minutes.' }, { status: 200 });
    }
    const res = await gh(`actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: env.GITHUB_REF || 'main' }) });
    if (res.status !== 204) return json({ error: `GitHub would not start the update (${res.status}).` }, { status: 502 });
    return json({ started: true, message: 'The update has started. It takes a few minutes; reload the page afterwards.' }, { status: 200 });
  } catch {
    return json({ error: 'GitHub cannot be reached. Try again in a minute.' }, { status: 502 });
  }
}
