// Who is signed in, and what they may see (the browser's side; the server has its own check in lib/access.js). The site's front door (the sign-in page) sets the level;
// the server enforces it on every request, so these helpers only decide what to SHOW.
// The old passcode boxes have gone: the functions below keep their names so the pages that use them still work.
import { RANK, WHIPS_FEATURES } from './pages.js'; // the levels, and the one switch for the Whips' Office features, live in pages.js

const NAME = 'adviserEditor';

let level = '';
export const setLevel = (l) => { level = RANK[l] ? l : ''; };
export const currentLevel = () => level;

// Which LIBBY: 'lords' (Noble LIBBY) or 'commons' (Honourable LIBBY). Chosen at the front door; pages ask it to read the right House.
let house = 'lords';
export const setHouse = (h) => { house = h === 'commons' ? 'commons' : 'lords'; };
export const currentHouse = () => house;
/** True if the signed-in person is at least this level ('peers', 'whips', 'staff' or 'admin'; Spokesperson and Leader's office count as 'whips'). Pages ask can('whips') for the Whips' Office features. */
export const can = (need) => (RANK[level] || 0) >= (RANK[need === 'whips' ? WHIPS_FEATURES : need] || 0);

/** True if the signed-in person's level is at least this one, taken literally (used for pages meant for Whips, such as Data). */
export const hasLevel = (need) => (RANK[level] || 0) >= (RANK[need] || 0);

const get = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: ask again next time */ } };

const attr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** A placeholder: the server ignores it and uses the sign-in instead. Non-empty when the person may make changes. */
export const savedPasscode = () => (can('whips') ? 'signed-in' : '');
export const savedName = () => get(NAME);
export const rememberAuth = (_passcode, name) => { if (name) set(NAME, name); };
export const forgetPasscode = () => {};

/** Just the name box (so comments and changes show who made them). */
export function authFieldsHtml() {
  return `<label class="field field-narrow"><span>Your name</span><input type="text" name="author" maxlength="80" value="${attr(savedName())}" autocomplete="name"></label>`;
}

/** Read the name from a form built with authFieldsHtml(). */
export function readAuth(form) {
  return { passcode: savedPasscode(), author: (form.querySelector('input[name="author"]')?.value || '').trim() };
}

/** Kept for the pages that call it; a sign-in problem is handled centrally (the page reloads to the sign-in screen). */
export function reopenPasscode() {}
