// THE LIST OF PAGES. This is the one place to change when you add or move a page.
//
// Everything else follows it: the menu, the routes, the hub pages (Business, LD Peers' Group), the row of subpage buttons,
// the home page cards and who may open each page. The server reads it too, for who may use each /api route.
// It holds only plain data and small helper functions (no page code), so both the website and the server can load it.
//
// To add a page: write public/js/views/<name>-page.js, then add ONE entry to PAGES below. See docs/adding-a-page.md.

/* ------------------------------------------------------------------ levels */

// The roles, lowest to highest. A person signs in as one role with that role's password (lib/access.js).
//   peers          read (as before)
//   whips          also the Data page and the Whips pages (as before)
//   spokesperson   the same as Whips for now
//   leader         Leader's office: the same as Whips for now
//   staff          everything except the back-channel operations (below)
//   admin          everything, including the back-channel operations
// Roles with the same number are equal: to give Spokespeople or the Leader's office their own access later, raise or lower their number here
// (and give pages and routes that level in the lists below).
//   beta           Beta tester: ONLY the pages marked `beta: true` below (today only Data), read-only. Not a step on the ladder:
//                  see canOpenPage() and betaMay(), which are what keep a beta tester out of everything else
//   developer      the Developer site: everything, plus the pages marked `level: DEVELOPER` (work in progress). Only the admin can give it,
//                  and the admin always has it
export const RANK = { beta: 1, peers: 1, whips: 2, spokesperson: 2, leader: 2, staff: 3, admin: 4, developer: 5 };
export const LEVEL_NAMES = { beta: 'Beta tester', peers: 'Peer', whips: 'Whip', spokesperson: 'Spokesperson', leader: 'Leader\u2019s office', staff: 'Staff', admin: 'Admin', developer: 'Developer' };
export const BETA = 'beta';
export const DEVELOPER = 'developer';
/** The roles in the order they are offered on the sign-in page and in the roles table. */
export const ROLE_ORDER = ['peers', 'whips', 'spokesperson', 'leader', 'staff', 'admin'];

// The level needed for the Whips' Office features (comments, drafting amendments, grids, Oral Question suggestions, Comms updates,
// stakeholders, amendment flags). Staff and Admin have them. To give them to Whips, change 'staff' to 'whips' here: this one line is the whole switch.
export const WHIPS_FEATURES = 'staff';
// The level for back-channel operations: things even Staff must not do. Today that is only changing who has which role.
// Give a future back-channel route this level (and a route that is not listed in any page's `api` also needs it for anything but reading).
export const BACKCHANNEL = 'admin';

export const atLeast = (have, need) => (RANK[have] || 0) >= (RANK[need || 'peers'] || 0);

/* ------------------------------------------------------------------ the two Houses */

// LIBBY comes in two: Honourable LIBBY for the House of Commons (green) and Noble LIBBY for the House of Lords (red). A page, a menu item or a
// group belongs to one House through `house` ('lords' when not given: everything LIBBY had before was the Lords) or to both ('both').
export const HOUSES = {
  commons: { name: 'Honourable LIBBY', house: 'House of Commons', members: 'MPs' },
  lords: { name: 'Noble LIBBY', house: 'House of Lords', members: 'peers' },
};
export const inHouse = (item, house = 'lords') => item.house === 'both' || (item.house || 'lords') === house;

/** May a person at this level open this page, in this House? A beta tester may open only the pages marked `beta: true`; everyone else goes by level. */
export const canOpenPage = (page, level, house = 'lords') => inHouse(page, house) && (level === BETA ? !!page.beta : atLeast(level, page.level));

/* ------------------------------------------------------------------ the menu */

