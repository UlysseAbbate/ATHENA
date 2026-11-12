// THE LIST OF PAGES. This is the one place to change when you add or move a page.
//
// Everything else follows it: the menu, the routes, the hub pages (Business, LD Peers' Group), the row of subpage buttons,
// the home page cards and who may open each page. The server reads it too, for who may use each /api route.
// It holds only plain data and small helper functions (no page code), so both the website and the server can load it.
//
// To add a page: write public/js/views/<name>-page.js, then add ONE entry to PAGES below. See docs/adding-a-page.md.

/* ------------------------------------------------------------------ levels */

// The roles, lowest to highest. A person has one role. Each role has a rank, and roles with the same rank may do the same things:
//   backbench, frontbench    Backbench / Frontbencher parliamentarian: read, and the Data page (for now, as Peers always had)
//   whips                    Whip: also the Whips Hub (availability for whipping, the data, parliamentary process)
//   leader                   Leader's circle: everything except the back-end (the back-end is the Admin's alone), including POLD Staff
//   admin                    Administrator: everything, including the back-end (back-channel) operations. Not other programs: only the site's owner has those
//   <role>_staff             each role's Staff (backbench_staff, frontbench_staff, whips_staff, leader_staff) have exactly their principal's access
// To give one of these roles more or less access later, change its number here (and the lists below).
//   beta           Beta tester: ONLY the pages marked `beta: true` below (today only Data), read-only. Not a step on the ladder:
//                  see canOpenPage() and betaMay(), which are what keep a beta tester out of everything else
//   developer      the Developer site: everything, plus the pages marked `level: DEVELOPER` (work in progress). Only the admin can give it,
//                  and the admin always has it
// The names `peers`, `spokesperson` and `staff` are the older names: `peers` and `staff` are still what the page and route lists below say for "at least this rank"
// (rank 1, and rank 3, Leader's circle), and all three keep their rank so nobody is locked out while the database is brought up to date.
export const RANK = {
  beta: 1, backbench: 1, backbench_staff: 1, frontbench: 1, frontbench_staff: 1, whips: 2, whips_staff: 2, leader: 3, leader_staff: 3, admin: 4, developer: 5,
  peers: 1, spokesperson: 1, staff: 3,
};
export const LEVEL_NAMES = {
  beta: 'Beta tester', backbench: 'Backbench parliamentarian', frontbench: 'Frontbencher parliamentarian', whips: 'Whip', leader: 'Leader\u2019s circle',
  backbench_staff: 'Backbench parliamentarian\u2019s Staff', frontbench_staff: 'Frontbencher parliamentarian\u2019s Staff', whips_staff: 'Whip\u2019s Staff', leader_staff: 'Leader\u2019s circle\u2019s Staff',
  admin: 'Administrator', developer: 'Developer', peers: 'Backbench parliamentarian', spokesperson: 'Frontbencher parliamentarian', staff: 'Leader\u2019s circle',
};
export const BETA = 'beta';
export const DEVELOPER = 'developer';
/** The roles in the order they are offered on the sign-in page and in the roles table. */
export const ROLE_ORDER = ['backbench', 'frontbench', 'whips', 'leader', 'backbench_staff', 'frontbench_staff', 'whips_staff', 'leader_staff', 'admin'];

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

