// GET /api/ld-peers          the names of the current Liberal Democrat peers (for yellow highlighting in the UI).
// GET /api/ld-peers?detail=1 the list the site is using, for checking: each peer's id, name and party, as the Members API
//                            gives them, plus anything that looks wrong (see "check"). The list is the Members API's current
//                            Lords members of party 17, refreshed once a day.
import { json, errorResponse, normPeer } from '../../../lib/libby/util.js';
import { ldPeers, isLDParty } from '../../../lib/libby/parliament.js';

export async function onRequestGet(ctx) {
  try {
    const peers = await ldPeers(ctx);
    if (new URL(ctx.request.url).searchParams.get('detail') !== '1') return json(peers.map((p) => p.name), { maxAge: 86400 });

    const sorted = [...peers].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    // Peers whose party is not Liberal Democrat should never be on this list.
    const notLibDem = sorted.filter((p) => p.party && !isLDParty(p.party)).map((p) => `${p.name} (${p.party})`);
    // Two Lib Dem peers with the same short name (e.g. "Lord Wallace"): only matters when a list gives a bare name.
    const byShort = {};
    for (const p of sorted) (byShort[normPeer(p.name).replace(/ of .*$/, '')] ||= []).push(p.name);
    const sharedShortName = Object.values(byShort).filter((l) => l.length > 1);
    return json({
      count: peers.length,
      check: {
        notLibDem: notLibDem.length ? notLibDem : 'none: every peer on the list is a Liberal Democrat',
        sharedShortName: sharedShortName.length ? sharedShortName : 'none',
        missingId: sorted.filter((p) => !p.id).map((p) => p.name),
      },
      peers: sorted.map((p) => ({ id: p.id, name: p.name, party: p.party || '(not given)' })),
    }, { maxAge: 0 });
  } catch (err) {
    return errorResponse(err);
  }
}
