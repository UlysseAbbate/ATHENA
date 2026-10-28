// The front door of LIBBY, in two steps, shown to everyone who is signed in:
//   1. which LIBBY: Honourable LIBBY (the House of Commons, green) or Noble LIBBY (the House of Lords, red)
//   2. Beta test or Developer:
//   Beta test   the Data page. Opens with the beta access code (typed once; it is then on the person's account).
//   Developer   everything, including work in progress. Only the administrator can open it.
// Both choices are remembered for the browser tab (sessionStorage); the links in the footer come back here.
const KEY = 'libbyEdition';
const HOUSE_KEY = 'libbyHouse';

export const chosenHouse = () => { try { const h = sessionStorage.getItem(HOUSE_KEY); return h === 'commons' || h === 'lords' ? h : ''; } catch { return ''; } };
export const chooseHouse = (h) => { try { if (h) sessionStorage.setItem(HOUSE_KEY, h); else sessionStorage.removeItem(HOUSE_KEY); } catch { /* the tab just asks again */ } };

/** Step 1: which House. */
export function renderHouseGate(el, { me, onEnter, signOut }) {
  el.innerHTML = `
    <header class="page-head"><h1>LIBBY</h1>
      <p class="lede">Liberal Intelligence for Business, Briefings and Year-round policy. Which House?</p></header>
    <div class="gate gate-houses">
      <button type="button" class="house-card house-commons" data-house="commons">
        <span class="house-name">Honourable LIBBY</span><span class="house-sub">House of Commons</span>
        <span class="house-text">Today\u2019s business, legislation and amendments, coming and past business, with Lib Dem MPs marked.</span></button>
      <button type="button" class="house-card house-lords" data-house="lords">
        <span class="house-name">Noble LIBBY</span><span class="house-sub">House of Lords</span>
        <span class="house-text">Today\u2019s business, legislation and amendments, the Whips\u2019 Office tools and the data.</span></button>
    </div>
    <p class="small muted">Signed in as ${clean(me.email)}. <button type="button" class="linkish" data-signout>Sign out</button></p>`;
  el.querySelectorAll('[data-house]').forEach((b) => b.addEventListener('click', () => { chooseHouse(b.dataset.house); onEnter(); }));
  el.querySelector('[data-signout]').addEventListener('click', signOut);
}

export const chosenEdition = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
export const chooseEdition = (e) => { try { if (e) sessionStorage.setItem(KEY, e); else sessionStorage.removeItem(KEY); } catch { /* the tab just asks again */ } };

const clean = (s) => String(s || '').replace(/[<>&"]/g, '');

/** Draw the gate into `el`. `me` is what /api/libby/me said (level, email); `token` is the Athena session token; `onEnter` is called after a choice. */
export function renderGate(el, { me, token, onEnter, signOut, houseName = 'LIBBY', betaOpen = true, onBack }) {
  const level = me.level || '';
  const isDeveloper = level === 'developer';
  const hasBeta = !!level;   // any LIBBY level includes the beta pages
  el.innerHTML = `
    <header class="page-head"><h1>${clean(houseName)}</h1>
      <p class="lede">Choose how to open it. ${onBack ? '<button type="button" class="linkish" data-back>Choose the other House</button>' : ''}</p></header>
    <div class="gate">
      <section class="gate-card" aria-labelledby="g-beta">
        <h2 id="g-beta">Beta test</h2>
        <p>The Data page: voting analysis and the House of Lords Library data dashboards.</p>
        ${!betaOpen ? '<p><button type="button" class="button" disabled aria-disabled="true">Beta test</button> <span class="small muted">Not in the beta yet.</span></p>'
          : hasBeta ? '<p><button type="button" class="button" data-enter="beta">Open the beta</button></p>' : `
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
  el.querySelector('[data-back]')?.addEventListener('click', onBack);
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
