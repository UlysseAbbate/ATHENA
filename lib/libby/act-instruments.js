// Secondary legislation for one Bill: once a Bill has become an Act, which of its sections have been brought into force by a commencement instrument and which
// have had their powers used by other instruments (see legislation-gov.js). Kept as a saved copy per Bill (renewed with the other saved copies at 6am and 6pm);
// the scheduled job reads more instruments than a live request does.
import { bill as billById } from './parliament.js';
import { pick } from './util.js';
import { snapshotted } from './snapshots.js';
import { findAct, actCommencement, instrumentsMadeUnder, parseContents, buildTracker, getText } from './legislation-gov.js';

const LEG = 'https://www.legislation.gov.uk';

export async function secondaryForBill(ctx, billId) {
  return snapshotted(ctx, `secondary-${billId}`, 12 * 3600, async () => {
    const b = await billById(billId);
    const title = pick(b, 'shortTitle') || '';
    if (!pick(b, 'isAct')) return { billId, isAct: false, title };
    const sittings = (pick(pick(b, 'currentStage') || {}, 'stageSittings') || []).map((x) => String(pick(x, 'date') || '').slice(0, 4)).filter(Boolean);
    const year = Number(sittings[sittings.length - 1] || String(pick(b, 'lastUpdate') || '').slice(0, 4)) || new Date().getFullYear();
    const act = await findAct(title, year);
    if (!act) return { billId, isAct: true, title, act: null };
    const live = !(ctx && ctx.strict);   // a live request reads fewer instruments (a Pages Function may only make so many requests); the job reads them all
    const [contents, commencement, madeUnder] = await Promise.all([
      getText(`${LEG}/${act.type}/${act.year}/${act.number}/contents/data.xml`, 45000),
      actCommencement(act, { maxPages: live ? 3 : 8 }).catch(() => []),
      instrumentsMadeUnder(act, { limit: live ? 15 : 80 }).catch(() => []),
    ]);
    return { billId, isAct: true, title, ...buildTracker(act, parseContents(contents), commencement, madeUnder), partial: live, updated: new Date().toISOString() };
  });
}
