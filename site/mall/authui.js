/* Shared email + password sign-in used by the Mall, Admin and Ulysse pages.
 * Usage: AuthUI.render(sb, hostElement)   -> shows Sign in / Create account / Forgot password
 *        AuthUI.watchRecovery(sb, hostElement) -> shows "set a new password" after a reset link
 *        AuthUI.changePassword(sb, hostElement) -> form for a signed-in user to change their password */
window.AuthUI = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = `.au{max-width:340px;margin:12vh auto;padding:0 16px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:inherit}
    .au h2{font-size:13px;letter-spacing:.2em;font-weight:600;margin:0 0 18px}
    .au .seg{display:flex;gap:16px;margin-bottom:16px}
    .au .seg button{border:0;background:none;color:inherit;opacity:.55;padding:4px 0;font:inherit;cursor:pointer;border-bottom:1px solid transparent}
    .au .seg button.on{opacity:1;border-color:currentColor}
    .au label{display:block;font-size:12px;opacity:.65;margin:10px 0 3px}
    .au input{width:100%;padding:9px;border:1px solid #8886;background:transparent;color:inherit;font:inherit;border-radius:0}
    .au button.go{margin-top:16px;padding:9px 16px;border:1px solid currentColor;background:transparent;color:inherit;font:inherit;cursor:pointer}
    .au .msg{margin-top:14px;font-size:13px}.au .msg.err{color:#c0392b}.au a{color:inherit}`;
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
