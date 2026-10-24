// Loads the browser libraries used to read and write Word and Excel files, only when they are needed.
// Versions are pinned so the site keeps behaving exactly as tested. The files are served from this site (site/libby/vendor), not a CDN.
const local = (file) => new URL('../../vendor/' + file, import.meta.url).href;
const SOURCES = {
  docx: local('docx.iife.js'),     // writes .docx (global: docx)
  JSZip: local('jszip.min.js'),   // reads .docx (global: JSZip)
  XLSX: local('xlsx.full.min.js'),  // writes .xlsx for the Data page (global: XLSX)
  pdfjsLib: local('pdf.min.js'), // reads the Today's List PDF (global: pdfjsLib)
};
/** pdf.js does its reading in a worker script of the same version. */
export const PDFJS_WORKER = local('pdf.worker.min.js');
const pending = {};

export function loadLib(name) {
  if (globalThis[name]) return Promise.resolve(globalThis[name]);
  if (!pending[name]) {
    pending[name] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SOURCES[name];
      s.onload = () => (globalThis[name] ? resolve(globalThis[name]) : reject(new Error(`${name} did not load.`)));
      s.onerror = () => { delete pending[name]; reject(new Error(`Could not load the ${name} library (the file is missing from this site).`)); };
      document.head.appendChild(s);
    });
  }
  return pending[name];
}