// FOR NOW the lowest ranks open only part of LIBBY (the rest is built and waiting). What each rank may open:
//   rank 1 (Backbench and Frontbencher parliamentarians, their Staff, Beta testers)   the Data page only, as Peers always had
//   rank 2 (Whips and Whip's Staff)                                                  the Whips Hub too: availability for whipping, the data, parliamentary process
//   rank 3 and above (Leader's circle and its Staff, Administrator, Developer)       everything their level allows: Leader's circle everything except the back-end
// The pages are listed by id, the /api routes by name. The server enforces the same lists (functions/api/libby/_middleware.js).
const BASIC_OPEN = { pages: ['home', 'data'], routes: ['data/.*', 'status', 'ld-peers'], write: [] };
const WHIPS_OPEN = { pages: ['home', 'data', 'whips-office', 'whips', 'lds150', 'parliamentary-process', 'issues-tracker', 'concessionometer'], routes: [...BASIC_OPEN.routes, 'whip-availability', 'people-roles', 'parliamentary-process', 'issues', 'concessions'], write: ['whip-availability', 'parliamentary-process', 'issues'] };
/** What this level may open for now: { pages, routes (reads), write (any request) }, or null if it is not held back. */
export const openFor = (level) => (RANK[level] >= 3 ? null : RANK[level] === 2 ? WHIPS_OPEN : BASIC_OPEN);
/** True if this level is held to part of LIBBY for now. */
export const isRestricted = (level) => openFor(level) !== null;
/** May a restricted level make this request? Reading what is behind its open pages, and writing only where its open pages save. */
export function liveMay(method, path, level) {
  const open = openFor(level);
  if (!open) return true;
  const hit = (list) => list.some((route) => new RegExp(`^/api/libby/(?:${route})$`).test(path));
  return (['GET', 'HEAD'].includes(String(method || 'GET').toUpperCase()) && hit(open.routes)) || hit(open.write);
}

/** May a person at this level open this page, in this House? A beta tester may open only the pages marked `beta: true`; everyone else goes by level; restricted levels only the live pages. */
export const canOpenPage = (page, level, house = 'lords') => inHouse(page, house) && (!isRestricted(level) || openFor(level).pages.includes(page.id))
  && (level === BETA ? !!page.beta : atLeast(level, page.level));

/* ------------------------------------------------------------------ the menu */

// The top menu, in order. `level` is the lowest level that sees the item; `beta: true` shows it to beta testers too. `title` and `text` are used for the home page card.
// Today and Business have buttons at the top to switch between Honourable LIBBY (the Commons, green) and Noble LIBBY (the Lords, red).
export const MENU = [
  { id: 'today', label: 'Today', href: '#/today', level: 'peers', beta: true, house: 'both', title: "Today's business", text: 'What is happening in the Commons or the Lords today: the order of business, Oral Questions and the committees.' },
  { id: 'business', label: 'Business', href: '#/business', level: 'peers', beta: true, house: 'both', title: 'Business', text: 'The coming weeks by calendar or by portfolio, and past business (votes, questions, committees, Hansard).' },
  { id: 'legislation', label: 'Legislation', href: '#/legislation', level: 'peers', beta: true, house: 'both', title: 'Legislation', text: 'Every live Bill in Parliament: where it is, the next stage, the documents for each stage and the amendments.' },
  { id: 'lds150', label: 'Lib Dems 150', href: '#/lib-dems-150', level: 'peers', beta: true, house: 'both', title: 'Lib Dems 150', text: 'Policy, Comms, the Wallace Room, Room 391, Ask a Parliamentarian, Parliamentary process and the guides.' },
  // Data: the one page every level has for now (for Whips and above it also sits under the Whips' page, so this item is only for the restricted levels)
  { id: 'data', label: 'Data', href: '#/data', level: 'peers', beta: true, liveOnly: true, house: 'both', title: 'Data', text: 'Voting analysis for the Lords and the Commons, and the Lords and Commons data.' },
  { id: 'whips-office', label: 'Whips Hub', href: '#/whips-office', level: 'whips', house: 'both', title: 'Whips Hub', text: 'Availability for whipping, the voting analysis and data for the Lords and the Commons, the Issues Tracker and the Concessionometer.' },
  { id: 'advisers-office', label: 'POLD Staff', href: '#/advisers-office', level: 'staff', house: 'both', title: 'POLD Staff', text: 'Bill advisers and leads, groupings and grids, the bulletin, the duty rota and the roles.' },
  { id: 'developer', label: 'Developer', href: '#/developer', level: DEVELOPER, house: 'both', title: 'Developer', text: 'Work in progress, and a register of every page and who can open it. Visible only to you.' },
];

