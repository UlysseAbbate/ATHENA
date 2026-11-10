#!/usr/bin/env node
// Renews the saved copies of the slow Parliament lookups (see lib/snapshots.js), so that nobody has to wait for them.
// Run by .github/workflows/refresh-data.yml six times a day (times: lib/schedule.js), or by hand:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/build-snapshots.mjs
//
// It does not repeat any logic: it calls the same lookups and the same /api routes the website uses, with "refresh" switched on,
// and the routes save what they find. One lookup failing does not stop the others; it is retried, and if it still fails the
// old saved copy stays in place and the run ends with a red cross naming what failed.
// Run the What's On / Forthcoming Business ingest BEFORE this (the workflow does), so the saved days and portfolios use it.

import { londonToday, addDays } from '../../lib/libby/util.js';
import { SAVED_DAYS_AHEAD, SAVED_FUTURE_LENGTHS } from '../../lib/libby/schedule.js';
import { writeSnapshot } from '../../lib/libby/snapshots.js';
import { PORTFOLIOS } from '../../lib/libby/portfolios.js';
import { secondaryForBill } from '../../lib/libby/act-instruments.js';
import { activeLordsBills, activeBills, billTypes, ldPeers, departments, allCommittees, recentLordsReports, billStagesMany, billPortfolios, previousBills, openInstruments } from '../../lib/libby/parliament.js';
import { onRequestGet as dayRoute } from '../../functions/api/libby/day/[date].js';
import { onRequestGet as futureRoute } from '../../functions/api/libby/future.js';
import { onRequestGet as portfolioRoute } from '../../functions/api/libby/portfolios/[code].js';
import { onRequestGet as pastRoute } from '../../functions/api/libby/past/[kind].js';
import { onRequestGet as votesRoute } from '../../functions/api/libby/data/votes.js';
import { onRequestGet as dashboardsRoute } from '../../functions/api/libby/data/lords.js';

const env = process.env;
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

const started = Date.now();
const today = londonToday();
const failed = [];

/**
 * What the lookups are given: refresh on (look it up live), strict (an error is an error, not "use the old copy").
 * `only` narrows the refresh to saved copies whose name starts with one of these, so the shared lookups, renewed first,
 * are not redone by every finished page that uses them.
 */
const context = (path = '/', params = {}, only = null) => ({
  env, params, refresh: true, refreshOnly: only, strict: true,
  request: new Request(`https://site.invalid${path}`, { headers: { 'x-refresh': '1' } }),
});

/** Run one step, trying up to three times; record it as failed if it never works. */
async function step(name, fn) {
  const t0 = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await fn();
      console.log(`ok      ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      return;
    } catch (err) {
      console.warn(`attempt ${attempt} of ${name} failed: ${err.message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }
  console.error(`FAILED  ${name}`);
  failed.push(name);
}

const PAGE_COPIES = ['day:', 'future:', 'portfolio:', 'past:', 'data:', 'lords-dashboards']; // the finished pages

/** Call one of the website's own /api routes and insist on a good answer. */
async function route(handler, path, params) {
  const res = await handler(context(path, params, PAGE_COPIES));
  if (!res.ok) throw new Error(`${path} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/* ---- the shared lookups */
await step('bill types', () => billTypes(context()));
await step('Bills in the Lords', () => activeLordsBills(context()));
await step('Bills in the Commons', () => activeBills(context(), 'Commons'));
await step('previous Bills (Acts)', () => previousBills(context()));
await step('secondary legislation of recent Acts', async () => {
  const recent = (await previousBills(context())).slice(0, 12);   // the instruments under the Acts most recently passed (commencement and powers, from legislation.gov.uk)
  for (const b of recent) await secondaryForBill(context(), b.id);
});
await step('statutory instruments', () => openInstruments(context()));
await step('Lib Dem peers', () => ldPeers(context()));
await step('departments', () => departments(context()));
await step('Bill portfolios', async () => {
  const tags = await billPortfolios(context());
  const bills = [...await activeLordsBills({ env }), ...await activeBills({ env }, 'Commons')];
  const byDefault = bills.filter((b) => tags[b.id]?.by === 'default').map((b) => b.title);
  const untagged = bills.filter((b) => !tags[b.id]?.codes?.length).map((b) => b.title);
  console.log(`        ${bills.length} Bills tagged; ${byDefault.length} placed by default (add them to lib/portfolio-overrides.js): ${byDefault.join('; ') || 'none'}`);
  if (untagged.length) throw new Error(`Bills with no portfolio: ${untagged.join('; ')}`);
});
await step('committees', () => allCommittees(context()));
await step('committee reports', () => recentLordsReports(context(), addDays(today, -180)));

/* ---- the stages of every Bill (for the "date of next stage" column), a few at a time */
await step('Bill stages', async () => {
  const bills = await activeLordsBills({ env }); // the copy just saved
  const ids = bills.map((b) => b.id);
  const problems = [];
  for (let i = 0; i < ids.length; i += 8) {
    const batch = ids.slice(i, i + 8);
    const { failed: bad } = await billStagesMany(context('/', {}, ['bill-stages:']), batch, batch.length);
    problems.push(...bad);
  }
  if (problems.length) throw new Error(`no stages for Bills ${problems.join(', ')}`);
});

/* ---- finished pages */
for (let i = 0; i <= SAVED_DAYS_AHEAD; i++) {
  const date = addDays(today, i);
  await step(`day ${date}`, () => route(dayRoute, `/api/day/${date}`, { date }));
}
for (const days of SAVED_FUTURE_LENGTHS) await step(`future ${days} days`, () => route(futureRoute, `/api/future?days=${days}`));
for (const p of PORTFOLIOS) await step(`portfolio ${p.code}`, () => route(portfolioRoute, `/api/portfolios/${p.code}`, { code: p.code }));

const monthOf = (iso) => iso.slice(0, 7);
const lastMonth = new Date(`${monthOf(today)}-01T12:00:00Z`);
lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
for (const [kind, query] of [['votes', ''], ['questions', ''], ['questions', '&ld=1'], ['statements', '']]) {
  await step(`past ${kind}${query}`, () => route(pastRoute, `/api/past/${kind}?skip=0&q=${query}`, { kind }));
}
for (const month of [monthOf(today), lastMonth.toISOString().slice(0, 7)]) {
  await step(`Hansard ${month}`, () => route(pastRoute, `/api/past/hansard?month=${month}`, { kind: 'hansard' }));
}
await step('voting data', () => route(votesRoute, '/api/data/votes'));
await step('Lords Library dashboards', () => route(dashboardsRoute, '/api/data/lords'));

/* ---- tidy up: copies nobody has renewed for two weeks belong to Bills / days / months that no longer matter */
await step('remove old copies', async () => {
  const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/api_snapshots?updated_at=lt.${encodeURIComponent(cutoff)}`, {
    method: 'DELETE',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
});

/* ---- leave a note of how the run went, for the line at the foot of the site */
const seconds = Math.round((Date.now() - started) / 1000);
await writeSnapshot(env, 'meta:refresh', { at: new Date().toISOString(), seconds, failed }).catch((err) => console.warn(`could not write the run note: ${err.message}`));

console.log(`\nFinished in ${seconds}s. ${failed.length ? `${failed.length} step(s) failed: ${failed.join(', ')}` : 'Everything was renewed.'}`);
process.exit(failed.length ? 1 : 0);
