// Shared helpers used by every Cloudflare Pages Function.

const UA = 'LIBBY/1.0 (Liberal Democrat Lords Whips Office)';

/** JSON response with optional browser/edge cache lifetime (seconds). */
export function json(data, { status = 200, maxAge = 0 } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store',
    },
  });
}

export function errorResponse(err, status = 502) {
  console.error(err);
  return json({ error: String(err && err.message ? err.message : err) }, { status });
}

/** fetch() with a user agent, timeout and a readable error. */
export async function getJSON(url, { timeout = 15000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}${new URL(url).pathname}`);
  return res.json();
}

export async function getText(url, { timeout = 15000 } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,*/*' },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}${new URL(url).pathname}`);
  return res.text();
}

/**
 * Memoise an async producer in Cloudflare's edge cache.
 * Note: the Cache API is a no-op on *.pages.dev preview hosts; it works on a custom domain.
 */
export async function cached(ctx, key, ttlSeconds, producer) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const req = new Request(`https://cache.internal/v1/${encodeURIComponent(key)}`);
  if (cache) {
    const hit = await cache.match(req);
    if (hit) return hit.json();
  }
  const data = await producer();
  if (cache) {
    const res = new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlSeconds}` },
    });
    const put = cache.put(req, res);
    if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  }
  return data;
}

/** Like Promise.all(items.map(fn)) but with at most `limit` running at once (kind to the source, and to Cloudflare's connection limit). */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Run a promise but return a fallback instead of throwing (keeps pages partially working). */
export async function safe(promise, fallback = null) {
  try { return await promise; } catch (e) { console.warn('safe():', e.message); return fallback; }
}

/** Case-insensitive property lookup: Parliament APIs mix PascalCase and camelCase. */
export function pick(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
    const lower = k.toLowerCase();
    for (const actual of Object.keys(obj)) if (actual.toLowerCase() === lower) return obj[actual];
  }
  return undefined;
}

/** Today's date in London as YYYY-MM-DD. */
export function londonToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

/** Minutes since midnight, London time. */
export function londonMinutesNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

export function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', pound: '£', bull: '•', middot: '·' };

export function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Crude but dependable HTML → text, preserving line structure and list bullets. */
export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n* ')
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article|ul|ol|table)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map((l) => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lowercase, strip punctuation — for fuzzy title matching. */
export function norm(s) {
  return String(s || '').toLowerCase().replace(/\[hl\]/g, '').replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Normalise a peer's name for matching ("The Baroness Brinton" → "baroness brinton"). */
export function normPeer(name) {
  return norm(String(name || '').replace(/^the\s+/i, '').replace(/\s+(CBE|OBE|MBE|KC|QC|PC|DBE|KBE|CH)\b.*$/i, ''));
}

/**
 * Where to look for the Commons debate behind a statement / urgent question: the search words, the start of the
 * date window (14 days before), and the Hansard search page to fall back on. Needs no network call.
 */
export function hansardQuery(title, dateIso) {
  const from = new Date(`${dateIso}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 14);
  const start = from.toISOString().slice(0, 10);
  const cleanTitle = String(title).replace(/[\u2018\u2019'"\u201C\u201D]/g, '').replace(/^(statement|uq|urgent question)\s*[:\u2013-]\s*/i, '').trim();
  const searchUrl = `https://hansard.parliament.uk/search/Debates?searchTerm=${encodeURIComponent(`"${cleanTitle}"`)}&house=Commons&startDate=${start}&endDate=${dateIso}`;
  return { start, cleanTitle, searchUrl };
}