// What a beta tester sees in the menu: the items marked `beta: true`.
export const BETA_MENU = MENU.filter((m) => m.beta && !m.liveOnly);

// Groups of subpages. Each group is shown as a hub page (cards) and as a row of buttons above each of its pages.
export const GROUPS = {
  business: { title: 'Business', intro: 'What Parliament will do, what it has done, and what the team has been saying.' },
  lds150: { title: 'Lib Dems 150', intro: 'Policy, Comms, the rooms, Ask a Parliamentarian, Parliamentary process and the guides.' },
  'whips-office': { title: 'Whips Hub', intro: 'For Whips and above: availability for whipping, the data, the Issues Tracker and the Concessionometer.' },
  'advisers-office': { title: 'POLD Staff', intro: 'For Staff and Admin: the tools for Bills, the bulletin and the rota, and who has which role.' },
};

// Buttons on the Lib Dems 150 page that open a guide. A link that is not known yet is left empty: the button then says the link is to come.
export const LD150_LINKS = [
  ['Organogram', 'https://libdemsparli.retool.com/embedded/public/c9c6ad33-7973-479f-b03b-5a5f4f4b53c2/LibDems', 'Who is who across the Liberal Democrats in Parliament.'],
  ['Rolling Top Lines', 'https://docs.google.com/document/d/1VVIfo4wl5TTxC_Laemh8SpNHL_rlk7cCEYXoB_gH-2g/edit?tab=t.0', 'The current top lines, kept up to date.'],
  ['Parliamentary Best Practice', 'https://docs.google.com/document/d/1eY_1B7R_doY1W0fcNz7U-aG9evOqslUR5TvZb_Kt5q4/edit?tab=t.0#heading=h.hyjxbekzuzan', 'How to get the most out of Parliament.'],
  ['MPs Staff New Starter Guide', 'https://docs.google.com/document/d/1F-Q1Nqp8mc8ALR19U6IDMhgid7Q1TMt0ntJ9E9SMTdQ/edit?tab=t.0', 'A guide for new members of MPs\u2019 staff.'],
  ['The Mill', 'https://the-mill.jericho.ac/home', 'The Mill.'],
  ['Campaigns Hub', 'https://drive.google.com/drive/folders/1mxKC4eWwXpc4YfOJukLbNqinBmEsafbc', 'The Campaigns Hub.'],
];

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
// Reads a beta tester may make (read-only) for the pages marked `beta: true`, beyond the routes listed under `api`.
const BETA_READS = ['ld-peers', 'live', 'bulletin', 'day/.*', 'bills', 'bills/.*', 'previous-bills', 'statutory-instruments', 'statutory-instruments/.*', 'bill-extras', 'bill-next', 'future', 'portfolios', 'portfolios/.*', 'commons/.*', 'past/.*', 'item-links', 'event-speakers',
  'policy/.*', 'room-bookings', 'ask-parliamentarian', 'bill-team', 'comms', 'todays-list'];

