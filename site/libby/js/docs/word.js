// Builds the Whips' Office Word documents (following the "DOCUMENTS" instructions):
//   - Committee Stage Grid / Report Stage Grid: A4 landscape, 1.27 cm margins, one table per group (each group on its own page), five columns of
//     1.3 / 3.2 / 4.6 / 13.3 / 4.7 cm (Am# : Place in Bill : Peer(s) : Member's Explanatory Statement : Briefings), 0.75pt light grey borders
//   - Report Stage Hymn Sheet: A4 portrait, 1.27 cm margins
// All in Arial, with the Lords Legislation Adviser header on every page. File names: "[Bill Code] [Stage Code] [Document Title]" (see docFileName).
// `D` is the docx library (window.docx in the browser, require('docx') in tests).

export const NAVY = '1F3864';
export const RED = 'C00000';
export const ORANGE = 'E97132';
const TABLE_W = 10465;          // portrait: the Hymn Sheet's box
const GRID_COLS = [737, 1814, 2608, 7541, 2665];   // 1.3, 3.2, 4.6, 13.3 and 4.7 cm in twentieths of a point
const GRID_W = GRID_COLS.reduce((a, b) => a + b, 0);
const GREY = 'BFBFBF';
const CREAM = 'FFF2CC';
export const FONT = 'Arial';

export function header(D) {
  const line = (children) => new D.Paragraph({ alignment: D.AlignmentType.RIGHT, spacing: { after: 0 }, children });
  const bold = (text) => new D.TextRun({ text, bold: true, size: 20, font: FONT });
  return new D.Header({
    children: [
      line([bold('LORDS LEGISLATION ADVISER, LORDS WHIPS OFFICE')]),
      line([
        bold('ADVISER: ULYSSE ABBATE I '),
        new D.ExternalHyperlink({
          link: 'mailto:ulysse.abbate@parliament.uk',
          children: [new D.TextRun({ text: 'ulysse.abbate@parliament.uk', bold: true, size: 20, font: FONT, underline: {}, color: '0563C1' })],
        }),
        bold(' I 07425 138410'),
      ]),
    ],
  });
}

function titleBlock(D, title, subtitle) {
  return [
    new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 40 }, children: [new D.TextRun({ text: title, bold: true, size: 56, color: RED, font: FONT })] }),
    new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 40 }, children: [new D.TextRun({ text: subtitle, bold: true, size: 32, color: '000000', font: FONT })] }),
    new D.Paragraph({ children: [] }),
  ];
}

export function makeDocument(D, children, { landscape = false } = {}) {
  return new D.Document({
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838, ...(landscape ? { orientation: D.PageOrientation.LANDSCAPE } : {}) }, margin: { top: 720, right: 720, bottom: 720, left: 720, header: 720, footer: 720 } } },
      headers: { default: header(D) },
      children,
    }],
  });
}

const border = (D, color = '000000') => ({ style: D.BorderStyle.SINGLE, size: 6, color });
const allBorders = (D, color) => ({ top: border(D, color), bottom: border(D, color), left: border(D, color), right: border(D, color) });

/* ------------------------------------------------------------------ Grid */

const GRID_LABELS = ['Am#', 'Place in Bill', 'Peer(s)', "Member's Explanatory Statement", 'Briefings'];

function groupTable(D, group) {
  const navyCell = (children, extra = {}) => new D.TableCell({
    children, shading: { fill: NAVY, type: D.ShadingType.CLEAR, color: 'auto' }, verticalAlign: D.VerticalAlign.CENTER, borders: allBorders(D, GREY), ...extra,
  });
  const white = (text, size) => new D.TextRun({ text, bold: true, color: 'FFFFFF', size, font: FONT });
  const centred = (children, after = 0) => new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after }, children });
  const run = (text, size, opts = {}) => new D.TextRun({ text, size, font: FONT, color: '000000', ...opts });

  const speakers = group.ldSpeakers || [];
  const headingRow = new D.TableRow({
    children: [navyCell([
      centred([white(`Group ${group.number} – ${group.topic}`, 24)], 40),
      centred([white(`LD Speakers:${speakers.length ? ` ${speakers.join(', ')}` : ''}`, 18)]),
    ], { columnSpan: 5, width: { size: GRID_W, type: D.WidthType.DXA } })],
  });
  const columnRow = new D.TableRow({
    children: GRID_LABELS.map((label, i) => navyCell([centred([white(label, 18)])], {
      width: { size: GRID_COLS[i], type: D.WidthType.DXA }, margins: { top: 120, bottom: 120 },
    })),
  });
  const cell = (children, i, centre, fill) => new D.TableCell({
    children, width: { size: GRID_COLS[i], type: D.WidthType.DXA }, borders: allBorders(D, GREY),
    shading: { fill, type: D.ShadingType.CLEAR, color: 'auto' },
    verticalAlign: centre ? D.VerticalAlign.CENTER : D.VerticalAlign.TOP,
  });
  const lines = (arr, size, align, opts = {}) => (arr.length ? arr : ['']).map((t) => new D.Paragraph({ alignment: align, spacing: { after: 0 }, children: [run(t, size, opts)] }));
  const rows = group.rows.map((r, n) => {
    const fill = n % 2 === 0 ? 'FFFFFF' : CREAM;   // white first, restarting for every group
    return new D.TableRow({
      cantSplit: true,
      children: [
        cell(lines([r.num], 18, D.AlignmentType.CENTER, { bold: true }), 0, true, fill),
        cell(lines(r.place || [], 16, D.AlignmentType.CENTER), 1, true, fill),
        cell((r.peers.length ? r.peers : [{ name: '' }]).map((pe) => new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 60 }, children: [run(String(pe.name).toUpperCase(), 16, { bold: true, ...(pe.ld ? { highlight: 'yellow' } : {}) })] })), 2, true, fill),
        cell([new D.Paragraph({ spacing: { after: 40 }, children: [run(r.text || '', 16)] })], 3, false, fill),
        cell(lines(r.briefings || [], 16, D.AlignmentType.LEFT), 4, false, fill),
      ],
    });
  });
  return new D.Table({
    width: { size: GRID_W, type: D.WidthType.DXA },
    columnWidths: GRID_COLS,
    layout: D.TableLayoutType.FIXED,
    alignment: D.AlignmentType.CENTER,
    rows: [headingRow, columnRow, ...rows],   // the two heading rows appear once per group: a table that runs onto a new page does not repeat them
  });
}

