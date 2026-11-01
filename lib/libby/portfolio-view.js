// The portfolio view: what the Lords has before it for one Government department area. Put together from several Parliament
// APIs, so the finished view is saved (lib/snapshots.js) and the scheduled job renews all of them.

import { safe, londonToday, addDays } from './util.js';
import { classifyPortfolios } from './portfolios.js';
import { activeLordsBillsTagged, billTypes, departments, statutoryInstruments, whatsOn, recentLordsReports } from './parliament.js';
import { sectionsFromWhatsOn, sectionsFromFB } from './business.js';
import { fbRows } from './supabase.js';

/** The view for one portfolio `p` (an entry of PORTFOLIO_BY_CODE). */
export async function buildPortfolio(ctx, p) {
  const { env } = ctx;
  const today = londonToday();
  const depts = await safe(departments(ctx), []);
  const lc = (s) => String(s).toLowerCase();
  const deptIds = depts.filter((d) => p.departments.some((n) => lc(d.name) === lc(n) || lc(d.name).includes(lc(n)))).map((d) => d.id);

  const [bills, types, sis, fb, events, reports] = await Promise.all([
    safe(activeLordsBillsTagged(ctx), []),
    safe(billTypes(ctx), []),
    deptIds.length
      ? Promise.all(deptIds.map((id) => safe(statutoryInstruments({ departmentId: id }), []))).then((a) => a.flat())
      : safe(statutoryInstruments({ take: 100 }), []).then((all) => all.filter((s) => classifyPortfolios(s.name).includes(p.code))),
    safe(fbRows(env, today, addDays(today, 56)), []),
    safe(whatsOn(today, addDays(today, 27), 'Lords', ctx), []),
    safe(recentLordsReports(ctx, addDays(today, -180)), []),
  ]);

  // Every Bill has a portfolio (lib/bill-tags.js), so this page and the Legislation page always agree.
  // ...and each is Government legislation or other legislation (Private Members' Bills and the rest), for the drop-down on the page.
  const typeName = Object.fromEntries(types.map((t) => [t.id, t.name]));
  const primary = bills.filter((b) => b.portfolios.includes(p.code))
    .map((b) => ({ ...b, category: /government/i.test(typeName[b.billTypeId] || '') ? 'government' : 'other' }));

  // Forthcoming Lords business in this portfolio (FB first, What's On for anything else).
  const seen = new Set();
  const forthcoming = [];
  const add = (date, item, source) => {
    if (!item.portfolios.includes(p.code) || item.kind === 'legislation') return;
    const key = `${date}|${item.title.toLowerCase().slice(0, 60)}`;
    if (seen.has(key)) return;
    seen.add(key);
    forthcoming.push({ date, kind: item.kind, title: item.title, detail: item.detail, source });
  };
  const fbByDate = {};
  for (const r of fb) (fbByDate[r.business_date] ||= []).push(r);
  for (const [date, rows] of Object.entries(fbByDate)) for (const s of sectionsFromFB(rows)) for (const i of s.items) add(date, i, 'Forthcoming Business');
  const evByDate = {};
  for (const e of events) (evByDate[e.date] ||= []).push(e);
  for (const [date, list] of Object.entries(evByDate)) for (const s of sectionsFromWhatsOn(list)) for (const i of s.items) add(date, i, "What's On");
  forthcoming.sort((a, b) => a.date.localeCompare(b.date));

  const committeeReports = reports
    .filter((r) => classifyPortfolios(`${r.title} ${r.committee}`).includes(p.code))
    .slice(0, 25);

  return {
    code: p.code,
    name: p.name,
    primaryLegislation: primary,
    secondaryLegislation: sis.map((s) => ({
      ...s,
      scheduled: forthcoming.find((f) => f.kind === 'si' && f.title.toLowerCase().includes(s.name.toLowerCase().slice(0, 40))) || null,
    })),
    forthcoming,
    committeeReports,
    policyLink: `#/policy?portfolio=${p.code}`,
    notes: deptIds.length ? [] : ['Department not found in the Members API reference list; legislation matched by keywords only.'],
  };
}
