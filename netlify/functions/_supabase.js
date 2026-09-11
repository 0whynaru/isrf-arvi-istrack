// Shared helper for the documents feature. Not a Netlify Function itself
// (no exports.handler) - required by documents-list.js, documents-upload.js,
// documents-approve.js, documents-reject.js, documents-download.js.
//
// Uses the SUPABASE SERVICE ROLE key, never the anon key - these functions
// run server-side only inside Netlify, the browser never sees this key.
// That's also why Row Level Security on the `documents` table and the
// `documents` storage bucket can stay locked down with no policies at
// all: the service role bypasses RLS by design, and nothing else ever
// talks to Supabase directly.

const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'documents';
const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024; // Netlify Functions request body cap is ~6MB; base64 inflates ~33%, so ~4.5MB of real file fits safely under that with room for the JSON wrapper.

function getSupabase(){
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key){
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum di-set di Netlify env vars.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// Shape returned to the browser. `admin` controls whether internal-only
// fields (note, reject_reason) are included - public visitors see status
// but not the review notes behind it.
function toPublicDoc(row, admin){
  const out = {
    id: row.id,
    title: row.title,
    fileName: row.original_filename,
    mimeType: row.mime_type,
    uploader: row.uploader_name,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at
  };
  if (admin){
    out.note = row.note;
    out.rejectReason = row.reject_reason;
  }
  return out;
}

module.exports = { getSupabase, BUCKET, MAX_UPLOAD_BYTES, toPublicDoc };
