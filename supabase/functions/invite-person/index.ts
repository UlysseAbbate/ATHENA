import { createClient } from "npm:@supabase/supabase-js@2";

// Called from the Access page by a signed-in administrator or program manager (verify_jwt is on).
//   {email, program, level, expires?, send?}   invite someone by email
// The database function invite_person (run as the caller, so its rules apply: you may only invite to programs you manage, up to the level you may give) either gives access at once, if the
// email already has an account, or keeps the invite. For a new email this function then asks Supabase to send the invite email, which makes the account; the invite becomes their access
// when the account exists (the apply_invites trigger). If the email cannot be sent the invite is still kept: the person can simply create an account with that email.
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  let b: { email?: string; program?: string; level?: string; expires?: string | null; send?: boolean; redirectTo?: string };
  try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!email || !b.program || !b.level) return json({ error: "Give an email, a program and a level." }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data, error } = await asCaller.rpc("invite_person", { p_email: email, p_program: b.program, p_level: b.level, p_expires: b.expires || null });
  if (error) return json({ error: error.message }, 400);
  if (data === "granted") return json({ status: "granted" });

  let emailed = false, note = "";
  if (b.send !== false) {
    const origin = req.headers.get("origin") ?? "";
    const redirectTo = b.redirectTo && origin && b.redirectTo.startsWith(origin) ? b.redirectTo : undefined;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { error: e2 } = await admin.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined);
    if (e2) note = e2.message; else emailed = true;
  }
  return json({ status: "invited", emailed, note });
});