export const PAGES = [
  { id: 'home', match: /^\/?$/, view: 'home-page.js', fn: 'renderHome', nav: '', beta: true, house: 'both', betaApi: BETA_READS },

  // Today: the Commons or the Lords, by the buttons at the top (the day pages are the same two views for any date)
  { id: 'today', match: /^\/today$/, view: 'today-page.js', fn: 'renderToday', params: (m, c) => ({ date: c.today }), nav: 'today', beta: true, house: 'both', switch: true,
    api: [['oq-suggest', { '*': WHIPS_FEATURES }], ['todays-list', { '*': WHIPS_FEATURES }],
      ['debate-speakers', { '*': WHIPS_FEATURES }],
      // The Committee and Report group timings are for Whips and above to read; Staff note when a group really started.
      ['legislative-timing', { GET: 'whips', '*': WHIPS_FEATURES }]] },
  { id: 'day', match: /^\/day\/(\d{4}-\d{2}-\d{2})$/, view: 'day-page.js', fn: 'renderDay', params: (m) => ({ date: m[1] }),
    nav: (m, c) => (m[1] === c.today ? 'today' : ''), group: 'business', tab: 'future', beta: true, house: 'lords', switch: true },
  { id: 'c-day', match: /^\/c\/day\/(\d{4}-\d{2}-\d{2})$/, view: 'commons-day-page.js', fn: 'renderCommonsDay', params: (m) => ({ date: m[1] }),
    nav: (m, c) => (m[1] === c.today ? 'today' : ''), group: 'business', tab: 'future', beta: true, house: 'commons', switch: true },

  // Legislation: every live Bill, in either House
  { id: 'legislation', match: /^\/legislation(?:\/(previous|statutory-instruments))?$/, view: 'legislation-page.js', fn: 'renderLegislation', params: (m) => ({ tab: m[1] || 'live' }), nav: 'legislation', beta: true, house: 'both' },
  { id: 'si', match: /^\/si\/([0-9a-fA-F-]+)$/, view: 'si-page.js', fn: 'renderSI', params: (m) => ({ id: m[1] }), nav: 'legislation', beta: true, house: 'both' },
  { id: 'bill', match: /^\/bill\/(\d+)$/, view: 'bill-page.js', fn: 'renderBill', params: (m) => ({ id: m[1] }), nav: 'legislation', beta: true, house: 'both',
    api: [['comments|grid-text|draft-amendment', { '*': WHIPS_FEATURES }],
      // Stakeholder notes and amendment flags are internal: Whips and above may read them, WHIPS_FEATURES may change them.
      ['bill-stakeholders|amendment-flags', { GET: 'whips', '*': WHIPS_FEATURES }],
      ['bills/.*/update-summary', { '*': WHIPS_FEATURES }]] },
  { id: 'c-bill', match: /^\/c\/bill\/(\d+)$/, view: 'bill-page.js', fn: 'renderBill', params: (m) => ({ id: m[1], house: 'commons' }), nav: 'legislation', beta: true, house: 'both' },

  // Business: the coming weeks by calendar or by portfolio, past business and Comms
  { id: 'business', match: /^\/business$/, view: 'group-page.js', fn: 'renderGroupPage', params: () => ({ group: 'business' }), nav: 'business', beta: true, house: 'both', switch: true },
  { id: 'future', match: /^\/future$/, view: 'future-page.js', fn: 'renderFuture', group: 'business', tab: 'future', tabLabel: 'Future', href: '#/future', beta: true, house: 'both', switch: true,
    card: 'The coming weeks by calendar or by portfolio: Oral Questions, legislation, secondary legislation and committee reports.' },
  { id: 'portfolio', match: /^\/portfolio\/([A-Za-z]+)$/, view: 'portfolio-page.js', fn: 'renderPortfolio', params: (m) => ({ code: m[1].toUpperCase() }), group: 'business', tab: 'future', beta: true, house: 'both', switch: true },
  { id: 'past', match: /^\/past(?:\/([a-z]+)(?:\/([a-z]+))?)?$/, view: 'past-page.js', fn: 'renderPast', params: (m) => ({ kind: m[1] || '', sub: m[2] || '' }),
    group: 'business', tab: 'past', tabLabel: 'Past', href: '#/past', beta: true, house: 'both', switch: true, card: 'Divisions, written questions and statements, committee work and Hansard.' },
  // Lib Dems 150: the parts of the old LD Peers' Group page that are not for the Whips or the advisers
  { id: 'lds150', match: /^\/lib-dems-150$/, view: 'lds150-page.js', fn: 'renderLds150', nav: 'lds150', beta: true, house: 'both' },
  { id: 'policy', match: /^\/policy$/, view: 'policy-page.js', fn: 'renderPolicy', group: 'lds150', tab: 'policy', tabLabel: 'Policy', href: '#/policy', beta: true, house: 'both',
    card: 'Search conference motions and policy papers, or browse them by portfolio.' },
  { id: 'wallace-room', match: /^\/wallace-room$/, view: 'wallace-room-page.js', fn: 'renderWallaceRoom', params: () => ({ room: 'wallace' }), group: 'lds150', tab: 'wallace', tabLabel: 'Wallace Room', href: '#/wallace-room', beta: true, house: 'both',
    card: 'Book the Wallace Room: see who has it and when, by week or month, and book it once or on a repeat.',
    api: [['room-bookings', { GET: 'peers', '*': 'peers' }]] },
  { id: 'room-391', match: /^\/room-391$/, view: 'wallace-room-page.js', fn: 'renderWallaceRoom', params: () => ({ room: '391' }), group: 'lds150', tab: 'room391', tabLabel: 'Room 391', href: '#/room-391', beta: true, house: 'both',
    card: 'Book Room 391, in the same way as the Wallace Room.' },
  { id: 'ask-parliamentarian', match: /^\/ask-parliamentarian$/, view: 'ask-page.js', fn: 'renderAsk', group: 'lds150', tab: 'ask', tabLabel: 'Ask a Parliamentarian', href: '#/ask-parliamentarian', beta: true, house: 'both',
    card: 'Ask for help (attend an AGM, work experience support ...) by a date; parliamentarians and their staff answer by offering support.',
    api: [['ask-parliamentarian', { GET: 'peers', '*': 'peers' }]] },
  { id: 'parliamentary-process', match: /^\/parliamentary-process$/, view: 'process-page.js', fn: 'renderProcess', group: 'lds150', tab: 'process', tabLabel: 'Parliamentary process', href: '#/parliamentary-process', house: 'both',
    card: 'Ask a question about procedure: answered from Erskine May (the Commons) and the Lords Companion, with the passages it used.',
    api: [['parliamentary-process', { GET: 'peers', '*': 'peers' }], ['process-companion', { GET: 'whips', '*': WHIPS_FEATURES }]] },
  { id: 'comms', match: /^\/comms$/, view: 'comms-page.js', fn: 'renderComms', group: 'lds150', tab: 'comms', tabLabel: 'Comms', href: '#/comms', beta: true, house: 'lords',
    card: 'The latest posts from the Lib Dem Lords team on Bluesky, X, Instagram and LinkedIn.',
    api: [['comms', { GET: 'peers', '*': WHIPS_FEATURES }]] },

  // The Whips' page (Whips and above): availability for whipping, and the data
  { id: 'whips-office', match: /^\/whips-office$/, view: 'group-page.js', fn: 'renderGroupPage', params: () => ({ group: 'whips-office' }), level: 'whips', nav: 'whips-office', house: 'both' },
  { id: 'whips', match: /^\/whips(?:\/availability)?$/, view: 'whips-page.js', fn: 'renderWhips', level: 'whips',
    group: 'whips-office', tab: 'availability', tabLabel: 'Availability', href: '#/whips', house: 'both', card: 'Mark the days you would prefer to be duty whip, have no preference, or are not free.',
    api: [['whip-availability', { GET: 'whips', '*': 'whips' }], ['people-roles', { GET: 'whips', '*': BACKCHANNEL }]] },
  { id: 'data', match: /^\/data(?:\/(votes|lords|commons))?$/, view: 'data-page.js', fn: 'renderData', params: (m) => ({ sub: m[1] || '' }), level: 'peers', beta: true,
    group: 'whips-office', tab: 'data', tabLabel: 'Data', href: '#/data', house: 'both', card: 'Voting analysis for the Lords and the Commons, and the Lords and Commons data.',
    api: [['data/.*', { '*': 'peers' }]], betaApi: ['data/.*'] },

  // The Advisers' page (Staff and above): the advisers' tools, and the roles
  { id: 'issues-tracker', match: /^\/issues-tracker$/, view: 'issues-page.js', fn: 'renderIssues', level: 'whips', group: 'whips-office', tab: 'issues', tabLabel: 'Issues Tracker', href: '#/issues-tracker', house: 'both',
    card: 'Campaigns and long-standing issues by portfolio, with everything done on each: questions, debates, legislation, amendments, who was responsible, and notes.',
    api: [['issues', { GET: 'whips', '*': 'whips' }]] },
  { id: 'concessionometer', match: /^\/concessionometer$/, view: 'concessionometer-page.js', fn: 'renderConcessionometer', level: 'whips', group: 'whips-office', tab: 'concessions', tabLabel: 'Concessionometer', href: '#/concessionometer', house: 'both',
    card: 'Every amendment we have won a concession on, with the Bill’s portfolio and the POLD Staff’s notes. Kept after the Bill has passed.',
    api: [['concessions', { GET: 'whips', '*': WHIPS_FEATURES }]] },
  { id: 'advisers-office', match: /^\/advisers-office$/, view: 'group-page.js', fn: 'renderGroupPage', params: () => ({ group: 'advisers-office' }), level: 'staff', nav: 'advisers-office', house: 'both' },
  { id: 'advisers', match: /^\/advisers$/, view: 'advisers-page.js', fn: 'renderAdvisers', level: 'staff', group: 'advisers-office', tab: 'advisers', tabLabel: 'Advisers', href: '#/advisers', house: 'both',
    card: 'Every page the advisers use: Bill advisers, groupings and grids, the bulletin, the duty rota, availability, the Wallace Room and Room 391.' },
  { id: 'roles', match: /^\/roles$/, view: 'roles-page.js', fn: 'renderRoles', level: BACKCHANNEL, group: 'advisers-office', tab: 'roles', tabLabel: 'Roles', href: '#/roles', house: 'both',
    card: 'Say who is a Backbench or Frontbencher parliamentarian, a Whip, in the Leader’s circle, their Staff, or an Administrator, and add staff who are not on the Members lists.' },
  // Duty Whips: Staff choose the rota (on the Advisers page; the rota itself shows on every day's page)
  { id: 'duty-whips', match: /^\/duty-whips$/, view: 'duty-page.js', fn: 'renderDuty', level: 'staff', group: 'advisers-office', tab: 'advisers', house: 'both',
    api: [['duty-whips', { GET: 'whips', '*': 'staff' }]] },
  { id: 'adviser-editor', match: /^\/adviser-editor$/, view: 'adviser-editor-page.js', fn: 'renderAdviserEditor', level: 'staff', group: 'advisers-office', tab: 'advisers', house: 'both',
    api: [['advisers', { '*': 'staff' }], ['groupings', { GET: WHIPS_FEATURES, '*': 'staff' }]] },
  { id: 'bulletin-editor', match: /^\/bulletin-editor$/, view: 'bulletin-editor-page.js', fn: 'renderBulletinEditor', level: 'staff', group: 'advisers-office', tab: 'advisers', house: 'both',
    api: [['bulletin', { GET: 'peers', '*': 'staff' }]] },

  // The Developer site: you only (the admin). Put work in progress here, with `level: DEVELOPER`, until it is ready to go live.
  { id: 'developer', match: /^\/developer$/, view: 'developer-page.js', fn: 'renderDeveloper', level: DEVELOPER, nav: 'developer', house: 'both' },
  // Team & access: the administrator's alone (the button is in the footer). The page reads the database directly, which answers only the administrator.
  { id: 'team', match: /^\/team$/, view: 'team-page.js', fn: 'renderTeam', level: BACKCHANNEL, nav: '', house: 'both' },
];

