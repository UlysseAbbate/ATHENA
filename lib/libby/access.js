// Access for LIBBY. People sign in once to Athena; their LIBBY level (Peer, Whip, Spokesperson, Leader's office, Staff, Admin)
// is a row in the access_grants table, given by the admin or a LIBBY program manager on the Access page, or comes from a
// shared access code. Who may use which page and which /api route is not written here: it is read from the page list in
// site/libby/js/pages.js, so a new page and its access rule are added in one place.

import { RANK, LEVEL_NAMES, ROLE_ORDER, WHIPS_FEATURES, BACKCHANNEL, BETA, DEVELOPER, atLeast, requiredLevel, betaMay, isRestricted, liveMay } from '../../site/libby/js/pages.js';
import { identityFromRequest } from './identity.js';

export { RANK, LEVEL_NAMES, ROLE_ORDER, WHIPS_FEATURES, BACKCHANNEL, BETA, DEVELOPER, atLeast, requiredLevel, betaMay, isRestricted, liveMay };

/** The level on a request's sign-in ('' if signed out, no LIBBY access, or the sign-in service is unreachable). */
export async function levelFromRequest(request, env) {
  try {
    const who = await identityFromRequest(request, env);
    return who && RANK[who.level] ? who.level : '';
  } catch {
    return '';
  }
}
