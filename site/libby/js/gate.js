// The front door of LIBBY: two buttons, Beta test and Developer, shown to everyone who is signed in.
//   Beta test   the Data page. Opens with the beta access code (typed once; it is then on the person's account).
//   Developer   everything, including work in progress. Only the administrator can open it.
// The choice is remembered for the browser tab (sessionStorage); "Switch" in the footer comes back here.
const KEY = 'libbyEdition';

export const chosenEdition = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
export const chooseEdition = (e) => { try { if (e) sessionStorage.setItem(KEY, e); else sessionStorage.removeItem(KEY); } catch { /* the tab just asks again */ } };

const clean = (s) => String(s || '').replace(/[<>&"]/g, '');

/** Draw the gate into `el`. `me` is what /api/libby/me said (level, email); `token` is the Athena session token; `onEnter` is called after a choice. */
export function renderGate(el, { me, token, onEnter, signOut }) {
  const level = me.level || '';
  const isDeveloper = level === 'developer';
  const hasBeta = !!level;   // any LIBBY level includes the beta pages
  el.innerHTML = `
    <header class="page-head"><h1>LIBBY</h1>
      <p class="lede">Liberal Intelligence for Business, Briefings and Year-round policy. Choose how to open it.</p></header>
    <div class="gate">
      <section class="gate-card" aria-labelledby="g-beta">
        <h2 id="g-beta">Beta test</h2>
        <p>The Data page: voting analysis and the House of Lords Library data dashboards.</p>
        ${hasBeta ? '<p><button type="button" class="button" data-enter="beta">Open the beta</button></p>' : `
        <form data-code autocomplete="off">
          <label class="field"><span>Beta access code</span><input type="password" name="code" required minlength="8" maxlength="200" autocomplete="off"></label>
          <p><button class="button" type="submit">Unlock the beta</button> <span class="small" data-status role="status" aria-live="polite"></span></p>
        </form>`}
      </section>
      <section class="gate-card" aria-labelledby="g-dev">
        <h2 id="g-dev">Developer</h2>
        <p>Everything, and work in progress.</p>
        ${isDeveloper ? '<p><button type="button" class="button" data-enter="developer">Open the developer site</button></p>'
          : '<p><button type="button" class="button" disabled aria-disabled="true">Developer</button> <span class="small muted">Only the administrator can open this.</span></p>'}
      </section>
    </div>
    <p class="small muted">Signed in as ${clean(me.email)}. <button type="button" class="linkish" data-signout>Sign out</button></p>`;

  el.querySelectorAll('[data-enter]').forEach((b) => b.addEventListener('click', () => { chooseEdition(b.dataset.enter); onEnter(); }));
  el.querySelector('[data-signout]').addEventListener('click', signOut);
  const form = el.querySelector('[data-code]');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = form.querySelector('[data-status]');
    status.textContent = 'Checking…';
    try {
      const res = await fetch('/api/claim-code', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: form.elements.code.value }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { status.textContent = d.error || 'That did not work.'; return; }
      chooseEdition('beta');
      onEnter();   // the page starts again, now with the beta level on the account
    } catch { status.textContent = 'Could not reach the server. Try again.'; }
  });
}
