// POST { action: 'subscribe', subscription: PushSubscriptionJSON, lat, lon }
// POST { action: 'unsubscribe', endpoint: '...' }
//
// Stores/removes a browser's Web Push subscription in Netlify Blobs so the
// scheduled function (check-quakes-scheduled.js) knows who to push
// earthquake alerts to, and (optionally) roughly where they are so it can
// decide whether a smaller nearby quake is relevant to them.
//
// PRIVACY NOTE (be upfront about this with users): lat/lon here is stored
// server-side, unlike everything else in this app which stays on-device.
// It is only used to compare distance-to-quake and is never shown to
// other users or used for anything else.

const { getStore, connectLambda } = require('@netlify/blobs');
const crypto = require('crypto');

function keyFor(endpoint){
  return crypto.createHash('sha256').update(endpoint).digest('hex');
}

exports.handler = async function(event){
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

  const store = getStore('push-subscriptions');

  if (body.action === 'unsubscribe'){
    const endpoint = body.endpoint || (body.subscription && body.subscription.endpoint);
    if (!endpoint) return { statusCode: 400, body: 'Missing endpoint' };
    await store.delete(keyFor(endpoint));
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  const sub = body.subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth){
    return { statusCode: 400, body: 'Missing/invalid subscription' };
  }

  const record = {
    subscription: sub,
    lat: typeof body.lat === 'number' ? body.lat : null,
    lon: typeof body.lon === 'number' ? body.lon : null,
    updatedAt: Date.now()
  };

  await store.setJSON(keyFor(sub.endpoint), record);

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
