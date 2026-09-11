// POST { username, password }
// On success, sets an HttpOnly session cookie (see _auth.js) and returns
// { ok: true }. That cookie is what trigger-alarm.js (and admin-check.js)
// check afterwards - the browser sends it automatically on same-origin
// requests, admin.html's JS never sees or handles the credential itself.

const { makeSessionCookie } = require('./_auth');

// Simple brute-force slow-down: fixed delay on every attempt regardless
// of outcome, so failed guesses can't be thrown rapid-fire, and success
// vs failure can't be timed apart either.
function delay(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }

exports.handler = async function(event){
  if (event.httpMethod !== 'POST'){
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e){
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const adminSecret = process.env.ADMIN_SECRET;
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD;

  if (!adminSecret || !adminPass){
    return { statusCode: 500, body: JSON.stringify({ error: 'ADMIN_SECRET / ADMIN_PASSWORD belum di-set di Netlify env vars.' }) };
  }

  await delay(400);

  const userOk = (body.username || '') === adminUser;
  const passOk = (body.password || '') === adminPass;

  if (!userOk || !passOk){
    return { statusCode: 401, body: JSON.stringify({ error: 'Username atau password salah.' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Set-Cookie': makeSessionCookie(adminUser, adminSecret), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true })
  };
};
