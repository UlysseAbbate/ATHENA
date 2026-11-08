/* Shared email + password sign-in used by Athena, LOVELACE, LUCIEN, Access and Admin.
 * Usage: AuthUI.render(sb, hostElement)   -> shows Sign in / Create account / Access code / Forgot password
 *        (an access code is a shared password for a group: the server checks it at /api/code-login)
 *        AuthUI.watchRecovery(sb, hostElement) -> shows "set a new password" after a reset link
 *        AuthUI.changePassword(sb, hostElement) -> form for a signed-in user to change their password */
window.AuthUI = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = `.au{max-width:26rem;margin:6vh auto;padding:0 1.25rem;font:400 16px/1.5 var(--body,system-ui,sans-serif);color:inherit}
    .au h2{display:flex;align-items:center;gap:.4rem;font:800 clamp(1.7rem,6vw,2.2rem)/1.15 var(--head,system-ui,sans-serif);letter-spacing:-.045em;margin:0 0 .4rem}
    .au h2::before{content:'';width:.3em;height:.5em;background:var(--accent,#FF6400);clip-path:var(--diamond-cut,polygon(0 50%,74.6% 0,100% 17%,100% 83%,74.6% 100%));flex:none}
    .au .seg{display:flex;gap:1.2rem;margin:1.2rem 0 .8rem;border-bottom:1px solid var(--rule,#E7E9EE)}
    .au .seg button{border:0;border-bottom:2px solid transparent;background:none;color:var(--muted,#5B6270);padding:.35rem 0;margin-bottom:-1px;font:600 .92rem var(--head,system-ui,sans-serif);cursor:pointer}
    .au .seg button:hover{color:var(--ink,#11141C)}
    .au .seg button.on{color:var(--ink,#11141C);border-bottom-color:var(--accent,#FF6400)}
    .au form{padding:0}
    .au label{display:block;font-weight:600;font-size:.88rem;margin:1rem 0 .3rem}
    .au input{width:100%;padding:.55rem .75rem;border:1px solid var(--rule-strong,#C8CCD4);background:var(--card,#fff);color:inherit;font:inherit;border-radius:6px}
    .au input:focus{outline:none;border-color:var(--accent,#FF6400);box-shadow:0 0 0 2px var(--accent-line,#FFDAC1)}
    .au button.go{margin-top:1.2rem;padding:.55rem 1.3rem;border:1px solid var(--btn-bg,#11141C);background:var(--btn-bg,#11141C);color:var(--btn-fg,#fff);font:600 .95rem var(--head,system-ui,sans-serif);cursor:pointer;border-radius:6px}
    .au button.go:hover{background:var(--btn-hover-bg,#FF6400);border-color:var(--btn-hover-bg,#FF6400);color:var(--btn-hover-fg,#11141C)}
    .au .msg{margin-top:.9rem;font-size:.9rem}.au .msg.err{color:var(--err,#B3141C);font-weight:700}.au a{color:inherit;text-decoration-color:var(--rule-strong,#C8CCD4);text-decoration-thickness:1px;text-underline-offset:3px}`;
  function style() { if (!document.getElementById("au-css")) { const s = document.createElement("style"); s.id = "au-css"; s.textContent = css; document.head.append(s); } }

  function render(sb, host, opts = {}) {
    style();
    let mode = opts.mode || "in";
    const draw = () => {
      const up = mode === "up", reset = mode === "reset", code = mode === "code";
      host.innerHTML = `<div class="au"><h2>${esc(opts.title || "SIGN IN")}</h2>
        <div class="seg"><button data-m="in" class="${mode === "in" ? "on" : ""}">Sign in</button><button data-m="up" class="${up ? "on" : ""}">Create account</button>${opts.codes === false ? "" : `<button data-m="code" class="${code ? "on" : ""}">Access code</button>`}</div>
        <form id="auf">${code ? '<label for="auc">Access code</label><input id="auc" type="password" required autocomplete="off">' : ""}${up ? '<label for="aun">Your name</label><input id="aun" autocomplete="name" required>' : ""}
        ${code ? "" : '<label for="aue">Email</label><input id="aue" type="email" required autocomplete="email">'}
        ${reset || code ? "" : `<label for="aup">Password${up ? " (at least 8 characters)" : ""}</label><input id="aup" type="password" required minlength="${up ? 8 : 1}" autocomplete="${up ? "new-password" : "current-password"}">`}
        <button class="go">${reset ? "Send reset link" : up ? "Create account" : code ? "Continue" : "Sign in"}</button></form>
        ${mode === "in" ? '<p class="msg"><a href="#" data-m="reset">Forgot password?</a></p>' : ""}
        ${reset ? '<p class="msg"><a href="#" data-m="in">Back to sign in</a></p>' : ""}<div id="aum" class="msg"></div></div>`;
      host.querySelectorAll("[data-m]").forEach(b => b.onclick = e => { e.preventDefault(); mode = b.dataset.m; draw(); });
      const say = (t, err) => { const m = host.querySelector("#aum"); m.textContent = t; m.className = "msg" + (err ? " err" : ""); };
      host.querySelector("#auf").onsubmit = async e => {
        e.preventDefault();
        if (code) {
          say("Working…");
          try {
            const r = await fetch("/api/code-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: host.querySelector("#auc").value }) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) return say(d.error || "That did not work. Try again.", true);
            const { error } = await sb.auth.setSession({ access_token: d.access_token, refresh_token: d.refresh_token });
            if (error) return say(error.message, true);
            return location.reload();
          } catch { return say("Could not reach the server. Try again.", true); }
        }
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
