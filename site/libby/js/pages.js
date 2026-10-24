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
export const RANK = { peers: 1, whips: 2, spokesperson: 2, leader: 2, staff: 3, admin: 4 };
export const LEVEL_NAMES = { peers: 'Peer', whips: 'Whip', spokesperson: 'Spokesperson', leader: 'Leader\u2019s office', staff: 'Staff', admin: 'Admin' };
/** The roles in the order they are offered on the sign-in page and in the roles table. */
export const ROLE_ORDER = ['peers', 'whips', 'spokesperson', 'leader', 'staff', 'admin'];

// The level needed for the Whips' Office features (comments, drafting amendments, grids, Oral Question suggestions, Comms updates,
// stakeholders, amendment flags). Staff and Admin have them. To give them to Whips, change 'staff' to 'whips' here: this one line is the whole switch.
export const WHIPS_FEATURES = 'staff';
// The level for back-channel operations: things even Staff must not do. Today that is only changing who has which role.
// Give a future back-channel route this level (and a route that is not listed in any page's `api` also needs it for anything but reading).
export const BACKCHANNEL = 'admin';

export const atLeast = (have, need) => (RANK[have] || 0) >= (RANK[need || 'peers'] || 0);

/* ------------------------------------------------------------------ the menu */

// The top menu, in order. `level` is the lowest level that sees the item. `title` and `text` are used for the home page card.
export const MENU = [
  { id: 'today', label: 'Today', href: '#/today', level: 'peers', title: "Today's business", text: 'Live proceedings, the order of business, Oral Questions with suggested supplementaries.' },
  { id: 'legislation', label: 'Legislation', href: '#/legislation', level: 'peers', title: 'Legislation', text: 'Every live Bill in the Lords: stage dates, the documents for each stage and amendments.' },
  { id: 'business', label: 'Business', href: '#/business', level: 'peers', title: 'Business', text: 'Future business, past business (votes, questions, committees, Hansard) and Comms.' },
  { id: 'group', label: "LD Peers' Group", href: '#/peers-group', level: 'peers', title: "LD Peers' Group", text: 'Liberal Democrat policy, the Wallace Room, voting and Lords data, and the tools for the Whips and advisers.' },
];

// Groups of subpages. Each group is shown as a hub page (cards) and as a row of buttons above each of its pages.
export const GROUPS = {
  business: { title: 'Business', intro: 'What the House will do, what it has done, and what the team has been saying.' },
  group: { title: 'LD Peers\u2019 Group', intro: 'Policy, and the tools the Whips and advisers use.' },
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
  { id: 'home', match: /^\/?$/, view: 'home-page.js', fn: 'renderHome', nav: '' },

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
  { id: 'whips', match: /^\/whips(?:\/(duty|availability|hymn-sheets))?$/, view: 'whips-page.js', fn: 'renderWhips', params: (m) => ({ sub: m[1] || '' }), level: 'whips',
    group: 'group', tab: 'whips', tabLabel: 'Whips', href: '#/whips', card: 'The duty rota, availability for whipping, and the hymn sheets.',
    api: [['duty-whips', { GET: 'whips', '*': 'staff' }], ['whip-availability', { GET: 'whips', '*': 'whips' }], ['hymn-sheets', { GET: 'whips', '*': 'staff' }],
      ['people-roles', { GET: 'whips', '*': BACKCHANNEL }]] },
  // Who is a Whip, Spokesperson and so on. Back-channel: Admin only. Everyone from Whips up reads the list (the Whips pages use it).
  { id: 'roles', match: /^\/roles$/, view: 'roles-page.js', fn: 'renderRoles', level: BACKCHANNEL, group: 'group', tab: 'roles', tabLabel: 'Roles', href: '#/roles',
    card: 'Say who is a Whip, a Spokesperson and so on, and add staff who are not on the Members list.' },
  { id: 'data', match: /^\/data(?:\/(votes|lords))?$/, view: 'data-page.js', fn: 'renderData', params: (m) => ({ sub: m[1] || '' }), level: 'whips',
    group: 'group', tab: 'data', tabLabel: 'Data', href: '#/data', card: 'Voting analysis and the House of Lords Library data dashboards.',
    api: [['data/.*', { '*': 'whips' }]] },
  { id: 'advisers', match: /^\/advisers$/, view: 'advisers-page.js', fn: 'renderAdvisers', level: 'staff', group: 'group', tab: 'advisers', tabLabel: 'Advisers', href: '#/advisers',
    card: 'Every page the advisers use: Bill advisers, groupings, the rota, hymn sheet uploads and data.' },
  { id: 'adviser-editor', match: /^\/adviser-editor$/, view: 'adviser-editor-page.js', fn: 'renderAdviserEditor', level: 'staff', group: 'group', tab: 'advisers',
    api: [['advisers', { '*': 'staff' }], ['groupings', { GET: WHIPS_FEATURES, '*': 'staff' }]] },
  { id: 'bulletin-editor', match: /^\/bulletin-editor$/, view: 'bulletin-editor-page.js', fn: 'renderBulletinEditor', level: 'staff', group: 'group', tab: 'advisers',
    api: [['bulletin', { GET: 'peers', '*': 'staff' }]] },

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
    ['Bill advisers', '#/adviser-editor', 'Say which adviser looks after each Bill. They show on the Legislation page.'],
    ['Groupings, grids and hymn sheets', '#/adviser-editor?tab=groupings', 'Upload the Government Whips\u2019 grouping, check it, and save it to build the grids and hymn sheets.'],
    ['All Bills', '#/legislation', 'Open a Bill for amendments, comments, draft amendments and the Whips\u2019 Office documents.'],
  ]],
  ['Whips', [
    ['Whips page', '#/whips', 'What the Whips see: the duty rota, availability and hymn sheets.'],
    ['Duty Whips: choose the rota', '#/whips/duty', 'Choose the two duty whips for each day.'],
    ['Availability: see who is free', '#/whips/availability', 'Who has marked each day green, amber or red.'],
    ['Hymn Sheets: upload', '#/whips/hymn-sheets', 'Upload hymn sheets for the Whips to download, or delete old ones.'],
  ]],
  ['Data', [
    ['Voting Data', '#/data/votes', 'Government wins and defeats, and where the Lib Dems made the difference.'],
    ['Lords Data', '#/data/lords', 'The House of Lords Library data dashboards.'],
  ]],
  ['Rooms', [
    ['Wallace Room', '#/wallace-room', 'See every booking and book the room. Staff and Admin can cancel anyone\u2019s booking, or a whole repeating series.'],
  ]],
  ['Home page', [
    ['Whips\u2019 Office Bulletin', '#/bulletin-editor', 'Write the messages in the box on the home page. They stay there until you change them.'],
  ]],
  ['Communications', [
    ['Comms', '#/comms', 'The latest posts, and where to update the X, Instagram and LinkedIn posts.'],
  ]],
];

/* ------------------------------------------------------------------ helpers (used by the website, the server and the checker) */

/** The menu items a person at this level sees. */
export const menuFor = (level) => MENU.filter((m) => atLeast(level, m.level));

/** The buttons (and hub cards) of a group that a person at this level may open. */
export const tabsFor = (group, level) => PAGES.filter((p) => p.group === group && p.tabLabel && atLeast(level, p.level))
  .map((p) => ({ tab: p.tab, label: p.tabLabel, href: p.href, card: p.card }));

/** For a page that matched an address: which menu item to highlight, and which group and button it sits under. */
export function placeOf(page, m, ctx) {
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