// The top menu, in order. `level` is the lowest level that sees the item. `title` and `text` are used for the home page card.
export const MENU = [
  { id: 'today', label: 'Today', href: '#/today', level: 'peers', title: "Today's business", text: 'Live proceedings, the order of business, Oral Questions with suggested supplementaries.' },
  { id: 'legislation', label: 'Legislation', href: '#/legislation', level: 'peers', title: 'Legislation', text: 'Every live Bill in the Lords: stage dates, the documents for each stage and amendments.' },
  { id: 'business', label: 'Business', href: '#/business', level: 'peers', title: 'Business', text: 'Future business, past business (votes, questions, committees, Hansard) and Comms.' },
  { id: 'group', label: "LD Peers' Group", href: '#/peers-group', level: 'peers', title: "LD Peers' Group", text: 'Liberal Democrat policy, the Wallace Room, voting and Lords data, and the tools for the Whips and advisers.' },
  // Honourable LIBBY (the Commons)
  { id: 'c-today', label: 'Today', href: '#/c/today', level: 'peers', house: 'commons', title: "Today's business", text: 'The Chamber, Westminster Hall and the committees today, with Lib Dem MPs marked.' },
  { id: 'c-legislation', label: 'Legislation', href: '#/c/legislation', level: 'peers', house: 'commons', title: 'Legislation', text: 'Every live Bill in the Commons: stage dates, documents and the amendments at Committee and Report.' },
  { id: 'cbusiness', label: 'Business', href: '#/c/business', level: 'peers', house: 'commons', title: 'Business', text: 'Coming business, and past business: votes, written questions and statements, committees and Hansard.' },
  { id: 'c-policy', label: 'Policy', href: '#/c/policy', level: 'peers', house: 'commons', title: 'Policy', text: 'Search conference motions and policy papers, or browse them by portfolio.' },
  { id: 'developer', label: 'Developer', href: '#/developer', level: DEVELOPER, house: 'both', title: 'Developer', text: 'Work in progress, and a register of every page and who can open it. Visible only to you.' },
];

// What a beta tester sees in the menu and on the home page, in place of MENU.
export const BETA_MENU = [
  { id: 'data', label: 'Data', href: '#/data', title: 'Data', text: 'Voting analysis and the House of Lords Library data dashboards.' },
];

// Groups of subpages. Each group is shown as a hub page (cards) and as a row of buttons above each of its pages.
export const GROUPS = {
  business: { title: 'Business', intro: 'What the House will do, what it has done, and what the team has been saying.' },
  group: { title: 'LD Peers\u2019 Group', intro: 'Policy, and the tools the Whips and advisers use.' },
  cbusiness: { title: 'Business', intro: 'What the House of Commons will do, and what it has done.' },
};

/* ------------------------------------------------------------------ the pages */

