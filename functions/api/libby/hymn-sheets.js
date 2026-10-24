// Hymn sheets uploaded by the advisers, for the Whips to download.
//   GET  /api/hymn-sheets                 -> { sheets: [ ... ] }                       (Whips and above)
//   GET  /api/hymn-sheets?id=12&download=1 -> the file itself                           (Whips and above)
//   POST /api/hymn-sheets  (multipart form: file, title, billId, billTitle, stage, day, sittingDate, author)   upload  (Staff and Admin)
//   POST /api/hymn-sheets  { action: 'delete', id }                                                         delete  (Staff and Admin)
// The details are kept in the hymn_sheets table and the file (as text) in hymn_sheet_files, so listing never loads files.
// Word (.docx, .doc) and PDF files up to 4 MB are accepted, and the start of each file is checked to be what its name says.

import { json, errorResponse, isIsoDate } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine } from '../../../lib/libby/auth.js';
import { readUpload, toBase64, fromBase64, safeName, fileResponse } from '../../../lib/libby/files.js';

const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const writeHeaders = (env, prefer = 'return=minimal') => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer,
});

const missingTable = (err) => /hymn_sheet/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });
  try {
    const id = posInt(q.get('id'));
    if (id && q.get('download')) {
      const [sheet] = await sbSelect(env, 'hymn_sheets', `select=file_name,content_type&id=eq.${id}`);
      const [file] = sheet ? await sbSelect(env, 'hymn_sheet_files', `select=data&sheet_id=eq.${id}`) : [];
      if (!sheet || !file) return json({ error: 'That hymn sheet could not be found.' }, { status: 404 });
      return fileResponse(fromBase64(file.data), { name: safeName(sheet.file_name, 'hymn-sheet'), mime: sheet.content_type });
    }
    const sheets = await sbSelect(env, 'hymn_sheets',
      'select=id,title,bill_id,bill_title,stage,day_number,sitting_date,file_name,size_bytes,uploaded_by,uploaded_at&order=sitting_date.desc.nullslast,uploaded_at.desc&limit=500');
    return json({ sheets });
  } catch (err) {
    if (missingTable(err)) return json({ error: 'The hymn sheet tables have not been created yet: run add-whips.sql in Supabase.' }, { status: 503 });
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  const refused = await passcodeProblem(request, env);
  if (refused) return refused;
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });
  const isForm = /multipart\/form-data/i.test(request.headers.get('content-type') || '');

  try {
    if (!isForm) {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Send JSON or a form.' }, { status: 400 }); }
      if (body?.action !== 'delete') return json({ error: 'Unknown action.' }, { status: 400 });
      const id = posInt(body.id);
      if (!id) return json({ error: 'Unknown hymn sheet.' }, { status: 400 });
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/hymn_sheets?id=eq.${id}`, { method: 'DELETE', headers: writeHeaders(env) }); // its file goes with it
      if (!res.ok) throw new Error(`Supabase hymn_sheets: ${res.status} ${await res.text()}`);
      return json({ ok: true, id });
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string' || !file.size) return json({ error: 'Choose a file to upload.' }, { status: 400 });
    const upload = await readUpload(file);
    if (upload.error) return json({ error: upload.error }, { status: upload.status });
    const { bytes } = upload;

    const billId = posInt(form.get('billId'));
    const billTitle = cleanLine(form.get('billTitle'), 200);
    const stage = cleanLine(form.get('stage'), 60);
    const day = posInt(form.get('day'));
    const date = isIsoDate(form.get('sittingDate')) ? form.get('sittingDate') : null;
    const title = cleanLine(form.get('title'), 200)
      || [billTitle, stage, day ? `Day ${day}` : '', 'Hymn Sheet'].filter(Boolean).join(' - ');

    const created = await fetch(`${env.SUPABASE_URL}/rest/v1/hymn_sheets`, {
      method: 'POST', headers: writeHeaders(env, 'return=representation'),
      body: JSON.stringify([{
        title, bill_id: billId || null, bill_title: billTitle || null, stage: stage || null, day_number: day || null, sitting_date: date,
        file_name: upload.name, content_type: upload.mime, size_bytes: bytes.length, uploaded_by: cleanLine(form.get('author'), 80) || null,
      }]),
    });
    if (!created.ok) throw new Error(`Supabase hymn_sheets: ${created.status} ${await created.text()}`);
    const [sheet] = await created.json();
    const stored = await fetch(`${env.SUPABASE_URL}/rest/v1/hymn_sheet_files`, {
      method: 'POST', headers: writeHeaders(env), body: JSON.stringify([{ sheet_id: sheet.id, data: toBase64(bytes) }]),
    });
    if (!stored.ok) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/hymn_sheets?id=eq.${sheet.id}`, { method: 'DELETE', headers: writeHeaders(env) }); // do not leave a sheet with no file
      throw new Error(`Supabase hymn_sheet_files: ${stored.status} ${await stored.text()}`);
    }
    return json({ ok: true, id: sheet.id, title });
  } catch (err) {
    if (missingTable(err)) return json({ error: 'The hymn sheet tables have not been created yet: run add-whips.sql in Supabase.' }, { status: 503 });
    return errorResponse(err);
  }
}
