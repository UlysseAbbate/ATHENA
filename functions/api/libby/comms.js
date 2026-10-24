// The Comms page: the latest post from each of the team's social accounts.
//   GET  /api/comms     -> { platforms: [ { key, name, handle, url, post, note } ], notes: [] }
//   POST /api/comms     { platform, text, postUrl, postedAt, author }   (Whips and above; empty text clears it)
// Bluesky has a free public feed, so its latest post is read live (and cached for 10 minutes).
// X, Instagram and LinkedIn do not offer a free way to read a page's posts, so someone pastes in the
// latest post and it is stored in Supabase (table comms_posts).

import { json, errorResponse, safe, cached, getJSON } from '../../../lib/libby/util.js';
import { sbSelect, sbUpsert, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine, cleanBlock } from '../../../lib/libby/auth.js';

const BSKY_HANDLE = 'libdempeers.bsky.social';
const PLATFORMS = [
  { key: 'bluesky', name: 'Bluesky', handle: '@libdempeers.bsky.social', url: 'https://bsky.app/profile/libdempeers.bsky.social', hosts: ['bsky.app'] },
  { key: 'x', name: 'X', handle: '@libdempeers', url: 'https://x.com/libdempeers', hosts: ['x.com', 'twitter.com'] },
  { key: 'instagram', name: 'Instagram', handle: '@libdempeers', url: 'https://www.instagram.com/libdempeers/', hosts: ['instagram.com'] },
  { key: 'linkedin', name: 'LinkedIn', handle: 'Liberal Democrat Peers', url: 'https://www.linkedin.com/company/liberal-democrat-peers', hosts: ['linkedin.com'] },
];
const FAILED = 'failed'; // marks a Bluesky lookup that errored (as opposed to an account with no posts yet)
const byKey = Object.fromEntries(PLATFORMS.map((p) => [p.key, p]));

/** The account's most recent post of its own (not a repost), from Bluesky's public feed. */
async function blueskyLatest() {
  const data = await getJSON(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${BSKY_HANDLE}&filter=posts_no_replies&limit=15`);
  for (const item of data.feed || []) {
    if (item.reason) continue; // a repost
    const post = item.post;
    if (!post?.uri) continue;
    const handle = post.author?.handle || BSKY_HANDLE;
    return {
      text: cleanBlock(post.record?.text, 1500),
      url: `https://bsky.app/profile/${handle}/post/${post.uri.split('/').pop()}`,
      at: post.record?.createdAt || post.indexedAt || '',
      hasMedia: !!post.embed,
    };
  }
  return null;
}

export async function onRequestGet(ctx) {
  const { env } = ctx;
  try {
    const notes = [];
    const [live, rows] = await Promise.all([
      safe(cached(ctx, 'comms-bluesky', 600, blueskyLatest), FAILED),
      supabaseConfigured(env)
        ? sbSelect(env, 'comms_posts', 'select=platform,body,post_url,posted_at,updated_by,updated_at').catch((err) => { notes.push(`Saved posts could not be read (has the comms_posts table been created in Supabase?): ${err.message}`); return []; })
        : Promise.resolve([]),
    ]);
    const manual = Object.fromEntries(rows.map((r) => [r.platform, r]));

    const platforms = PLATFORMS.map((p) => {
      const m = manual[p.key];
      let post = null;
      let note = '';
      if (p.key === 'bluesky' && live && live !== FAILED) post = { ...live, source: 'live' };
      else {
        if (p.key === 'bluesky' && live === FAILED) note = 'Bluesky could not be reached just now.';
        if (m && (m.body || m.post_url)) post = { text: m.body || '', url: m.post_url || '', at: m.posted_at || '', source: 'manual', by: m.updated_by || '', savedAt: m.updated_at || '' };
      }
      return { key: p.key, name: p.name, handle: p.handle, url: p.url, auto: p.key === 'bluesky', post, note };
    });
    return json({ platforms, notes }, { maxAge: 0 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, { status: 400 }); }
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });
  const p = byKey[body.platform];
  if (!p) return json({ error: 'Unknown account.' }, { status: 400 });

  const text = cleanBlock(body.text, 1500);
  let postUrl = cleanLine(body.postUrl, 500);
  if (postUrl) {
    let u;
    try { u = new URL(postUrl); } catch { return json({ error: 'The post link is not a valid web address.' }, { status: 400 }); }
    const host = u.hostname.replace(/^www\./, '');
    if (u.protocol !== 'https:' || !p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return json({ error: `The post link should be an https address on ${p.hosts[0]}.` }, { status: 400 });
    }
    postUrl = u.href;
  }
  const postedAt = /^\d{4}-\d{2}-\d{2}$/.test(body.postedAt || '') ? body.postedAt : null;

  try {
    if (!text && !postUrl) {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/comms_posts?platform=eq.${p.key}`, {
        method: 'DELETE',
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, prefer: 'return=minimal' },
      });
      if (!res.ok) throw new Error(`Supabase comms_posts: ${res.status} ${await res.text()}`);
      return json({ ok: true, cleared: true });
    }
    await sbUpsert(env, 'comms_posts', [{
      platform: p.key, body: text, post_url: postUrl || null, posted_at: postedAt,
      updated_by: cleanLine(body.author, 80) || null, updated_at: new Date().toISOString(),
    }]);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
