// Spreadsheet import, what each page expects. One entry per page that takes data in; the reading is in sheet.js and the screen in panel.js.
//
// HOW TO CHANGE WHAT A SHEET IS UNDERSTOOD AS (also written up in docs/IMPORTS.md, which Claude Code is told to read when the owner shares a sample sheet):
//   - a heading the sheet uses that the page does not recognise  ->  add it to that field's `aliases`
//   - a value that is not understood (a role, a kind of action, a portfolio)  ->  add it to the importer's synonyms (ROLE_WORDS, KIND_WORDS) or the lookups
//   - a sheet for a page that cannot take one yet  ->  add an importer here (fields + resolve), then its `commit` where the page is (see issues-page.js for the pattern)
//   - then run `node scripts/libby/check-import.mjs <the sheet>` to see how every importer reads it, and add the sheet's shape to scripts/libby/check-import.mjs's tests.
import { cellValue, blockValue, matchColumns, fitScore, norm, parseDate } from './sheet.js';

const f = (key, label, aliases, extra = {}) => ({ key, label, aliases, type: 'text', ...extra });

/* ------------------------------------------------------------------ Issues Tracker: one row per thing done, grouped under its campaign */
export const KIND_WORDS = [
  ['oral-question', ['oral question', 'oq', 'oral q', 'topical question']], ['written-question', ['written question', 'wq', 'pq', 'parliamentary question', 'written q', 'wpq']],
  ['debate', ['debate', 'speech', 'statement', 'urgent question', 'uq', 'adjournment', 'westminster hall', 'motion']], ['amendment', ['amendment', 'am ']],
  ['legislation', ['legislation', 'bill', 'act', 'si ', 'statutory instrument', 'regulations', 'order', 'clause']], ['committee', ['committee', 'select committee', 'inquiry', 'evidence']],
  ['event', ['event', 'meeting', 'visit', 'roundtable', 'reception', 'briefing', 'conference']], ['media', ['media', 'press', 'article', 'op-ed', 'oped', 'interview', 'social', 'tweet', 'blog']],
];
const KIND_IDS = KIND_WORDS.map(([k]) => k);
export function kindOf(text) {
  const t = ` ${String(text || '').toLowerCase().trim()} `;
  if (!t.trim()) return '';
  const hit = KIND_IDS.find((k) => t.trim().replace(/\s+/g, '-') === k);
  if (hit) return hit;
  for (const [k, words] of KIND_WORDS) if (words.some((w) => t.includes(` ${w.trim()} `) || t.includes(` ${w.trim()}s `) || t.trim() === w.trim())) return k;
  return 'other';
}
/** A portfolio from a code ("DEFRA") or a name ("Environment, Food and Rural Affairs", or a word of it). */
export function portfolioOf(text, portfolios) {
  const t = norm(text);
  if (!t) return null;
  return portfolios.find((p) => norm(p.code) === t) || portfolios.find((p) => norm(p.name) === t)
    || (t.length >= 4 ? portfolios.find((p) => norm(p.name).includes(t) || t.includes(norm(p.name))) : null) || null;
}

