import { createClient } from "npm:@supabase/supabase-js@2";

// Called by the GitHub Actions collector. Authenticates with a shared secret (INGEST_TOKEN), not a user JWT.
//   {name, body}                       store one of the three Ulysse blobs
//   {action: "get", name}              read one back (the collector's memory of first-seen times between runs)
//   {action: "coverage", rows: [...]}  add new Sarah Olney coverage to Lovelace's Media trackers (existing URLs are left untouched)
//   {action: "social_posts", rows: [...]}  add posts found on the tracked social accounts to the Social Media Channels Tracker (rows: organisation, platform, posted_on, summary, url)
//   {action: "london_data", rows: [...]}  add the London data drops, ONS releases and GLA meetings to Lovelace's Daily Plan (rows: key, date, title, url, starts, section)
//   {action: "membership_events", rows: [...]}  add the Lib Dem London events to Lovelace's Daily Plan, under Internal Campaign > Membership Engagement (rows: key, date, title, url, starts)
//   {action: "parliament_events", rows: [...]}  add the UK Parliament What's On events to Lovelace's Daily Plan, under London Politics > Political Events (rows: key, date, title, url, starts)
//   {action: "archive", rows: [...]}   keep items in LUCIEN's permanent archive (table lucien_archive); {action: "archive_status"} says how many committee items it holds
//   {action: "econ_data", rows: [...]}  load economic statistics (Nomis) into the table econ_data; {action: "econ_status"} says when they were last loaded
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
// Removes the untouched entries (nobody has edited them) of one feed from today on that the feed no longer carries. Done by id, in small groups, so long lists never make a long web address.
// deno-lint-ignore no-explicit-any
async function dropStale(sb: any, prefix: string, keep: Set<string>) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await sb.from("day_plan_entries").select("id,auto_key").like("auto_key", `${prefix}%`).gte("plan_date", today).is("updated_by", null).limit(5000);
  const stale = (data ?? []).filter((r: { id: string; auto_key: string }) => !keep.has(r.auto_key)).map((r: { id: string }) => r.id);
  for (let i = 0; i < stale.length; i += 100) await sb.from("day_plan_entries").delete().in("id", stale.slice(i, i + 100));
}

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
    await dropStale(sb, "statscal:", new Set(rows.map(r => r.auto_key)));
    return json({ ok: true, added: data?.length ?? 0 });
  }

  // Events the collector reads from public calendars, filed on their day in Lovelace's Daily Plan, once each. An entry nobody has edited that the calendar no longer carries
  // (a date moved, an event cancelled) is removed; one a person has edited (or moved to another section) stays.
  //   membership_events: the Liberal Democrats' London events (events.libdems.org.uk)   -> Internal Campaign > Membership Engagement
  //   parliament_events: the UK Parliament What's On calendar (whatson-api.parliament.uk) -> London Politics > Political Events
  const DAY_EVENTS: Record<string, { area: string; section: string; prefix: string; link: RegExp }> = {
    membership_events: { area: "internal", section: "membership", prefix: "libdemev:", link: /^https:\/\/events\.libdems\.org\.uk\// },
    parliament_events: { area: "london", section: "political", prefix: "whatson:", link: /^https:\/\/whatson\.parliament\.uk\// },
  };
  const feed = payload.action ? DAY_EVENTS[payload.action] : undefined;
  if (feed) {
    if (!Array.isArray(payload.rows)) return json({ error: "bad request" }, 400);
    const rows = payload.rows.slice(0, MAX_COVERAGE).map((r: Record<string, unknown>) => ({
      plan_date: /^\d{4}-\d{2}-\d{2}$/.test(String(r?.date)) ? String(r.date) : null, area: feed.area, section: feed.section,
      title: str(r?.title, 400), starts: str(r?.starts, 40) || null, link: feed.link.test(str(r?.url, 1000)) ? str(r?.url, 1000) : null, auto_key: str(r?.key, 160),
    })).filter(r => r.plan_date && r.title && r.auto_key.startsWith(feed.prefix));
    if (!rows.length) return json({ ok: true, added: 0 });
    const { data, error } = await sb.from("day_plan_entries").upsert(rows, { onConflict: "auto_key", ignoreDuplicates: true }).select("id");
    if (error) return json({ error: error.message }, 500);
    await dropStale(sb, feed.prefix, new Set(rows.map(r => r.auto_key)));
    return json({ ok: true, added: data?.length ?? 0 });
  }

  // LUCIEN's permanent archive: everything the collector finds is kept here for good (the live feed keeps 180 days). Rows are stored once per id; a later run refreshes the title, summary and date.
  if (payload.action === "archive") {
    if (!Array.isArray(payload.rows)) return json({ error: "bad request" }, 400);
    const CATS = new Set(["committee", "thinktank", "media", "polling"]);
    const rows = payload.rows.slice(0, 1000).map((r: Record<string, unknown>) => {
      const { id, category, source, title, url, published, first_seen, summary, tags, ...rest } = (r ?? {}) as Record<string, unknown>;
      return {
        id: str(id, 64), category: str(category, 20), source: str(source, 200), title: str(title, 400), url: str(url, 1000),
        published: typeof published === "string" && !isNaN(Date.parse(published)) ? new Date(published).toISOString() : null,
        first_seen: typeof first_seen === "string" && !isNaN(Date.parse(first_seen)) ? new Date(first_seen).toISOString() : new Date().toISOString(),
        summary: str(summary, 2000) || null, tags: Array.isArray(tags) ? tags.slice(0, 20).map((t) => str(t, 80)).filter(Boolean) : [], item: rest,
      };
    }).filter((r) => r.id && CATS.has(r.category) && r.source && r.title && /^https?:\/\//.test(r.url));
    if (!rows.length) return json({ ok: true, stored: 0 });
    const { error } = await sb.from("lucien_archive").upsert(rows, { onConflict: "id" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, stored: rows.length });
  }
  // What the archive holds, so the collector knows whether the committees' history still has to be loaded.
  if (payload.action === "archive_status") {
    const { count, error } = await sb.from("lucien_archive").select("id", { count: "exact", head: true }).eq("category", "committee");
    if (error) return json({ error: error.message }, 500);
    const { data } = await sb.from("lucien_archive").select("published").eq("category", "committee").not("published", "is", null).order("published", { ascending: true }).limit(1);
    return json({ ok: true, committees: count ?? 0, oldest_committee: data?.[0]?.published ?? null });
  }

  // LUCIEN > Economic policy: open official statistics (Nomis) in one long table, so a figure can be cross-referenced by area, age and sex.
  if (payload.action === "econ_data") {
    if (!Array.isArray(payload.rows)) return json({ error: "bad request" }, 400);
    const DS = new Set(["aps_labour", "claimants", "ashe", "gdhi", "census_econ"]);
    const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
    const rows = payload.rows.slice(0, 1000).map((r: Record<string, unknown>) => ({
      id: str(r?.id, 40), dataset: str(r?.dataset, 30), geography_code: str(r?.geography_code, 20), geography_name: str(r?.geography_name, 80),
      geography_level: ["uk", "country", "region"].includes(String(r?.geography_level)) ? String(r.geography_level) : "region",
      sex: ["all", "male", "female"].includes(String(r?.sex)) ? String(r.sex) : "all",
      age_from: num(r?.age_from), age_to: num(r?.age_to), age_label: str(r?.age_label, 40) || null,
      category: str(r?.category, 200), measure: str(r?.measure, 200), unit: str(r?.unit, 20), value: num(r?.value),
      period: str(r?.period, 60), source_url: /^https:\/\/www\.nomisweb\.co\.uk\//.test(str(r?.source_url, 500)) ? str(r?.source_url, 500) : null, fetched_at: new Date().toISOString(),
    })).filter((r) => r.id && DS.has(r.dataset) && r.geography_code && r.category && r.measure && r.unit && r.value !== null && r.period);
    if (!rows.length) return json({ ok: true, stored: 0 });
    const { error } = await sb.from("econ_data").upsert(rows, { onConflict: "id" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, stored: rows.length });
  }
  // When the economic data was last loaded (it changes monthly or less, so the collector reloads it about weekly).
  if (payload.action === "econ_status") {
    const { data, error } = await sb.from("econ_data").select("fetched_at").order("fetched_at", { ascending: false }).limit(1);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, last_fetched: data?.[0]?.fetched_at ?? null });
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
