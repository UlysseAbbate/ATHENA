// Checks who may see which room bookings (Wallace Room, Room 391): the Whips and above and the account that made a booking see it in full;
// everyone else gets only "booked" (no name, no note, no series), and the server never sends them the rest.
// Run: node scripts/libby/check-rooms.mjs
import { toBooking, mayManage, maySee, isOwner, onRequestGet } from '../../functions/api/libby/room-bookings.js';

let failed = 0;
const ok = (cond, name) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`); if (!cond) failed++; };

const row = { id: 7, series_id: 3, peer: 'Lord Secret', note: 'Budget briefing', start_at: '2026-12-01T10:00:00', end_at: '2026-12-01T11:00:00', booked_by_email: 'office@example.org', locked: false };
const asWhip = { level: 'whips', email: 'whip@example.org' }, asStaff = { level: 'staff', email: 's@example.org' };
const asOwner = { level: 'peers', email: 'office@example.org' }, asOther = { level: 'peers', email: 'someone@example.org' }, asNobody = { level: 'peers', email: '' };

ok(toBooking(row, asWhip).peer === 'Lord Secret' && toBooking(row, asWhip).note === 'Budget briefing' && toBooking(row, asStaff).peer === 'Lord Secret', 'the Whips and above see who booked and the note');
ok(toBooking(row, asOwner).peer === 'Lord Secret' && toBooking(row, asOwner).mine === true && toBooking(row, asOwner).manage, 'the account that made the booking sees it in full');
const masked = toBooking(row, asOther);
ok(masked.peer === '' && masked.note === '' && masked.seriesId === null && masked.manage === false && masked.mine === false && masked.start === '10:00' && masked.date === '2026-12-01', 'anyone else sees only that the slot is booked, and when');
ok(!JSON.stringify(masked).includes('Secret') && !JSON.stringify(masked).includes('Budget') && !JSON.stringify(masked).includes('office@example.org'), 'nothing that identifies the booker is in what they are sent');
ok(toBooking(row, asNobody).peer === '' && !isOwner({ ...row, booked_by_email: null }, asNobody), 'an account with no email is never an owner, and a booking made before owners were recorded belongs to no one');
ok(mayManage(row, asWhip) && mayManage(row, asOwner) && !mayManage(row, asOther) && !mayManage({ ...row, booked_by_email: null }, asOther), 'the booker and the Whips can change a booking; others cannot');
ok(toBooking({ ...row, locked: true }, asOther).locked === true, 'a booking set in stone says so to everyone, so it cannot be requested');

// teams: people in a team with the booker see the booking in full, but cannot change it, and a team never changes anyone's level
const mate = { level: 'peers', email: 'mate@example.org', team: new Set(['office@example.org']) };
const tb = toBooking(row, mate);
ok(tb.peer === 'Lord Secret' && tb.note === 'Budget briefing' && tb.visible && tb.team && !tb.manage && !mayManage(row, mate), 'a teammate of the booker sees the booking in full but cannot change it');
ok(toBooking({ ...row, booked_by_email: 'stranger@example.org' }, mate).peer === '' && !maySee({ ...row, booked_by_email: 'stranger@example.org' }, mate), 'and sees nothing more of anyone outside their team');
const adminMate = { level: 'admin', email: 'admin@example.org' };
ok(toBooking(row, { ...asOther, team: new Set(['admin@example.org']) }).manage === false && mayManage(row, adminMate), 'being in a team with an administrator gives no one more rights than their own level');
ok(toBooking(row, { ...asOther, team: new Set() }).peer === '' && toBooking({ ...row, booked_by_email: null }, mate).peer === '', 'with no team, or for a booking with no recorded owner, nothing is shared');

// the route itself, with a stand-in for the database
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  const body = u.includes('/room_bookings') ? [row, { ...row, id: 8, series_id: null, peer: 'Baroness Mine', note: 'Mine', booked_by_email: 'someone@example.org', start_at: '2026-12-01T13:00:00', end_at: '2026-12-01T14:00:00' }]
    : u.includes('/room_series') ? [{ id: 3, peer: 'Lord Secret', rule: { from: '2026-12-01', until: '2026-12-29', every: 1, days: [1], start: '10:00', end: '11:00' } }]
    : u.includes('/room_requests') ? [{ booking_id: 7 }]
    : u.includes('/libby_team_members') ? (u.includes('select=team_id') ? (u.includes('mate%40example.org') ? [{ team_id: 1 }] : []) : [{ email: 'office@example.org' }, { email: 'mate@example.org' }])
    : u.includes('/libby_teams') ? [{ name: 'Leader\u2019s office' }] : [];
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const get = async (data) => (await onRequestGet({ request: new Request('https://athena.test/api/libby/room-bookings?room=wallace&from=2026-11-30&to=2026-12-06'), env, data })).json();
const forOther = await get({ level: 'peers', email: 'someone@example.org' });
const text = JSON.stringify(forOther);
ok(!text.includes('Lord Secret') && !text.includes('Budget briefing') && forOther.bookings.find((b) => b.id === 7).peer === '' && Object.keys(forOther.series).length === 0, 'the server does not send another account’s booking details or its repeat to someone below the Whips');
ok(forOther.bookings.find((b) => b.id === 8).peer === 'Baroness Mine' && forOther.bookings.find((b) => b.id === 8).mine === true, 'but sends them their own booking in full');
ok(forOther.bookings.find((b) => b.id === 7).requested === true, 'and tells them which slots they have already asked for');
const forMate = await get({ level: 'peers', email: 'mate@example.org' });
ok(forMate.bookings.find((b) => b.id === 7).peer === 'Lord Secret' && forMate.bookings.find((b) => b.id === 7).manage === false && forMate.teams[0] === 'Leader\u2019s office', 'the route sends a teammate the booking in full (view only) and names their team');
ok(forMate.bookings.find((b) => b.id === 8).peer === 'Baroness Mine' || forMate.bookings.find((b) => b.id === 8).peer === '', 'and no one outside the team is ever named by accident');
const forWhip = await get({ level: 'whips', email: 'whip@example.org' });
ok(forWhip.bookings.find((b) => b.id === 7).peer === 'Lord Secret' && forWhip.series[3] && forWhip.bookings.every((b) => b.manage), 'the Whips get everything');
globalThis.fetch = realFetch;

console.log(failed ? `\n${failed} check(s) failed` : '\nAll room checks passed.');
process.exit(failed ? 1 : 0);
