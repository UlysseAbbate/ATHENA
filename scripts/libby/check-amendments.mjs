// The shortened place in the Bill: "Clause 3, page 2, line 14" -> "C3, P2, L14". Run: node scripts/libby/check-amendments.mjs
import { shortPlace } from '../../site/libby/js/amendments-table.js';
const cases = [
  ['Clause 3, page 2, line 14', 'C3, P2, L14'],
  ['Clause 12A, page 10, line 3', 'C12A, P10, L3'],
  ['New Clause (after Clause 5)', 'New Clause (after C5)'],
  ['Clause 4 stand part / leave out', 'C4 stand part / leave out'],
  ['Schedule 2, page 40, line 9', 'Schedule 2, P40, L9'],
  ['', ''],
];
let failed = 0;
for (const [from, want] of cases) { const got = shortPlace(from); if (got !== want) { failed++; console.log(`FAIL  ${from} -> ${got} (wanted ${want})`); } }
console.log(failed ? `${failed} failed` : 'Amendment places OK');
process.exit(failed ? 1 : 0);
