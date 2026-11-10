// The "Give me an Update" Word document, titled "[Bill] Update [Date]": minimalist, in the Whips' Office house style of the other documents (Arial, A4, the red title,
// navy headings, the orange rule). Four short sections: 1 Intro, 2 Summary, 3 Lib Dem activity, 4 Parliamentary activity. Amendments and divisions link to Parliament.
// `D` is the docx library (window.docx in the browser, require('docx') in tests). `data` is /api/libby/bills/:id/update; `ai` is the optional written summary
// { overview, parts: [{ heading, summary }] } (/api/libby/bills/:id/update-summary).
import { makeDocument, NAVY, RED, ORANGE, FONT } from './word.js';

const SIZE = 20;   // 10pt
const long = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
const shortDate = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const cleanTitle = (t) => String(t || '').replace(/\s*\[HL\]\s*/gi, ' ').replace(/\s+/g, ' ').trim();

/** "Health Bill Update 10 November 2026": the title of the document and (with .docx) its file name. */
export const updateTitle = (data) => `${cleanTitle(data.bill.title)} Update ${long(data.generated)}`;

export function buildUpdateDoc(D, data, ai = null) {
  const run = (text, o = {}) => new D.TextRun({ text, size: SIZE, font: FONT, ...o });
  const link = (text, url) => (/^https?:\/\//.test(url || '')
    ? new D.ExternalHyperlink({ link: url, children: [new D.TextRun({ text, size: SIZE, font: FONT, color: '0563C1', underline: {} })] })
    : run(text));
  const para = (children, o = {}) => new D.Paragraph({ spacing: { after: 80 }, ...o, children: Array.isArray(children) ? children : [run(children)] });
  const heading = (text) => new D.Paragraph({
    spacing: { before: 280, after: 120 }, border: { bottom: { style: D.BorderStyle.SINGLE, size: 8, color: ORANGE, space: 2 } },
    children: [new D.TextRun({ text, bold: true, size: 26, color: NAVY, font: FONT })],
  });
  const sub = (text) => new D.Paragraph({ spacing: { before: 160, after: 60 }, children: [new D.TextRun({ text, bold: true, size: 22, color: NAVY, font: FONT })] });
  const bullet = (children) => new D.Paragraph({ spacing: { after: 40 }, bullet: { level: 0 }, children: Array.isArray(children) ? children : [run(children)] });

  const b = data.bill;
  const out = [];
  out.push(new D.Paragraph({ spacing: { after: 40 }, children: [new D.TextRun({ text: updateTitle(data), bold: true, size: 44, color: RED, font: FONT })] }));

  /* 1 Intro */
  out.push(heading('1. Intro'));
  out.push(para([run('Current stage: ', { bold: true }), run(`${b.currentStage || 'not known'}${b.currentHouse && b.currentHouse !== 'Unassigned' ? ` (${b.currentHouse})` : ''}.`),
    ...(data.next ? [run('  Next sitting: ', { bold: true }), run(`${data.next.stage}${data.next.house ? ` (${data.next.house})` : ''}, ${shortDate(data.next.date)}.`)] : [])]));
  if (b.isAct) out.push(para('This Bill has received Royal Assent and is now an Act.'));
  for (const [label, t] of [['Commons', data.team.commons], ['Lords', data.team.lords]]) {
    out.push(para([run(`${label}: `, { bold: true }), run(`Adviser ${t.adviser || 'not named yet'}; Bill lead ${t.lead || 'not named yet'}.`)]));
  }

  /* 2 Summary */
  out.push(heading('2. Summary'));
  const official = (data.summary.official || '').trim();
  if (ai && ai.overview) out.push(para(ai.overview));
  else if (official) out.push(para(official));
  else if (b.longTitle) out.push(para([run('Long title: ', { bold: true }), run(b.longTitle)]));
  if (ai && ai.parts && ai.parts.length) {
    out.push(sub('The Parts of the Bill'));
    for (const p of ai.parts) out.push(bullet([run(`${p.heading}: `, { bold: true }), run(p.summary)]));
  } else if (data.summary.parts && data.summary.parts.length) {
    out.push(sub('The Parts of the Act'));
    for (const p of data.summary.parts) out.push(bullet([run(`${p.part}: `, { bold: true }), run(`sections ${p.first} to ${p.last}${p.headings && p.headings.length ? `, including ${p.headings.slice(0, 3).join('; ')}` : ''}.`)]));
  }
  if (data.summary.sources && data.summary.sources.length) {
    out.push(para([run('Official documents: ', { bold: true }), ...data.summary.sources.flatMap((s, i) => [i ? run('; ') : run(''), link(s.label, s.url)])], { spacing: { before: 80, after: 80 } }));
  }
  out.push(para([run('The Bill on Parliament’s website: ', { bold: true }), link(b.url, b.url)]));

  /* 3 Lib Dem activity */
  out.push(heading('3. Lib Dem activity'));
  const stages = data.ldActivity.stages;
  if (!stages.length) out.push(para('No amendments have been tabled by the Liberal Democrats yet.'));
  for (const s of stages) {
    out.push(sub(`${s.house}, ${s.stage}: ${s.amendments.length} Liberal Democrat-led amendment${s.amendments.length === 1 ? '' : 's'} of ${s.totalTabled} tabled`));
    const marked = s.amendments.filter((a) => a.noteworthy);
    const plain = s.amendments.filter((a) => !a.noteworthy);
    for (const a of marked) {
      const tags = [a.concession || (a.flags || []).includes('win') ? 'WIN' : '', (a.flags || []).includes('voting') ? 'Voting' : '', (a.flags || []).includes('content') ? 'Content' : '', (a.flags || []).includes('notcontent') ? 'Not Content' : ''].filter(Boolean);
      out.push(para([link(`Amendment ${a.number || '(no number yet)'}`, a.url), run(` (${a.place || 'in the Bill'}), ${a.lead}`, { bold: true }), ...(tags.length ? [run(`  [${tags.join(', ')}]`, { bold: true, color: RED })] : [])], { spacing: { before: 100, after: 20 } }));
      if (a.summary) out.push(para(a.summary, { indent: { left: 284 } }));
      for (const n of a.notes || []) out.push(para([run('Note: ', { bold: true }), run(n)], { indent: { left: 284 } }));
      if (a.concessionNotes) out.push(para([run('Concession: ', { bold: true }), run(a.concessionNotes)], { indent: { left: 284 } }));
    }
    for (const a of plain) {
      out.push(bullet([link(`Am ${a.number || '—'}`, a.url), run(` (${a.place || 'in the Bill'}), ${a.lead}: ${a.summary || 'see the amendment'}`)]));
    }
  }

  /* 4 Parliamentary activity */
  out.push(heading('4. Parliamentary activity'));
  if (!data.divisions.length) out.push(para('There have been no votes on this Bill yet.'));
  const cell = (children, w, o = {}) => new D.TableCell({ width: { size: w, type: D.WidthType.DXA }, margins: { top: 40, bottom: 40, left: 80, right: 80 }, ...o, children });
  const W = [1300, 4700, 2700, 2000];
  const hdrCell = (t, w) => cell([para([run(t, { bold: true, color: 'FFFFFF' })], { spacing: { after: 0 } })], w, { shading: { fill: NAVY, type: D.ShadingType.CLEAR, color: 'auto' } });
  if (data.divisions.length) {
    const edge = { style: D.BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
    out.push(new D.Table({
      width: { size: W.reduce((x, y) => x + y, 0), type: D.WidthType.DXA }, columnWidths: W,
      borders: { top: edge, bottom: edge, left: edge, right: edge, insideHorizontal: edge, insideVertical: edge },
      rows: [
        new D.TableRow({ tableHeader: true, children: [hdrCell('Date', W[0]), hdrCell('Division', W[1]), hdrCell('How the Lib Dems voted', W[2]), hdrCell('Result', W[3])] }),
        ...data.divisions.map((d) => {
          const yes = d.house === 'Lords' ? 'Content' : 'Aye', no = d.house === 'Lords' ? 'Not Content' : 'No';
          const ld = d.ldContent == null ? 'not recorded' : `${d.ldContent} ${yes}, ${d.ldNotContent} ${no}`;
          return new D.TableRow({ children: [
            cell([para(shortDate(d.date), { spacing: { after: 0 } })], W[0]),
            cell([para([link(d.title, d.url), run(` (${d.house})`)], { spacing: { after: 0 } })], W[1]),
            cell([para(ld, { spacing: { after: 0 } })], W[2]),
            cell([para(`${d.result}: ${d.content} to ${d.notContent}`, { spacing: { after: 0 } })], W[3]),
          ] });
        }),
      ],
    }));
  }
  out.push(para([run(`Prepared on ${long(data.generated)} from Parliament’s Bills, Lords Votes, Commons Votes and Members APIs${data.ldActivity.internal ? ' and the team’s notes' : ''}.`, { italics: true, color: '595959', size: 16 })], { spacing: { before: 240 } }));
  return makeDocument(D, out);
}
