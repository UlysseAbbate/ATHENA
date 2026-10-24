// Reading the Government Whips' Office "Today's Lists" PDF.
//   linesFromTextItems(pages)  turns the text pieces pdf.js finds in the PDF into lines of text, with a mark where a new paragraph
//                              starts (the PDF has no real paragraphs, only positions on the page)
//   parseTodaysList(lines)     turns those lines into the day's business: sections (Chamber, Grand Committee), their items in
//                              order with time limits, speakers' lists, groupings and rising times
// Both are plain functions with no browser objects, so the server and the tests can use them too.
// The PDF itself is read in the browser (see public/js/docs/pdf-lines.js); only the parsed result and its text are sent to the server.

/* ------------------------------------------------------------------ PDF text pieces -> lines */

/**
 * @param pages  [ [ { str, x, y, width } ... ] ... ] one array of text pieces per page (x, y are the position on the page,
 *               y counting up from the bottom, as pdf.js gives them)
 * @returns      [ { text, para } ]   para: true when the line starts a new paragraph; { text: '' } marks a blank line
 */
export function linesFromTextItems(pages) {
  const rows = [];
  pages.forEach((items, page) => {
    const byY = [];
    for (const it of items) {
      if (!String(it.str).trim() && !String(it.str).length) continue;
      let row = byY.find((r) => Math.abs(r.y - it.y) <= 2);
      if (!row) { row = { y: it.y, page, items: [] }; byY.push(row); }
      row.items.push(it);
    }
    byY.sort((a, b) => b.y - a.y);
    rows.push(...byY);
  });

  const lines = rows.map((r) => {
    const items = r.items.sort((a, b) => a.x - b.x);
    let text = '';
    let end = null;
    for (const it of items) {
      const s = String(it.str);
      // Pieces that touch are joined as they are; a gap on the page (a margin number, then a name) becomes a space.
      if (end !== null && it.x - end > 3 && !/\s$/.test(text) && !/^\s/.test(s)) text += ' ';
      text += s;
      end = it.x + (it.width || 0);
    }
    return { text: text.replace(/\s+/g, ' ').trim(), y: r.y, page: r.page, x: items[0].x };
  }).filter((l) => l.text);

  // How far apart wrapped lines are, so a bigger gap can be read as a new paragraph.
  const gaps = [];
  for (let i = 1; i < lines.length; i++) if (lines[i].page === lines[i - 1].page) gaps.push(lines[i - 1].y - lines[i].y);
  gaps.sort((a, b) => a - b);
  const lead = gaps.length ? gaps[Math.floor(gaps.length * 0.3)] || gaps[0] : 14; // the usual line spacing (a low-ish gap, ignoring page tops)

  const out = [];
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    const gap = prev && prev.page === l.page ? prev.y - l.y : Infinity;
    if (i && gap !== Infinity && gap > lead * 1.9) out.push({ text: '', para: true }); // a gap inside a page; a page break is not a gap
    out.push({ text: l.text, para: i === 0 || gap > lead * 1.25 });
  });
  return out;
}

/* ------------------------------------------------------------------ times and names */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "2.30pm" / "11am" / "3pm" / "12.15pm" -> minutes after midnight (null if it is not a time). */
export function clockToMinutes(text) {
  const m = String(text || '').trim().toLowerCase().match(/^(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)$/);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3] === 'pm') h += 12;
  return h * 60 + Number(m[2] || 0);
}

/** 870 -> "2.30pm", 660 -> "11am" (the way the Whips' lists write times). */
export function minutesToClock(mins) {
  const total = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const h = h24 % 12 || 12;
  return `${h}${m ? `.${String(m).padStart(2, '0')}` : ''}${h24 < 12 ? 'am' : 'pm'}`;
}

/** "5 minutes" / "2½ hours" / "1 hour" / "90 minutes" -> minutes (null if none). */
export function durationToMinutes(text) {
  const t = String(text || '').toLowerCase().replace(/½/g, '.5').replace(/\s+and a half/, '.5');
  const m = t.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/);
  if (!m) return null;
  return Math.round(Number(m[1]) * (/^h/.test(m[2]) ? 60 : 1));
}

const TITLES = { L: 'Lord', B: 'Baroness', V: 'Viscount', E: 'Earl', D: 'Duke', M: 'Marquess', C: 'Countess', Ly: 'Lady', Bp: 'Bishop', Abp: 'Archbishop', Lord: 'Lord', Baroness: 'Baroness' };

