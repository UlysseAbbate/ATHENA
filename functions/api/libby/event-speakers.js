// GET /api/libby/event-speakers?id=<What's On event id>
// The speakers list for a Lords debate, from the What's On API: who is down to speak, in order, with their party, and which of them are
// Liberal Democrats. The business page shows it under the item when "Speakers" is pressed.
import { json, errorResponse, getJSON } from '../../../lib/libby/util.js';
import { ldPeers, ldMatcher } from '../../../lib/libby/parliament.js';

const WHATSON = 'https://whatson-api.parliament.uk';

export async function onRequestGet(ctx) {
  const id = Number(new URL(ctx.request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'Pass ?id=<event id>.' }, { status: 400 });
  try {
    const [list, peers] = await Promise.all([
      getJSON(`${WHATSON}/calendar/events/speakers.json?queryParameters.house=Lords&queryParameters.eventId=${id}`),
      ldPeers(ctx).catch(() => []),
    ]);
    const isLD = ldMatcher(peers);
    const speakers = (Array.isArray(list) ? list : []).map((s) => ({
      name: s.Name || '', party: s.Party || '', colour: /^[0-9a-f]{6}$/i.test(s.PartyColour || '') ? s.PartyColour : '',
      order: s.SpeakingOrder || 0, ld: isLD({ id: s.MemberId, name: s.Name, party: s.Party }),
    })).filter((s) => s.name).sort((a, b) => a.order - b.order);
    return json({ id, speakers, ldCount: speakers.filter((s) => s.ld).length }, { maxAge: 300 });
  } catch (err) {
    return errorResponse(err);
  }
}
