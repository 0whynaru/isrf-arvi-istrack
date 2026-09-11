// ISTrack / ISFR-ARVI service worker
//
// This is what actually fixes "alarm mati kalau tab ditutup / HP dikunci":
// a normal setInterval() in a page's JS dies the moment the tab is closed
// or the browser throttles/kills background tabs. A Service Worker is a
// separate background script the browser keeps around specifically so it
// can wake up and handle a `push` event even when no tab for this site is
// open at all - that's what makes a real background alarm possible.
//
// This file only reacts to push messages sent by our own backend
// (netlify/functions/check-quakes-scheduled.js) via the Web Push protocol.
// It does not do any polling itself.

self.addEventListener('install', function(event){
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event){
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e){}

  var title = data.title || 'Peringatan Gempa';
  var body = data.body || '';
  var isTsunami = !!data.tsunami;

  // Level keparahan beda di notifikasi latar belakang: getar gempa biasa
  // vs getar tsunami yang lebih panjang/berat, karena field `tsunami` ini
  // sudah dikirim di payload dari trigger-alarm.js / check-quakes-scheduled.js
  // tapi sebelumnya gak dipakai sama sekali di sini.
  //
  // JUJUR: Web Notifications / Web Push TIDAK punya opsi "sound" ataupun
  // "color" kustom - semua browser mengabaikan field itu kalau dikasih,
  // dan ikon/badge di Android biasanya di-tint monokrom sama sistem
  // (warna asli file PNG-nya diabaikan). Jadi yang benar-benar bisa
  // dibedakan lewat API ini cuma: pola getar, tag/judul/isi teks (yang
  // sudah beda dari sisi server), dan requireInteraction. Suara notifikasi
  // yang benar-benar terdengar beda tiap tsunami vs gempa biasa cuma bisa
  // didapat kalau tab-nya lagi kebuka (lihat playQuakeAlarm() di arvi.js,
  // yang sekarang juga sudah dibedakan) - bukan lewat push saat app ditutup.
  var vibratePattern = isTsunami
    ? [700, 150, 700, 150, 700, 150, 700, 150, 1200, 300, 1200, 300, 1200]
    : [500, 200, 500, 200, 500, 200, 900, 300, 900, 300, 900];

  var options = {
    body: body,
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    // Tag includes the severity type + time: near-identical events of the
    // SAME type replace each other instead of piling up, but a tsunami
    // push never silently replaces (or gets replaced by) a plain quake
    // push tag, so it can't get swallowed if both land close together.
    tag: 'istrack-' + (isTsunami ? 'tsunami-' : 'quake-') + (data.time || Date.now()),
    requireInteraction: true,
    vibrate: vibratePattern,
    data: data
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var targetUrl = '/arvi.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      for (var i = 0; i < list.length; i++){
        var client = list[i];
        if (client.url.indexOf('arvi.html') !== -1 && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
