// legislation.gov.uk (https://www.legislation.gov.uk/developer): finds an Act, lists its sections, and works out, for each section, which statutory instruments have
// brought it into force (commencement) and which have used a power the section gives (powers).
//   - Commencement comes from legislation.gov.uk's own "changes to legislation" data: an effect of type "coming into force" from a statutory instrument on a provision.
//   - Powers come from the instruments themselves: an instrument's preamble says "using the powers conferred by sections 103(1), (2) and (4), 105 ... of the Health and Care Act 2022".
//     The instruments that mention an Act are found with legislation.gov.uk's text search, then the preamble is read.
// Everything is read from the public site (no key); responses are kept by the callers (see functions/api/libby/bills/[id]/secondary.js).
import { getJSON } from './util.js';

const LEG = 'https://www.legislation.gov.uk';
const UA = 'athena-libby/1.0 (+https://github.com/UlysseAbbate/ATHENA)';
const ACT_TYPES = ['ukpga', 'asp', 'asc', 'anaw', 'nia'];   // the Public General Acts are what a UK Bill becomes

export async function getText(url, timeout = 30000) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/xml, application/atom+xml, text/xml' }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}${new URL(url).pathname}`);
  return res.text();
}
void getJSON;

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const attr = (tag, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag); return m ? decode(m[1]) : ''; };
const strip = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** "The Health and Care Act 2022" -> the words to search for, without "Act" and the year. */
export const actWords = (title) => String(title || '').replace(/\s+Act(\s+\d{4})?\s*$/i, '').replace(/\s+\d{4}\s*$/, '').trim();

/**
 * Find the Act a Bill became. `title` is the Bill's short title ("Sovereign Grant Act", with or without the year), `year` the year of Royal Assent.
 * Returns { type, year, number, title, uri } or null.
 */
export function parseActSearch(xml, title) {
  const want = actWords(title).toLowerCase();
  const entries = String(xml).split('<entry>').slice(1);
  for (const e of entries) {
    const id = /<id>http:\/\/www\.legislation\.gov\.uk\/id\/([a-z]+)\/(\d{4})\/(\d+)<\/id>/.exec(e);
    const t = /<title>(.*?)<\/title>/s.exec(e);
    if (!id || !t) continue;
    const found = decode(t[1]).trim();
    if (actWords(found).toLowerCase() === want) return { type: id[1], year: Number(id[2]), number: Number(id[3]), title: found, uri: `${LEG}/${id[1]}/${id[2]}/${id[3]}` };
  }
  return null;
}

export async function findAct(title, year) {
  const years = [year, year - 1, year + 1].filter((y) => y > 1800);   // Royal Assent is sometimes in the year after the session began
  for (const y of years) {
    for (const type of ['ukpga']) {
      const xml = await getText(`${LEG}/${type}/${y}/data.feed?title=${encodeURIComponent(actWords(title))}&results-count=20`);
      const hit = parseActSearch(xml, title);
      if (hit) return hit;
    }
  }
  return null;
}

/** The numbered sections of an Act in order, each with the Part it is in: [{ ref, label, heading, part }], from the Act's contents. */
export function parseContents(xml) {
  const out = [];
  let part = '';
  const re = /<ContentsPart\b[^>]*><ContentsNumber>(.*?)<\/ContentsNumber><ContentsTitle>(.*?)<\/ContentsTitle>|<ContentsItem\b[^>]*ContentRef="([^"]*)"[^>]*><ContentsNumber>(.*?)<\/ContentsNumber><ContentsTitle>(.*?)<\/ContentsTitle>/gs;
  for (const m of String(xml).matchAll(re)) {
    if (m[1] !== undefined) { part = `${strip(m[1])}: ${strip(m[2])}`; continue; }
    out.push({ ref: decode(m[3]), label: strip(m[4]), heading: strip(m[5]), part });
  }
  return out;
}

/** The effects that bring an Act's provisions into force: [{ provision, provisionUri, si: { title, uri, number, year }, date, qualification }]. */
export function parseCommencement(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<ukm:Effect\b([^>]*)>(.*?)<\/ukm:Effect>/gs)) {
    const a = m[1], inner = m[2];
    if (attr(a, 'Type') !== 'coming into force' || attr(a, 'AffectingClass') !== 'UnitedKingdomStatutoryInstrument') continue;
    const sections = [...(/<ukm:AffectedProvisions>(.*?)<\/ukm:AffectedProvisions>/s.exec(inner) || [, ''])[1].matchAll(/<ukm:Section\b[^>]*URI="([^"]*)"[^>]*>(.*?)<\/ukm:Section>/g)];
    const inForce = /<ukm:InForce\b([^>]*)\/?>/.exec(inner);
    out.push({
      provision: attr(a, 'AffectedProvisions'), provisionUri: sections.length ? decode(sections[0][1]) : '',
      si: { title: strip((/<ukm:AffectingTitle>(.*?)<\/ukm:AffectingTitle>/s.exec(inner) || [])[1]), year: Number(attr(a, 'AffectingYear')) || 0, number: Number(attr(a, 'AffectingNumber')) || 0,
        uri: `${LEG}/uksi/${attr(a, 'AffectingYear')}/${attr(a, 'AffectingNumber')}` },
      date: inForce ? attr(inForce[1], 'Date') : '', qualification: inForce ? attr(inForce[1], 'Qualification') : '',
    });
  }
  return out;
}

/** All commencement effects for an Act, a page at a time (legislation.gov.uk gives up to 200 effects a page). */
export async function actCommencement(act, { maxPages = 8 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const xml = await getText(`${LEG}/changes/affected/${act.type}/${act.year}/${act.number}/data.feed?affecting-type=uksi&results-count=200&page=${page}`, 45000);
    out.push(...parseCommencement(xml));
    if (!/<leg:morePages>[1-9]/.test(xml) || (/<leg:morePages>(\d+)/.exec(xml) || [0, 0])[1] <= 0) break;
  }
  return out;
}

