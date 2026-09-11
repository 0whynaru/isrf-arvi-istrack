// GET ?id=123
// Returns a short-lived signed URL to the file in Supabase Storage.
// Regular visitors can only get a URL for documents with status
// "active" (i.e. already ACC'd). An admin session cookie bypasses that,
// so dokumentasi-admin.html can preview a waiting/rejected file too.

const { getSupabase, BUCKET } = require('./_supabase');
const { getSession } = require('./_auth');

const SIGNED_URL_SECONDS = 60;

exports.handler = async function(event){
  try {
    if (event.httpMethod !== 'GET'){
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const id = Number((event.queryStringParameters || {}).id);
    if (!id){
      return { statusCode: 400, body: JSON.stringify({ error: 'Query param id wajib diisi.' }) };
    }

    const adminSecret = process.env.ADMIN_SECRET;
    const isAdmin = !!(adminSecret && getSession(event, adminSecret));

    const supabase = getSupabase();
    const { data: doc, error: findError } = await supabase
      .from('documents')
      .select('id, storage_path, original_filename, status')
      .eq('id', id)
      .single();

    if (findError || !doc){
      return { statusCode: 404, body: JSON.stringify({ error: 'Dokumen tidak ditemukan.' }) };
    }
    if (doc.status !== 'active' && !isAdmin){
      return { statusCode: 403, body: JSON.stringify({ error: 'Dokumen ini belum disetujui admin.' }) };
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(doc.storage_path, SIGNED_URL_SECONDS, { download: doc.original_filename });
    if (signError) throw signError;

    return { statusCode: 200, body: JSON.stringify({ url: signed.signedUrl, fileName: doc.original_filename }) };
  } catch (err){
    console.error('documents-download crashed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error: ' + (err && err.message ? err.message : String(err)) }) };
  }
};
