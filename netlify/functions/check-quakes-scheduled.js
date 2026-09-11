// Runs on a cron schedule (see netlify.toml) - roughly every 5 minutes -
// REGARDLESS of whether anyone has the site open in a browser tab. This is
// the actual fix for "alarm mati kalau tab ditutup/HP dikunci": the
// in-page polling in arvi.js dies the moment the tab closes, but this
// function runs on Netlify's servers on its own schedule and pushes
// notifications straight to subscribed devices via the Web Push protocol
// + this site's service worker (sw.js), which the OS can deliver even
// when the site isn't open at all.
//
// Being straight about what this is NOT: it is still a POLLING check every
// few minutes, same as the in-page version - it is not a live feed from
// USGS/BMKG and does not shorten how fast USGS/BMKG themselves publish an
// event. It just means detection no longer depends on a browser tab
// staying open and unthrottled.

const webpush = require('web-push');
const { getStore, connectLambda } = require('@netlify/blobs');

const INDONESIA_BOUNDS = { minLat: -11, maxLat: 6.5, minLon: 94.5, maxLon: 141.5 };
const RADIUS_KM = 50;
const BMKG_TARGET = 'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json';

function haversineKm(lat1, lon1, lat2, lon2){
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchJson(url, opts){
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error('http ' + r.status + ' for ' + url);
  return r.json();
}

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
  } catch (err){
    // 404/410 = the browser has permanently invalidated this subscription
    // (uninstalled, permission revoked, etc.) - clean it up so we stop
    // wasting cycles retrying something that will never succeed again.
    if (err && (err.statusCode === 404 || err.statusCode === 410)){
      await store.delete(key);
    }
  }
}

exports.handler = async function(event){
  // Required in "Lambda compatibility mode" (exports.handler style) so
  // getStore() below knows which site/token to use - without this it
  // throws MissingBlobsEnvironmentError in production. Netlify still
  // passes a Lambda-shaped event object to scheduled functions, so this
  // works the same way here as in the HTTP-triggered functions.
  connectLambda(event);

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

  if (!publicKey || !privateKey){
    console.error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY belum di-set di Netlify env vars.');
    return { statusCode: 200, body: 'VAPID keys not configured, skipping.' };
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const stateStore = getStore('quake-state');
  const subStore = getStore('push-subscriptions');

  const state = (await stateStore.get('state', { type: 'json' })) || {
    seenUsgsIds: [],
    lastBmkgKey: null,
    firstRun: true
  };

  const subs = await getAllSubscriptions(subStore);
  const events = []; // { mag, place, time, near: bool, distanceKm, source }

  // ---- USGS (all of Indonesia, M3.5+, last 30 minutes) ------------------
  try {
    const url = 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson' +
      '&starttime=' + new Date(Date.now() - 30 * 60 * 1000).toISOString() +
      '&minlatitude=' + INDONESIA_BOUNDS.minLat +
      '&maxlatitude=' + INDONESIA_BOUNDS.maxLat +
      '&minlongitude=' + INDONESIA_BOUNDS.minLon +
      '&maxlongitude=' + INDONESIA_BOUNDS.maxLon +
      '&minmagnitude=3.5&orderby=time&limit=50';
    const data = await fetchJson(url);
    const seen = new Set(state.seenUsgsIds);
    const newIds = [];
    (data.features || []).forEach(function(f){
      newIds.push(f.id);
      if (seen.has(f.id)) return;
      if (state.firstRun) return; // don't blast pushes for old backlog on first-ever run
      const mag = f.properties.mag;
      const [lon, lat] = f.geometry.coordinates;
      events.push({
        mag: mag, place: f.properties.place, time: f.properties.time,
        lat: lat, lon: lon, source: 'USGS'
      });
    });
    // Cap the remembered id list so this doesn't grow forever.
    state.seenUsgsIds = newIds.slice(0, 300);
  } catch (err){
    console.error('USGS fetch failed:', err.message);
  }

  // ---- BMKG (direct fetch - no CORS issue server-side) -------------------
  try {
    const data = await fetchJson(BMKG_TARGET, { headers: { 'User-Agent': 'ISTrack-ISFR-ARVI/1.0' } });
    const g = data && data.Infogempa && data.Infogempa.gempa;
    if (g){
      const key = g.DateTime + '|' + g.Coordinates;
      if (state.lastBmkgKey && key !== state.lastBmkgKey && !state.firstRun){
        const [latStr, lonStr] = (g.Coordinates || '').split(',');
        // BMKG's own "Potensi" field on this same response already says
        // whether THIS event is tsunami-potential ("Berpotensi tsunami")
        // or not ("Tidak berpotensi tsunami") - no separate endpoint
        // needed, same field the in-page arvi.js polling reads.
        const potensi = String(g.Potensi || '');
        const tsunami = potensi.toLowerCase().indexOf('tsunami') > -1 &&
          potensi.toLowerCase().indexOf('tidak') === -1;
        events.push({
          mag: parseFloat(g.Magnitude) || 0,
          place: g.Wilayah || g.Coordinates || '-',
          time: g.DateTime,
          lat: parseFloat(latStr), lon: parseFloat(lonStr),
          source: 'BMKG',
          tsunami: tsunami,
          potensi: potensi
        });
      }
      state.lastBmkgKey = key;
    }
  } catch (err){
    console.error('BMKG fetch failed (proxy-free, server-side):', err.message);
  }

  state.firstRun = false;
  await stateStore.setJSON('state', state);

  if (!events.length || !subs.length){
    return { statusCode: 200, body: JSON.stringify({ pushed: 0, events: events.length, subs: subs.length }) };
  }

  let pushed = 0;
  for (const ev of events){
    const isBig = ev.mag >= 5;
    for (const { key, record } of subs){
      let near = false;
      let distanceKm = null;
      if (record.lat != null && record.lon != null && ev.lat != null && ev.lon != null){
        distanceKm = haversineKm(record.lat, record.lon, ev.lat, ev.lon);
        near = distanceKm <= RADIUS_KM;
      }
      // Same rule as the in-page alarm: M5+ goes to everyone, smaller
      // quakes only go to people within RADIUS_KM who've shared a location.
      // Tsunami-potential events are the one exception - those go out to
      // everyone regardless of magnitude/distance filtering, since a
      // tsunami threat isn't scoped by the same 50km "did you feel it"
      // radius as shaking is.
      if (!isBig && !near && !ev.tsunami) continue;

      const payload = ev.tsunami ? {
        title: '⚠️ BERPOTENSI TSUNAMI - Gempa M' + ev.mag.toFixed(1),
        body: (ev.potensi || 'Berpotensi tsunami') + ' · ' + (ev.place || '-'),
        mag: ev.mag, place: ev.place, time: ev.time, near: near, source: ev.source, tsunami: true
      } : {
        title: 'PERINGATAN! Gempa M' + ev.mag.toFixed(1),
        body: (ev.place || '-') + (near && distanceKm != null ? (' (~' + Math.round(distanceKm) + ' km darimu)') : ''),
        mag: ev.mag, place: ev.place, time: ev.time, near: near, source: ev.source, tsunami: false
      };
      await pushToSubscription(subStore, key, record.subscription, payload);
      pushed++;
    }
  }

  return { statusCode: 200, body: JSON.stringify({ pushed: pushed, events: events.length, subs: subs.length }) };
};
