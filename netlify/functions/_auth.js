// Shared helper for the admin session system. Not exported as a Netlify
// Function itself (no `exports.handler`) - just required by the other
// functions in this folder (admin-login.js, admin-logout.js,
// admin-check.js, trigger-alarm.js). esbuild bundles it into each one.
//
// How the session works:
//   1. admin-login.js checks username/password against env vars, then
//      signs a small JSON payload { u: username, exp: <timestamp> } with
//      HMAC-SHA256 using ADMIN_SECRET as the key, and sets it as an
//      HttpOnly cookie.
//   2. Every admin-only function (trigger-alarm.js) re-verifies that
//      signature + expiry on the incoming cookie before doing anything.
//      Because it's HttpOnly, page JS can't read or forge it - only our
//      own server-side code can create a valid one.
//   3. admin-logout.js just overwrites the cookie with an already-expired
//      one, which makes the browser drop it.
//
// This is intentionally a lightweight, dependency-free session scheme
// (no JWT library, no database row per session) - appropriate for "one
// or a couple of trusted admins," not a general multi-tenant auth system.

const crypto = require('crypto');

const COOKIE_NAME = 'istrack_admin_session';
const SESSION_HOURS = 8;

function base64url(input){
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(str){
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

function sign(payloadObj, secret){
  const payloadStr = base64url(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
  return payloadStr + '.' + sig;
}

function verify(token, secret){
  if (!token || token.indexOf('.') === -1) return null;
  const [payloadStr, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
  const sigBuf = Buffer.from(sig || '', 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  let payload;
  try { payload = JSON.parse(base64urlDecode(payloadStr)); } catch(e){ return null; }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

function parseCookies(header){
  const out = {};
  (header || '').split(';').forEach(function(pair){
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

// Reads the session cookie off a Netlify Function `event` and returns the
// verified payload, or null if missing/invalid/expired.
function getSession(event, secret){
  const header = (event.headers && (event.headers.cookie || event.headers.Cookie)) || '';
  const cookies = parseCookies(header);
  return verify(cookies[COOKIE_NAME], secret);
}

// Builds the Set-Cookie header value for a fresh login.
function makeSessionCookie(username, secret){
  const payload = { u: username, exp: Date.now() + SESSION_HOURS * 60 * 60 * 1000 };
  const token = sign(payload, secret);
  return COOKIE_NAME + '=' + token + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + (SESSION_HOURS * 3600);
}

// Builds the Set-Cookie header value that clears the session (logout).
function makeExpiredCookie(){
  return COOKIE_NAME + '=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
}

module.exports = { getSession, makeSessionCookie, makeExpiredCookie, COOKIE_NAME };
