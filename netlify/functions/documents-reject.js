// POST { id, reason? } - admin only.
// Flips a document's status to "rejected" and stores the reason, which
// dokumentasi.html can show the uploader later. Same session-cookie
// auth as documents-approve.js / trigger-alarm.js.

const { getSupabase } = require('./_supabase');
const { getSession } = require('./_auth');

exports.handler = async function(event){
  try {
    if (event.httpMethod !== 'POST'){
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret){
      return { statusCode: 500, body: JSON.stringify({ error: 'ADMIN_SECRET belum di-set di Netlify env vars.' }) };
    }
    const session = getSession(event, adminSecret);
    if (!session){
      return { statusCode: 401, body: JSON.stringify({ error: 'Belum login / sesi habis.' }) };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e){
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const id = Number(body.id);
    if (!id){
      return { statusCode: 400, body: JSON.stringify({ error: 'id wajib diisi.' }) };
    }
    const reason = (body.reason || '').trim();

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('documents')
      .update({ status: 'rejected', reject_reason: reason || null, decided_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, title')
      .single();

    if (error) throw error;
    if (!data){
      return { statusCode: 404, body: JSON.stringify({ error: 'Dokumen tidak ditemukan.' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, id: data.id, title: data.title }) };
  } catch (err){
    console.error('documents-reject crashed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error: ' + (err && err.message ? err.message : String(err)) }) };
  }
};
