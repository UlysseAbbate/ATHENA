// Shared by the routes that write data or spend money (adviser editor, comments, drafting, grids).
// The check is now the signed-in ticket and level (see lib/access.js), not a passcode typed with each request.

import { json } from './util.js';
import { levelFromRequest, requiredLevel, atLeast } from './access.js';

const sha256 = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

/** Compare two secrets without leaking how much of them matched. */
export async function sameSecret(a, b) {
  const [x, y] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * Returns an error Response if the request's sign-in is missing or its level is too low for this route, otherwise null.
 * (The front door in functions/_middleware.js checks the same rule; this is a second check inside each route.)
 */
export async function passcodeProblem(request, env) {
  const level = await levelFromRequest(request, env);
  if (!level) return json({ error: 'Please sign in.', login: true }, { status: 401 });
  const need = requiredLevel(request.method, new URL(request.url).pathname);
  if (!atLeast(level, need)) return json({ error: 'Your access level does not allow this.' }, { status: 403 });
  return null;
}

/** One line of plain text: no control characters, collapsed spaces, length-capped. */
export const cleanLine = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Several lines of text: keeps line breaks, drops other control characters, length-capped. */
export const cleanBlock = (s, max) => String(s ?? '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
