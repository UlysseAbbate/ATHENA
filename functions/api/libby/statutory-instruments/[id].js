// GET /api/libby/statutory-instruments/:id — one statutory instrument: who laid it, its procedure and dates, the Acts it is made under, its stages (the steps in
// each House) and documents (the SI website's pages, and committee reports and correspondence that mention it).
import { json, errorResponse, safe, cached } from '../../../../lib/libby/util.js';
import { statutoryInstrumentDetail } from '../../../../lib/libby/parliament.js';
import { instrumentReports } from '../../../../lib/libby/si-reports.js';

export async function onRequestGet(ctx) {
  const id = String(ctx.params.id || '');
  if (!/^[0-9a-f-]{8,40}$/i.test(id)) return json({ error: 'Unknown instrument.' }, { status: 400 });
  try {
    const out = await cached(ctx, `si-${id}`, 1800, async () => {
      const si = await statutoryInstrumentDetail(id);
      const reports = await safe(instrumentReports(si.name), []);
      return { ...si, reports };
    });
    return json(out, { maxAge: 600 });
  } catch (err) {
    return errorResponse(err);
  }
}
