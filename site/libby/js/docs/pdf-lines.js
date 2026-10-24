// Reads a PDF in the browser and returns its text as lines (see linesFromTextItems in list-parser.js).
// The PDF never leaves the browser: only the text found in it is used.
import { loadLib, PDFJS_WORKER } from './loader.js';
import { linesFromTextItems } from './list-parser.js';

const MAX_BYTES = 8 * 1024 * 1024;

export async function readPdfLines(file) {
  if (!file) throw new Error('Choose a PDF first.');
  if (file.size > MAX_BYTES) throw new Error('That file is over 8 MB: is it the right one?');
  const pdfjs = await loadLib('pdfjsLib');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  } catch (err) {
    throw new Error(/password/i.test(String(err && err.message)) ? 'That PDF is password protected.' : 'That file could not be read as a PDF.');
  }
  const pages = [];
  for (let n = 1; n <= doc.numPages && n <= 12; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width })));
  }
  const lines = linesFromTextItems(pages);
  if (lines.length < 5) throw new Error('There is hardly any text in that PDF (is it a scan?). Upload the PDF the Whips\u2019 Office sends out.');
  return lines;
}
