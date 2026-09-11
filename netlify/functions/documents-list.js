// GET - list all documents (used by both dokumentasi.html and
// dokumentasi-admin.html).
//
// No login required to call this: the documents list itself is meant to
// be visible to everyone, same as the "Compliance Documents" reference
// list this tab was modeled on. If the request carries a valid admin
// session cookie, the response also includes `note` and `rejectReason`
// so the admin panel can show why something was rejected - regular
// visitors don't get those fields.

const { getSupabase, toPublicDoc } = require('./_supabase');
const { getSession } = require('./_auth');

exports.handler = async function(event){
  try {
    if (event.httpMethod !== 'GET'){
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const adminSecret = process.env.ADMIN_SECRET;
    const isAdmin = !!(adminSecret && getSession(event, adminSecret));

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ documents: data.map(function(row){ return toPublicDoc(row, isAdmin); }) })
    };
  } catch (err){
    console.error('documents-list crashed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error: ' + (err && err.message ? err.message : String(err)) }) };
  }
};
