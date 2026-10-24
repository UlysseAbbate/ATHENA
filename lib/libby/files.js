// Uploaded files kept in the database as base64 text (hymn sheets, stakeholder briefings).
// Only Word and PDF files are accepted, up to 4 MB, and the start of each file is checked to be what its name says.

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const UPLOAD_TYPES = {
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: [0x50, 0x4b, 0x03, 0x04] },
  doc: { mime: 'application/msword', magic: [0xd0, 0xcf, 0x11, 0xe0] },
  pdf: { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] },
};

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const safeName = (name, fallback = 'file') => String(name || fallback).replace(/[\u0000-\u001f"\\/:*?<>|]+/g, '_').slice(0, 150);

/**
 * Checks an uploaded File. Returns { error, status } if it is not acceptable, otherwise { bytes, mime, name }.
 */
export async function readUpload(file) {
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'That file is over 4 MB. Save it as a smaller file and try again.', status: 413 };
  const ext = String(file.name || '').toLowerCase().split('.').pop();
  const type = UPLOAD_TYPES[ext];
  if (!type) return { error: 'Upload a Word (.docx or .doc) or PDF file.', status: 400 };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!type.magic.every((b, i) => bytes[i] === b)) return { error: `That file does not look like a real .${ext} file.`, status: 400 };
  return { bytes, mime: type.mime, name: safeName(file.name) };
}

/** A download reply for stored file bytes. */
export function fileResponse(bytes, { name, mime }) {
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': mime || 'application/octet-stream',
      'content-disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'private, no-store',
    },
  });
}
