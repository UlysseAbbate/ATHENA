// LIBBY's sign-in: the person signs in once to Athena (email and password, or a shared access code). Their session token is
// kept in a cookie for /api/libby only (so page links such as downloads carry it too) and renewed whenever it is refreshed.
// A classic script, loaded before app.js.
if (window.Theme) Theme.wire(document);   // the Auto / Light / Dark button in the masthead
window.LibbyAuth = (() => {
  const sb = Athena.sb;
  const COOKIE = "athena_at";
  const secure = location.protocol === "https:" ? "; Secure" : "";
  const put = s => { const life = Math.max(60, (s.expires_at || 0) - Math.floor(Date.now() / 1000)); document.cookie = `${COOKIE}=${encodeURIComponent(s.access_token)}; Path=/api/libby; Max-Age=${life}; SameSite=Lax${secure}`; };
  const clear = () => { document.cookie = `${COOKIE}=; Path=/api/libby; Max-Age=0; SameSite=Lax${secure}`; };
  /** The Athena session (or null), with the cookie brought up to date. */
  async function ready() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) put(session); else clear();
    sb.auth.onAuthStateChange((_ev, s) => { if (s) put(s); else clear(); });
    return session;
  }
  async function signOut() { clear(); await sb.auth.signOut(); }
  return { sb, ready, signOut };
})();
