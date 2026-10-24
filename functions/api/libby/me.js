// GET /api/libby/me -> the signed-in person's LIBBY level (the page uses it to show or hide options).
import { json } from '../../../lib/libby/util.js';
import { identityFromRequest } from '../../../lib/libby/identity.js';
import { LEVEL_NAMES, RANK } from '../../../lib/libby/access.js';

export async function onRequestGet({ request, env }) {
  const who = await identityFromRequest(request, env).catch(() => null);
  if (!who) return json({ error: 'Please sign in.', login: true }, { status: 401 });
  if (!RANK[who.level]) return json({ error: 'You have not been given access to LIBBY.', noAccess: true, email: who.email }, { status: 403 });
  return json({ level: who.level, name: LEVEL_NAMES[who.level], email: who.email });
}
