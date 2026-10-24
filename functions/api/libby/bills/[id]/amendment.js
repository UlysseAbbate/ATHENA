// GET /api/bills/:id/amendment?stage=:billStageId&aid=:amendmentId
// Full text and Member's explanatory statement for one amendment (loaded on demand).

import { json, errorResponse } from '../../../../../lib/libby/util.js';
import { amendmentDetail } from '../../../../../lib/libby/parliament.js';

export async function onRequestGet({ params, request }) {
  const q = new URL(request.url).searchParams;
  const stage = Number(q.get('stage'));
  const aid = Number(q.get('aid'));
  if (!stage || !aid) return json({ error: 'Pass ?stage= and ?aid=.' }, { status: 400 });
  try {
    return json(await amendmentDetail(Number(params.id), stage, aid), { maxAge: 3600 });
  } catch (err) {
    return errorResponse(err);
  }
}
