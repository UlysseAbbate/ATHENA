/* Shared email + password sign-in used by the Mall, Admin and Ulysse pages.
 * Usage: AuthUI.render(sb, hostElement)   -> shows Sign in / Create account / Forgot password
 *        AuthUI.watchRecovery(sb, hostElement) -> shows "set a new password" after a reset link
 *        AuthUI.changePassword(sb, hostElement) -> form for a signed-in user to change their password */
window.AuthUI = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = `.au{max-width:360px;margin:12vh auto;padding:0 16px;font:14px/1.5 var(--body,Arial,sans-serif);color:inherit}
    .au h2{font:800 1.5rem/1.1 var(--head,Arial,sans-serif);letter-spacing:-.02em;margin:0 0 18px;display:inline;background:linear-gradient(transparent 62%,var(--yellow,#FDBB30) 62% 92%,transparent 92%);padding:0 .12em;margin-left:-.12em}
    .au .seg{display:flex;gap:4px;margin:18px 0 6px;border:0}
    .au .seg button{border:0;background:none;color:inherit;opacity:.6;padding:6px 12px 6px 0;font:700 .9rem var(--head,Arial,sans-serif);cursor:pointer;border-bottom:3px solid transparent;border-radius:0}
    .au .seg button.on{opacity:1;border-color:var(--yellow-deep,#F5A100)}
    .au label{display:block;font-size:12px;font-weight:600;opacity:.7;margin:12px 0 3px}
    .au input{width:100%;padding:9px 11px;border:1px solid var(--line-strong,#BDBAB0);background:var(--card,transparent);color:inherit;font:inherit;border-radius:8px}
    .au input:focus{outline:none;border-color:var(--black,#111);box-shadow:0 0 0 3px rgba(253,187,48,.55)}
    .au button.go{margin-top:18px;padding:.55rem 1.2rem;border:1px solid var(--black,#111);background:var(--black,#111);color:var(--yellow,#FDBB30);font:700 .92rem var(--head,Arial,sans-serif);cursor:pointer;border-radius:10px}
    .au button.go:hover{background:#2a2a2a}
    .au .msg{margin-top:14px;font-size:13px}.au .msg.err{color:#C62828}.au a{color:inherit;text-decoration-color:var(--yellow-deep,#F5A100)}`;
  function style() { if (!document.getElementById("au-css")) { const s = document.createElement("style"); s.id = "au-css"; s.textContent = css; document.head.append(s); } }

  function render(sb, host, opts = {}) {
    style();
    let mode = opts.mode || "in";
    const draw = () => {
      const up = mode === "up", reset = mode === "reset";
      host.innerHTML = `<div class="au"><h2>${esc(opts.title || "SIGN IN")}</h2>
        <div class="seg"><button data-m="in" class="${mode === "in" ? "on" : ""}">Sign in</button><button data-m="up" class="${up ? "on" : ""}">Create account</button></div>
        <form id="auf">${up ? '<label for="aun">Your name</label><input id="aun" autocomplete="name" required>' : ""}
        <label for="aue">Email</label><input id="aue" type="email" required autocomplete="email">
        ${reset ? "" : `<label for="aup">Password${up ? " (at least 8 characters)" : ""}</label><input id="aup" type="password" required minlength="${up ? 8 : 1}" autocomplete="${up ? "new-password" : "current-password"}">`}
        <button class="go">${reset ? "Send reset link" : up ? "Create account" : "Sign in"}</button></form>
        ${mode === "in" ? '<p class="msg"><a href="#" data-m="reset">Forgot password?</a></p>' : ""}
        ${reset ? '<p class="msg"><a href="#" data-m="in">Back to sign in</a></p>' : ""}<div id="aum" class="msg"></div></div>`;
      host.querySelectorAll("[data-m]").forEach(b => b.onclick = e => { e.preventDefault(); mode = b.dataset.m; draw(); });
      const say = (t, err) => { const m = host.querySelector("#aum"); m.textContent = t; m.className = "msg" + (err ? " err" : ""); };
      host.querySelector("#auf").onsubmit = async e => {
        e.preventDefault();
        const email = host.querySelector("#aue").value.trim(), pw = host.querySelector("#aup")?.value;
        say("Working…");
        if (reset) {
          const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
          return say(error ? error.message : "If that address has an account, a reset link is on its way.", !!error);
        }
        if (up) {
          const name = host.querySelector("#aun").value.trim();
          const { data, error } = await sb.auth.signUp({ email, password: pw, options: { data: { full_name: name } } });
          if (error) return say(error.message, true);
          if (data.session) return location.reload();
          if (data.user && data.user.identities && data.user.identities.length === 0) return say("That email already has an account. Use Sign in.", true);
          return say("Account created. Check your email to confirm it, then sign in.");
        }
        const { error } = await sb.auth.signInWithPassword({ email, password: pw });
        if (error) return say(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message, true);
        location.reload();
      };
    };
    draw();
  }

  function setPasswordForm(sb, host, title, done) {
    style();
    host.innerHTML = `<div class="au"><h2>${esc(title)}</h2><form id="auf"><label for="aup">New password (at least 8 characters)</label>
      <input id="aup" type="password" required minlength="8" autocomplete="new-password"><button class="go">Save password</button></form><div id="aum" class="msg"></div></div>`;
    host.querySelector("#auf").onsubmit = async e => {
      e.preventDefault();
      const { error } = await sb.auth.updateUser({ password: host.querySelector("#aup").value });
      const m = host.querySelector("#aum");
      if (error) { m.textContent = error.message; m.className = "msg err"; } else { m.textContent = "Password updated."; setTimeout(done, 800); }
    };
  }
  const watchRecovery = (sb, host) => sb.auth.onAuthStateChange(ev => { if (ev === "PASSWORD_RECOVERY") setPasswordForm(sb, host, "SET A NEW PASSWORD", () => { history.replaceState(null, "", location.pathname); location.reload(); }); });
  const changePassword = (sb, host, done) => setPasswordForm(sb, host, "CHANGE PASSWORD", done || (() => location.reload()));
  return { render, watchRecovery, changePassword };
})();
