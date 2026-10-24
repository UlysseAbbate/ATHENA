// The Lords Data part of the Data page: the House of Lords Library's data dashboards.
//   GET /api/data/lords                 -> { dashboards: [ { title, url, date, description } ] }
//   GET /api/data/lords?page=<url>      -> { embed, excel } for one dashboard (its Power BI report and spreadsheet)
// The list is read from https://lordslibrary.parliament.uk/type/data-dashboard/ (cached 12 hours), so new dashboards
// appear by themselves. If the Library cannot be reached, the dashboards known in October 2026 are listed instead.
// Whips and above only (lib/access.js).

import { json, errorResponse, getText, cached, decodeEntities } from '../../../../lib/libby/util.js';
import { snapshotted } from '../../../../lib/libby/snapshots.js';

const LIST = 'https://lordslibrary.parliament.uk/type/data-dashboard/';
const HOST = 'lordslibrary.parliament.uk';

const KNOWN = [
  ['House of Lords data dashboard: Current membership of the House', 'house-of-lords-data-dashboard-membership-of-the-house', 'The size of the House and breakdowns by party, gender, age and length of service.'],
  ['House of Lords data dashboard: Peerage creations', 'house-of-lords-data-dashboard-peerage-creations', 'The creation of life peerages.'],
  ['House of Lords data dashboard: Party and group strengths and voting', 'house-of-lords-data-dashboard-party-and-group-strengths-and-voting', 'The sizes of the largest parties and groups, and statistics on voting behaviour.'],
  ['Lords reform: Membership, attendance, voting and participation data (2019–2024 parliament)', 'lords-reform-membership-attendance-voting-and-participation-data-2019-2024-parliament', 'Member activity over the 2019–24 Parliament: attendance, votes, debates, written questions and roles.'],
  ['House of Lords data dashboard: Business and sittings of the House', 'house-of-lords-data-dashboard-business-and-sittings-of-the-house', 'The business of the House and the length of sittings.'],
  ['House of Lords: Largest votes and government defeats', 'house-of-lords-largest-votes-and-government-defeats', 'Divisions since 1999 in which 500 or more members voted, and government defeats.'],
  ['House of Lords data dashboard: Delegated legislation', 'house-of-lords-data-dashboard-delegated-legislation', 'Delegated legislation in the House of Lords.'],
  ['House of Lords data dashboard: Regional representation in the House of Lords', 'regional-representation-in-the-house-of-lords', 'Regional representation in the House of Lords.'],
].map(([title, slug, description]) => ({ title, url: `https://${HOST}/${slug}/`, date: '', description }));

const text = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const shortTitle = (t) => t.replace(/^House of Lords data dashboard:\s*/i, '').replace(/^House of Lords:\s*/i, '');

const humanise = (url) => {
  const t = String(url).replace(/^https:\/\/lordslibrary\.parliament\.uk\//, '').replace(/\/$/, '').replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * The dashboards listed on the Library's "Data dashboard" page, newest first.
 * Each heading link is read up to its OWN closing tag, so one dashboard can never swallow the next. A dashboard we
 * already know keeps its known title; a new one keeps the page's title, unless that is implausibly long.
 */
function parseList(html) {
  const out = [];
  const re = /<h[2-4][^>]*>\s*<a\b[^>]*?href="(https:\/\/lordslibrary\.parliament\.uk\/[^"#?]+\/)"[^>]*>((?:(?!<\/a>)[\s\S])*)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const url = m[1];
    if (/\/(type|topic|tag|research|category|resources|about-us|subscribe)\//.test(url) || out.some((d) => d.url === url)) continue;
    const tail = html.slice(re.lastIndex, re.lastIndex + 2000);
    const stop = tail.search(/<h[1-6][\s>]/i); // the next heading starts the next dashboard
    const after = stop >= 0 ? tail.slice(0, stop) : tail;
    const date = text((after.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+\d{1,2}\s+\w+,?\s+\d{4}/) || [''])[0]);
    const DATE_ONLY = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+\d{1,2}\s+\w+,?\s+\d{4}$/;
    const para = [...after.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((x) => text(x[1])).find((t) => t && !DATE_ONLY.test(t));
    const known = KNOWN.find((k) => k.url === url);
    const found = text(m[2]);
    const title = known ? known.title : (found && found.length <= 150 ? found : humanise(url));
    const description = para ? para.slice(0, 300) : (known ? known.description : '');
    out.push({ title, url, date, description });
  }
  return out;
}

/** The Power BI report and the Excel download on one dashboard page. */
function parsePage(html) {
  const clean = String(html).replace(/&amp;/g, '&');
  const embed = (clean.match(/https:\/\/app\.powerbi\.com\/view\?r=[A-Za-z0-9=_%-]+/) || [])[0] || '';
  const excel = (clean.match(/href="(https:\/\/lordslibrary\.parliament\.uk\/[^"]+\.xlsx)"/i) || [])[1] || '';
  return { embed, excel };
}

export async function onRequestGet(ctx) {
  const page = new URL(ctx.request.url).searchParams.get('page');
  try {
    if (page) {
      let u;
      try { u = new URL(page); } catch { return json({ error: 'Unknown dashboard.' }, { status: 400 }); }
      if (u.protocol !== 'https:' || u.hostname !== HOST) return json({ error: 'Unknown dashboard.' }, { status: 400 });
      const detail = await cached(ctx, `lords-dashboard-${u.pathname}`, 43200, async () => parsePage(await getText(u.href)));
      return json({ url: u.href, ...detail }, { maxAge: 3600 });
    }
    let dashboards = [];
    let note = '';
    try {
      dashboards = await snapshotted(ctx, 'lords-dashboards-v2', 43200, async () => {
        const list = parseList(await getText(LIST));
        if (!list.length) throw new Error('No dashboards found on the Library page (its layout may have changed).');
        return list;
      });
    } catch (err) {
      note = `The Lords Library list could not be read just now (${err.message}), so the dashboards known in October 2026 are shown.`;
    }
    // Keep any known dashboard the live list missed.
    for (const k of KNOWN) if (!dashboards.some((d) => d.url === k.url)) dashboards.push(k);
    return json({ dashboards: dashboards.map((d) => ({ ...d, short: shortTitle(d.title) })), note }, { maxAge: 3600 });
  } catch (err) {
    return errorResponse(err);
  }
}
