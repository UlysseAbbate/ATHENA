// Hash-based router: #/today, #/bill/4035, #/policy?q=carers ...
// Hash URLs need no server configuration and can be bookmarked and shared.
// Which pages exist, where they sit in the menu and who may open them is all in pages.js: this file just follows that list.
// Keep this file plain ASCII (no curly quotes or dashes).

import { ensureLDPeers, setForceRefresh } from './api.js';
import { todayIso, errorBox } from './ui.js';
import { setLevel, hasLevel, currentLevel, currentHouse } from './session.js';
import { PAGES, MENU, HOUSES, menuFor, tabsFor, placeOf, canOpenPage, inHouse, GROUPS } from './pages.js';
import { chosenEdition, chooseEdition, renderGate } from './gate.js';
import { applyHouse, savedHouse, renderHouseSwitch, setMembers } from './house-switch.js';

const app = document.getElementById('app');
let renderToken = 0;

// The menu is rebuilt for the signed-in level once it is known; until then the page's own menu is hidden so it cannot flash.
const topnavAtStart = document.querySelector('.topnav');
if (topnavAtStart) topnavAtStart.style.visibility = 'hidden';

/** The menu for this person's level. */
function buildMenu() {
  const nav = document.querySelector('.topnav');
  if (!nav) return;
  nav.innerHTML = menuFor(currentLevel(), currentHouse()).map((m) => '<a href="' + m.href + '" data-nav="' + m.id + '">' + m.label + '</a>').join('');
  nav.style.visibility = '';
}

/** The row of buttons above a subpage: its group's pages, with this one marked. Hidden if there is only one to show. */
function renderSubnav(group, tab) {
  let box = document.getElementById('subnav');
  if (!box) {
    box = document.createElement('div');
    box.id = 'subnav';
    box.className = 'subnav';
    app.insertAdjacentElement('beforebegin', box);
  }
  const tabs = group ? tabsFor(group, currentLevel(), currentHouse()) : [];
  if (tabs.length < 2) { box.innerHTML = ''; return; }
  const hub = MENU.find((x) => x.id === group); // the group's own page: the label links to it
  box.innerHTML = '<div class="subnav-inner"><a class="subnav-label" href="' + (hub ? hub.href : '#/') + '">' + GROUPS[group].title + '</a>'
    + tabs.map((t) => '<a class="button ' + (t.tab === tab ? '' : 'button-quiet') + '" href="' + t.href + '"' + (t.tab === tab ? ' aria-current="page"' : '') + '>' + t.label + '</a>').join('')
    + '</div>';
}

/** The Commons / Lords buttons at the top of Today and Business (and the pages under them). */
function drawHouseSwitch(show) {
  let box = document.getElementById('houseswitch');
  if (!box) {
    box = document.createElement('div');
    box.id = 'houseswitch';
    box.className = 'houseswitch';
    app.insertAdjacentElement('beforebegin', box);
  }
  renderHouseSwitch(box, show, () => { buildMenu(); route(); });
}

/** The two rows between the header and the page, created once and in this order: the subpage tabs, then the House button. */
function slots() {
  if (!document.getElementById('subnav')) { const b = document.createElement('div'); b.id = 'subnav'; b.className = 'subnav'; app.insertAdjacentElement('beforebegin', b); }
  if (!document.getElementById('houseswitch')) { const b = document.createElement('div'); b.id = 'houseswitch'; b.className = 'houseswitch'; app.insertAdjacentElement('beforebegin', b); }
}