// Routes that are not tied to one page.
export const SHARED_API = [
  ['me', { '*': 'peers' }],
];

/* ------------------------------------------------------------------ the Advisers page */

// The buttons on the Advisers page (Staff and Admin): [ section, [ [button, address, what it is for] ] ].
export const ADVISER_LINKS = [
  ['Legislation', [
    ['Update Bill advisers and leads', '#/adviser-editor', 'Name the adviser and the Bill lead for each Bill, in the Commons and the Lords. They show at the top of the Bill\u2019s page.'],
    ['Upload Groupings, Grids & Hymn Sheets', '#/adviser-editor?tab=groupings', 'Upload the Government Whips\u2019 grouping, check it, and save it to build the grids and hymn sheets.'],
  ]],
  ['Whipping', [
    ['Whips\u2019 Office Bulletin', '#/bulletin-editor', 'Write the messages in the box on the home page. They stay there until you change them.'],
    ['Duty Whips: choose the rota', '#/duty-whips', 'Choose the two duty whips for each day.'],
    ['Availability: see who is free', '#/whips', 'Who has marked each day green, amber or red.'],
  ]],
  ['Upload a spreadsheet', [
    ['Import concessions', '#/concessionometer', 'Open "Import Concessions from a spreadsheet" at the top: Bill, when it was won, portfolio and notes.'],
    ['Import campaigns and actions', '#/issues-tracker', 'Open "Import Issues Tracker from a spreadsheet" at the top: one row for each thing done, with its campaign and portfolio.'],
    ['Import Bulletin messages', '#/bulletin-editor', 'Open "Import Bulletin messages from a spreadsheet" at the top: a heading and a message on each row.'],
    ['Import roles', '#/roles', 'Open "Import Roles from a spreadsheet": a name and a role on each row.'],
  ]],
  ['Office', [
    ['Wallace Room', '#/wallace-room', 'See every booking and book the room. Staff and Admin can cancel anyone\u2019s booking, or a whole repeating series.'],
    ['Room 391', '#/room-391', 'The same for Room 391: see every booking and book the room. Staff and Admin can cancel anyone\u2019s booking, or a whole repeating series.'],
  ]],
];