// One entry per address. Fields:
//   id        a short name
//   match     which address (the part after #) this entry handles; brackets pass values on to `params`
//   view      the file in public/js/views/ and `fn` the function in it that draws the page
//   params    (match, ctx) => values handed to the page (ctx has today's date and the query string)
//   level     the lowest level that may open it (default 'peers')
//   nav       the menu item to highlight (a name, or a function of (match, ctx)). Default: the group's menu item, else this page.
//   group     the group it belongs to, and `tab` which button in that group it sits under
//   tabLabel, href, card   give a page its own button and hub card (the main page of a tab)
//   api       the /api routes behind this page and who may use them: [ ['route-name', { GET: level, '*': level }] ]
//             'GET' is reading and '*' is anything else (saving, uploading). A route not listed here may be read by Peers and changed by no one but Admin.
export const PAGES = [
  { id: 'home', match: /^\/?$/, view: 'home-page.js', fn: 'renderHome', nav: '', beta: true, house: 'both' },

  { id: 'today', match: /^\/today$/, view: 'day-page.js', fn: 'renderDay', params: (m, c) => ({ date: c.today }), nav: 'today',
    api: [['oq-suggest', { '*': WHIPS_FEATURES }], ['todays-list', { '*': WHIPS_FEATURES }]] },
  { id: 'day', match: /^\/day\/(\d{4}-\d{2}-\d{2})$/, view: 'day-page.js', fn: 'renderDay', params: (m) => ({ date: m[1] }),
    nav: (m, c) => (m[1] === c.today ? 'today' : ''), group: 'business', tab: 'future' },

  { id: 'legislation', match: /^\/legislation$/, view: 'legislation-page.js', fn: 'renderLegislation', nav: 'legislation' },
  { id: 'bill', match: /^\/bill\/(\d+)$/, view: 'bill-page.js', fn: 'renderBill', params: (m) => ({ id: m[1] }), nav: 'legislation',
    api: [['comments|grid-text|draft-amendment', { '*': WHIPS_FEATURES }],
      // Stakeholder notes and amendment flags are internal: Whips and above may read them, WHIPS_FEATURES may change them.
      ['bill-stakeholders|amendment-flags', { GET: 'whips', '*': WHIPS_FEATURES }]] },

  // Business
  { id: 'future', match: /^\/future$/, view: 'future-page.js', fn: 'renderFuture', group: 'business', tab: 'future', tabLabel: 'Future', href: '#/future',
    card: 'Forthcoming Business by calendar or by portfolio, with secondary legislation and committee reports.' },
  { id: 'portfolio', match: /^\/portfolio\/([A-Za-z]+)$/, view: 'portfolio-page.js', fn: 'renderPortfolio', params: (m) => ({ code: m[1].toUpperCase() }), group: 'business', tab: 'future' },
  { id: 'past', match: /^\/past(?:\/([a-z]+)(?:\/([a-z]+))?)?$/, view: 'past-page.js', fn: 'renderPast', params: (m) => ({ kind: m[1] || '', sub: m[2] || '' }),
    group: 'business', tab: 'past', tabLabel: 'Past', href: '#/past', card: 'Lords divisions, written questions and statements, committee work and Hansard.' },
  { id: 'comms', match: /^\/comms$/, view: 'comms-page.js', fn: 'renderComms', group: 'business', tab: 'comms', tabLabel: 'Comms', href: '#/comms',
    card: 'The latest posts from the Lib Dem Lords team on Bluesky, X, Instagram and LinkedIn.',
    api: [['comms', { GET: 'peers', '*': WHIPS_FEATURES }]] },

  // LD Peers' Group
  { id: 'policy', match: /^\/policy$/, view: 'policy-page.js', fn: 'renderPolicy', group: 'group', tab: 'policy', tabLabel: 'Policy', href: '#/policy',
    card: 'Search conference motions and policy papers, or browse them by portfolio.' },
  { id: 'wallace-room', match: /^\/wallace-room$/, view: 'wallace-room-page.js', fn: 'renderWallaceRoom', group: 'group', tab: 'wallace', tabLabel: 'Wallace Room', href: '#/wallace-room',
    card: 'Book the Wallace Room: see who has it and when, by week or month, and book it once or on a repeat.',
    api: [['room-bookings', { GET: 'peers', '*': 'peers' }]] },
  { id: 'whips', match: /^\/whips(?:\/availability)?$/, view: 'whips-page.js', fn: 'renderWhips', level: 'whips',
    group: 'group', tab: 'whips', tabLabel: 'Whips', href: '#/whips', card: 'Mark the days you would prefer to be duty whip, have no preference, or are not free.',
    api: [['whip-availability', { GET: 'whips', '*': 'whips' }], ['people-roles', { GET: 'whips', '*': BACKCHANNEL }]] },
  // Duty Whips: Staff choose the rota (on the Advisers page; the rota itself shows on every day's page)
  { id: 'duty-whips', match: /^\/duty-whips$/, view: 'duty-page.js', fn: 'renderDuty', level: 'staff', group: 'group', tab: 'advisers',
    api: [['duty-whips', { GET: 'whips', '*': 'staff' }]] },
  // Who is a Whip, Spokesperson and so on. Back-channel: Admin only. Everyone from Whips up reads the list (the Whips pages use it).
  { id: 'roles', match: /^\/roles$/, view: 'roles-page.js', fn: 'renderRoles', level: BACKCHANNEL, group: 'group', tab: 'roles', tabLabel: 'Roles', href: '#/roles',
    card: 'Say who is a Whip, a Spokesperson and so on, and add staff who are not on the Members list.' },
  { id: 'data', match: /^\/data(?:\/(votes|lords))?$/, view: 'data-page.js', fn: 'renderData', params: (m) => ({ sub: m[1] || '' }), level: 'whips',
    group: 'group', tab: 'data', tabLabel: 'Data', href: '#/data', card: 'Voting analysis and the House of Lords Library data dashboards.', beta: true,
    api: [['data/.*', { '*': 'whips' }]] },
  { id: 'advisers', match: /^\/advisers$/, view: 'advisers-page.js', fn: 'renderAdvisers', level: 'staff', group: 'group', tab: 'advisers', tabLabel: 'Advisers', href: '#/advisers',
    card: 'Every page the advisers use: Bill advisers, groupings and grids, the bulletin, the duty rota, availability and the Wallace Room.' },
  { id: 'adviser-editor', match: /^\/adviser-editor$/, view: 'adviser-editor-page.js', fn: 'renderAdviserEditor', level: 'staff', group: 'group', tab: 'advisers',
    api: [['advisers', { '*': 'staff' }], ['groupings', { GET: WHIPS_FEATURES, '*': 'staff' }]] },
  { id: 'bulletin-editor', match: /^\/bulletin-editor$/, view: 'bulletin-editor-page.js', fn: 'renderBulletinEditor', level: 'staff', group: 'group', tab: 'advisers',
    api: [['bulletin', { GET: 'peers', '*': 'staff' }]] },

  // The Developer site: you only (the admin). Put work in progress here, with `level: DEVELOPER`, until it is ready to go live.
  { id: 'developer', match: /^\/developer$/, view: 'developer-page.js', fn: 'renderDeveloper', level: DEVELOPER, nav: 'developer', house: 'both' },

  // Honourable LIBBY: the House of Commons, from the Commons APIs (What's On, Bills, Commons Votes, written questions and statements,
  // committees). The Lords Whips' Office pages (Comms, Whips, Wallace Room, Roles, Advisers) and the Lords voting analysis have no
  // Commons counterpart and are not here.
  { id: 'c-today', match: /^\/c\/today$/, view: 'commons-day-page.js', fn: 'renderCommonsDay', params: (m, c) => ({ date: c.today }), nav: 'c-today', house: 'commons' },
  { id: 'c-day', match: /^\/c\/day\/(\d{4}-\d{2}-\d{2})$/, view: 'commons-day-page.js', fn: 'renderCommonsDay', params: (m) => ({ date: m[1] }),
    nav: (m, c) => (m[1] === c.today ? 'c-today' : ''), group: 'cbusiness', tab: 'c-future', house: 'commons' },
  { id: 'c-legislation', match: /^\/c\/legislation$/, view: 'legislation-page.js', fn: 'renderLegislation', params: () => ({ house: 'commons' }), nav: 'c-legislation', house: 'commons' },
  { id: 'c-bill', match: /^\/c\/bill\/(\d+)$/, view: 'bill-page.js', fn: 'renderBill', params: (m) => ({ id: m[1], house: 'commons' }), nav: 'c-legislation', house: 'commons' },
  { id: 'c-future', match: /^\/c\/future$/, view: 'commons-future-page.js', fn: 'renderCommonsFuture', group: 'cbusiness', tab: 'c-future', tabLabel: 'Coming up', href: '#/c/future',
    card: 'The coming weeks in the Chamber and Westminster Hall, from the What\u2019s On calendar.', house: 'commons' },
  { id: 'c-past', match: /^\/c\/past(?:\/([a-z]+)(?:\/([a-z]+))?)?$/, view: 'past-page.js', fn: 'renderPast', params: (m) => ({ kind: m[1] || '', sub: m[2] || '', house: 'commons' }),
    group: 'cbusiness', tab: 'c-past', tabLabel: 'Past', href: '#/c/past', card: 'Commons divisions (with how the Lib Dem MPs voted), written questions and statements, committees and Hansard.', house: 'commons' },
  { id: 'c-policy', match: /^\/c\/policy$/, view: 'policy-page.js', fn: 'renderPolicy', nav: 'c-policy', house: 'commons' },
  { id: 'c-business', match: /^\/c\/business$/, view: 'group-page.js', fn: 'renderGroupPage', params: () => ({ group: 'cbusiness' }), nav: 'cbusiness', house: 'commons' },

  // The two hub pages
  { id: 'business', match: /^\/business$/, view: 'group-page.js', fn: 'renderGroupPage', params: () => ({ group: 'business' }), nav: 'business' },
  { id: 'group', match: /^\/peers-group$/, view: 'group-page.js', fn: 'renderGroupPage', params: () => ({ group: 'group' }), nav: 'group' },
];