/**
 * A name as the speakers' lists abbreviate it -> the full style the rest of the site uses.
 *   "L Clement-Jones" -> "Lord Clement-Jones"      "B Lloyd of Effra" -> "Baroness Lloyd of Effra"
 *   "Bp Peterborough" -> "Bishop of Peterborough"  "E Effingham" -> "Earl of Effingham"   "V Stansgate" -> "Viscount Stansgate"
 */
export function expandName(abbreviated) {
  const s = String(abbreviated || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(Abp|Bp|Ly|L|B|V|E|D|M|C)\s+(.+)$/);
  if (!m) return s;
  const title = TITLES[m[1]];
  // Bishops, Earls, Dukes, Marquesses and Countesses are styled "of Place" (Viscounts, Lords and Baronesses are not)
  return /^(Bishop|Archbishop|Earl|Duke|Marquess|Countess)$/.test(title) && !/^of\s/i.test(m[2]) ? `${title} of ${m[2]}` : `${title} ${m[2]}`;
}

const PEER_END = /(?:Lord|Baroness|Viscount|Earl|Countess|Marquess|Duke|Lady|Bishop|Archbishop|The [A-Z][a-z]+)\s[^()]*$/;

/* ------------------------------------------------------------------ the parser */

const SECTION_RE = /^business in (?:the )?(chamber|grand committee)(?:\s+in the ([^]+?))?\s+at\s+([0-9.:]+\s*(?:am|pm))\s*$/i;
const HEADINGS = [
  ['oq', /^oral questions?\b/i],
  ['pnq', /^private notice questions?\b/i],
  ['statement', /^questions on an? (?:oral )?(?:statement|urgent question)\b/i],
  ['brief', /^business expected to be brief\b/i],
  ['main', /^main business\b/i],
  ['dinner', /^(?:dinner|lunch) break business\b/i],
  ['after', /^business after\b/i],
  ['introduction', /^introductions?$/i],
  ['rising', /^estimated rising time\b/i],
];
const NOTE_BULLET = /^[●•·]\s*/;
const REF_ROW = /^g?[A-Z]{0,2}\d+[A-Z]{0,2}(?:\s*,\s*g?[A-Z]{0,2}\d+[A-Z]{0,2})*,?$/;
const SPEAKER_LINE = /^(?:\d+\s+)?((?:Abp|Bp|Ly|L|B|V|E|D|M|C)\s+[A-Z][^()]*)$/;
const TERMINAL = /(?:\([A-Za-z&' ,.\-’]+\)|\(time-limited[^)]*\)|\b(?:Lord|Baroness|Viscount|Earl|Duke|Lady)\s+[A-Z][^()]*)\.?$/;

/** One block of text -> an item. `heading` is the kind of the heading it sat under. */
function itemFromText(text, heading, groupLabel = '') {
  const t = text.replace(/\s+/g, ' ').trim();
  const item = { kind: 'other', title: t, detail: '', peers: [], minister: '', dept: '', minutes: null, timeLimited: false, noLimit: false, notes: [], groupings: null, speakers: null, speechLimits: null };
  const limit = t.match(/\(\s*time-limited to ([^)]+)\)/i);
  if (limit) { item.timeLimited = true; item.minutes = durationToMinutes(limit[1]); item.title = t.replace(/\s*\(\s*time-limited to [^)]+\)\.?/i, '').trim(); }

  if (heading === 'oq' || heading === 'pnq') {
    // "Lord Wills to ask His Majesty’s Government what ... 2026. (Baroness Winterton of Doncaster, FCDO)"
    // "Lord Polak to ask His Majesty's Government, in the light of ... communities. Baroness Twycross (CO)"
    // "Lord Nagaraju to ask the Senior Deputy Speaker what ... (Lord Ponsonby of Shulbrede, SDS)"
    // who is asked: the Government, or an office holder written with capitals ("the Senior Deputy Speaker") up to the first lower-case word
    const m = item.title.match(/^(.+?)\s+to ask\s+((?:His|Her) Majesty['’]s Government|the (?:[A-Z][A-Za-z\-]*\s+)*[A-Z][A-Za-z\-]*)(?=[,\s])[,\s]*(.+)$/);
    item.kind = heading;
    if (m) {
      item.peers = [m[1].trim()];
      let body = m[3].trim();
      let who = '';
      const bracket = body.match(/^(.*?)\s*\(([^()]+)\)\s*\.?$/);
      if (bracket) { body = bracket[1]; who = bracket[2]; }
      let minister = '';
      let dept = '';
      const parts = who.split(/,\s*/);
      if (parts.length > 1) { minister = parts.slice(0, -1).join(', '); dept = parts[parts.length - 1]; } else { dept = parts[0] || ''; }
      // "... Jewish communities. Baroness Twycross" -> the minister, when the brackets hold only the department
      const tail = body.match(/^(.*[.?!])\s+((?:Lord|Baroness|Viscount|Earl|Lady|The)\s[A-Za-z' \u2019\-]+)$/);
      if (tail) { body = tail[1]; if (!minister) minister = tail[2].trim(); }
      item.title = body.replace(/\.$/, '').trim();
      item.minister = minister.trim();
      item.dept = dept.trim();
      if (!/Majesty/i.test(m[2])) item.askedOf = m[2].trim();
    }
    return item;
  }
  if (heading === 'statement') {
    item.kind = /urgent question/i.test(groupLabel) ? 'uq' : 'statement';
    const m = item.title.match(/^[‘'"“](.+?)[’'"”]\s*[–-]\s*(.+?)\s*(?:\(([^()]+)\))?\s*$/);
    if (m) { item.title = m[1].trim(); item.minister = m[2].trim(); item.dept = (m[3] || '').trim(); }
    return item;
  }
  if (heading === 'introduction') {
    item.kind = 'introduction';
    item.title = 'Introductions';
    item.detail = t;
    item.peers = [...t.matchAll(/\b((?:Lord|Baroness|Viscount|Earl|Countess|Duke|Lady|Marquess)\s+[A-Z][A-Za-z'’\-]+(?:\s+(?:of\s+)?[A-Z][A-Za-z'’\-]+)*?)(?=\s*,|\s+and\b|\s+will\b|$)/g)].map((m) => m[1]);
    return item;
  }

  // Business: a Bill stage ("Armed Forces Bill – Report – Baroness Antrobus") or a motion ("Lord Patel to move that ...")
  const stage = item.title.match(/^(.*\bBill(?:\s*\[HL\])?)\s+[–-]\s+(.+?)(?:\s+[–-]\s+((?:Lord|Baroness|Viscount|Earl|Duke|Lady|The)\s.+))?$/);
  if (stage) {
    item.kind = 'legislation';
    item.title = stage[1].trim();
    item.detail = stage[2].trim();
    item.peers = stage[3] ? [stage[3].trim()] : [];
    return item;
  }
  const si = item.title.match(/^(.*?(?:Regulations|Order|Rules|Scheme|Code of Practice)(?:\s*\(No\.?\s*\d+\))?\s+20\d\d)(?:\s+[–-]\s+(.+?))?(?:\s+[–-]\s+((?:Lord|Baroness|Viscount|Earl|Duke|Lady|The)\s.+))?$/);
  if (si && !/\bBill\b/.test(si[1])) {
    item.kind = 'si';
    item.title = si[1].trim();
    item.detail = (si[2] || '').trim();
    item.peers = si[3] ? [si[3].trim()] : [];
    return item;
  }
  const motion = item.title.match(/^(.+?)\s+to (move|ask|call attention)\b/i);
  if (motion) {
    item.kind = /to ask/i.test(item.title) ? 'qsd' : 'motion';
    const who = motion[1].replace(/,?\s+on behalf of .+$/i, '').trim();
    item.peers = [who];
    item.detail = '';
    return item;
  }
  item.kind = /\bBill\b/.test(item.title) ? 'legislation' : 'other';
  return item;
}

/**
 * @param lines  from linesFromTextItems
 * @returns { date, weekday, sections: [ { name, place, start, startMinutes, items: [...], rising, risingMinutes } ], notes }
 *   Each item: { kind, title, detail, peers, minister, dept, minutes, timeLimited, noLimit, notes, groupings, speakers, speechLimits, group }
 *     minutes        the time the list gives it (null if it gives none)
 *     speakers       [ { n, name, full } ] the Speakers list, in order (name as written, full as the site styles it)
 *     speechLimits   { default, byName: { full name: minutes } } from the "Except for ... all speeches are limited to ..." line
 *     group          the heading it sat under, with its time: { kind, label, minutes } (e.g. Oral Questions, 40 minutes)
 */
export function parseTodaysList(lines) {
  const out = { date: '', weekday: '', sections: [], notes: [] };
  const head = lines.slice(0, 14).map((l) => l.text).join(' ');
  const d = head.match(/\b(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)\s+(\d{1,2})\s+([A-Z]+)\s+(\d{4})/i);
  if (d && MONTHS.includes(d[3].toLowerCase())) {
    out.date = `${d[4]}-${String(MONTHS.indexOf(d[3].toLowerCase()) + 1).padStart(2, '0')}-${String(Number(d[2])).padStart(2, '0')}`;
    out.weekday = DAYS[DAYS.indexOf(d[1].toLowerCase())];
  }

  let section = null;
  let group = null;            // the heading in force: { kind, label, minutes }
  let block = [];              // lines of the item being read
  let current = null;          // the last item finished (guidance, groupings and speakers attach to it)
  let mode = '';               // '', 'speakers', 'groupings', 'rising'
  let rowOpen = false;         // the last grouping row ended with a comma, so the next line is part of it

  const flush = () => {
    if (!block.length || !section) { block = []; return; }
    const text = block.join(' ');
    const item = itemFromText(text, group && group.kind, group && group.label);
    if (group && group.minutes && (group.kind === 'oq' || group.kind === 'pnq' || group.kind === 'statement') && item.minutes === null) item.groupMinutes = group.minutes;
    item.group = group ? { kind: group.kind, label: group.label, minutes: group.minutes } : null;
    section.items.push(item);
    current = item;
    block = [];
    mode = '';
  };

  for (let i = 0; i < lines.length; i++) {
    const { text: raw, para } = lines[i];
    const line = raw.trim();
    if (!line) { if (mode !== 'speakers' && mode !== 'groupings') flush(); continue; }
    if (/^notes:?$/i.test(line)) { flush(); out.notes = lines.slice(i + 1).map((l) => l.text).filter(Boolean); break; }

    const sec = line.match(SECTION_RE);
    if (sec) {
      flush();
      const grand = /grand/i.test(sec[1]);
      section = { name: grand ? 'Grand Committee' : 'Chamber', place: (sec[2] || '').trim(), start: sec[3].replace(/\s+/g, ''), startMinutes: clockToMinutes(sec[3]), items: [], rising: '', risingMinutes: null };
      out.sections.push(section);
      group = null; current = null; mode = '';
      continue;
    }
    if (!section) continue;

    if (mode === 'rising') {
      let full = line;
      let k = i;
      while (k + 1 < lines.length && lines[k + 1].text && !lines[k + 1].para) full += ` ${lines[++k].text}`;
      i = k;
      full = full.replace(/\.$/, '').trim();
      section.risingText = full;
      section.rising = full.replace(/^the (house|grand committee) is expected to rise\s*/i, '');
      const tm = full.match(/\b(?:by|around|at)\s+([0-9.:]+\s*(?:am|pm))/i);
      section.risingMinutes = tm ? clockToMinutes(tm[1]) : null;
      mode = '';
      continue;
    }

    // Guidance, groupings, speakers and the like belong to the item above them: finish reading that item first.
    if (mode !== 'speakers' && mode !== 'groupings' && (/^(speakers:?|there is no official time limit|except for|target for the day|grouping of amendments)/i.test(line) || NOTE_BULLET.test(line))) flush();

    const heading = HEADINGS.find(([, re]) => re.test(line));
    if (heading && (line.length < 160)) {
      flush();
      const [kind] = heading;
      if (kind === 'rising') { mode = 'rising'; continue; }
      // a heading can wrap onto a second line: "Questions on an Oral Statement made in the House of Commons on Thursday 15 October" / "(40 minutes)"
      let label = line;
      let k = i;
      while (!/\)\s*$/.test(label) && kind !== 'main' && kind !== 'brief' && kind !== 'introduction' && k + 1 < lines.length && lines[k + 1].text && !lines[k + 1].para && label.length < 140 && !/\bminutes?\)/.test(label)) { label += ` ${lines[++k].text}`; }
      if (/\bminutes?\)\s*$/.test(label) || kind === 'main' || kind === 'brief' || kind === 'introduction' || /\)\s*$/.test(label)) i = k; else label = line;
      group = { kind, label: label.replace(/\s*\([^)]*\)\s*$/, '').trim(), minutes: durationToMinutes((label.match(/\(([^)]*)\)\s*$/) || [])[1]) };
      current = null; mode = '';
      continue;
    }

    if (/^prayers\b/i.test(line)) {
      flush();
      const minutes = durationToMinutes((line.match(/\(([^)]*)\)\s*$/) || [])[1]);
      const item = { kind: 'prayers', title: line.replace(/\s*\([^)]*\)\s*$/, '').trim(), detail: '', peers: [], minister: '', dept: '', minutes, timeLimited: false, noLimit: false, notes: [], groupings: null, speakers: null, speechLimits: null, group: null };
      section.items.push(item);
      current = item;
      group = null;
      continue;
    }

    if (/^speakers:?$/i.test(line)) { flush(); mode = 'speakers'; if (current) current.speakers = current.speakers || []; continue; }
    if (mode === 'speakers') {
      const sp = line.match(SPEAKER_LINE);
      if (sp && current) {
        current.speakers.push({ n: current.speakers.length + 1, name: sp[1].trim(), full: expandName(sp[1]) });
        continue;
      }
      mode = ''; // anything else ends the list and is read as usual
    }
    // "Except for Lord Patel (15 minutes), Lord Clement-Jones (10 minutes) ..., all speeches are limited to 4 minutes"
    if (/^except for\b/i.test(line) || (current && /^speeches are limited to|^all speeches are limited/i.test(line))) {
      let full = line;
      let k = i;
      while (!/limited to [^.]*?minutes?\.?\s*$/i.test(full) && k + 1 < lines.length && lines[k + 1].text) full += ` ${lines[++k].text}`;
      i = k;
      if (current) {
        const limits = { default: null, byName: {} };
        const dflt = full.match(/(?:all\s+)?speeches are limited to (\d+(?:\.\d+)?)\s*minutes?/i);
        if (dflt) limits.default = Number(dflt[1]);
        for (const m of full.replace(/^except for\s+/i, '').matchAll(/((?:The\s+)?(?:Lord|Baroness|Viscount|Earl|Duke|Lady|Countess|Marquess|Bishop|Archbishop)\s+[^()]+?)\s*\(\s*(\d+(?:\.\d+)?)\s*minutes?\s*\)/gi)) {
          limits.byName[m[1].replace(/^(?:and|The)\s+/i, '').replace(/^(Earl|Duke|Bishop|Marquess|Archbishop|Countess)\s+of\s+/i, '$1 of ').trim()] = Number(m[2]);
        }
        current.speechLimits = limits;
      }
      continue;
    }

    if (/^there is no official time limit/i.test(line)) {
      let full = line; let k = i;
      while (k + 1 < lines.length && lines[k + 1].text && !lines[k + 1].para) full += ` ${lines[++k].text}`;
      i = k;
      if (current) { current.noLimit = true; const bm = full.match(/within (\d+)\s*minutes/i); if (bm) current.backbenchMinutes = Number(bm[1]); }
      continue;
    }

    if (/^target for the day/i.test(line)) { if (current) current.notes.push(line); continue; }
    if (/^grouping of amendments:?/i.test(line)) { flush(); mode = 'groupings'; rowOpen = false; if (current) current.groupings = []; continue; }
    if (mode === 'groupings') {
      const norm = line.replace(/\s+/g, ' ');
      if (REF_ROW.test(norm) && current) {
        const refs = norm.replace(/,$/, '').split(/\s*,\s*/).filter(Boolean);
        if (rowOpen && current.groupings.length) current.groupings[current.groupings.length - 1].push(...refs); // the group carries on from the line above
        else current.groupings.push(refs);
        rowOpen = /,$/.test(norm);
        continue;
      }
      mode = '';
    }
    if (NOTE_BULLET.test(line)) { // speaking-time guidance under a Bill stage
      if (current) {
        const last = current.guidance || (current.guidance = []);
        last.push(line.replace(NOTE_BULLET, ''));
      }
      continue;
    }
    if (current && current.guidance && !para && /^[a-z]/.test(line) && block.length === 0 && current.guidance.length) { current.guidance[current.guidance.length - 1] += ` ${line}`; continue; }
    if (/^[*]\s*/.test(line)) { flush(); block.push(line.replace(/^[*]\s*/, '')); continue; }

    // Ordinary text: it starts an item, or carries on the one being read.
    if (block.length && para && TERMINAL.test(block.join(' ')) && !/^(?:of|and|the|to)\b/.test(line)) flush();
    block.push(line);
    if (/\(\s*time-limited to [^)]+\)\.?$/i.test(line)) flush();
  }
  flush();

  out.sections = out.sections.filter((s) => s.items.length);
  return out;
}
