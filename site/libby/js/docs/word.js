// Builds the Whips' Office Word documents (following the "DOCUMENTS" instructions):
//   - Committee Stage Grid / Report Stage Grid
//   - Report Stage Hymn Sheet
// Measurements match the Whips' Office example grid: A4, 1.27 cm margins, a 10,465-wide table split
// 934 / 2149 / 6354 / 1028 (Am# : Peer(s) : Member's Explanatory Statement : Notes), 0.75pt borders.
// `D` is the docx library (window.docx in the browser, require('docx') in tests).

const NAVY = '1F3864';
const RED = 'C00000';
const ORANGE = 'E97132';
const TABLE_W = 10465;
const COLS = [934, 2149, 6354, 1028];
const FONT = 'Arial';

function header(D) {
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

function makeDocument(D, children) {
  return new D.Document({
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 720, right: 720, bottom: 720, left: 720, header: 720, footer: 720 } } },
      headers: { default: header(D) },
      children,
    }],
  });
}

const border = (D, color = '000000') => ({ style: D.BorderStyle.SINGLE, size: 6, color });
const allBorders = (D, color) => ({ top: border(D, color), bottom: border(D, color), left: border(D, color), right: border(D, color) });

/* ------------------------------------------------------------------ Grid */

function groupTable(D, group, firstColLabel) {
  const navyCell = (children, extra = {}) => new D.TableCell({
    children, shading: { fill: NAVY, type: D.ShadingType.CLEAR, color: 'auto' }, verticalAlign: D.VerticalAlign.CENTER, borders: allBorders(D), ...extra,
  });
  const white = (text, size) => new D.TextRun({ text, bold: true, color: 'FFFFFF', size, font: FONT });
  const centred = (children, after = 40) => new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after }, children });

  const headingRow = new D.TableRow({
    children: [navyCell([
      centred([white(`Group ${group.number} – ${group.topic}`, 28)]),
      centred([white('', 22)]), // blank line for the lead speaker's name, completed by hand
    ], { columnSpan: 4, width: { size: TABLE_W, type: D.WidthType.DXA } })],
  });
  const labels = [firstColLabel, 'Peer(s)', "Member's Explanatory Statement", 'Notes'];
  const columnRow = new D.TableRow({
    children: labels.map((label, i) => navyCell([centred([white(label, 22)], 0)], {
      width: { size: COLS[i], type: D.WidthType.DXA }, margins: { top: 120, bottom: 120 },
    })),
  });
  const cell = (children, i, centre) => new D.TableCell({
    children, width: { size: COLS[i], type: D.WidthType.DXA }, borders: allBorders(D),
    verticalAlign: centre ? D.VerticalAlign.CENTER : D.VerticalAlign.TOP,
  });
  const rows = group.rows.map((r) => new D.TableRow({
    cantSplit: true, // keep each amendment's row on one page
    children: [
      cell([centred([new D.TextRun({ text: r.num, bold: true, size: 22, font: FONT })], 0)], 0, true),
      cell((r.peers.length ? r.peers : [{ name: '' }]).map((p) => centred([new D.TextRun({
        text: String(p.name).toUpperCase(), bold: true, size: 20, font: FONT, ...(p.ld ? { highlight: 'yellow' } : {}),
      })], 60)), 1, true),
      cell([new D.Paragraph({ spacing: { after: 40 }, children: [new D.TextRun({ text: r.text || '', size: 20, font: FONT })] })], 2, false),
      cell([new D.Paragraph({ children: [] })], 3, false),
    ],
  }));
  return new D.Table({
    width: { size: TABLE_W, type: D.WidthType.DXA },
    columnWidths: COLS,
    layout: D.TableLayoutType.FIXED,
    alignment: D.AlignmentType.CENTER,
    rows: [headingRow, columnRow, ...rows],
  });
}

/**
 * grid = { billTitle, stageWord: 'Committee'|'Report', day, groups: [ { number, topic, rows: [ { num, peers: [{name, ld}], text } ] } ] }
 * `firstColLabel` is "Am#" (also used for C/AC clause references from a running list).
 */
export function buildGridDoc(D, grid) {
  const children = [...titleBlock(D, grid.billTitle, `${grid.stageWord} Stage Grid — Day ${grid.day || '[X]'}`)];
  grid.groups.forEach((g, i) => {
    children.push(groupTable(D, g, 'Am#'));
    if (i < grid.groups.length - 1) children.push(new D.Paragraph({ children: [] }));
  });
  return makeDocument(D, children);
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

/** "Financial Services and Markets Bill [HL]" → "Financial_Services_and_Markets_Bill_HL" for file names. */
export const fileSafe = (s) => String(s || '').replace(/[[\]]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