// Routes that are not tied to one page.
export const SHARED_API = [
  ['me', { '*': 'peers' }],
];

/* ------------------------------------------------------------------ the Advisers page */

// The buttons on the Advisers page (Staff and Admin): [ section, [ [button, address, what it is for] ] ].
export const ADVISER_LINKS = [
  ['Legislation', [
    ['Update Bill Advisers', '#/adviser-editor', 'Say which adviser looks after each Bill. They show on the Legislation page.'],
    ['Upload Groupings, Grids & Hymn Sheets', '#/adviser-editor?tab=groupings', 'Upload the Government Whips\u2019 grouping, check it, and save it to build the grids and hymn sheets.'],
  ]],
  ['Whipping', [
    ['Whips\u2019 Office Bulletin', '#/bulletin-editor', 'Write the messages in the box on the home page. They stay there until you change them.'],
    ['Duty Whips: choose the rota', '#/duty-whips', 'Choose the two duty whips for each day.'],
    ['Availability: see who is free', '#/whips', 'Who has marked each day green, amber or red.'],
  ]],
  ['Office', [
    ['Wallace Room', '#/wallace-room', 'See every booking and book the room. Staff and Admin can cancel anyone\u2019s booking, or a whole repeating series.'],
  ]],
];

/* ------------------------------------------------------------------ helpers (used by the website, the server and the checker) */

