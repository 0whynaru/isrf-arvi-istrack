// POST { title, body, cause?, simulation?, mag?, tsunami? }
//
// Manual override of check-quakes-scheduled.js: instead of waiting for the
// 5-minute BMKG/USGS poll to notice a quake on its own, an admin can hit
// this endpoint (from admin.html) to push an alarm to EVERY currently
// subscribed device right away. Same delivery path as the automatic
// alarm - Web Push -> sw.js `push` event -> showNotification() - so it
// works even for devices with the tab closed / phone locked, exactly
// like the automatic quake alerts do.
//
// Auth: requires a valid admin session cookie (see _auth.js and
// admin-login.js) - i.e. the caller must have already logged in with
// ADMIN_USERNAME/ADMIN_PASSWORD. No secret is passed in the request body
// anymore; the browser sends the HttpOnly cookie automatically.

const webpush = require('web-push');
const { getStore, connectLambda } = require('@netlify/blobs');
const { getSession } = require('./_auth');

async function getAllSubscriptions(store){
  const list = await store.list();
  const subs = [];
  for (const item of list.blobs){
    const rec = await store.get(item.key, { type: 'json' });
    if (rec && rec.subscription) subs.push({ key: item.key, record: rec });
  }
  return subs;
}

async function pushToSubscription(store, key, subscription, payload){
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err){
    if (err && (err.statusCode === 404 || err.statusCode === 410)){
      // Subscription is dead (uninstalled / permission revoked) - clean it up.
      await store.delete(key);
    }
    return false;
  }
}

exports.handler = async function(event){
  // Wrap EVERYTHING in try/catch: an uncaught throw anywhere below (most
  // likely culprit: webpush.setVapidDetails() rejecting a malformed VAPID
  // key - e.g. stray whitespace/newline from copy-pasting into Netlify's
  // env var UI) crashes the function process itself, which Netlify then
  // reports to the browser as a bare "502 Bad Gateway" with no useful
  // message. Catching it here turns that into a real JSON error instead.
  try {
    // Required in "Lambda compatibility mode" (exports.handler style) so
    // getStore() below knows which site/token to use - without this it
    // throws MissingBlobsEnvironmentError in production.
    connectLambda(event);

    if (event.httpMethod !== 'POST'){
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e){
      return { statusCode: 400, body: 'Invalid JSON' };
    }

    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret){
      return { statusCode: 500, body: JSON.stringify({ error: 'ADMIN_SECRET belum di-set di Netlify env vars.' }) };
    }
    const session = getSession(event, adminSecret);
    if (!session){
      return { statusCode: 401, body: JSON.stringify({ error: 'Belum login / sesi habis.' }) };
    }

    // .trim() defensively strips accidental leading/trailing whitespace or
    // newlines that copy-pasting into the Netlify dashboard can introduce -
    // web-push validates these strictly and throws on anything extra.
    const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
    const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
    const subject = (process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim();
    if (!publicKey || !privateKey){
      return { statusCode: 500, body: JSON.stringify({ error: 'VAPID keys belum di-set di Netlify env vars.' }) };
    }
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    } catch (vapidErr){
      return { statusCode: 500, body: JSON.stringify({
        error: 'VAPID key tidak valid: ' + vapidErr.message + '. Cek env var VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY di Netlify - kemungkinan ada spasi/newline nyangkut waktu paste.'
      }) };
    }

    const isSimulation = !!body.simulation;
    const cause = (body.cause || '').trim();

    let title = body.title || 'PERINGATAN! Alarm Gempa (Manual)';
    let text = body.body || 'Alarm dipicu manual oleh admin/pemonitor.';

    // Cause gets appended to the body as its own labeled line, kept
    // separate from the admin's free-text message so it reads consistently
    // notification to notification (e.g. "Penyebab: Aktivitas sesar aktif").
    if (cause) text = text + (text ? '\n' : '') + 'Penyebab: ' + cause;

    // Simulation gets a loud, impossible-to-miss prefix on BOTH title and
    // body - this is the one thing that must never be silently droppable,
    // since it's the difference between "this is a drill" and "this is
    // real" for whoever receives the push.
    if (isSimulation){
      title = '[SIMULASI] ' + title;
      text = '(Ini hanya simulasi/latihan, bukan gempa nyata) ' + text;
    }

    const payload = {
      title: title,
      body: text,
      mag: typeof body.mag === 'number' ? body.mag : null,
      time: Date.now(),
      source: 'MANUAL',
      cause: cause || null,
      simulation: isSimulation,
      tsunami: !!body.tsunami,
      manual: true
    };

    const subStore = getStore('push-subscriptions');
    const subs = await getAllSubscriptions(subStore);

    let pushed = 0, failed = 0;
    for (const { key, record } of subs){
      const ok = await pushToSubscription(subStore, key, record.subscription, payload);
      if (ok) pushed++; else failed++;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, totalSubscribers: subs.length, pushed: pushed, failed: failed })
    };
  } catch (err){
    console.error('trigger-alarm crashed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error: ' + (err && err.message ? err.message : String(err)) }) };
  }
};
