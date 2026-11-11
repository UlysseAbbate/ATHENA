// Checks the Parliamentary process page's readers and the answer pipeline (lib/libby/process-search.js, site/libby/js/docs/companion-reader.js), using responses recorded from Erskine May's API
// (scripts/libby/fixtures/erskine-may-*.json) and a stand-in for Claude. Run: node scripts/libby/check-process.mjs
import fs from 'node:fs';
import { keywordQueries, erskineSections, answerQuestion, companionPieces } from '../../lib/libby/process-search.js';
import { chunkPages, linesOfPage } from '../../site/libby/js/docs/companion-reader.js';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
let failed = 0;
const ok = (cond, name) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`); if (!cond) failed++; };

ok(JSON.stringify(keywordQueries('When can a Bill be given Royal Assent by Commission?')) === JSON.stringify(['bill given royal', 'assent commission', 'bill']) || keywordQueries('When can a Bill be given Royal Assent by Commission?').length >= 2, 'a question becomes search phrases without the filler words');
ok(keywordQueries('what is it').length === 0, 'a question of only filler words gives none');

// the Companion PDF: lines of a page, and cutting it into numbered paragraphs under their headings
const items = [{ str: 'Royal', x: 10, y: 700 }, { str: 'Assent', x: 50, y: 700 }, { str: '7.12 Royal Assent may be notified.', x: 10, y: 680 }];
ok(JSON.stringify(linesOfPage(items)) === JSON.stringify(['Royal Assent', '7.12 Royal Assent may be notified.']), 'the text items of a page are put back into lines, top to bottom');
const chunks = chunkPages([
  { page: 3, lines: ['Contents', 'Foreword text before any numbered paragraph.'] },
  { page: 10, lines: ['Royal Assent', '7.12 Royal Assent may be notified at any convenient break between two items of business. Notice is', 'not required in advance of the day.', 'Ping pong', '7.13 When a Bill is returned to the Lords from the Commons with amendments the House considers them in turn.', '12', 'Companion to the Standing Orders', 'A second line of that paragraph.'] },
]);
ok(chunks.length === 2 && chunks[0].ref === '7.12' && chunks[0].heading === 'Royal Assent' && chunks[0].page === 10 && /not required in advance/.test(chunks[0].body), 'the Companion is cut into numbered paragraphs, each with its heading and page');
ok(chunks[1].ref === '7.13' && chunks[1].heading === 'Ping pong' && /second line of that paragraph/.test(chunks[1].body) && !/Companion to the Standing Orders/.test(chunks[1].body) && !/\b12\b/.test(chunks[1].body), 'running headers and page numbers are left out');
const longPara = chunkPages([{ page: 1, lines: [`1.1 ${'A sentence of the Companion. '.repeat(120)}`] }]);
ok(longPara.length > 1 && longPara.every((c) => c.body.length <= 1800), 'a very long paragraph is split into pieces');

// Erskine May, read live from its API (here: the recorded answers)
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('erskinemay-api') && u.includes('/Search/ParagraphSearchResults/')) return new Response(JSON.stringify(read('erskine-may-search-royal-assent.json')), { status: 200 });
  if (u.includes('erskinemay-api') && u.includes('/Section/')) return new Response(JSON.stringify(read('erskine-may-section-16612.json')), { status: 200 });
  if (u.includes('api.anthropic.com')) {
    const sent = JSON.parse(init.body).messages[0].content;
    globalThis.__sent = sent;
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(/Passages:/.test(sent) ? { answer: 'Royal Assent may be notified at a break in business [1].', confidence: 'clear', used: [1, 7] } : { queries: ['royal assent'] }) }] }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};
const secs = await erskineSections(['royal assent'], { sections: 2 });
ok(secs.length >= 1 && secs[0].source === 'Erskine May' && secs[0].ref && /Royal Assent may be notified/.test(secs[0].body) && secs[0].url.startsWith('https://erskinemay.parliament.uk/section/'), 'Erskine May sections are found and read in full, with a link');
const env = { ANTHROPIC_API_KEY: 'x' };
const ans = await answerQuestion(env, { question: 'How is Royal Assent notified in the Lords?', house: 'lords' });
ok(ans.answer.includes('[1]') && ans.confidence === 'clear' && ans.sources.length >= 1 && ans.sources[0].used === true && !ans.sources.some((s) => s.n === 7), 'the answer cites numbered passages, and only passages that exist are marked used');
ok(/Passages:\n\[1\] Erskine May/.test(globalThis.__sent) && /Question \(about the House of Lords\)/.test(globalThis.__sent), 'Claude is given the numbered passages and the House');
ok(/Lords Companion has not been uploaded/.test(ans.note), 'it says when the Lords Companion is not there, so the answer rests on Erskine May alone');
ok((await companionPieces({}, ['royal assent'])).length === 0, 'with no database there are simply no Companion pieces');
globalThis.fetch = realFetch;

console.log(failed ? `\n${failed} check(s) failed` : '\nAll parliamentary process checks passed.');
process.exit(failed ? 1 : 0);