async function route() {
  slots();
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  const ctx = { today: todayIso(), query };
  const token = ++renderToken;

  let page = null;
  let m = null;
  for (const p of PAGES) {
    const r = path.match(p.match);
    if (r) { page = p; m = r; break; }
  }
  const place = page ? placeOf(page, m, ctx) : { menu: '', group: '', tab: '' };

  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.toggleAttribute('aria-current', a.dataset.nav === place.menu);
    if (a.hasAttribute('aria-current')) a.setAttribute('aria-current', 'page');
  });

  // Only Today and Business (and the pages under them) have a House: there the whole page is green (Commons) or red (Lords). Every other page is orange.
  const ofOneHouse = !!(page && page.switch);
  if (ofOneHouse) document.documentElement.dataset.house = currentHouse(); else delete document.documentElement.dataset.house;
  setMembers(ofOneHouse);
  drawHouseSwitch(ofOneHouse);

  if (!page) {
    renderSubnav('', '');
    app.innerHTML = '<header class="page-head"><h1>Page not found</h1><p class="lede">That address does not match a section. <a href="#/">Go to the home page</a>.</p></header>';
    return;
  }
  if (!inHouse(page, currentHouse())) {   // a link to the other House's LIBBY
    renderSubnav('', '');
    const other = currentHouse() === 'commons' ? 'lords' : 'commons';
    app.innerHTML = '<header class="page-head"><h1>' + HOUSES[other].name + '</h1><p class="lede">This page is in ' + HOUSES[other].name + ' (' + HOUSES[other].house + '). <button type="button" class="linkish" id="go-other">Switch to it</button> or <a href="#/">go to the home page</a>.</p></header>';
    document.getElementById('go-other').addEventListener('click', () => { applyHouse(other); buildMenu(); route(); });
    return;
  }
  if (!canOpenPage(page, currentLevel(), currentHouse())) {
    renderSubnav('', '');
    app.innerHTML = '<header class="page-head"><h1>Not available</h1><p class="lede">Your access level does not include this page. <a href="#/">Go to the home page</a>.</p></header>';
    return;
  }

  renderSubnav(place.group, place.tab);
  app.innerHTML = '';
  window.scrollTo(0, 0);
  try {
    await ensureLDPeers();
    if (token !== renderToken) return;
    let mod;
    try {
      mod = await import('./views/' + page.view); // the page's file is loaded only when it is opened
    } catch (err) {
      throw new Error('This page could not be loaded (' + err.message + '). Check that public/js/views/' + page.view + ' exists.');
    }
    if (token !== renderToken) return;
    await mod[page.fn](app, page.params ? page.params(m, ctx) : {}, query, () => token !== renderToken);
    const h1 = app.querySelector('h1');
    document.title = h1 ? h1.textContent + ' - LIBBY' : 'LIBBY';
  } catch (err) {
    if (token === renderToken) app.innerHTML = errorBox(err);
  }
}

/** The foot of the page: who is signed in, the Developer version button (for people with developer access), Team & access (the administrator's alone) and Sign out.
 *  The Theme button sits in the same foot (index.html). */
function showWho(name, { developer, edition }) {
  const foot = document.querySelector('.foot');
  if (!foot) return;
  foot.insertAdjacentHTML('beforeend', '<p class="small">Signed in as ' + name + '. <a href="../">Athena home</a>'
    + (developer ? ' &middot; <button type="button" class="linkish" id="switch-edition">' + (edition === 'developer' ? 'Back to the Beta test' : 'Developer version') + '</button>'
      + ' &middot; <button type="button" class="linkish" id="foot-team">Team &amp; access</button>' : '')
    + ' &middot; <button type="button" class="linkish" id="logout">Sign out</button></p>');
  document.getElementById('switch-edition')?.addEventListener('click', () => { chooseEdition(edition === 'developer' ? '' : 'developer'); location.hash = '#/'; location.reload(); });
  document.getElementById('foot-team')?.addEventListener('click', () => { location.hash = '#/team'; });
  document.getElementById('logout').addEventListener('click', async () => {
    chooseEdition('');
    try { await LibbyAuth.signOut(); } catch (e) { /* reload anyway */ }
    location.reload();
  });
}

/** Sign-in and no-access screens (the menu is hidden: there is nothing to open yet). */
function plainScreen(html) {
  const nav = document.querySelector('.topnav');
  if (nav) nav.style.visibility = 'hidden';
  app.innerHTML = html;
}

/* ------------------------------------------------------------ freshness line and "Refresh now" */

const LONDON = { timeZone: 'Europe/London' };
const clock = (d) => d.toLocaleTimeString('en-GB', { ...LONDON, hour: '2-digit', minute: '2-digit' });

