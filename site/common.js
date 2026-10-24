/* Shared by every Athena page: one Supabase client, escaping helpers and "who am I / what may I see".
 * Nothing here is a security boundary: row-level security in the database decides what each person can read or write. */
window.Athena = (() => {
  const sb = window.supabase.createClient(window.MALL_CONFIG.url, window.MALL_CONFIG.key,
    { auth: { persistSession: true, detectSessionInUrl: true } });
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = u => { try { const p = new URL(u); return /^https?:$/.test(p.protocol) ? p.href : null; } catch { return null; } };
  function ago(iso) {
    if (!iso) return "never";
    const h = (Date.now() - new Date(iso)) / 36e5;
    if (h < 1) return "just now"; if (h < 24) return `${Math.floor(h)}h ago`;
    const d = Math.floor(h / 24); return d === 1 ? "yesterday" : `${d}d ago`;
  }
  /* One round trip: {session, profile, role, admin, perms: {resource: {r, w}}} or null when signed out.
   * `role` is null when no role has been given yet or the person's access date has passed. */
  async function access() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const { data, error } = await sb.rpc("my_access");
    if (error) throw error;
    return { session, ...data, perms: data.perms || {} };
  }
  const may = (acc, res, act = "r") => !!(acc && (acc.admin || acc.perms?.[res]?.[act]));
  const notFound = () => { document.body.innerHTML = '<main style="text-align:center;padding-top:20vh;font:14px system-ui">Not found</main>'; };
  return { sb, esc, safeUrl, ago, access, may, notFound };
})();
