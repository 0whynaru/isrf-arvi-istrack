// POST { title, uploaderName, note?, fileName, mimeType, fileBase64 }
//
// No user-login system exists on ISTrack for regular visitors (only
// admins log in) - so `uploaderName` is a free-text field the sender
// types in, same spirit as the "Nama Pengirim" style field you'd see on
// a public compliance-document form. New documents always land as
// status "waiting" and only become downloadable once an admin hits ACC
// on dokumentasi-admin.html.
//
// File is sent as base64 inside the JSON body (no multipart parsing
// needed, no extra dependency). This caps real file size at roughly
// 4.5MB - see MAX_UPLOAD_BYTES in _supabase.js. If you outgrow that,
// switch to Supabase's createSignedUploadUrl() so the browser uploads
// straight to Storage instead of through this function.

const crypto = require('crypto');
const { getSupabase, BUCKET, MAX_UPLOAD_BYTES } = require('./_supabase');

function sanitizeFileName(name){
  return String(name || 'dokumen').replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(-120);
}

exports.handler = async function(event){
  try {
    if (event.httpMethod !== 'POST'){
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e){
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const title = (body.title || '').trim();
    const uploaderName = (body.uploaderName || '').trim();
    const note = (body.note || '').trim();
    const fileName = sanitizeFileName(body.fileName);
    const mimeType = (body.mimeType || 'application/octet-stream').trim();
    const fileBase64 = body.fileBase64 || '';

    if (!title || !uploaderName || !fileBase64){
      return { statusCode: 400, body: JSON.stringify({ error: 'title, uploaderName, dan fileBase64 wajib diisi.' }) };
    }

    const fileBuffer = Buffer.from(fileBase64, 'base64');
    if (fileBuffer.length > MAX_UPLOAD_BYTES){
      return { statusCode: 413, body: JSON.stringify({ error: 'File terlalu besar. Maksimal sekitar 4.5MB.' }) };
    }

    const supabase = getSupabase();
    const storagePath = Date.now() + '-' + crypto.randomBytes(6).toString('hex') + '-' + fileName;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: false });
    if (uploadError) throw uploadError;

    const { data, error: insertError } = await supabase
      .from('documents')
      .insert({
        title: title,
        original_filename: fileName,
        storage_path: storagePath,
        mime_type: mimeType,
        uploader_name: uploaderName,
        note: note || null,
        status: 'waiting'
      })
      .select('id')
      .single();

    if (insertError){
      // Clean up the file we just uploaded so it doesn't become an
      // orphan in Storage with no matching row.
      await supabase.storage.from(BUCKET).remove([storagePath]).catch(function(){});
      throw insertError;
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, id: data.id }) };
  } catch (err){
    console.error('documents-upload crashed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error: ' + (err && err.message ? err.message : String(err)) }) };
  }
};
