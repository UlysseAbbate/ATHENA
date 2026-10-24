// Stakeholders on a Bill: who has been in touch, how to reach them, what their position is, and their briefing.
//   GET  /api/bill-stakeholders?bill=:billId          -> { stakeholders: [ ... ] }              (Whips and above)
//   GET  /api/bill-stakeholders?id=:id&download=1     -> the uploaded briefing itself            (Whips and above)
//   POST /api/bill-stakeholders  (multipart form: billId, organisation, contactName, contact, position, briefing, file, author)
//                                add; with `id` it updates that entry instead (a new `file` replaces the old one,
//                                removeFile=1 removes it)                                       (needs the Whips' Office features)
//   POST /api/bill-stakeholders  { action: 'delete', id }                                       (needs the Whips' Office features)
// The notes are in bill_stakeholders and an uploaded file (as text) in bill_stakeholder_files, so listing never loads files.

import { json, errorResponse } from '../../../lib/libby/util.js';
import { sbSelect, supabaseConfigured } from '../../../lib/libby/supabase.js';
import { passcodeProblem, cleanLine, cleanBlock } from '../../../lib/libby/auth.js';
import { readUpload, toBase64, fromBase64, fileResponse } from '../../../lib/libby/files.js';

const COLUMNS = 'id,bill_id,organisation,contact_name,contact,position,briefing,file_name,size_bytes,created_by,created_at,updated_by,updated_at';
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };
const missingTable = (err) => /bill_stakeholder/.test(String(err.message)) && /does not exist|relation|schema cache/.test(String(err.message));
const MISSING = 'The stakeholder tables have not been created yet: run supabase/migrations/003_stakeholders-and-flags.sql in Supabase.';

const writeHeaders = (env, prefer = 'return=minimal') => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer,
});

async function must(res, what) {
  if (!res.ok) throw new Error(`Supabase ${what}: ${res.status} ${await res.text()}`);
  return res;
}

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  if (!supabaseConfigured(env)) return json({ error: 'Supabase settings are missing in Cloudflare.' }, { status: 503 });
  try {
    const id = posInt(q.get('id'));
    if (id && q.get('download')) {
      const [row] = await sbSelect(env, 'bill_stakeholders', `select=file_name,content_type&id=eq.${id}`);
      const [file] = row ? await sbSelect(env, 'bill_stakeholder_files', `select=data&stakeholder_id=eq.${id}`) : [];
      if (!row || !file) return json({ error: 'That briefing could not be found.' }, { status: 404 });
      return fileResponse(fromBase64(file.data), { name: row.file_name || 'briefing', mime: row.content_type });
    }
    const bill = posInt(q.get('bill'));
    if (!bill) return json({ error: 'Pass ?bill=.' }, { status: 400 });
    const stakeholders = await sbSelect(env, 'bill_stakeholders', `select=${COLUMNS}&bill_id=eq.${bill}&order=organisation.asc,created_at.asc`);
    return json({ stakeholders });
  } catch (err) {
    if (missingTable(err)) return json({ error: MISSING }, { status: 503 });
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
      if (!id) return json({ error: 'Unknown stakeholder.' }, { status: 400 });
      await must(await fetch(`${env.SUPABASE_URL}/rest/v1/bill_stakeholders?id=eq.${id}`, { method: 'DELETE', headers: writeHeaders(env) }), 'bill_stakeholders'); // its file goes with it
      return json({ ok: true, id });
    }

    const form = await request.formData();
    const id = posInt(form.get('id'));
    const billId = posInt(form.get('billId'));
    const organisation = cleanLine(form.get('organisation'), 200);
    const author = cleanLine(form.get('author'), 80) || null;
    if (!organisation) return json({ error: 'Enter the stakeholder organisation.' }, { status: 400 });
    if (!id && !billId) return json({ error: 'Unknown Bill.' }, { status: 400 });

    const fields = {
      organisation,
      contact_name: cleanLine(form.get('contactName'), 150) || null,
      contact: cleanLine(form.get('contact'), 300) || null,
      position: cleanLine(form.get('position'), 400) || null,
      briefing: cleanBlock(form.get('briefing'), 20000) || null,
    };

    let upload = null;
    const file = form.get('file');
    if (file && typeof file !== 'string' && file.size) {
      upload = await readUpload(file);
      if (upload.error) return json({ error: upload.error }, { status: upload.status });
    }
    const removeFile = !upload && form.get('removeFile') === '1';
    const fileFields = upload
      ? { file_name: upload.name, content_type: upload.mime, size_bytes: upload.bytes.length }
      : removeFile ? { file_name: null, content_type: null, size_bytes: null } : {};

    let rowId = id;
    if (id) {
      await must(await fetch(`${env.SUPABASE_URL}/rest/v1/bill_stakeholders?id=eq.${id}`, {
        method: 'PATCH', headers: writeHeaders(env), body: JSON.stringify({ ...fields, ...fileFields, updated_by: author, updated_at: new Date().toISOString() }),
      }), 'bill_stakeholders');
    } else {
      const created = await must(await fetch(`${env.SUPABASE_URL}/rest/v1/bill_stakeholders`, {
        method: 'POST', headers: writeHeaders(env, 'return=representation'),
        body: JSON.stringify([{ bill_id: billId, ...fields, ...fileFields, created_by: author, updated_by: author }]),
      }), 'bill_stakeholders');
      rowId = (await created.json())[0].id;
    }

    if (upload) {
      const stored = await fetch(`${env.SUPABASE_URL}/rest/v1/bill_stakeholder_files`, {
        method: 'POST', headers: writeHeaders(env, 'resolution=merge-duplicates,return=minimal'),
        body: JSON.stringify([{ stakeholder_id: rowId, data: toBase64(upload.bytes) }]),
      });
      if (!stored.ok) {
        if (!id) await fetch(`${env.SUPABASE_URL}/rest/v1/bill_stakeholders?id=eq.${rowId}`, { method: 'DELETE', headers: writeHeaders(env) }); // do not leave an entry whose file is missing
        throw new Error(`Supabase bill_stakeholder_files: ${stored.status} ${await stored.text()}`);
      }
    } else if (removeFile) {
      await must(await fetch(`${env.SUPABASE_URL}/rest/v1/bill_stakeholder_files?stakeholder_id=eq.${rowId}`, { method: 'DELETE', headers: writeHeaders(env) }), 'bill_stakeholder_files');
    }

    const [row] = await sbSelect(env, 'bill_stakeholders', `select=${COLUMNS}&id=eq.${rowId}`);
    return json({ ok: true, stakeholder: row });
  } catch (err) {
    if (missingTable(err)) return json({ error: MISSING }, { status: 503 });
    return errorResponse(err);
  }
}
