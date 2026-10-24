// Tiny Supabase (PostgREST) client. Runs only on the server (Cloudflare Functions),
// so the service-role key never reaches the browser.

export function supabaseConfigured(env) {
  return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

const TIMEOUT_MS = 10000; // a slow database answers with an error instead of leaving the page waiting

function headers(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra,
  };
}

/** GET /rest/v1/{table}?{query} — `query` is a PostgREST query string. */
export async function sbSelect(env, table, query = '') {
  if (!supabaseConfigured(env)) return [];
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: headers(env), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Supabase ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** POST /rest/v1/rpc/{fn} */
export async function sbRpc(env, fn, args) {
  if (!supabaseConfigured(env)) throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: headers(env), body: JSON.stringify(args), signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Supabase rpc ${fn}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Upsert rows (merge on primary key / unique constraint). */
export async function sbUpsert(env, table, rows) {
  if (!supabaseConfigured(env)) return;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers(env, { prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Supabase upsert ${table}: ${res.status} ${await res.text()}`);
}

/** Forthcoming Business rows for a date range, written by scripts/ingest_whips.py. */
export async function fbRows(env, from, to) {
  return sbSelect(env, 'whips_business',
    `select=business_date,section,position,text,kind,dept&source=eq.fb&business_date=gte.${from}&business_date=lte.${to}&order=business_date.asc,position.asc`);
}

/** whatson_events rows for a date range, populated by scripts/ingest_whatson.py. */
export async function whatsonRows(env, house, from, to) {
  const base = 'event_date,section,start_time,category,title,members';
  const query = (cols) => `select=${cols}&house=eq.${house}&event_date=gte.${from}&event_date=lte.${to}&order=event_date.asc,position.asc`;
  try {
    return await sbSelect(env, 'whatson_events', query(`${base},event_url,speakers`));
  } catch (err) {
    // The two newer columns are added by add-whatson-links.sql; until it has been run, read without them.
    if (/event_url|speakers/.test(String(err.message))) return sbSelect(env, 'whatson_events', query(base));
    throw err;
  }
}