/* ------------------------------------------------------------------ helpers (used by the website, the server and the checker) */

/** The menu items a person at this level sees, in this House. */
export const menuFor = (level, house = 'lords') => {
  const open = openFor(level);
  const may = (m) => (level === BETA ? m.beta : atLeast(level, m.level));
  // for a restricted level: its open pages; the Data item (liveOnly) only if the Whips Hub, which holds Data too, is not open
  const items = open ? MENU.filter((m) => may(m) && (m.liveOnly ? !open.pages.includes('whips-office') : open.pages.includes(m.id))) : MENU.filter((m) => !m.liveOnly && atLeast(level, m.level));
  return items.filter((m) => inHouse(m, house));
};

/** The buttons (and hub cards) of a group that a person at this level may open, in this House. */
export const tabsFor = (group, level, house = 'lords') => PAGES.filter((p) => p.group === group && p.tabLabel && canOpenPage(p, level, house))
  .map((p) => ({ tab: p.tab, label: p.tabLabel, href: p.href, card: p.card }));

/** For a page that matched an address: which menu item to highlight, and which group and button it sits under. */
export function placeOf(page, m, ctx, level) {
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

/** What a beta tester may ask the server for: reading only, and only the routes a page marked `beta: true` lists under `betaApi` (plus /me, handled by the server). Nothing is allowed just because a Peer may read it. */
const BETA_ROUTES = [...new Set([...PAGES.filter((p) => p.beta).flatMap((p) => p.betaApi || []), 'status'])]
  .map((route) => new RegExp(`^/api/libby/(?:${route})$`));
export const betaMay = (method, path) => ['GET', 'HEAD'].includes(String(method || 'GET').toUpperCase()) && BETA_ROUTES.some((re) => re.test(path));
