import { createClient } from "npm:@supabase/supabase-js@2";

// Called by the GitHub Actions collector. Authenticates with a shared secret (INGEST_TOKEN), not a user JWT.
//   {name, body}                       store one of the three Ulysse blobs
//   {action: "get", name}              read one back (the collector's memory of first-seen times between runs)
//   {action: "coverage", rows: [...]}  add new Sarah Olney coverage to Lovelace's Media trackers (existing URLs are left untouched)
//   {action: "social_posts", rows: [...]}  add posts found on the tracked social accounts to the Social Media Channels Tracker (rows: organisation, platform, posted_on, summary, url)
//   {action: "london_data", rows: [...]}  add the London data drops, ONS releases and GLA meetings to Lovelace's Daily Plan (rows: key, date, title, url, starts, section)
//   {action: "social_accounts"}        the tracked social accounts that have a handle set, for the collector to follow
const ALLOWED = new Set(["feed", "polls", "health", "statscal"]);
const MAX_BYTES = 5_000_000;
const MAX_COVERAGE = 600;

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const expected = Deno.env.get("INGEST_TOKEN") ?? "";
  const given = req.headers.get("x-ingest-token") ?? "";
  if (expected.length < 24 || !safeEqual(given, expected)) return json({ error: "unauthorised" }, 401);

  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.length > MAX_BYTES) return json({ error: "too large" }, 413);
  let payload: { action?: string; name?: string; body?: unknown; rows?: unknown };
  try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return json({ error: "bad json" }, 400); }
  if (!payload || typeof payload !== "object") return json({ error: "bad request" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  if (payload.action === "get") {
    if (!payload.name || !ALLOWED.has(payload.name)) return json({ error: "bad request" }, 400);
    const { data, error } = await sb.from("ulysse_data").select("body,updated_at").eq("name", payload.name).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, name: payload.name, body: data?.body ?? null, updated_at: data?.updated_at ?? null });
  }

  if (payload.action === "social_accounts") {
    const { data, error } = await sb.from("social_accounts").select("organisation,platform,handle,url").not("handle", "is", null);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, accounts: data ?? [] });
  }

  // Data, statistics and GLA meetings from the Stats calendar's collector: filed on the day in Lovelace's Daily Plan (London Politics > Data & Statistics, or Political Events), once each.
  // An entry nobody has edited and that the feed no longer carries (a date moved, a drop cancelled) is removed; one a person has edited stays.
  if (payload.action === "london_data") {
    if (!Array.isArray(payload.rows)) return json({ error: "bad request" }, 400);
    const rows = payload.rows.slice(0, MAX_COVERAGE).map((r: Record<string, unknown>) => ({
      plan_date: /^\d{4}-\d{2}-\d{2}$/.test(String(r?.date)) ? String(r.date) : null, area: "london", section: ["data", "political", "events"].includes(String(r?.section)) ? String(r.section) : "data",
      title: str(r?.title, 400), starts: str(r?.starts, 40) || null, link: /^https?:\/\//.test(str(r?.url, 1000)) ? str(r?.url, 1000) : null, auto_key: str(r?.key, 160),
    })).filter(r => r.plan_date && r.title && r.auto_key.startsWith("statscal:"));
    if (!rows.length) return json({ ok: true, added: 0 });
    const { data, error } = await sb.from("day_plan_entries").upsert(rows, { onConflict: "auto_key", ignoreDuplicates: true }).select("id");
    if (error) return json({ error: error.message }, 500);
    const today = new Date().toISOString().slice(0, 10);
    await sb.from("day_plan_entries").delete().like("auto_key", "statscal:%").gte("plan_date", today).is("updated_by", null)
      .not("auto_key", "in", `(${rows.map(r => `"${r.auto_key}"`).join(",")})`);
    return json({ ok: true, added: data?.length ?? 0 });
  }

  // Posts found on the tracked social accounts: kept against their account (Lovelace's Social Media Channels Tracker); a post is stored once per address.
  if (payload.action === "social_posts") {
    if (!Array.isArray(payload.rows)) return json({ error: "bad request" }, 400);
    const { data: accts, error: ae } = await sb.from("social_accounts").select("id,organisation,platform");
    if (ae) return json({ error: ae.message }, 500);
    const idOf = new Map((accts ?? []).map(a => [`${String(a.organisation).toLowerCase()}|${a.platform}`, a.id]));
    const rows = payload.rows.slice(0, MAX_COVERAGE).map((r: Record<string, unknown>) => ({
      account_id: idOf.get(`${str(r?.organisation, 200).toLowerCase()}|${str(r?.platform, 40)}`),
      posted_at: /^\d{4}-\d{2}-\d{2}$/.test(String(r?.posted_on)) ? `${r.posted_on}T12:00:00Z` : null,
      summary: str(r?.summary, 400), url: str(r?.url, 1000),
    })).filter(r => r.account_id && r.posted_at && r.summary && /^https?:\/\//.test(r.url));
    if (!rows.length) return json({ ok: true, added: 0 });
    const { data, error } = await sb.from("social_posts").upsert(rows, { onConflict: "url", ignoreDuplicates: true }).select("id");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, added: data?.length ?? 0 });
  }

  if (payload.action === "coverage") {
    if (!Array.isArray(payload.rows)) return json({ error: "bad request" }, 400);
    const rows = payload.rows.slice(0, MAX_COVERAGE).map((r: Record<string, unknown>) => ({
      covered_on: /^\d{4}-\d{2}-\d{2}$/.test(String(r?.covered_on)) ? String(r.covered_on) : null,
      outlet: str(r?.outlet, 120), headline: str(r?.headline, 400), url: str(r?.url, 1000), notes: str(r?.notes, 600) || null,
      source: r?.source === "social" ? "social" : "auto",
    })).filter(r => r.covered_on && r.outlet && r.headline && /^https?:\/\//.test(r.url));
    if (!rows.length) return json({ ok: true, added: 0 });
    // skip headlines already logged by hand (same outlet + headline, different URL)
    const since = rows.map(r => r.covered_on as string).sort()[0];
    const { data: existing } = await sb.from("media_coverage").select("outlet,headline").gte("covered_on", since);
    const seen = new Set((existing ?? []).map(e => `${e.outlet.toLowerCase()}|${e.headline.toLowerCase()}`));
    // (only for news: two social posts can share a first line, and the web address already tells them apart)
    const fresh = rows.filter(r => r.source === "social" || !seen.has(`${r.outlet.toLowerCase()}|${r.headline.toLowerCase()}`));
    if (!fresh.length) return json({ ok: true, added: 0 });
    const { data, error } = await sb.from("media_coverage").upsert(fresh, { onConflict: "url", ignoreDuplicates: true }).select("id");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, added: data?.length ?? 0 });
  }

  if (!payload.name || !ALLOWED.has(payload.name) || payload.body === undefined || payload.body === null || typeof payload.body !== "object")
    return json({ error: "bad request" }, 400);
  const { error } = await sb.from("ulysse_data").upsert({ name: payload.name, body: payload.body, updated_at: new Date().toISOString() });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, name: payload.name });
});