/** Section numbers from phrases like "sections 103(1), (2) and (4), 105 and 183(1) and (2)" -> ['103', '105', '183']. */
export function sectionNumbers(phrase) {
  const nums = [];
  for (const m of String(phrase).matchAll(/(?:^|[\s,])(\d+[A-Z]{0,3})(?=\(|[\s,.;]|$)/g)) if (!nums.includes(m[1])) nums.push(m[1]);
  return nums;
}

/**
 * The powers an instrument says it uses under an Act: reads the preamble ("using the powers conferred by sections ... of the Health and Care Act 2022").
 * Returns the section numbers, in the order given, or [] if the preamble does not name this Act.
 */
export function powersUsed(preamble, actTitle) {
  const text = strip(preamble);
  const re = /powers? (?:conferred|given|contained)(?: on [^.]*?)? by ((?:sections?|paragraphs?|regulations?|articles?)\b[^;]*?) of (?:the )?([A-Z][^.;]*?\b\d{4})/gi;
  const found = [];
  for (const m of text.matchAll(re)) {
    if (m[2].replace(/^the /i, '').trim().toLowerCase() !== String(actTitle).replace(/^the /i, '').trim().toLowerCase()) continue;
    if (!/^sections?/i.test(m[1])) continue;
    for (const n of sectionNumbers(m[1].replace(/^sections?\s+/i, ''))) if (!found.includes(n)) found.push(n);
  }
  return found;
}

/** The preamble (introductory text) of an instrument's XML. */
export const preambleOf = (xml) => (/<IntroductoryText>(.*?)<\/IntroductoryText>/s.exec(String(xml)) || [, ''])[1];

/**
 * Instruments that use powers under an Act: the text search finds the instruments that mention it, and each one's preamble is read.
 * Returns [{ title, uri, year, number, powers: ['103', '105'] }] for those whose preamble names the Act. `limit` caps the preambles read.
 */
export async function instrumentsMadeUnder(act, { limit = 80 } = {}) {
  const feed = await getText(`${LEG}/uksi/data.feed?text=${encodeURIComponent(`"${act.title}"`)}&start-year=${act.year || 1990}&results-count=${limit}`, 45000);
  const hits = [...String(feed).matchAll(/<entry>(.*?)<\/entry>/gs)].map((e) => {
    const id = /<id>http:\/\/www\.legislation\.gov\.uk\/id\/uksi\/(\d{4})\/(\d+)<\/id>/.exec(e[1]);
    const t = /<title>(.*?)<\/title>/s.exec(e[1]);
    return id && t ? { year: Number(id[1]), number: Number(id[2]), title: decode(t[1]).trim() } : null;
  }).filter(Boolean);
  const out = [];
  const queue = [...hits];
  // a few at a time; an instrument too new to have its text on the site (only a PDF so far) has no preamble to read and is skipped
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const h = queue.shift();
      let xml;
      try { xml = await getText(`${LEG}/uksi/${h.year}/${h.number}/made/data.xml`, 30000); } catch { continue; }
      const powers = powersUsed(preambleOf(xml), act.title);
      if (powers.length) out.push({ ...h, uri: `${LEG}/uksi/${h.year}/${h.number}`, powers });
    }
  }));
  out.sort((x, y) => y.year - x.year || y.number - x.number);
  return out;
}

/** True if the section's number looks like "103" or "26A" (a top-level section, not "Sch. 2"). */
export const sectionKey = (label) => { const m = /^(?:s\.\s*)?(\d+[A-Z]{0,3})\b/i.exec(String(label || '').trim()); return m ? m[1].toUpperCase() : ''; };

/**
 * The tracker for one Act: a row per section with how it has been commenced and which instruments used its powers.
 * { act, sections: [{ label, heading, commencement: [{ si, date, qualification }], powers: [{ si }] }], summary: { sections, commenced, powerSections, powersUsed } }
 */
export function buildTracker(act, contents, commencement, madeUnder) {
  const byKey = new Map();
  for (const c of commencement) {
    const key = sectionKey(c.provision);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    const list = byKey.get(key);
    if (!list.some((x) => x.si.uri === c.si.uri)) list.push({ si: c.si, date: c.date, qualification: c.qualification });
  }
  const powerBy = new Map();
  for (const si of madeUnder) for (const n of si.powers) {
    const key = n.toUpperCase();
    if (!powerBy.has(key)) powerBy.set(key, []);
    powerBy.get(key).push({ title: si.title, uri: si.uri });
  }
  const sections = contents.filter((s) => sectionKey(s.label)).map((s) => {
    const key = sectionKey(s.label);
    return { label: s.label, key, heading: s.heading, part: s.part, commencement: byKey.get(key) || [], powers: powerBy.get(key) || [] };
  });
  return {
    act,
    sections,
    summary: {
      sections: sections.length, commenced: sections.filter((s) => s.commencement.length).length,
      powerSections: [...powerBy.keys()].filter((k) => sections.some((s) => s.key === k)).length, instruments: madeUnder.length,
    },
  };
}

/** Fetch everything and build the tracker for an Act. */
export async function actTracker(act) {
  const [contentsXml, commencement, madeUnder] = await Promise.all([
    getText(`${LEG}/${act.type}/${act.year}/${act.number}/contents/data.xml`, 45000),
    actCommencement(act).catch(() => []),
    instrumentsMadeUnder(act).catch(() => []),
  ]);
  return buildTracker(act, parseContents(contentsXml), commencement, madeUnder);
}
