// Quick self-test: parses a sample of the Whips' Today's Lists and prints the result.
// Run with `npm run check` after changing lib/business.js.
import { parseWhipsTodaysList } from '../../lib/libby/business.js';

const sample = `MONDAY 21 OCTOBER 2024
Business in the Chamber at 2.30pm
Oral Questions (40 minutes)
* Lord Sandhurst to ask His Majesty’s Government what steps they are taking to prevent reoffending.  (Lord Timpson, MoJ)
Questions on an Oral Statement made in the House of Commons on Thursday 17 October (40 minutes)
‘Government’s Childcare Expansion’ – Baroness Smith of Malvern (Department for Education)
Main Business
Passenger Railway Services (Public Ownership) Bill – Committee (day 1 of 2) – Lord Hendy of Richmond Hill
Grouping of amendments:
A1, 2, 21

1, 30, 48
Estimated rising time
The House is expected to rise at around 10pm.
Business in Grand Committee in the Moses Room at 3.45pm
Russia (Sanctions) (EU Exit) (Amendment) (No. 4) Regulations 2024 – Consideration in Grand Committee – Baroness Chapman of Darlington
Notes:`;

const r = parseWhipsTodaysList(sample);
const kinds = r.sections.flatMap((s) => s.items.map((i) => i.kind)).join(',');
const expected = 'oq,statement,legislation,si';
console.log(JSON.stringify(r, null, 2));
if (kinds !== expected || r.date !== '2024-10-21') { console.error(`FAIL: got ${kinds}`); process.exit(1); }
console.log('\nParser OK');
