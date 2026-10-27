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

/** Forthcoming Business rows ('fb') or Order Paper rows ('todays_list') for a date range, written by scripts/libby/ingest_lordsbusiness.py. */
export async function fbRows(env, from, to, source = 'fb') {
  const query = (cols) => `select=${cols}&source=eq.${source}&business_date=gte.${from}&business_date=lte.${to}&order=business_date.asc,position.asc`;
  const base = 'business_date,section,position,text,kind,dept';
  try {
    return await sbSelect(env, 'whips_business', query(`${base},member_id`));
  } catch (err) {
    if (/member_id/.test(String(err.message))) return sbSelect(env, 'whips_business', query(base));   // until the column exists
    throw err;
  }
}

/** The Lords' Order Paper rows for a date range (the same shape as Forthcoming Business). */
export const orderPaperRows = (env, from, to) => fbRows(env, from, to, 'todays_list');

/** whatson_events rows for a date range, populated by scripts/libby/ingest_whatson.py from the What's On API. */
export async function whatsonRows(env, house, from, to) {
  const base = 'event_date,section,start_time,category,title,members';
  const query = (cols) => `select=${cols}&house=eq.${house}&event_date=gte.${from}&event_date=lte.${to}&order=event_date.asc,position.asc`;
  // Newer columns first; a database that has not been given them yet is read with what it has.
  for (const cols of [`${base},event_url,speakers,event_id,end_time,location,bill_id,bill_name,committee`, `${base},event_url,speakers`, base]) {
    try {
      return await sbSelect(env, 'whatson_events', query(cols));
    } catch (err) {
      if (!/event_url|speakers|event_id|end_time|location|bill_id|bill_name|committee/.test(String(err.message)) || cols === base) throw err;
    }
  }
  return [];
}