/** The menu items a person at this level sees, in this House. */
export const menuFor = (level, house = 'lords') => (level === BETA ? BETA_MENU : MENU.filter((m) => atLeast(level, m.level))).filter((m) => inHouse(m, house));

/** The buttons (and hub cards) of a group that a person at this level may open, in this House. */
export const tabsFor = (group, level, house = 'lords') => PAGES.filter((p) => p.group === group && p.tabLabel && canOpenPage(p, level, house))
  .map((p) => ({ tab: p.tab, label: p.tabLabel, href: p.href, card: p.card }));

/** For a page that matched an address: which menu item to highlight, and which group and button it sits under. */
export function placeOf(page, m, ctx, level) {
  if (level === BETA) return { menu: page.id, group: '', tab: '' };   // a beta tester's menu is the three pages themselves, with no groups
  let menu = typeof page.nav === 'function' ? page.nav(m, ctx) : page.nav;
  const inGroup = !!page.group && !menu; // a page can step out of its group, e.g. a day that is today
  if (!menu) menu = page.group || page.id;
  return { menu, group: inGroup ? page.group : '', tab: inGroup ? page.tab : '' };
}

/** All the /api rules, built from the pages above: [ [pattern, { GET, '*' }] ]. */
export const API_RULES = [...SHARED_API, ...PAGES.flatMap((p) => p.api || [])]
  .map(([route, rules]) => [new RegExp(`^/api/libby/(?:${route})$`), rules]);

/** The lowest level allowed to make this request. A route not listed may be read by Peers and changed only by Admin (the back-channel level). */
export function requiredLevel(method, path) {
  const m = String(method || 'GET').toUpperCase();
  const key = m === 'HEAD' ? 'GET' : m;
  for (const [re, by] of API_RULES) if (re.test(path)) return by[key] || by['*'] || 'admin'; // anything a rule does not name needs an Admin
  return key === 'GET' ? 'peers' : 'admin';
}

/** What a beta tester may ask the server for: reading only, and only the routes behind the pages marked `beta: true` (plus /me, handled by the server). */
const BETA_ROUTES = [...new Set([...PAGES.filter((p) => p.beta).flatMap((p) => [...(p.api || []).map(([route]) => route), ...(p.betaApi || [])]), 'status'])]
  .map((route) => new RegExp(`^/api/libby/(?:${route})$`));
export const betaMay = (method, path) => ['GET', 'HEAD'].includes(String(method || 'GET').toUpperCase()) && BETA_ROUTES.some((re) => re.test(path));