/**
 * grid = { billTitle, stageWord: 'Committee'|'Report', day, groups: [ { number, topic, ldSpeakers: [names], rows: [ { num, place: [lines], peers: [{name, ld}], text, briefings: [names] } ] } ] }
 * `num` is the amendment number, or the C/AC clause reference when the list was a running list.
 */
export function buildGridDoc(D, grid) {
  const children = [...titleBlock(D, grid.billTitle, `${grid.stageWord} Stage Grid — Day ${grid.day || '[X]'}`)];
  grid.groups.forEach((g, i) => {
    // every group starts on a new page (except the first, which follows the title); the marker paragraph is one point high
    if (i > 0) children.push(new D.Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0, line: 20, lineRule: D.LineRuleType.EXACT }, children: [] }));
    children.push(groupTable(D, g));
  });
  return makeDocument(D, children, { landscape: true });
}

/* ------------------------------------------------------------------ Hymn sheet */

/** hymn = { billTitle, day, groups: [ { number, refsLabel, theme } ] } */
export function buildHymnDoc(D, hymn) {
  const run = (text, opts = {}) => new D.TextRun({ text, size: 24, font: FONT, color: '000000', ...opts });
  const children = [...titleBlock(D, hymn.billTitle, `Hymn Sheet: Report Stage Day ${hymn.day || '[X]'}`)];
  children.splice(2, 0, new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 120 }, children: [run('WHIP:', { bold: true, size: 22 }), run(' ', { size: 22 })] }));

  const boxChildren = [new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { before: 80, after: 160 }, children: [new D.TextRun({ text: 'VOTE SUMMARY', bold: true, size: 28, color: ORANGE, font: FONT })] })];
  hymn.groups.forEach((g, i) => {
    boxChildren.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [run(`Group ${g.number}`, { bold: true })] }));
    for (let k = 0; k < 3; k++) boxChildren.push(new D.Paragraph({ children: [] }));
    if (i < hymn.groups.length - 1) boxChildren.push(new D.Paragraph({ children: [] }));
  });
  children.push(new D.Table({
    width: { size: TABLE_W, type: D.WidthType.DXA },
    columnWidths: [TABLE_W],
    rows: [new D.TableRow({ children: [new D.TableCell({ width: { size: TABLE_W, type: D.WidthType.DXA }, borders: allBorders(D, ORANGE), children: boxChildren })] })],
  }));
  children.push(new D.Paragraph({ children: [] }));

  for (const g of hymn.groups) {
    children.push(new D.Paragraph({ spacing: { before: 120, after: 80 }, children: [run(`Group ${g.number} – Amendments ${g.refsLabel}`, { bold: true, underline: {} })] }));
    children.push(new D.Paragraph({ spacing: { after: 80 }, children: [run(g.theme || '')] }));
    children.push(new D.Paragraph({ spacing: { after: 200 }, children: [run('[Division / voting instructions — to be completed]', { bold: true, highlight: 'yellow' })] }));
  }
  return makeDocument(D, children);
}

/** Turn a document into a download (browser only). */
export async function downloadDoc(D, doc, filename) {
  const blob = await D.Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** "Financial Services and Markets Bill [HL]" -> "Financial_Services_and_Markets_Bill_HL" (kept for other documents' file names). */
export const fileSafe = (s) => String(s || '').replace(/[[\]]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

const MINOR = new Set('a an and as at by for from in of on or the to with'.split(' '));
/** The Bill Code: the first letter of each major word of the short title, in capitals (minor words left out): "Financial Services and Markets Bill" -> "FSMB". */
export function billCode(title) {
  return String(title || '').replace(/\[[^\]]*\]/g, ' ').split(/[^A-Za-z0-9]+/).filter((w) => w && !MINOR.has(w.toLowerCase())).map((w) => w[0].toUpperCase()).join('');
}
const STAGE_CODES = { 'Second Reading': '2R', '2nd Reading': '2R', Committee: 'CS', Report: 'RS', 'Ping Pong': 'PP' };
/** "[Bill Code] [Stage Code] [Document Title].docx", e.g. "FSMB L_CS Grid.docx" (house 'Lords' or 'Commons'; stage 'Committee', 'Report', 'Second Reading' or 'Ping Pong'). */
export function docFileName({ billTitle, house = 'Lords', stage, title }) {
  return `${billCode(billTitle)} ${house === 'Commons' ? 'C' : 'L'}_${STAGE_CODES[stage] || ''} ${title}.docx`;
}