const issues = {
  id: 'issues', title: 'Issues Tracker', noun: 'action',
  blurb: 'One row for each thing that was done, with the campaign it belongs to. A row with only a campaign (and no action) just creates the campaign. Blank campaign or portfolio cells take the one above, so sheets grouped under a heading work.',
  fields: [
    f('portfolio', 'Portfolio', ['portfolio', 'department', 'dept', 'policy area', 'area', 'brief', 'topic area', 'subject area'], { required: true, fillDown: true }),
    f('issue', 'Campaign or issue', ['campaign', 'issue', 'campaign name', 'issue name', 'campaign or issue', 'topic', 'subject', 'theme'], { required: true, fillDown: true }),
    f('description', 'About the campaign', ['description', 'about', 'background', 'campaign description', 'what is it', 'overview'], { type: 'block' }),
    f('what', 'What was done', ['what was done', 'action', 'activity', 'item', 'intervention', 'contribution', 'event', 'what', 'detail', 'details', 'description of action']),
    f('date', 'Date', ['date', 'when', 'date done', 'date of action', 'day', 'done on'], { type: 'date' }),
    f('kind', 'Kind', ['kind', 'type', 'category', 'format', 'type of action', 'vehicle']),
    f('url', 'Link', ['link', 'url', 'hansard', 'hansard link', 'source', 'web address', 'reference', 'link to hansard'], { type: 'url' }),
    f('parliamentarian', 'Parliamentarian', ['parliamentarian', 'mp', 'peer', 'member', 'lead', 'who', 'spokesperson', 'tabled by', 'lord', 'baroness', 'responsible parliamentarian']),
    f('staff', 'Adviser or Staff', ['staff', 'adviser', 'advisor', 'staffer', 'researcher', 'pold', 'office', 'responsible staff', 'adviser or staff']),
    f('notes', 'Notes', ['notes', 'note', 'comments', 'comment', 'remarks', 'outcome', 'result', 'follow up'], { type: 'block' }),
  ],
  resolve(v, lk) {
    if (!v.issue && !v.what) return { skip: true };
    const problems = [];
    const p = portfolioOf(v.portfolio, lk.portfolios || []);
    if (!v.portfolio) problems.push('No portfolio'); else if (!p) problems.push(`Unknown portfolio "${v.portfolio}"`);
    if (!v.issue) problems.push('No campaign or issue');
    if (v.what && !v.date) problems.push('No date for the action');
    if (v.date_bad) problems.push(`"${v.date_bad}" is not a date`);
    if (v.url_bad) problems.push(`"${v.url_bad}" is not a web address (left out)`);
    const entry = { portfolio: p && p.code, issue: v.issue, description: v.description,
      action: v.what ? { what: v.what, date: v.date, kind: kindOf(v.kind) || 'other', url: v.url_bad ? '' : v.url, parliamentarian: v.parliamentarian, staff: v.staff, notes: v.notes } : null };
    return { entry, problems, fatal: problems.filter((x) => !/left out/.test(x)).length > 0, summary: `${p ? p.code : '?'} · ${v.issue || '?'}${v.what ? ` · ${v.what}` : ''}` };
  },
};

