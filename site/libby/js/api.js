// Calls this site's own /api routes (Cloudflare Pages Functions).
import { setLDPeers } from './ui.js';

let forceRefresh = false;
/** While on, every read asks the server for fresh data instead of the saved copy (the "Refresh now" button turns it on for one page load). */
export const setForceRefresh = (on) => { forceRefresh = !!on; };

export async function api(path, { passive = false, ...options } = {}) {
  // `passive` is for background polling (the live panel), which must never trigger a refresh of the saved data.
  const fresh = forceRefresh && !passive && (options.method || 'GET').toUpperCase() === 'GET';
  const res = await fetch(`/api/libby/${path}`, {
    ...options,
    ...(fresh ? { cache: 'reload' } : {}), // skip the browser's own copy too
    headers: { accept: 'application/json', ...(fresh ? { 'x-refresh': '1' } : {}), ...(options.body && !(options.body instanceof FormData) ? { 'content-type': 'application/json' } : {}) }, // a FormData upload sets its own multipart type
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if ((res.status === 401 && data && data.login) || (res.status === 403 && data && data.noAccess)) {
    // The sign-in has ended or the access was withdrawn (for example a shared code was switched off): reload to show the right screen.
    location.reload();
    return new Promise(() => {});
  }
  if (!res.ok) throw new Error((data && data.error) || `The server returned ${res.status}.`);
  if (data && Array.isArray(data.ldPeers)) setLDPeers(data.ldPeers);
  return data;
}

let peersLoaded = null;
/** Make sure the Lib Dem peer list is loaded before highlighting names. */
export function ensureLDPeers() {
  if (!peersLoaded) peersLoaded = api('ld-peers').then(setLDPeers).catch(() => {});
  return peersLoaded;
}
