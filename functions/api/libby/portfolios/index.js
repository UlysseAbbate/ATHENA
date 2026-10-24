// GET /api/portfolios — the list of portfolios (one per department tab of the dashboard).
import { json } from '../../../../lib/libby/util.js';
import { PORTFOLIOS } from '../../../../lib/libby/portfolios.js';

export async function onRequestGet() {
  return json(PORTFOLIOS.map(({ code, name }) => ({ code, name })), { maxAge: 86400 });
}