/* ------------------------------------------------------------------ Concessionometer: one row per concession */
const SEASON_START = { spring: [3, 1], summer: [6, 1], autumn: [9, 1], fall: [9, 1], winter: [12, 1] };   // month, day: the season's first day, so the order on the page is right
/** "Summer 2025" -> { date: '2025-06-01', period: 'Summer 2025' }; a real date -> { date }; anything else -> null. */
export function whenOf(text) {
  const t = String(text || '').trim();
  if (!t) return { date: '', period: '' };
  const d = parseDate(t);
  if (d) return { date: d, period: '' };
  const m = /^(spring|summer|autumn|fall|winter)\s+(\d{4})$/i.exec(t.replace(/\s+/g, ' '));
  if (m) { const [mo, da] = SEASON_START[m[1].toLowerCase()]; return { date: `${m[2]}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`, period: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}` }; }
  return null;
}
const concessions = {
  id: 'concessions', title: 'Concessions', noun: 'concession',
  blurb: 'One row for each concession: the Bill, when it was won (a date, or a season such as "Summer 2025"), the portfolio (one or more, e.g. "DBT, DSIT") and the Staff’s notes. A column for what the concession is called is kept as its name. Other columns (importance, rating) are ignored. A concession already on the list (same Bill and name) is left as it is.',
  fields: [
    f('bill', 'Bill', ['bill', 'bill legislation', 'legislation', 'bill name', 'act', 'bill or legislation', 'bill title'], { required: true }),
    f('name', 'Concession name', ['concession name', 'concession', 'name', 'title', 'win', 'what was won']),
    f('when', 'Date won', ['date', 'date won', 'when', 'won', 'season', 'period', 'time', 'date of concession']),
    f('portfolio', 'Portfolio', ['portfolio', 'department', 'portfolio department', 'dept', 'brief', 'policy area']),
    f('notes', 'Notes', ['notes', 'note', 'details', 'detail', 'comments', 'comment', 'description', 'summary', 'outcome'], { type: 'block' }),
  ],
  resolve(v, lk) {
    if (!v.bill && !v.name) return { skip: true };
    const problems = [];
    if (!v.bill) problems.push('No Bill');
    const w = whenOf(v.when);
    if (w === null) problems.push(`"${v.when}" is not a date or a season (date left blank)`);
    const codes = [], unknown = [];
    for (const part of String(v.portfolio || '').split(/[,;/&+]|\band\b/i).map((x) => x.trim()).filter(Boolean)) {
      const p = portfolioOf(part, lk.portfolios || []);
      if (p) { if (!codes.includes(p.code)) codes.push(p.code); } else unknown.push(part);
    }
    if (unknown.length) problems.push(`Unknown portfolio ${unknown.map((u) => `"${u}"`).join(', ')} (left out)`);
    const entry = { bill: v.bill, name: v.name, portfolio: codes, notes: v.notes, wonAt: (w && w.date) || '', period: (w && w.period) || '' };
    return { entry, problems, fatal: !v.bill, summary: `${v.bill || '?'}${v.name ? ` · ${v.name}` : ''} · ${codes.join(', ') || 'no portfolio'} · ${(w && (w.period || w.date)) || 'no date'}` };
  },
};

/* ------------------------------------------------------------------ Roles: people and the role they hold */
export const ROLE_WORDS = [
  // checked in this order; "staff" words come first so "Whip's staff" is not read as "Whip"
  ['whips_staff', ['whip staff', 'whips staff', 'whip s staff', 'whips office staff']], ['leader_staff', ['leader staff', 'leaders staff', 'leader s circle s staff', 'leaders circle staff', 'leader s office staff', 'pold staff', 'pold', 'staff']],
  ['frontbench_staff', ['frontbench staff', 'frontbencher staff', 'frontbencher parliamentarian s staff', 'spokesperson staff', 'front bench staff']], ['backbench_staff', ['backbench staff', 'backbencher staff', 'backbench parliamentarian s staff', 'back bench staff']],
  ['whips', ['whip', 'whips', 'deputy whip', 'chief whip']], ['leader', ['leader', 'leaders circle', 'leader s circle', 'leaders office', 'leader s office', 'leadership', 'deputy leader']],
  ['frontbench', ['frontbench', 'frontbencher', 'frontbencher parliamentarian', 'front bench', 'spokesperson', 'spokesman', 'spokeswoman', 'shadow']], ['backbench', ['backbench', 'backbencher', 'backbench parliamentarian', 'back bench', 'peer', 'mp', 'member']],
  ['admin', ['admin', 'administrator', 'administration']],
];
/** A role from the words in a cell ("Whip", "Frontbencher parliamentarian's Staff", "Spokesperson"), or a role id. */
export function roleOf(text, roles) {
  const t = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!t) return '';
  const byId = (roles || []).find((r) => r.id === t.replace(/ /g, '_') || norm(r.label) === norm(t));
  if (byId) return byId.id;
  for (const [id, words] of ROLE_WORDS) if (words.some((w) => t === w || (w.length >= 5 && t.includes(w)) || new RegExp(`(^| )${w}( |$)`).test(t))) return (!roles || roles.some((r) => r.id === id)) ? id : '';
  return '';
}
const houseOf = (text) => { const t = String(text || '').toLowerCase(); return /commons|\bmp\b|\bmps\b/.test(t) ? 'commons' : /lords|peer|baroness|lord\b/.test(t) ? 'lords' : ''; };

const roles = {
  id: 'roles', title: 'Roles', noun: 'person',
  blurb: 'One row for each person: their name and their role. People already on the list get the new role; anyone else is added (with the House, if the sheet gives one).',
  fields: [
    f('name', 'Name', ['name', 'person', 'full name', 'member', 'peer', 'mp', 'who', 'parliamentarian', 'staff member'], { required: true }),
    f('role', 'Role', ['role', 'level', 'position', 'job', 'job title', 'status', 'access', 'type'], { required: true }),
    f('house', 'House', ['house', 'chamber'], {}),
  ],
  resolve(v, lk) {
    if (!v.name && !v.role) return { skip: true };
    const problems = [];
    const role = roleOf(v.role, lk.roles);
    if (!v.name) problems.push('No name');
    if (!v.role) problems.push('No role'); else if (!role) problems.push(`"${v.role}" is not a role I know (${(lk.roles || []).map((r) => r.label).join(', ')})`);
    return { entry: { name: v.name, role, house: houseOf(v.house) || 'lords' }, problems, fatal: problems.length > 0, summary: `${v.name || '?'} · ${role || v.role || '?'}` };
  },
};

/* ------------------------------------------------------------------ Whips' Office Bulletin: messages */
const bulletin = {
  id: 'bulletin', title: 'Bulletin messages', noun: 'message',
  blurb: 'One row for each message: an optional heading and the message. They are added to the end of the bulletin.',
  fields: [
    f('heading', 'Heading', ['heading', 'title', 'headline', 'subject'], {}),
    f('body', 'Message', ['message', 'body', 'text', 'content', 'note', 'notice', 'item', 'bulletin'], { type: 'block', required: true }),
  ],
  resolve(v) {
    if (!v.body && !v.heading) return { skip: true };
    const problems = v.body ? [] : ['No message'];
    return { entry: { heading: v.heading, body: v.body }, problems, fatal: problems.length > 0, summary: `${v.heading ? `${v.heading}: ` : ''}${(v.body || '').slice(0, 60)}` };
  },
};

/* ------------------------------------------------------------------ Access: invite many people at once */
const invites = {
  id: 'invites', title: 'Invites', noun: 'invite',
  blurb: 'One row for each person: their email, and the level to give them. If the sheet has a program column it is used; otherwise the program chosen above.',
  fields: [
    f('email', 'Email', ['email', 'e-mail', 'email address', 'mail', 'address'], { required: true, type: 'email' }),
    f('level', 'Level', ['level', 'role', 'access', 'permission', 'access level', 'type'], { required: true }),
    f('program', 'Program', ['program', 'programme', 'app', 'site', 'system', 'area'], {}),
    f('until', 'Access until', ['until', 'expires', 'expiry', 'end', 'end date', 'access until', 'valid until', 'to'], { type: 'date' }),
  ],
  resolve(v, lk) {
    if (!v.email && !v.level) return { skip: true };
    const problems = [];
    const prog = v.program ? (lk.programs || []).find((p) => norm(p.id) === norm(v.program) || norm(p.name) === norm(v.program)) : (lk.programs || []).find((p) => p.id === lk.fixedProgram);
    if (!prog) problems.push(v.program ? `Unknown program "${v.program}"` : 'No program (choose one above)');
    const levels = prog ? ((lk.levels || {})[prog.id] || []) : [];
    const lv = v.level && levels.find((l) => norm(l.level) === norm(v.level) || norm(l.label) === norm(v.level) || (norm(v.level).length >= 4 && norm(l.label).includes(norm(v.level))));
    if (!v.email || v.email_bad) problems.push(v.email ? `"${v.email}" is not an email address` : 'No email');
    if (!v.level) problems.push('No level'); else if (prog && !lv) problems.push(`"${v.level}" is not a level in ${prog.name}`);
    if (v.until_bad) problems.push(`"${v.until_bad}" is not a date`);
    return { entry: { email: v.email, program: prog && prog.id, level: lv && lv.level, until: v.until }, problems, fatal: problems.length > 0, summary: `${v.email || '?'} · ${prog ? prog.name : '?'} · ${lv ? lv.label : v.level || '?'}` };
  },
};

/* ------------------------------------------------------------------ LOVELACE social accounts: who is followed, from links */
const SOCIAL_HOSTS = [['instagram.com', 'Instagram'], ['facebook.com', 'Facebook'], ['fb.com', 'Facebook'], ['twitter.com', 'Twitter'], ['x.com', 'Twitter'], ['bsky.app', 'BlueSky'], ['substack.com', 'Substack'],
  ['tiktok.com', 'TikTok'], ['linkedin.com', 'LinkedIn'], ['youtube.com', 'YouTube'], ['youtu.be', 'YouTube'], ['threads.net', 'Threads'], ['mastodon.social', 'Mastodon']];
const PLATFORM_NAMES = { instagram: 'Instagram', insta: 'Instagram', ig: 'Instagram', facebook: 'Facebook', fb: 'Facebook', twitter: 'Twitter', x: 'Twitter', 'twitter x': 'Twitter', bluesky: 'BlueSky', bsky: 'BlueSky',
  substack: 'Substack', tiktok: 'TikTok', linkedin: 'LinkedIn', youtube: 'YouTube', threads: 'Threads', mastodon: 'Mastodon', other: 'Other' };
const urlParts = (u) => { try { const x = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`); return { host: x.hostname.toLowerCase().replace(/^www\./, ''), path: x.pathname.split('/').filter(Boolean) }; } catch { return null; } };
/** The platform a profile link belongs to ("https://bsky.app/profile/x.bsky.social" -> "BlueSky"), or '' if it is not one the tracker knows. */
export function platformOf(url) {
  const p = urlParts(String(url || '').trim());
  if (!p) return '';
  const hit = SOCIAL_HOSTS.find(([h]) => p.host === h || p.host.endsWith(`.${h}`));
  return hit ? hit[1] : '';
}
/** The platform named in a cell ("X", "Insta", "BlueSky"), or ''. */
export const platformName = (text) => PLATFORM_NAMES[String(text || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim()] || '';
/** The account's handle: the one given, or taken from the link (for BlueSky the full handle, for Substack the publication's address). */
export function handleOf(platform, url, given = '') {
  const g = String(given || '').trim().replace(/^@/, '');
  if (g) return g;
  const p = urlParts(String(url || '').trim());
  if (!p) return '';
  if (platform === 'BlueSky') return p.path[0] === 'profile' ? (p.path[1] || '') : '';
  if (platform === 'Substack') return p.host;
  if (platform === 'Mastodon') return p.path[0] ? `${p.path[0].replace(/^@/, '')}@${p.host}` : '';   // user@instance, which is how the feed address is built
  if (platform === 'LinkedIn') return p.path[1] ? `${p.path[0]}/${p.path[1]}` : '';
  if (platform === 'YouTube') return (p.path[0] || '').startsWith('@') ? p.path[0] : p.path.slice(0, 2).join('/');
  return (p.path[0] || '').replace(/^@/, '');   // Instagram, Facebook, Twitter, TikTok, Threads, Mastodon: the first part of the path
}
const accounts = {
  id: 'accounts', title: 'Tracked accounts', noun: 'account',
  blurb: 'One row for each account: who it belongs to and a link to its profile (the platform and handle are worked out from the link). An account already on the list has its link and handle updated.',
  fields: [
    f('organisation', 'Account owner', ['account owner', 'owner', 'organisation', 'organization', 'account', 'account name', 'org', 'channel owner', 'whose', 'who'], { required: true }),
    f('url', 'Link to the profile', ['link', 'url', 'profile', 'profile link', 'link to account', 'link to the account', 'address', 'web address', 'page', 'channel link'], { type: 'url' }),
    f('platform', 'Platform', ['platform', 'network', 'channel', 'site', 'social network', 'social media']),
    f('handle', 'Handle', ['handle', 'username', 'user name', 'account handle', 'screen name']),
  ],
  resolve(v) {
    if (!v.organisation && !v.url && !v.handle) return { skip: true };
    const problems = [];
    const platform = platformName(v.platform) || platformOf(v.url);
    if (!v.organisation) problems.push('No account owner');
    if (!platform) problems.push(v.platform ? `"${v.platform}" is not a platform I know` : 'Could not tell the platform from the link (add a Platform column)');
    if (!v.url && !v.handle) problems.push('No link');
    if (v.url_bad) problems.push(`"${v.url_bad}" is not a web address`);
    const handle = handleOf(platform, v.url, v.handle);
    return { entry: { organisation: v.organisation, platform, handle, url: v.url || '' }, problems, fatal: problems.length > 0, summary: `${v.organisation || '?'} · ${platform || '?'}${handle ? ` · ${handle}` : ''}` };
  },
};

export const IMPORTERS = { issues, concessions, accounts, roles, bulletin, invites };

/* ------------------------------------------------------------------ putting a sheet through an importer */

/**
 * Read a sheet (as readWorkbook gives it) the way `importer` expects, using `mapping` (from matchColumns, possibly corrected by the person).
 * Returns { entries: [ { row, entry, problems, fatal, summary } ], skipped (empty rows), counts: { ok, problems, fatal } }.
 */
export function analyse(sheet, importer, lookups, mapping) {
  const out = []; let skipped = 0;
  const last = {};
  sheet.rows.forEach((r, i) => {
    const v = {};
    for (const fld of importer.fields) {
      const col = mapping[fld.key];
      const raw = col >= 0 ? r[col] : '';
      if (fld.type === 'block') { v[fld.key] = blockValue(raw); continue; }
      const c = cellValue(fld.type, raw);
      v[fld.key] = c.ok ? c.value : '';
      if (!c.ok) v[`${fld.key}_bad`] = c.value;
      if (fld.fillDown) { if (v[fld.key]) last[fld.key] = v[fld.key]; else if (last[fld.key]) v[fld.key] = last[fld.key]; }
    }
    const res = importer.resolve(v, lookups || {});
    if (res.skip) { skipped++; return; }
    out.push({ row: i + 2, ...res });
  });
  return { entries: out, skipped, counts: { ok: out.filter((e) => !e.fatal).length, problems: out.filter((e) => e.problems.length).length, fatal: out.filter((e) => e.fatal).length } };
}

/** How every importer would read a sheet: for the dev check and for choosing the right importer when a page offers several. */
export function readWithAll(sheet, lookups = {}) {
  return Object.values(IMPORTERS).map((imp) => {
    const match = matchColumns(sheet.headers, sheet.rows, imp.fields);
    return { importer: imp, match, fit: fitScore(match, imp.fields), result: analyse(sheet, imp, lookups, match.mapping) };
  }).sort((a, b) => b.fit - a.fit);
}