/** "12:02", or "Thu 22 Oct, 18:02" if it was not today. */
function whenText(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x) => x.toLocaleDateString('en-CA', LONDON);
  if (day(d) === day(new Date())) return clock(d);
  return d.toLocaleDateString('en-GB', { ...LONDON, weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + clock(d);
}

/** The line at the foot: when the saved Parliament data was last renewed, when it next is, and the button to renew it now. */
async function showFreshness(justRefreshed) {
  let box = document.getElementById('freshness');
  const foot = document.querySelector('.foot');
  if (!box && foot) {
    foot.insertAdjacentHTML('beforeend', '<p class="small" id="freshness"></p>');
    box = document.getElementById('freshness');
  }
  if (!box) return;
  let st = null;
  try {
    const res = await fetch('/api/libby/status', { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (res.ok) st = await res.json();
  } catch (e) { /* the line is a convenience: leave it as it was */ }
  if (!st) return;
  const next = st.next ? String(st.next.hour).padStart(2, '0') + ':00' + (st.next.tomorrow ? ' tomorrow' : '') : '';
  const failed = st.lastRun && st.lastRun.failed && st.lastRun.failed.length ? st.lastRun.failed.length : 0;
  box.innerHTML = (st.updated
    ? 'Parliament data ' + (justRefreshed ? 'refreshed just now' : 'last updated ' + whenText(st.updated)) + (next ? ' &middot; next automatic update ' + next : '')
    : 'Parliament data is being looked up live (no saved copy yet)')
    + ' &middot; <button type="button" class="linkish" id="refresh-now">Refresh now</button>'
    + (window.RefreshAll ? ' &middot; ' + window.RefreshAll.html : '')
    + (failed ? ' <span class="muted">(' + failed + ' lookup' + (failed === 1 ? '' : 's') + ' failed on the last update, so some older data may be shown)</span>' : '');
  document.getElementById('refresh-now').addEventListener('click', refreshNow);
}

let refreshing = false;
/** Redraw the page you are on with fresh data: every read it makes asks the server to look the data up again. */
async function refreshNow() {
  if (refreshing) return;
  refreshing = true;
  const btn = document.getElementById('refresh-now');
  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing...'; }
  setForceRefresh(true);
  try { await route(); } finally { setForceRefresh(false); refreshing = false; }
  showFreshness(true);
}

async function start() {
  const session = await LibbyAuth.ready();
  if (!session) { app.innerHTML = ''; AuthUI.render(LibbyAuth.sb, app, { title: 'Sign in to LIBBY' }); return; }
  applyHouse(savedHouse());
  try {
    const res = await fetch('/api/libby/me', { headers: { accept: 'application/json' } });
    if (res.status === 401) { await LibbyAuth.signOut(); location.reload(); return; }
    const me = await res.json();
    const signOut = async () => { chooseEdition(''); await LibbyAuth.signOut(); location.reload(); };
    // Everyone goes straight to the Beta test. Someone with no LIBBY access yet is asked for the beta access code. A person with developer access
    // gets a button in the foot to open the developer version.
    if (res.status === 403) {
      plainScreen('');
      renderGate(app, { me, token: session.access_token, onEnter: () => { location.hash = '#/'; location.reload(); }, signOut });
      return;
    }
    const developer = me.level === 'developer';
    const edition = developer && chosenEdition() === 'developer' ? 'developer' : 'beta';
    // The Beta test shows a developer everything except the developer-only pages (the Developer page and work in progress).
    setLevel(developer ? (edition === 'developer' ? 'developer' : 'admin') : me.level);
    showWho(String((me.email ? me.email + ' (' + (me.name || me.level) + ')' : me.name || me.level)).replace(/[<>&]/g, ''), { developer, edition });
  } catch (e) { /* if this fails the pages show only read-only options */ }
  buildMenu();
  window.addEventListener('hashchange', route);
  route();
  showFreshness();
  setInterval(() => { if (!document.hidden && !refreshing) showFreshness(); }, 10 * 60 * 1000);
}
start();
