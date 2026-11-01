// The front door of LIBBY is the Beta test: everyone with LIBBY access goes straight in. Someone signed in with no LIBBY access yet comes here, to type the
// beta access code (once; it is then on their account). A person with developer access opens the developer version from a button in the foot of the page.
const KEY = 'libbyEdition';

export const chosenEdition = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
export const chooseEdition = (e) => { try { if (e) sessionStorage.setItem(KEY, e); else sessionStorage.removeItem(KEY); } catch { /* the tab just asks again */ } };

const clean = (s) => String(s || '').replace(/[<>&"]/g, '');

/** Draw the code box into `el`. `me` is what /api/libby/me said (email); `token` is the Athena session token; `onEnter` is called once the code has been accepted. */
export function renderGate(el, { me, token, onEnter, signOut }) {
  el.innerHTML = `
    <header class="page-head"><h1>Beta test</h1>
      <p class="lede">Liberal Intelligence for Business, Briefings and Year-round policy. Type the beta access code to come in.</p></header>
    <div class="gate">
      <section class="gate-card" aria-labelledby="g-beta">
        <h2 id="g-beta">Beta access code</h2>
        <form data-code autocomplete="off">
          <label class="field"><span>Beta access code</span><input type="password" name="code" required minlength="8" maxlength="200" autocomplete="off"></label>
          <p><button class="button" type="submit">Open the beta test</button> <span class="small" data-status role="status" aria-live="polite"></span></p>
        </form>
      </section>
    </div>
    <p class="small muted">Signed in as ${clean(me.email)}. <button type="button" class="linkish" data-signout>Sign out</button></p>`;
  el.querySelector('[data-signout]').addEventListener('click', signOut);
  const form = el.querySelector('[data-code]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = form.querySelector('[data-status]');
    status.textContent = 'Checking\u2026';
    try {
      const res = await fetch('/api/claim-code', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: form.elements.code.value }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { status.textContent = d.error || 'That did not work.'; return; }
      onEnter();   // the page starts again, now with the beta level on the account
    } catch { status.textContent = 'Could not reach the server. Try again.'; }
  });
}
