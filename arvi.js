(function(){
  'use strict';

  // ---------------------------------------------------------------
  // ISFR-ARVI map + statistics
  //
  // Data sources:
  //  - Gempa bumi: USGS GeoJSON feed (LIVE, real-time, CORS-friendly)
  //  - Radar curah hujan: RainViewer tile API (LIVE, no key required)
  //  - Titik api / hotspot (peta): NASA GIBS/FIRMS WMS raster (LIVE, no key)
  //  - Titik api / hotspot (statistik per-titik): pakai data contoh secara
  //    default. Kalau pengguna mengisi MAP_KEY FIRMS gratis lewat panel
  //    filter, statistik beralih memakai data asli dari FIRMS Area API.
  // ---------------------------------------------------------------

  // ---- Boot / opening screen -------------------------------------------
  // Shows the ISFR-ARVI logo for a minimum time so the page doesn't just
  // "pop" the map in, but never blocks longer than MAX_BOOT_MS even if a
  // resource stalls or fails to load.
  (function bootScreen(){
    var boot = document.getElementById('arviBoot');
    if (!boot) return;
    var MIN_BOOT_MS = 5000;
    var MAX_BOOT_MS = 5000;
    var start = Date.now();
    var hidden = false;
    function hide(){
      if (hidden) return;
      hidden = true;
      var wait = Math.max(0, MIN_BOOT_MS - (Date.now() - start));
      setTimeout(function(){
        boot.classList.add('is-hidden');
        setTimeout(function(){ if (boot.parentNode) boot.parentNode.removeChild(boot); }, 650);
      }, wait);
    }
    window.addEventListener('load', hide);
    setTimeout(hide, MAX_BOOT_MS);
  })();

  var FIRMS_KEY_STORAGE = 'istrack_firms_mapkey';

  function getFirmsKey(){
    try { return (localStorage.getItem(FIRMS_KEY_STORAGE) || '').trim(); } catch(e){ return ''; }
  }
  function setFirmsKey(key){
    try {
      if (key) localStorage.setItem(FIRMS_KEY_STORAGE, key);
      else localStorage.removeItem(FIRMS_KEY_STORAGE);
    } catch(e){}
  }

  // FIRMS' Area API serves several independent satellite/sensor sources -
  // switching between them isn't just a color/style choice, each one is a
  // genuinely different detector with its own revisit time & resolution:
  //   - VIIRS_SNPP_NRT   : Suomi-NPP, 375m pixels, ~12hr revisit (default)
  //   - VIIRS_NOAA20_NRT : NOAA-20,   375m pixels, ~12hr revisit, offset orbit
  //   - VIIRS_NOAA21_NRT : NOAA-21,   375m pixels, newest satellite of the three
  //   - MODIS_NRT        : Terra+Aqua, 1km pixels, coarser but longer track record
  var FIRE_SOURCE_STORAGE = 'istrack_arvi_fire_source';
  var FIRE_SOURCES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'MODIS_NRT'];
  function getFireSource(){
    try {
      var v = localStorage.getItem(FIRE_SOURCE_STORAGE);
      return FIRE_SOURCES.indexOf(v) > -1 ? v : FIRE_SOURCES[0];
    } catch(e){ return FIRE_SOURCES[0]; }
  }
  function setFireSource(v){
    try { if (FIRE_SOURCES.indexOf(v) > -1) localStorage.setItem(FIRE_SOURCE_STORAGE, v); } catch(e){}
  }

  // Statistics/alert scope: Indonesia-only (default) or worldwide. This
  // only affects the FIRMS Area API call used for the counter/alarm - the
  // NASA GIBS raster layer on the map already shows fires everywhere in
  // the world regardless of this setting, since it's just map tiles.
  var FIRE_SCOPE_STORAGE = 'istrack_arvi_fire_scope';
  function getFireScope(){
    try { return localStorage.getItem(FIRE_SCOPE_STORAGE) === 'world' ? 'world' : 'idn'; } catch(e){ return 'idn'; }
  }
  function setFireScope(v){
    try { localStorage.setItem(FIRE_SCOPE_STORAGE, v === 'world' ? 'world' : 'idn'); } catch(e){}
  }

  var INDONESIA_BOUNDS = { minLat: -11, maxLat: 6.5, minLon: 94.5, maxLon: 141.5 };

  // Rough bounding boxes used to bucket a lat/lon point into an Indonesian
  // macro-region. This is a simplification for demo/statistics purposes,
  // not an authoritative administrative boundary lookup.
  var REGIONS = [
    { id: 'sumatra',   name: 'Sumatra',        minLat: -6,   maxLat: 6.5,  minLon: 94.5, maxLon: 106 },
    { id: 'jawa',      name: 'Jawa',           minLat: -9,   maxLat: -5.5, minLon: 105,  maxLon: 115 },
    { id: 'kalimantan',name: 'Kalimantan',     minLat: -4.5, maxLat: 5,    minLon: 108.5,maxLon: 119.5 },
    { id: 'sulawesi',  name: 'Sulawesi',       minLat: -6.5, maxLat: 2,    minLon: 118.5,maxLon: 125.5 },
    { id: 'nusatenggara', name: 'Nusa Tenggara', minLat: -11, maxLat: -7.5, minLon: 114.5, maxLon: 125.5 },
    { id: 'maluku',    name: 'Maluku',         minLat: -8.5, maxLat: 3,    minLon: 124.5,maxLon: 135.5 },
    { id: 'papua',     name: 'Papua',          minLat: -9.5, maxLat: 0.5,  minLon: 130.5,maxLon: 141.5 }
  ];

  function regionFor(lat, lon){
    for (var i = 0; i < REGIONS.length; i++){
      var r = REGIONS[i];
      if (lat >= r.minLat && lat <= r.maxLat && lon >= r.minLon && lon <= r.maxLon) return r;
    }
    return null;
  }

  // Demo fire hotspot points (illustrative only - see note above).
  function fetchFireDemoData(){
    return [
      { lat: -2.2,  lon: 113.9, name: 'Kalimantan Tengah' },
      { lat: -0.5,  lon: 101.4, name: 'Riau' },
      { lat: -3.3,  lon: 114.6, name: 'Kalimantan Selatan' },
      { lat: -1.6,  lon: 103.6, name: 'Jambi' },
      { lat: -4.0,  lon: 121.0, name: 'Sulawesi Selatan' }
    ];
  }

  // Real per-point hotspot data from NASA FIRMS' "Area" API. Requires a
  // free MAP_KEY (https://firms.modaps.eosdis.nasa.gov/api/area/). Returns
  // a promise resolving to the same {lat, lon, name} shape as the demo
  // data, capped to a sane point count so the UI stays responsive.
  // NASA's FIRMS "Area" API server does not send an
  // Access-Control-Allow-Origin header, so a direct browser fetch() to it
  // gets silently blocked by the browser's CORS policy - the request never
  // even reaches NASA. From the outside that looks EXACTLY like "the
  // MAP_KEY is invalid" (a rejected/failed fetch), even with a perfectly
  // good key - there is nothing wrong with the key itself. Work around it
  // the same way this file already does for BMKG below: try the request
  // directly first (in case NASA ever adds CORS support), then fall back
  // to a short list of public CORS proxies. Remember whichever proxy last
  // worked so a dead one doesn't cost an extra failed round-trip every time.
  var FIRMS_PROXIES = [
    function(url){ return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url); },
    function(url){ return 'https://corsproxy.io/?url=' + encodeURIComponent(url); },
    function(url){ return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url); }
  ];
  var lastWorkingFirmsProxy = 0;
  function fetchFirmsCsv(url){
    function viaProxyChain(){
      var order = FIRMS_PROXIES.map(function(_, i){ return i; });
      order.sort(function(a, b){
        if (a === lastWorkingFirmsProxy) return -1;
        if (b === lastWorkingFirmsProxy) return 1;
        return 0;
      });
      var i = 0;
      function attempt(){
        if (i >= order.length) return Promise.reject(new Error('all-firms-proxies-failed'));
        var idx = order[i++];
        return fetch(FIRMS_PROXIES[idx](url)).then(function(r){
          if (!r.ok) throw new Error('proxy-http-' + r.status);
          return r.text();
        }).then(function(text){
          lastWorkingFirmsProxy = idx;
          return text;
        }).catch(function(){
          return attempt(); // try the next proxy in line
        });
      }
      return attempt();
    }
    return fetch(url).then(function(r){
      if (!r.ok) throw new Error('http-' + r.status);
      return r.text();
    }).catch(function(){
      return viaProxyChain();
    });
  }

  var FIRMS_MAX_POINTS = 600;
  function fetchFireRealData(days, source, scope){
    var key = getFirmsKey();
    if (!key) return Promise.reject(new Error('no-key'));
    var range = Math.min(10, Math.max(1, days || 1));
    var src = FIRE_SOURCES.indexOf(source) > -1 ? source : FIRE_SOURCES[0];
    // FIRMS' "area" endpoint takes a west,south,east,north bounding box (or
    // "world") - it does NOT accept an ISO country code like "IDN" (that's
    // only valid on the separate /api/country/ endpoint). Passing "IDN"
    // here used to make NASA return an error response, which this code
    // then misread as "the MAP_KEY is invalid" even for a perfectly good
    // key. Indonesia's bbox fixes that; "world" covers every country.
    var bbox = scope === 'world'
      ? 'world'
      : (INDONESIA_BOUNDS.minLon + ',' + INDONESIA_BOUNDS.minLat + ',' +
         INDONESIA_BOUNDS.maxLon + ',' + INDONESIA_BOUNDS.maxLat);
    var url = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv/' + encodeURIComponent(key) +
      '/' + src + '/' + bbox + '/' + range;
    return fetchFirmsCsv(url).then(function(csv){
      var lines = csv.split(/\r?\n/).filter(Boolean);
      if (!lines.length) throw new Error('empty');
      // FIRMS may return a plain-text error (e.g. invalid key) instead of
      // CSV - guard against that by checking the header looks right.
      var header = lines[0].toLowerCase();
      if (header.indexOf('latitude') === -1 || header.indexOf('longitude') === -1) {
        throw new Error('invalid-response');
      }
      var cols = header.split(',');
      var latIdx = cols.indexOf('latitude');
      var lonIdx = cols.indexOf('longitude');
      var confIdx = cols.indexOf('confidence');
      var points = [];
      // Worldwide queries can return tens of thousands of rows in one day -
      // rendering all of them as individual Leaflet markers would freeze a
      // phone. `total` counts every real row (used for the "X titik api
      // baru" alert math); `points` is capped for what actually gets drawn
      // on the map/legend, so the alarm still reflects reality even though
      // the visible dots don't.
      var total = 0;
      for (var i = 1; i < lines.length; i++){
        var parts = lines[i].split(',');
        var lat = parseFloat(parts[latIdx]);
        var lon = parseFloat(parts[lonIdx]);
        if (isNaN(lat) || isNaN(lon)) continue;
        total++;
        if (points.length < FIRMS_MAX_POINTS){
          var region = regionFor(lat, lon);
          points.push({
            lat: lat,
            lon: lon,
            name: (region && region.name) || 'Indonesia',
            confidence: confIdx > -1 ? parts[confIdx] : null
          });
        }
      }
      return { points: points, total: total };
    });
  }

  function quakeColor(mag){
    if (mag >= 5.5) return '#ff6b6b';
    if (mag >= 4.5) return '#ff7a45';
    return '#f2c94c';
  }

  function fmtPct(n){
    return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '') + '%';
  }

  document.addEventListener('DOMContentLoaded', function(){
    var mapEl = document.getElementById('arviMap');
    if (!mapEl || typeof L === 'undefined') return;

    // zoomControl:false - Leaflet's own zoom buttons are replaced by the
    // custom-styled +/- control in the corner (#arviZoomCtrl below), wired
    // up further down, so we don't end up with two overlapping zoom UIs.
    var map = L.map('arviMap', { zoomControl: false, maxZoom: 19 }).setView([-2.5, 118], 5);

    // The map now fills the viewport dynamically (full-screen layout)
    // instead of sitting in a fixed-height box, so Leaflet needs a nudge
    // whenever the container size can change: on load, after the boot
    // screen animates out, on window resize/orientation change, and
    // once webfonts settle (which can shift the nav bar's height).
    function refreshMapSize(){ map.invalidateSize(); }
    setTimeout(refreshMapSize, 60);
    window.addEventListener('load', refreshMapSize);
    window.addEventListener('resize', refreshMapSize);
    window.addEventListener('orientationchange', function(){ setTimeout(refreshMapSize, 250); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refreshMapSize);

    // Dedicated pane for place-name / border labels so they always sit on
    // top of data overlays (quake/fire markers, radar) instead of getting
    // buried underneath them the way a normal tile layer would.
    map.createPane('labelsPane');
    map.getPane('labelsPane').style.zIndex = 650;
    map.getPane('labelsPane').style.pointerEvents = 'none';

    // Dedicated pane for the live fire hotspot raster, above everything
    // else (basemap, OSM labels) so the fire pixels are never hidden
    // underneath the place-name overlay.
    map.createPane('firePane');
    map.getPane('firePane').style.zIndex = 700;
    map.getPane('firePane').style.pointerEvents = 'none';

    // Satellite/aerial imagery basemap (Esri World Imagery - free, no API
    // key). Good real-photo resolution worldwide, including village-level
    // detail in most populated parts of Indonesia. One image layer covers
    // every zoom level, so "Gelap"/"Terang" now just tints it slightly
    // darker or leaves it true-color, instead of swapping basemaps.
    var satBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, and the GIS user community',
      maxZoom: 19,
      maxNativeZoom: 17,
      className: 'arvi-sat-base is-dark'
    }).addTo(map);

    // Esri's own place-label layer (tried first) only carries big cities/
    // provincial capitals - it has no dusun/village-level names at all,
    // so zoomed in on a small settlement it renders nothing. OpenStreetMap
    // has that density everywhere in Indonesia, so its tiles are laid on
    // top of the satellite photo at partial opacity instead - a real
    // "hybrid" look, roads/place names visible, photo still showing
    // through underneath.
    // Off by default: this OSM tile layer covers the ENTIRE map (not just
    // text labels) at partial opacity, which is what gives the whole photo
    // that washed-out/pale look people notice right away. Left as an
    // opt-in layer (toggle in the filter panel) for anyone who wants
    // road/village names badly enough to trade some photo clarity for it.
    var satLabels = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      pane: 'labelsPane',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom: 19,
      opacity: 0.6
    });

    var quakeLayer = L.layerGroup().addTo(map);
    var fireDemoLayer = L.layerGroup(); // used only to compute region stats, off by default
    var radarLayer = L.layerGroup();
    var fireLiveLayer = L.layerGroup().addTo(map); // NASA GIBS/FIRMS raster overlay, real-time
    var fireClusterLayer = L.layerGroup().addTo(map); // density-based "zona kritis" circles

    // ---- Earthquake shockwave ripple at the epicenter ---------------------
    // A looping ripple (added to quakeLayer, so it shows/hides with the
    // "Gempa Bumi" layer toggle same as the dot markers) for quakes that
    // are still recent, plus a one-shot brighter "burst" the instant a
    // brand-new quake is detected via polling - visually separates "just
    // happened" from "3 weeks ago, still M3.6" at a glance on the map.
    function quakeRippleIcon(mag, color, burst){
      var scale = Math.max(5, Math.min(14, mag * 2.4));
      var ringClass = burst ? 'arvi-quake-burst-ring' : 'arvi-quake-ripple-ring';
      var mods = burst ? ['b2', 'b3'] : ['r2', 'r3'];
      var html = '<div class="arvi-quake-ripple" style="--ring-color:' + color + '; --ring-scale:' + scale + ';">' +
        '<span class="' + ringClass + '"></span>' +
        '<span class="' + ringClass + ' ' + mods[0] + '"></span>' +
        '<span class="' + ringClass + ' ' + mods[1] + '"></span>' +
        '</div>';
      return L.divIcon({ className: '', html: html, iconSize: [1, 1], iconAnchor: [0, 0] });
    }
    function addQuakeRipple(lat, lon, mag, opts){
      opts = opts || {};
      var color = opts.color || quakeColor(mag);
      var marker = L.marker([lat, lon], {
        icon: quakeRippleIcon(mag, color, !!opts.burst),
        interactive: false,
        keyboard: false
      });
      marker.addTo(quakeLayer);
      if (opts.burst){
        // Matches the CSS animation's total run time (last ring's delay +
        // its own duration) plus a small margin, then cleans itself up so
        // burst markers don't pile up in the layer forever.
        setTimeout(function(){ quakeLayer.removeLayer(marker); }, 2500);
      }
      return marker;
    }

    var statusEl = document.getElementById('arviMapStatus');
    function setStatus(text){ if (statusEl) statusEl.textContent = text; }

    // Data collected so far, used to compute the percentage panel.
    var collected = { quakes: [], fires: fetchFireDemoData() };

    // ---- Update notifications (fire + earthquake) ----------------------
    // Shared toast/badge/history system. Fire hotspots trigger a
    // notification when the tracked count grows; earthquakes trigger one
    // when a new M5+ event appears in the USGS feed. Both log into the
    // same "Riwayat Notifikasi" history panel.
    var toastStack = document.getElementById('arviToastStack');
    var notifDot = document.getElementById('arviFireNotifDot');
    var notifHistory = [];
    var prevFireTotal = null;

    function esc(s){
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
        return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
      });
    }

    function showToast(icon, title, body, durationMs, onClick){
      if (!toastStack) return;
      var el = document.createElement('div');
      el.className = 'arvi-toast';
      el.setAttribute('role', 'status');
      el.innerHTML =
        '<i class="fa-solid ' + icon + ' arvi-toast-icon" aria-hidden="true"></i>' +
        '<div class="arvi-toast-body"><p class="arvi-toast-title"></p><p></p></div>' +
        '<button type="button" class="arvi-toast-close" aria-label="Tutup notifikasi"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>';
      el.querySelector('.arvi-toast-title').textContent = title;
      el.querySelector('.arvi-toast-body p:last-child').textContent = body;
      toastStack.appendChild(el);
      requestAnimationFrame(function(){ el.classList.add('show'); });
      var dismissed = false;
      function remove(){
        if (dismissed) return;
        dismissed = true;
        el.classList.remove('show');
        setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 250);
      }
      setTimeout(remove, durationMs || 8000);
      el.querySelector('.arvi-toast-close').addEventListener('click', function(e){
        e.stopPropagation();
        remove();
      });
      if (onClick){
        el.style.cursor = 'pointer';
        el.addEventListener('click', function(){ onClick(); remove(); });
      }
    }

    function setNotifBadge(on){
      if (notifDot) notifDot.hidden = !on;
    }

    function renderNotifHistory(){
      var el = document.getElementById('arviNotifHistoryList');
      if (!el) return;
      if (!notifHistory.length){
        el.innerHTML = '<p class="placeholder">Belum ada update baru di sesi ini.</p>';
        return;
      }
      var TYPE_ICON = { 'quake-near': 'fa-triangle-exclamation', 'quake': 'fa-house-crack', 'quake-bmkg': 'fa-house-crack', 'tsunami': 'fa-water', 'volcano': 'fa-mountain' };
      var TYPE_COLOR = { 'quake-near': '#ff3b3b', 'quake': '#ff7a45', 'quake-bmkg': '#ff7a45', 'tsunami': '#ff3b3b', 'volcano': '#ff9e4a' };
      el.innerHTML = notifHistory.map(function(n){
        var icon = TYPE_ICON[n.type] || 'fa-fire';
        var color = TYPE_COLOR[n.type] || '#ff9e4a';
        var t = new Date(n.time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        return '<div class="arvi-notif-row">' +
          '<i class="fa-solid ' + icon + '" style="color:' + color + ';" aria-hidden="true"></i>' +
          '<div class="arvi-notif-row-body">' +
            '<p class="arvi-notif-row-title">' + esc(n.title) + '<span class="arvi-notif-row-time">' + t + '</span></p>' +
            '<p class="arvi-notif-row-text">' + esc(n.body) + '</p>' +
          '</div></div>';
      }).join('');
    }

    // icon: font-awesome class (no "fa-solid"). type: 'fire' | 'quake', used
    // to pick the history-log icon/color.
    function notify(type, icon, title, body){
      showToast(icon, title, body);
      setNotifBadge(true);
      notifHistory.unshift({ type: type, title: title, body: body, time: Date.now() });
      if (notifHistory.length > 20) notifHistory.length = 20;
      renderNotifHistory();
      sendPushNotification(title, body, type);
    }

    // ---- Browser push notifications (Web Notifications API) -------------
    // The in-page toast above only reaches the user while this tab is the
    // one being looked at. Polling (setInterval) keeps running in a
    // backgrounded/minimized tab, but there's nothing on screen to show it
    // for - so significant updates (M5+ quake, new "zona kritis" fire
    // cluster) go through the OS notification tray instead when the tab is
    // hidden. This is the plain `Notification` constructor, not a real push
    // service: no service worker, no server. It only fires while this tab
    // is still open somewhere (background/minimized is fine; fully closing
    // the tab stops it, same as the polling itself).
    var PUSH_PREF_STORAGE = 'istrack_arvi_push_enabled';
    function getPushPref(){
      try { return localStorage.getItem(PUSH_PREF_STORAGE) === '1'; } catch(e){ return false; }
    }
    function setPushPref(on){
      try { localStorage.setItem(PUSH_PREF_STORAGE, on ? '1' : '0'); } catch(e){}
    }

    var pushSupported = typeof window.Notification !== 'undefined';
    var pushToggle = document.getElementById('arviPushToggle');
    var pushStatusEl = document.getElementById('arviPushStatus');

    function setPushStatus(text, kind){
      if (!pushStatusEl) return;
      pushStatusEl.textContent = 'Status: ' + text;
      pushStatusEl.classList.remove('is-live', 'is-error');
      if (kind) pushStatusEl.classList.add(kind);
    }

    function refreshPushUI(){
      if (!pushToggle) return;
      if (!pushSupported){
        pushToggle.disabled = true;
        setPushStatus('browser ini tidak mendukung Notification API.', 'is-error');
        return;
      }
      var perm = Notification.permission;
      var pref = getPushPref();
      pushToggle.checked = pref && perm === 'granted';
      if (perm === 'denied'){
        setPushStatus('izin ditolak - aktifkan lewat pengaturan situs di browser.', 'is-error');
      } else if (perm === 'granted' && pref){
        setPushStatus('aktif - update signifikan akan muncul walau tab ini tidak aktif.', 'is-live');
      } else {
        setPushStatus('belum diaktifkan.');
      }
    }

    if (pushToggle){
      refreshPushUI();
      pushToggle.addEventListener('change', function(){
        if (!pushSupported){
          pushToggle.checked = false;
          return;
        }
        if (!pushToggle.checked){
          setPushPref(false);
          refreshPushUI();
          return;
        }
        if (Notification.permission === 'granted'){
          setPushPref(true);
          refreshPushUI();
          return;
        }
        if (Notification.permission === 'denied'){
          pushToggle.checked = false;
          refreshPushUI();
          return;
        }
        Notification.requestPermission().then(function(perm){
          setPushPref(perm === 'granted');
          refreshPushUI();
        });
      });
    }

    // ========================================================================
    // ---- Fix #1: real BACKGROUND alarm via Web Push + Service Worker -----
    // ========================================================================
    // Everything above (and the whole rest of this file) is in-page polling:
    // it only runs while this tab is open and not throttled by the OS/
    // browser. This block is different - it registers a Service Worker
    // (sw.js) and subscribes it to Web Push via our own backend
    // (netlify/functions/check-quakes-scheduled.js, a scheduled function
    // that runs every ~5 minutes on Netlify's servers regardless of
    // whether anyone has this site open). That backend sends push messages
    // straight to the OS, which can wake the service worker and show a
    // notification even with the tab fully closed or the phone locked -
    // that's the part in-page JS alone can never do.
    //
    // HONEST LIMITS, even with this: it's still POLLING every ~5 minutes
    // server-side, not an instant feed - and it depends on the browser
    // itself still supporting/allowing push in the background (varies by
    // OS battery settings, especially on some Android skins that
    // aggressively kill background services).
    var VAPID_PUBLIC_KEY = 'BBjqUCVLpF-kLlH9gwkwDCvxUNl01LvFN5R1zYA1zcDwx2GUskZBZ-GdIoIZ-l5vVFR3DrGd5qEuqxcj_GKCMNI';
    var PUSH_BG_PREF_STORAGE = 'istrack_arvi_push_bg_pref';

    function urlBase64ToUint8Array(base64String){
      var padding = '='.repeat((4 - base64String.length % 4) % 4);
      var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      var rawData = atob(base64);
      var outputArray = new Uint8Array(rawData.length);
      for (var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
      return outputArray;
    }

    function getPushBgPref(){ try { return localStorage.getItem(PUSH_BG_PREF_STORAGE) === '1'; } catch(e){ return false; } }
    function setPushBgPref(on){ try { localStorage.setItem(PUSH_BG_PREF_STORAGE, on ? '1' : '0'); } catch(e){} }

    var pushBgToggle = document.getElementById('arviPushBgToggle');
    var pushBgStatusEl = document.getElementById('arviPushBgStatus');
    var pushBgSupported = 'serviceWorker' in navigator && 'PushManager' in window && typeof window.Notification !== 'undefined';

    function setPushBgStatus(text, kind){
      if (!pushBgStatusEl) return;
      pushBgStatusEl.textContent = text;
      pushBgStatusEl.classList.remove('is-live', 'is-error');
      if (kind) pushBgStatusEl.classList.add(kind);
    }

    function postSubscription(action, subscription){
      var body = { action: action };
      if (action === 'subscribe'){
        body.subscription = subscription.toJSON ? subscription.toJSON() : subscription;
        if (userLoc){ body.lat = userLoc.lat; body.lon = userLoc.lon; }
      } else {
        body.endpoint = subscription.endpoint || subscription;
      }
      return fetch('/.netlify/functions/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).catch(function(){
        // Backend unreachable (e.g. Functions not deployed yet on this
        // hosting) - fail quietly, in-page alarm keeps working regardless.
      });
    }

    // Called whenever "Lokasi Saya" gets a fresh GPS fix (see watchPosition
    // above) so the server-side distance check uses up-to-date location
    // instead of wherever you were the moment you first subscribed.
    function syncPushSubscriptionLocation(){
      if (!pushBgSupported || !getPushBgPref() || !userLoc) return;
      navigator.serviceWorker.getRegistration().then(function(reg){
        if (!reg) return;
        return reg.pushManager.getSubscription();
      }).then(function(sub){
        if (sub) postSubscription('subscribe', sub); // re-send with updated lat/lon
      }).catch(function(){});
    }

    function enablePushBg(){
      if (!pushBgSupported){
        setPushBgStatus('Browser ini tidak mendukung push notification di background.', 'is-error');
        return Promise.resolve();
      }
      return navigator.serviceWorker.register('/sw.js').then(function(reg){
        return Notification.requestPermission().then(function(perm){
          if (perm !== 'granted'){
            setPushBgStatus('Izin notifikasi ditolak - aktifkan lewat pengaturan situs di browser.', 'is-error');
            if (pushBgToggle) pushBgToggle.checked = false;
            setPushBgPref(false);
            return;
          }
          return reg.pushManager.getSubscription().then(function(existing){
            return existing || reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
          }).then(function(sub){
            return postSubscription('subscribe', sub);
          }).then(function(){
            setPushBgPref(true);
            setPushBgStatus('Aktif - alarm akan tetap masuk walau tab ini ditutup / HP terkunci.', 'is-live');
          });
        });
      }).catch(function(err){
        setPushBgStatus('Gagal mengaktifkan: ' + (err && err.message ? err.message : 'error tidak diketahui') + '.', 'is-error');
        if (pushBgToggle) pushBgToggle.checked = false;
        setPushBgPref(false);
      });
    }

    function disablePushBg(){
      setPushBgPref(false);
      if (!pushBgSupported) return;
      navigator.serviceWorker.getRegistration().then(function(reg){
        if (!reg) return;
        return reg.pushManager.getSubscription().then(function(sub){
          if (!sub) return;
          return postSubscription('unsubscribe', sub).then(function(){ return sub.unsubscribe(); });
        });
      }).then(function(){
        setPushBgStatus('Nonaktif - alarm cuma jalan selagi tab ini terbuka.');
      }).catch(function(){});
    }

    if (pushBgToggle){
      if (!pushBgSupported){
        pushBgToggle.disabled = true;
        setPushBgStatus('Browser ini tidak mendukung push notification di background.', 'is-error');
      } else {
        // Reflect actual state on load (best-effort, doesn't force a
        // permission prompt just from opening the page).
        pushBgToggle.checked = getPushBgPref() && Notification.permission === 'granted';
        if (getPushBgPref() && Notification.permission === 'granted'){
          setPushBgStatus('Aktif - alarm akan tetap masuk walau tab ini ditutup / HP terkunci.', 'is-live');
          // Silently make sure the subscription still exists server-side
          // (e.g. after clearing site data) without re-prompting for
          // permission, which is already granted.
          enablePushBg();
        } else if (Notification.permission === 'denied'){
          setPushBgStatus('Izin notifikasi ditolak - aktifkan lewat pengaturan situs di browser.', 'is-error');
        }
      }
      pushBgToggle.addEventListener('change', function(){
        if (pushBgToggle.checked){
          enablePushBg();
        } else {
          disablePushBg();
        }
      });
    }

    // tag: collapses rapid repeats of the same update type into a single
    // OS notification instead of stacking the tray with duplicates.
    function sendPushNotification(title, body, tag){
      if (!pushSupported) return;
      if (Notification.permission !== 'granted' || !getPushPref()) return;
      // Fire alerts and "gempa dekat lokasimu" are urgent enough to warrant
      // a real OS notification even while this tab is the active one - not
      // just the in-page toast, which is easy to miss if attention is
      // elsewhere on screen.
      if (tag !== 'fire' && tag !== 'quake-near' && !document.hidden) return;
      try {
        var n = new Notification(title, {
          body: body,
          icon: 'assets/icon-192.png',
          tag: 'arvi-' + tag,
          renotify: true
        });
        n.onclick = function(){
          window.focus();
          n.close();
        };
      } catch(e){}
    }

    // ---- Suara alarm untuk titik api baru ---------------------------------
    // Dibangun langsung lewat Web Audio API (dua nada naik-turun kayak
    // sirene singkat) - jadi gak butuh file audio eksternal yang bisa gagal
    // dimuat. Cuma jalan kalau browser dukung AudioContext & user udah
    // pernah berinteraksi dgn halaman (kebijakan autoplay browser modern).
    var fireAlarmCtx = null;

    // ---- Fix #3: "warm up" the AudioContext on the FIRST interaction -----
    // Browsers block audio from playing until the page has seen at least
    // one real user gesture (click/tap/key). Before this fix, the alarm's
    // AudioContext was only ever created/resumed the moment an alarm
    // needed to play - if that happened to be the FIRST thing to occur on
    // the page (e.g. someone opened the tab and just left it running with
    // no interaction), the browser could silently block the sound even
    // though the full-screen visual still showed up. Creating + resuming
    // it on ANY early interaction (even something unrelated, like tapping
    // a checkbox) "unlocks" it for later, so a programmatic alarm trigger
    // that happens without further interaction can still actually play.
    function warmUpAudioOnce(){
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!fireAlarmCtx) fireAlarmCtx = new Ctx();
        if (fireAlarmCtx.state === 'suspended') fireAlarmCtx.resume();
      } catch(e){}
      ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(function(evt){
        document.removeEventListener(evt, warmUpAudioOnce);
      });
    }
    ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(function(evt){
      document.addEventListener(evt, warmUpAudioOnce, { once: true, passive: true });
    });

    function playFireAlarm(){
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!fireAlarmCtx) fireAlarmCtx = new Ctx();
        if (fireAlarmCtx.state === 'suspended') fireAlarmCtx.resume();

        var ctx = fireAlarmCtx;
        var now = ctx.currentTime;
        var totalBeeps = 3;
        for (var i = 0; i < totalBeeps; i++){
          var start = now + i * 0.45;
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = 'square';
          // Naik-turun tiap beep biar kedengeran kayak alarm, bukan nada datar.
          osc.frequency.setValueAtTime(880, start);
          osc.frequency.linearRampToValueAtTime(1320, start + 0.18);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.linearRampToValueAtTime(0.35, start + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(start);
          osc.stop(start + 0.35);
        }
      } catch(e){}
    }

    // ---- Suara alarm untuk gempa DEKAT lokasimu ---------------------------
    // Nada sirine dua-oktaf yang naik-turun cepat dan berulang - kesan
    // "darurat" ala early-warning alarm, dibikin sendiri lewat Web Audio API
    // (bukan rekaman/jiplak chime NHK Jepang yang berhak cipta).
    //
    // tsunami=true pakai nada yang beda sengaja: dua oscillator low+high
    // gantian pelan-pelan (mirip sirine peringatan tsunami/evakuasi sungguhan
    // - undulasi lambat), bukan siulan cepat gempa biasa. Tujuannya biar
    // kedengeran beda dari suara di kepala walau mata belum lihat layar.
    function playQuakeAlarm(tsunami){
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!fireAlarmCtx) fireAlarmCtx = new Ctx();
        if (fireAlarmCtx.state === 'suspended') fireAlarmCtx.resume();

        var ctx = fireAlarmCtx;
        var now = ctx.currentTime;

        if (tsunami){
          // Sirine tsunami: 2 siklus naik-turun LAMBAT (khas sirine evakuasi
          // pesisir), tiap siklus lebih panjang & lebih rendah frekuensinya
          // dibanding alarm gempa biasa - kontras jelas biar gak ketuker.
          var cyclesT = 2;
          for (var t = 0; t < cyclesT; t++){
            var startT = now + t * 1.1;
            var oscT = ctx.createOscillator();
            var gainT = ctx.createGain();
            oscT.type = 'sine';
            oscT.frequency.setValueAtTime(420, startT);
            oscT.frequency.linearRampToValueAtTime(880, startT + 0.5);
            oscT.frequency.linearRampToValueAtTime(420, startT + 1.0);
            gainT.gain.setValueAtTime(0.0001, startT);
            gainT.gain.linearRampToValueAtTime(0.45, startT + 0.08);
            gainT.gain.setValueAtTime(0.45, startT + 0.9);
            gainT.gain.exponentialRampToValueAtTime(0.0001, startT + 1.05);
            oscT.connect(gainT);
            gainT.connect(ctx.destination);
            oscT.start(startT);
            oscT.stop(startT + 1.08);
          }
          return;
        }

        var cycles = 4;
        for (var i = 0; i < cycles; i++){
          var start = now + i * 0.5;
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = 'sawtooth';
          // Siulan cepat naik lalu turun tiap siklus - lebih "mendesak"
          // dibanding alarm titik api yang cuma 1 nada per beep.
          osc.frequency.setValueAtTime(600, start);
          osc.frequency.linearRampToValueAtTime(1100, start + 0.18);
          osc.frequency.linearRampToValueAtTime(600, start + 0.38);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.linearRampToValueAtTime(0.4, start + 0.03);
          gain.gain.setValueAtTime(0.4, start + 0.34);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(start);
          osc.stop(start + 0.45);
        }
      } catch(e){}
    }

    // ---- Full-screen earthquake alarm (Japan EEW-style) -------------------
    // The USGS query above already only fetches quakes inside Indonesia's
    // bounding box, so any "big quake" alert here is already Indonesia-only
    // by construction. Fires full-screen for: (a) M5+ anywhere in that box,
    // or (b) ANY new M3.5+ quake within RADIUS_KM of the user (if "Lokasi
    // Saya" is on) - full-screen + vibration on top of the existing sound
    // + toast + OS notification, so it's hard to miss while the tab is
    // open. HONEST NOTE: this only fires once USGS has already published
    // the event (seconds to a couple of minutes after the shaking starts,
    // sometimes longer) - it is NOT a true P-wave early-warning system like
    // Japan's actual EEW, which alerts BEFORE strong shaking arrives.
    var quakeAlarmEl = document.getElementById('arviQuakeAlarm');
    var quakeAlarmQueue = [];
    var quakeAlarmShowing = false;
    var quakeAlarmSoundTimer = null;
    var quakeAlarmAutoHideTimer = null;
    var quakeAlarmCurrent = null; // the quake item currently on screen (needed by Saya Aman / Laporkan)

    // tsunami=true dapet pola getar yang lebih panjang & lebih "berat"
    // (jeda pendek antar getar, lebih banyak denyut) dibanding getar gempa
    // biasa - biar keparahan kerasa beda walau HP di kantong/gak dilihat.
    function vibrateAlarm(tsunami){
      if (!('vibrate' in navigator)) return; // not supported (e.g. iOS Safari) - fails silently
      try {
        navigator.vibrate(tsunami
          ? [700, 150, 700, 150, 700, 150, 700, 150, 1200, 300, 1200, 300, 1200]
          : [500, 200, 500, 200, 500, 200, 900, 300, 900, 300, 900]);
      } catch(e){}
    }

    function stopQuakeAlarmEffects(){
      if (quakeAlarmSoundTimer){ clearInterval(quakeAlarmSoundTimer); quakeAlarmSoundTimer = null; }
      if (quakeAlarmAutoHideTimer){ clearTimeout(quakeAlarmAutoHideTimer); quakeAlarmAutoHideTimer = null; }
      if ('vibrate' in navigator){ try { navigator.vibrate(0); } catch(e){} }
    }

    function showNextQuakeAlarm(){
      if (!quakeAlarmEl || quakeAlarmShowing || !quakeAlarmQueue.length) return;
      var item = quakeAlarmQueue.shift();
      quakeAlarmCurrent = item;
      quakeAlarmShowing = true;
      document.body.classList.add('arvi-alarm-open');

      var sourceEl = document.getElementById('arviQuakeAlarmSource');
      var magEl = document.getElementById('arviQuakeAlarmMag');
      var placeEl = document.getElementById('arviQuakeAlarmPlace');
      var timeEl = document.getElementById('arviQuakeAlarmTime');
      if (sourceEl){
        sourceEl.textContent = 'Sumber: ' + (item.source || 'USGS') + (item.near ? ' · Dekat lokasimu' : '');
      }
      if (magEl) magEl.textContent = item.mag.toFixed(1);
      if (placeEl){
        placeEl.textContent = (item.place || '-') +
          (item.distanceKm != null ? (' (~' + Math.round(item.distanceKm) + ' km darimu)') : '');
      }
      if (timeEl) timeEl.textContent = item.time ? new Date(item.time).toLocaleString('id-ID') : '';
      quakeAlarmEl.classList.toggle('is-near', !!item.near);
      quakeAlarmEl.classList.toggle('is-tsunami', !!item.tsunami);
      var tsunamiStripEl = document.getElementById('arviTsunamiStrip');
      if (tsunamiStripEl) tsunamiStripEl.hidden = !item.tsunami;

      quakeAlarmEl.hidden = false;
      requestAnimationFrame(function(){ quakeAlarmEl.classList.add('show'); });

      playQuakeAlarm(item.tsunami);
      vibrateAlarm(item.tsunami);
      // Repeat the siren + vibration while it's up, like a real alarm
      // rather than a single beep - stops as soon as it's dismissed.
      quakeAlarmSoundTimer = setInterval(function(){ playQuakeAlarm(item.tsunami); vibrateAlarm(item.tsunami); }, 2200);
      // Auto-dismiss after a while so it can't get stuck on-screen forever
      // if nobody's there to tap a button.
      quakeAlarmAutoHideTimer = setTimeout(hideQuakeAlarm, 30000);
    }

    function hideQuakeAlarm(){
      if (!quakeAlarmEl) return;
      quakeAlarmEl.classList.remove('show');
      stopQuakeAlarmEffects();
      quakeAlarmShowing = false;
      document.body.classList.remove('arvi-alarm-open');
      setTimeout(function(){
        if (quakeAlarmEl) quakeAlarmEl.hidden = true;
        showNextQuakeAlarm();
      }, 220);
    }

    function queueQuakeAlarm(mag, place, time, near, distanceKm, source, tsunami){
      if (!quakeAlarmEl) return;
      quakeAlarmQueue.push({ mag: mag, place: place, time: time, near: near, distanceKm: distanceKm, source: source || 'USGS', tsunami: !!tsunami });
      showNextQuakeAlarm();
    }

    var quakeAlarmDismiss = document.getElementById('arviQuakeAlarmDismiss');
    if (quakeAlarmDismiss) quakeAlarmDismiss.addEventListener('click', hideQuakeAlarm);

    // ---- Uji Coba Alarm (filter panel) - fires the exact same alarm
    // pipeline (full-screen + sirine + getar + tombol Saya Aman/Laporkan)
    // with clearly-labeled simulated data, so people can test/demo it
    // (and check their phone's sound/vibration) without waiting for a
    // real earthquake.
    var testAlarmBtn = document.getElementById('arviTestAlarmBtn');
    if (testAlarmBtn){
      testAlarmBtn.addEventListener('click', function(){
        queueQuakeAlarm(6.5, 'Lokasi Simulasi (Uji Coba)', Date.now(), false, null, 'SIMULASI', false);
      });
    }
    var testTsunamiBtn = document.getElementById('arviTestTsunamiBtn');
    if (testTsunamiBtn){
      testTsunamiBtn.addEventListener('click', function(){
        queueQuakeAlarm(7.8, 'Lokasi Simulasi, Laut (Uji Coba)', Date.now(), false, null, 'SIMULASI', true);
      });
    }

    // ---- "Saya Aman" - local-only check-in, no central server ------------
    // This is a static front-end site with nothing to send the check-in
    // TO (no backend/database) - so this just logs it on THIS device and
    // says so plainly, instead of pretending it reached anyone.
    var SAFE_LOG_KEY = 'istrack_arvi_safe_log';
    function logLocal(storageKey, entry, cap){
      var list = [];
      try { list = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch(e){ list = []; }
      list.unshift(entry);
      if (list.length > (cap || 20)) list.length = cap || 20;
      try { localStorage.setItem(storageKey, JSON.stringify(list)); } catch(e){}
    }
    var quakeAlarmSafeBtn = document.getElementById('arviQuakeAlarmSafe');
    if (quakeAlarmSafeBtn){
      quakeAlarmSafeBtn.addEventListener('click', function(){
        var item = quakeAlarmCurrent;
        if (item){
          logLocal(SAFE_LOG_KEY, {
            mag: item.mag, place: item.place, time: item.time, savedAt: Date.now()
          });
        }
        hideQuakeAlarm();
        showToast('fa-check', 'Status dicatat', 'Status "Aman" kamu disimpan lokal di perangkat ini (situs ini gak punya server pusat buat kirim status ke orang lain).');
      });
    }

    // ---- "Laporkan" - quick felt-report modal -----------------------------
    var FELT_LOG_KEY = 'istrack_arvi_felt_reports';
    var reportModal = document.getElementById('arviReportModal');
    var reportContext = document.getElementById('arviReportContext');
    var reportFelt = document.getElementById('arviReportFelt');
    var reportNote = document.getElementById('arviReportNote');
    var reportWa = document.getElementById('arviReportWa');
    var reportSave = document.getElementById('arviReportSave');
    var reportClose = document.getElementById('arviReportModalClose');

    function openReportModal(item){
      if (!reportModal) return;
      quakeAlarmCurrent = item || quakeAlarmCurrent;
      if (reportContext && quakeAlarmCurrent){
        reportContext.textContent = 'M ' + quakeAlarmCurrent.mag.toFixed(1) + ' · ' + (quakeAlarmCurrent.place || '-');
      }
      reportModal.hidden = false;
      requestAnimationFrame(function(){ reportModal.classList.add('show'); });
    }
    function closeReportModal(){
      if (!reportModal) return;
      reportModal.classList.remove('show');
      setTimeout(function(){ if (reportModal) reportModal.hidden = true; }, 200);
    }

    var quakeAlarmReportBtn = document.getElementById('arviQuakeAlarmReport');
    if (quakeAlarmReportBtn){
      quakeAlarmReportBtn.addEventListener('click', function(){
        var item = quakeAlarmCurrent;
        hideQuakeAlarm();
        openReportModal(item);
      });
    }
    if (reportClose) reportClose.addEventListener('click', closeReportModal);
    if (reportModal){
      reportModal.addEventListener('click', function(e){
        if (e.target === reportModal) closeReportModal();
      });
    }

    function buildReportText(){
      var item = quakeAlarmCurrent;
      if (!item) return '';
      var felt = reportFelt ? reportFelt.value : '';
      var note = reportNote ? reportNote.value.trim() : '';
      var when = item.time ? new Date(item.time).toLocaleString('id-ID') : '-';
      var txt = 'Laporan gempa (ISFR-ARVI):\n' +
        'M ' + item.mag.toFixed(1) + ' - ' + (item.place || '-') + '\n' +
        'Waktu: ' + when + '\n' +
        'Guncangan dirasakan: ' + felt;
      if (note) txt += '\nCatatan: ' + note;
      return txt;
    }

    if (reportFelt || reportNote){
      [reportFelt, reportNote].forEach(function(el){
        if (!el) return;
        el.addEventListener('input', function(){
          if (reportWa) reportWa.href = 'https://wa.me/?text=' + encodeURIComponent(buildReportText());
        });
      });
    }

    if (reportWa){
      reportWa.addEventListener('click', function(){
        reportWa.href = 'https://wa.me/?text=' + encodeURIComponent(buildReportText());
      });
    }

    if (reportSave){
      reportSave.addEventListener('click', function(){
        var item = quakeAlarmCurrent;
        if (item){
          logLocal(FELT_LOG_KEY, {
            mag: item.mag,
            place: item.place,
            time: item.time,
            felt: reportFelt ? reportFelt.value : '',
            note: reportNote ? reportNote.value.trim() : '',
            savedAt: Date.now()
          });
        }
        closeReportModal();
        showToast('fa-flag', 'Laporan disimpan', 'Laporan dampak gempa kamu disimpan lokal di perangkat ini. Pakai tombol "Bagikan WA" kalau mau kirim ke keluarga/grup.');
      });
    }

    // ---- BMKG (Badan Meteorologi, Klimatologi, dan Geofisika) cross-check -
    // BMKG is Indonesia's own official earthquake authority (their
    // equivalent of Japan's JMA) and often publishes domestic events
    // within minutes - sometimes faster than USGS picks them up. Their
    // public JSON feed (data.bmkg.go.id) does NOT send an
    // Access-Control-Allow-Origin header, so a plain browser fetch() from
    // this static site gets blocked by CORS - that's BMKG's server
    // configuration, not something a front-end-only site can fix. We
    // route through a public read-only CORS proxy as a best-effort
    // workaround; BMKG is a bonus/faster cross-check, not a hard
    // dependency - USGS alone already covers all of Indonesia.
    //
    // Fix #5: a SINGLE hardcoded proxy is a single point of failure - if
    // that one proxy goes down, gets rate-limited, or shuts down, BMKG
    // cross-checking silently dies forever with no way to recover short of
    // editing code. Instead, try a short list of independent public
    // proxies in order; remember whichever one last worked and try it
    // first next time, so one dead proxy doesn't cost an extra failed
    // round-trip on every single poll going forward.
    var BMKG_PROXIES = [
      function(url){ return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url); },
      function(url){ return 'https://corsproxy.io/?url=' + encodeURIComponent(url); },
      function(url){ return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url); }
    ];
    var BMKG_TARGET = 'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json';
    var lastBmkgKey = null;
    var firstBmkgLoad = true;

    // Fix #5 generalized: each independent polling job (BMKG quakes, MAGMA
    // volcano status, ...) gets its OWN "which proxy worked last time"
    // memory via its own state object, so a dead proxy for one job doesn't
    // affect the others, and each job still avoids an extra failed
    // round-trip once it finds a working proxy.
    function makeProxyChainState(){ return { lastWorking: 0 }; }
    var bmkgProxyState = makeProxyChainState();

    function fetchViaProxyChain(buildUrls, targetUrl, state, parseAs){
      // Tries proxies in order (starting with whichever worked last time
      // for THIS state/job), resolves with the first one that returns a
      // usable response, rejects only if ALL of them fail.
      // parseAs: 'json' (default) or 'text' (for HTML scraping targets).
      var order = buildUrls.map(function(_, i){ return i; });
      order.sort(function(a, b){
        if (a === state.lastWorking) return -1;
        if (b === state.lastWorking) return 1;
        return 0;
      });
      var i = 0;
      function attempt(){
        if (i >= order.length) return Promise.reject(new Error('all proxies failed'));
        var idx = order[i++];
        return fetch(buildUrls[idx](targetUrl)).then(function(r){
          if (!r.ok) throw new Error('proxy http ' + r.status);
          return parseAs === 'text' ? r.text() : r.json();
        }).then(function(data){
          state.lastWorking = idx;
          return data;
        }).catch(function(){
          return attempt(); // try the next proxy in line
        });
      }
      return attempt();
    }

    // BMKG's "Potensi" field carries their own tsunami-potential call for
    // this event (separate from just the magnitude) - e.g. "Berpotensi
    // tsunami" vs "Tidak berpotensi tsunami". This is the same autogempa.json
    // response already being polled for the quake cross-check above, so no
    // extra endpoint/request is needed - just read the field.
    function isTsunamiPotential(potensiText){
      var t = String(potensiText || '').toLowerCase();
      if (!t) return false;
      if (t.indexOf('tidak') > -1) return false; // "tidak berpotensi tsunami"
      return t.indexOf('tsunami') > -1;
    }

    function fetchBmkgLatest(){
      fetchViaProxyChain(BMKG_PROXIES, BMKG_TARGET, bmkgProxyState).then(function(data){
        var g = data && data.Infogempa && data.Infogempa.gempa;
        if (!g) return;
        var key = g.DateTime + '|' + g.Coordinates;
        var isFirst = firstBmkgLoad;
        firstBmkgLoad = false;
        if (key === lastBmkgKey) return; // nothing new since last poll
        lastBmkgKey = key;
        if (isFirst) return; // don't alarm on whatever BMKG already had loaded when the page opened

        var mag = parseFloat(g.Magnitude) || 0;
        var place = g.Wilayah || g.Coordinates || '-';
        var tsunami = isTsunamiPotential(g.Potensi);
        queueQuakeAlarm(mag, place, g.DateTime, false, null, 'BMKG', tsunami);
        // BMKG's Coordinates field is "lat,lon" - use it to fire the same
        // shockwave burst ripple used for USGS detections, so a BMKG-only
        // event (one BMKG catches before/without a matching USGS entry)
        // still gets the same "just happened here" visual on the map.
        var bmkgCoords = (g.Coordinates || '').split(',');
        var bLat = parseFloat(bmkgCoords[0]);
        var bLon = parseFloat(bmkgCoords[1]);
        if (!isNaN(bLat) && !isNaN(bLon)){
          addQuakeRipple(bLat, bLon, mag, { burst: true, color: tsunami ? '#ff3b3b' : quakeColor(mag) });
        }
        if (tsunami){
          notify('tsunami', 'fa-water', '⚠️ BERPOTENSI TSUNAMI - Gempa M' + mag.toFixed(1), (g.Potensi || '') + ' · ' + place);
        } else {
          notify('quake-bmkg', 'fa-house-crack', 'Info resmi BMKG: Gempa M' + mag.toFixed(1), place);
        }
      }).catch(function(){
        // Every proxy in the chain failed - fail silently, USGS coverage
        // continues exactly as before. BMKG is a bonus, not a dependency.
      });
    }
    fetchBmkgLatest();
    setInterval(fetchBmkgLatest, 60 * 1000);

    // ---- PVMBG / MAGMA Indonesia - gunung berapi (volcano activity level) -
    // PVMBG (Pusat Vulkanologi dan Mitigasi Bencana Geologi) publishes the
    // 4-level activity status (Normal / Waspada / Siaga / Awas) for every
    // monitored volcano in Indonesia on magma.esdm.go.id. Unlike BMKG,
    // MAGMA doesn't expose a public JSON feed at all (no autogempa.json
    // equivalent) - the "tingkat-aktivitas" status list only exists as an
    // HTML page, which is also why it needs the same read-only CORS proxy
    // workaround as BMKG above (plus that page also blocks known bot/
    // automation user-agents, which a normal browser fetch through a proxy
    // isn't). So this is scraped best-effort, exactly like community
    // wrappers for the same page do - if PVMBG ever changes their page
    // layout this can silently stop matching, which is why it's built to
    // fail quietly and fall back to a "buka MAGMA langsung" link rather
    // than break the rest of the app. Bonus/best-effort feature, not a
    // hard dependency, same philosophy as the BMKG cross-check.
    var MAGMA_PROXIES = [
      function(url){ return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url); },
      function(url){ return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url); },
      function(url){ return 'https://corsproxy.io/?url=' + encodeURIComponent(url); }
    ];
    var MAGMA_TARGET = 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas';
    var magmaProxyState = makeProxyChainState();

    // Curated coordinates for Indonesia's most commonly-monitored active
    // volcanoes, so status entries scraped from MAGMA (which only gives a
    // name + province, no lat/lng) can still be placed on the map. Not
    // exhaustive (PVMBG monitors ~120+), but covers the ones that show up
    // in "Siaga"/"Awas" status most often. Anything scraped that isn't in
    // this list still shows up in the text list, just without a map pin.
    var VOLCANO_COORDS = {
      'anak krakatau': [-6.102, 105.423], 'krakatau': [-6.102, 105.423],
      'merapi': [-7.540, 110.446], 'semeru': [-8.108, 112.922],
      'kelud': [-7.930, 112.308], 'bromo': [-7.942, 112.950],
      'raung': [-8.125, 114.042], 'ijen': [-8.058, 114.242],
      'agung': [-8.343, 115.508], 'batur': [-8.242, 115.375],
      'sinabung': [3.170, 98.392], 'marapi': [-0.381, 100.474],
      'kerinci': [-1.697, 101.264], 'dempo': [-4.030, 103.130],
      'ile lewotolok': [-8.273, 123.505], 'lewotolok': [-8.273, 123.505],
      'lewotobi laki-laki': [-8.542, 122.775], 'lewotobi perempuan': [-8.536, 122.771],
      'ibu': [1.488, 127.630], 'dukono': [1.693, 127.894],
      'gamalama': [0.800, 127.325], 'karangetang': [2.781, 125.407],
      'soputan': [1.108, 124.737], 'lokon': [1.358, 124.792],
      'awu': [3.674, 125.447], 'ruang': [2.319, 125.407],
      'sangeang api': [8.183, 119.05], 'rokatenda': [-8.267, 121.708],
      'egon': [8.671, 122.451], 'iya': [-8.900, 121.640],
      'sirung': [-8.508, 124.130], 'anak ranakah': [-8.617, 120.483],
      'slamet': [-7.242, 109.208], 'papandayan': [-7.320, 107.730],
      'guntur': [-7.145, 107.840], 'tangkuban parahu': [-6.770, 107.600],
      'tangkuban perahu': [-6.770, 107.600], 'galunggung': [-7.250, 108.058],
      'ciremai': [-6.892, 108.408], 'gede': [-6.785, 106.980],
      'talang': [-0.978, 100.679], 'kaba': [-3.520, 102.617],
      'rinjani': [-8.420, 116.470], 'tambora': [-8.245, 118.000],
      'colo': [-0.169, 121.608], 'lokon-empung': [1.358, 124.792],
      'iliboleng': [-8.343, 123.258], 'wurlali': [-6.973, 129.876],
      'gamkonora': [1.380, 127.528], 'kie besi': [0.083, 127.404],
      'banda api': [-4.525, 129.871]
    };

    var LEVEL_META = {
      'awas':    { label: 'Awas (IV)',    color: '#ff3b3b', rank: 4 },
      'siaga':   { label: 'Siaga (III)',  color: '#ff7a45', rank: 3 },
      'waspada': { label: 'Waspada (II)', color: '#f2c94c', rank: 2 },
      'normal':  { label: 'Normal (I)',   color: '#5fd3c4', rank: 1 }
    };

    function normalizeVolcanoName(name){
      return String(name || '')
        .toLowerCase()
        .replace(/^g\.\s*/, '').replace(/^gunung\s*/, '').replace(/^gn\.\s*/, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim();
    }
    function findVolcanoCoords(name){
      var key = normalizeVolcanoName(name);
      if (!key) return null;
      if (VOLCANO_COORDS[key]) return VOLCANO_COORDS[key];
      var foundKey = Object.keys(VOLCANO_COORDS).filter(function(k){
        return key.indexOf(k) > -1 || k.indexOf(key) > -1;
      }).sort(function(a, b){ return b.length - a.length; })[0];
      return foundKey ? VOLCANO_COORDS[foundKey] : null;
    }

    var volcanoLayer = L.layerGroup().addTo(map);
    var VOLCANO_SEEN_KEY = 'istrack_arvi_volcano_seen_alerts';
    function getVolcanoSeen(){
      try { return JSON.parse(localStorage.getItem(VOLCANO_SEEN_KEY) || '[]'); } catch(e){ return []; }
    }
    function addVolcanoSeen(id){
      try {
        var list = getVolcanoSeen();
        if (list.indexOf(id) === -1){
          list.push(id);
          if (list.length > 300) list = list.slice(-300);
          localStorage.setItem(VOLCANO_SEEN_KEY, JSON.stringify(list));
        }
      } catch(e){}
    }

    function volcanoIcon(color){
      return L.divIcon({
        className: 'arvi-volcano-marker',
        html: '<i class="fa-solid fa-mountain" style="color:' + color + ';"></i>',
        iconSize: [22, 22],
        iconAnchor: [11, 18]
      });
    }

    // Very loose/defensive HTML scrape: walk every table row in document
    // order, treat a row whose only real content matches "Level ... (Awas/
    // Siaga/Waspada/Normal)" as a new section header, and every following
    // row up to the next header as a volcano entry belonging to that
    // section. Text-pattern based (not tied to exact CSS class names) so
    // small markup tweaks on PVMBG's side are less likely to break it
    // outright versus matching a specific class name.
    function parseMagmaHtml(html){
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var rows = doc.querySelectorAll('table tr');
      if (!rows.length) return [];
      var LEVEL_RE = /\b(Awas|Siaga|Waspada|Normal)\b/i;
      var currentLevel = null;
      var out = [];
      rows.forEach(function(tr){
        var cells = Array.prototype.slice.call(tr.querySelectorAll('td'));
        if (!cells.length) return;
        var rowText = cells.map(function(c){ return c.textContent.trim(); }).filter(Boolean);
        var joined = rowText.join(' ');
        var levelMatch = joined.match(LEVEL_RE);
        // Header row: single meaningful cell and it names a level.
        if (rowText.length <= 1 && levelMatch && /level/i.test(joined)){
          currentLevel = levelMatch[1].toLowerCase();
          return;
        }
        if (!currentLevel) return; // haven't hit a section header yet
        // Data row: skip pure-numeric filler cells (row counters etc.)
        var textCells = rowText.filter(function(t){ return !/^\d+$/.test(t) && !/^lihat laporan$/i.test(t); });
        if (!textCells.length) return;
        var first = textCells[0];
        var name = first, location = textCells[1] || '';
        if (first.indexOf(' - ') > -1){
          var parts = first.split(' - ');
          name = parts[0].trim();
          location = (parts[1] || location || '').trim();
        }
        if (!name || name.length < 3) return;
        var link = tr.querySelector('a[href]');
        out.push({
          name: name,
          location: location,
          level: currentLevel,
          link: link ? link.getAttribute('href') : null
        });
      });
      // De-dupe by name+level (headers/sub-rows can sometimes double up).
      var seenKey = {};
      return out.filter(function(v){
        var k = v.name.toLowerCase() + '|' + v.level;
        if (seenKey[k]) return false;
        seenKey[k] = true;
        return true;
      });
    }

    function renderVolcanoStatus(list){
      volcanoLayer.clearLayers();
      var listEl = document.getElementById('arviVolcanoList');
      var countsEl = document.getElementById('arviVolcanoCounts');
      var updatedEl = document.getElementById('arviVolcanoUpdated');
      if (updatedEl) updatedEl.textContent = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

      if (!list.length){
        if (listEl) listEl.innerHTML = '<p class="placeholder">Data status gunung api tidak dapat dimuat saat ini (proxy/HTML MAGMA mungkin sedang bermasalah). <a href="https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas" target="_blank" rel="noopener">Buka MAGMA Indonesia langsung</a>.</p>';
        if (countsEl) countsEl.innerHTML = '';
        return;
      }

      var counts = { awas: 0, siaga: 0, waspada: 0, normal: 0 };
      list.forEach(function(v){ if (counts[v.level] != null) counts[v.level]++; });

      if (countsEl){
        countsEl.innerHTML = ['awas', 'siaga', 'waspada', 'normal'].map(function(lv){
          var meta = LEVEL_META[lv];
          return '<span class="arvi-volcano-count-pill" style="background:' + meta.color + ';">' + meta.label.split(' ')[0] + ': ' + counts[lv] + '</span>';
        }).join('');
      }

      var newAlerts = [];
      list.forEach(function(v){
        var coords = findVolcanoCoords(v.name);
        var meta = LEVEL_META[v.level] || LEVEL_META.normal;
        if (coords && v.level !== 'normal'){
          var marker = L.marker(coords, { icon: volcanoIcon(meta.color) });
          marker.bindPopup(
            '<b>' + esc(v.name) + '</b><br>' + esc(v.location || '') +
            '<br>Status: <b style="color:' + meta.color + ';">' + meta.label + '</b>' +
            (v.link ? '<br><a href="' + (v.link.indexOf('http') === 0 ? v.link : 'https://magma.esdm.go.id' + v.link) + '" target="_blank" rel="noopener">Lihat laporan PVMBG</a>' : '')
          );
          volcanoLayer.addLayer(marker);
        }
        if (v.level === 'awas' || v.level === 'siaga'){
          var id = v.name.toLowerCase() + '|' + v.level;
          if (getVolcanoSeen().indexOf(id) === -1){
            newAlerts.push(v);
            addVolcanoSeen(id);
          }
        }
      });

      // Only toast/alarm for genuinely NEW Awas/Siaga entries (first time
      // seen on this device), same "don't spam every poll" rule as BMKG.
      newAlerts.forEach(function(v){
        var meta = LEVEL_META[v.level];
        notify('volcano', 'fa-mountain', 'Status ' + meta.label + ': G. ' + v.name, v.location || 'PVMBG/MAGMA Indonesia');
      });

      var elevated = list.filter(function(v){ return v.level !== 'normal'; })
        .sort(function(a, b){ return (LEVEL_META[b.level].rank) - (LEVEL_META[a.level].rank); });

      if (listEl){
        if (!elevated.length){
          listEl.innerHTML = '<p class="placeholder">Tidak ada gunung berstatus di atas Normal saat ini.</p>';
        } else {
          listEl.innerHTML = elevated.map(function(v){
            var meta = LEVEL_META[v.level];
            return '<div class="arvi-notif-row">' +
              '<i class="fa-solid fa-mountain" style="color:' + meta.color + ';" aria-hidden="true"></i>' +
              '<div class="arvi-notif-row-body">' +
                '<p class="arvi-notif-row-title">' + esc(v.name) + '<span class="arvi-volcano-level-tag" style="background:' + meta.color + ';">' + esc(meta.label) + '</span></p>' +
                '<p class="arvi-notif-row-text">' + esc(v.location || '-') + '</p>' +
              '</div></div>';
          }).join('');
        }
      }
    }

    function fetchVolcanoStatus(){
      fetchViaProxyChain(MAGMA_PROXIES, MAGMA_TARGET, magmaProxyState, 'text').then(function(html){
        var list = parseMagmaHtml(html);
        renderVolcanoStatus(list);
      }).catch(function(){
        renderVolcanoStatus([]); // shows the "couldn't load, open MAGMA directly" fallback
      });
    }
    fetchVolcanoStatus();
    setInterval(fetchVolcanoStatus, 10 * 60 * 1000); // slow-moving data, poll every 10 min

    var volcanoLayerToggle = document.getElementById('arviLayerVolcano');
    if (volcanoLayerToggle){
      volcanoLayerToggle.addEventListener('change', function(){
        if (volcanoLayerToggle.checked) map.addLayer(volcanoLayer);
        else map.removeLayer(volcanoLayer);
      });
    }

    function checkFireUpdate(newTotal, isLive){
      if (prevFireTotal === null){
        // First load: just establish the baseline, no notification yet.
        prevFireTotal = newTotal;
        return;
      }
      if (newTotal > prevFireTotal){
        var diff = newTotal - prevFireTotal;
        playFireAlarm();
        notify(
          'fire',
          'fa-fire',
          'Update titik api',
          diff + ' titik api baru terdeteksi' + (isLive ? ' (data FIRMS asli)' : '') + ' — total sekarang ' + newTotal + '.'
        );
      }
      prevFireTotal = newTotal;
    }

    // ---- Radius filter (user's location) --------------------------------
    // Shows only quakes / fire-hotspot stat points within RADIUS_KM of the
    // browser's geolocated position. The raw quake/fire-stat markers are
    // kept in these arrays (alongside their lat/lon) so the filter can be
    // toggled on/off without refetching data.
    var RADIUS_KM = 50;
    var userLoc = null;
    var radiusFilterOn = false;
    var userLocMarker = null;
    var userLocCircle = null;
    var geoWatchId = null; // Fix #2: continuous location tracking (see radiusToggle below)
    var quakeMarkers = [];    // { marker, lat, lon }
    var fireStatMarkers = []; // { marker, lat, lon }

    function haversineKm(lat1, lon1, lat2, lon2){
      var R = 6371;
      var dLat = (lat2 - lat1) * Math.PI / 180;
      var dLon = (lon2 - lon1) * Math.PI / 180;
      var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function applyRadiusFilter(){
      function sync(list, layer){
        list.forEach(function(item){
          var within = !radiusFilterOn || !userLoc ||
            haversineKm(userLoc.lat, userLoc.lon, item.lat, item.lon) <= RADIUS_KM;
          var has = layer.hasLayer(item.marker);
          if (within && !has) layer.addLayer(item.marker);
          if (!within && has) layer.removeLayer(item.marker);
        });
      }
      sync(quakeMarkers, quakeLayer);
      sync(fireStatMarkers, fireDemoLayer);

      var nearQuakes = [];
      var nearFires = [];
      var statusEl2 = document.getElementById('arviRadiusStatus');
      if (statusEl2){
        if (!radiusFilterOn){
          statusEl2.textContent = 'Aktifkan untuk melihat gempa & titik api dalam radius ' + RADIUS_KM + ' km dari lokasimu (butuh izin lokasi browser). Hanya berlaku untuk data gempa & statistik titik api, bukan layer raster titik api NASA.';
        } else if (!userLoc){
          statusEl2.textContent = 'Mencari lokasimu…';
        } else {
          nearQuakes = quakeMarkers.filter(function(m){ return haversineKm(userLoc.lat, userLoc.lon, m.lat, m.lon) <= RADIUS_KM; });
          nearFires = fireStatMarkers.filter(function(m){ return haversineKm(userLoc.lat, userLoc.lon, m.lat, m.lon) <= RADIUS_KM; });
          statusEl2.textContent = nearQuakes.length + ' gempa dan ' + nearFires.length + ' titik api dalam radius ' + RADIUS_KM + ' km dari lokasimu.';
        }
      }
      updateEmergencyPanel(nearQuakes, nearFires);
      refreshAqi();
    }

    // ---- Info darurat & evakuasi (otomatis) -------------------------------
    // Surfaces the national emergency numbers right on the map, but only
    // when it's actually relevant: the user has opted into the radius
    // filter (so we know roughly where they are) AND there's a quake or
    // fire hotspot within that radius. Closing it only dismisses that
    // specific situation - if the nearby count changes (new event, or the
    // old one clears), it can reappear.
    var lastEmergencyKey = null;
    var emergencyDismissedKey = null;

    function updateEmergencyPanel(nearQuakes, nearFires){
      var panel = document.getElementById('arviEmergencyPanel');
      if (!panel) return;
      var show = radiusFilterOn && !!userLoc && (nearQuakes.length > 0 || nearFires.length > 0);
      var key = nearQuakes.length + '-' + nearFires.length;
      lastEmergencyKey = key;
      if (show && emergencyDismissedKey === key){
        panel.hidden = true;
        return;
      }
      panel.hidden = !show;
      if (!show) return;

      var summaryEl = document.getElementById('arviEmergencySummary');
      if (summaryEl){
        var parts = [];
        if (nearQuakes.length){
          var maxQ = nearQuakes.reduce(function(a, b){ return b.mag > a.mag ? b : a; });
          parts.push(nearQuakes.length + ' gempa (terbesar M' + maxQ.mag.toFixed(1) + ')');
        }
        if (nearFires.length){
          parts.push(nearFires.length + ' titik api');
        }
        summaryEl.textContent = 'Terdeteksi ' + parts.join(' & ') + ' dalam radius ' + RADIUS_KM + ' km dari lokasimu.';
      }
    }

    var emergencyCloseBtn = document.getElementById('arviEmergencyClose');
    if (emergencyCloseBtn){
      emergencyCloseBtn.addEventListener('click', function(){
        emergencyDismissedKey = lastEmergencyKey;
        var panel = document.getElementById('arviEmergencyPanel');
        if (panel) panel.hidden = true;
      });
    }

    // ---- Titik api LIVE (NASA GIBS / FIRMS VIIRS, no API key) ----
    // GIBS serves each day's detections as a separate WMS raster layer;
    // to approximate FIRMS' "last N days" view we stack one WMS tile
    // layer per day going back `days` days.
    function isoDate(d){ return d.toISOString().slice(0,10); }

    function buildFireLiveLayer(days){
      fireLiveLayer.clearLayers();
      // Cache-bust every rebuild so the *same* day's tile URL still forces
      // a fresh request instead of Leaflet quietly reusing whatever image
      // the browser cached on the previous poll. This is the main reason
      // the fire layer used to look "stuck"/not real-time even though this
      // function was already being re-run every 60s by the setInterval
      // below - the URL never changed, so the browser never re-fetched it.
      var cacheBust = Date.now();
      // Include TODAY's mosaic (not just "yesterday") so hotspots detected
      // in the last few hours show up as soon as NASA has processed them,
      // instead of waiting for the day to roll over. NRT detections do lag
      // a few hours behind real time (that's on NASA's side, not ours -
      // there is no source that plots satellite fire detections faster
      // than the satellite can physically pass over and the data can be
      // processed), so today's layer may look sparse earlier in the day;
      // that's expected, not a bug.
      var today = new Date();
      for (var i = 0; i <= days; i++){
        var d = new Date(today.getTime() - i * 24 * 3600 * 1000);
        var wms = L.tileLayer.wms('https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi', {
          layers: 'VIIRS_NOAA20_Thermal_Anomalies_375m_All,VIIRS_SNPP_Thermal_Anomalies_375m_All',
          format: 'image/png',
          transparent: true,
          version: '1.1.1',
          time: isoDate(d),
          opacity: i === 0 ? 0.9 : Math.max(0.5, 0.85 - i * 0.08),
          attribution: 'Fire data &copy; NASA GIBS / FIRMS (VIIRS)',
          // Sits in its own pane above the basemap and OSM place-labels so
          // it's never hidden underneath them (see firePane above).
          pane: 'firePane',
          // NASA's raw pixels read as a pale salmon/pink at low opacity; this
          // pushes the reds/oranges without relying on opacity to do it, so
          // small/faint hotspots don't get washed out or disappear.
          className: 'arvi-fire-live',
          // This VIIRS 375m layer only has real imagery up to native zoom 9 on
          // GIBS' side - requesting tiles past that returns a rendered
          // "Zoom Level Not Supported" placeholder image instead of an error.
          // Capping maxNativeZoom makes Leaflet stop requesting past zoom 9
          // and just upscale the last valid tile when the user zooms in
          // further, instead of showing that placeholder text.
          maxNativeZoom: 9,
          // Not a real WMS param GIBS understands - just an extra query
          // string field so the tile URL (and therefore the cache key)
          // changes on every rebuild. See cacheBust comment above.
          _ts: cacheBust
        });
        wms.addTo(fireLiveLayer);
      }
    }

    buildFireLiveLayer(1);
    var currentFireRange = 1;
    var currentFireSource = getFireSource();
    var currentFireScope = getFireScope();

    var rangeToggle = document.getElementById('arviRangeToggle');
    if (rangeToggle){
      var rangeBtns = rangeToggle.querySelectorAll('.unit-toggle-btn');
      rangeBtns.forEach(function(btn, idx){
        if (idx === 0) btn.classList.add('active');
        btn.addEventListener('click', function(){
          rangeBtns.forEach(function(b){ b.classList.remove('active'); });
          btn.classList.add('active');
          currentFireRange = parseInt(btn.dataset.range, 10);
          buildFireLiveLayer(currentFireRange);
          refreshFireStats(currentFireRange);
        });
      });
    }

    // ---- Gempa bumi (USGS, live) ----
    var seenQuakeIds = {};
    var firstQuakeLoad = true;

    function loadQuakes(){
      var since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0,10);
      var usgsUrl = 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson'
        + '&starttime=' + since
        + '&minlatitude=' + INDONESIA_BOUNDS.minLat
        + '&maxlatitude=' + INDONESIA_BOUNDS.maxLat
        + '&minlongitude=' + INDONESIA_BOUNDS.minLon
        + '&maxlongitude=' + INDONESIA_BOUNDS.maxLon
        + '&minmagnitude=3.5&orderby=time&limit=200';

      if (firstQuakeLoad) setStatus('Memuat data gempa (USGS)…');
      fetch(usgsUrl).then(function(r){ return r.json(); }).then(function(geo){
        var feats = (geo && geo.features) || [];
        var newBigQuakes = [];
        var newNearbyQuakes = [];
        feats.forEach(function(f){
          var qid = f.id || (f.properties.time + '-' + f.geometry.coordinates.join(','));
          if (seenQuakeIds[qid]) return;
          seenQuakeIds[qid] = true;

          var lon = f.geometry.coordinates[0];
          var lat = f.geometry.coordinates[1];
          var mag = f.properties.mag || 0;
          collected.quakes.push({ lat: lat, lon: lon, mag: mag, place: f.properties.place, time: f.properties.time });
          var marker = L.circleMarker([lat, lon], {
            radius: Math.max(4, mag * 2.2),
            color: quakeColor(mag),
            fillColor: quakeColor(mag),
            fillOpacity: 0.55,
            weight: 1.2
          });
          marker.bindPopup(
            '<b><i class="fa-solid fa-house-crack" style="color:#ff7a45;"></i> M ' + mag.toFixed(1) + '</b><br>' + esc(f.properties.place || '-') +
            '<br><span style="opacity:.65">' + new Date(f.properties.time).toLocaleString('id-ID') + '</span>'
          );
          marker.addTo(quakeLayer);
          quakeMarkers.push({ marker: marker, lat: lat, lon: lon, mag: mag });

          // Shockwave ripple: looping ring while the quake is still
          // "recent" (< 1 hour old), so it stands out from older markers
          // that are otherwise the same-looking dot. Plus a brighter
          // one-shot burst ring the moment a quake is NEW to this session
          // (i.e. arrived on a poll after the initial load) for instant
          // visual feedback right when it's detected.
          var ageMs = Date.now() - f.properties.time;
          if (ageMs >= 0 && ageMs < 60 * 60 * 1000){
            addQuakeRipple(lat, lon, mag);
          }
          if (!firstQuakeLoad){
            addQuakeRipple(lat, lon, mag, { burst: true });
          }

          if (!firstQuakeLoad && mag >= 5) newBigQuakes.push({ mag: mag, place: f.properties.place, time: f.properties.time });

          // Gempa baru DI DEKAT lokasimu (radius-filter aktif) - ini yang
          // bunyi alarm, terlepas dari magnitudonya (asal masih lolos
          // ambang M3.5+ dari query USGS di atas), karena gempa kecil yang
          // dekat lebih relevan buatmu daripada gempa besar di ujung negara.
          if (!firstQuakeLoad && radiusFilterOn && userLoc &&
              haversineKm(userLoc.lat, userLoc.lon, lat, lon) <= RADIUS_KM){
            newNearbyQuakes.push({ mag: mag, place: f.properties.place, time: f.properties.time, distanceKm: haversineKm(userLoc.lat, userLoc.lon, lat, lon) });
          }
        });

        applyRadiusFilter();
        setStatus(collected.quakes.length + ' gempa (M3.5+, 30 hari terakhir) - sumber USGS');
        renderStats();
        renderQuakeSequences();

        if (newNearbyQuakes.length){
          playQuakeAlarm();
          var nearBody = newNearbyQuakes.map(function(q){
            return 'M' + q.mag.toFixed(1) + ' ' + (q.place || '') + ' (~' + Math.round(q.distanceKm) + ' km darimu)';
          }).join(', ');
          notify(
            'quake-near',
            'fa-triangle-exclamation',
            newNearbyQuakes.length > 1 ? newNearbyQuakes.length + ' GEMPA DEKAT LOKASIMU' : 'GEMPA DEKAT LOKASIMU',
            nearBody
          );
          newNearbyQuakes.forEach(function(q){
            queueQuakeAlarm(q.mag, q.place, q.time, true, q.distanceKm);
          });
        } else if (newBigQuakes.length){
          var body = newBigQuakes.map(function(q){ return 'M' + q.mag.toFixed(1) + ' ' + (q.place || ''); }).join(', ');
          notify(
            'quake',
            'fa-house-crack',
            newBigQuakes.length > 1 ? newBigQuakes.length + ' gempa M5+ baru' : 'Gempa M5+ baru',
            body
          );
          newBigQuakes.forEach(function(q){
            queueQuakeAlarm(q.mag, q.place, q.time, false, null);
          });
        }
        firstQuakeLoad = false;
      }).catch(function(){
        if (firstQuakeLoad) setStatus('Gagal memuat data gempa USGS (cek koneksi / CORS).');
        renderStats();
      });
    }

    // ---- Rangkaian gempa / indikasi gempa susulan (aftershock) -----------
    // A raw list of M3.5+ quakes doesn't distinguish "several unrelated
    // quakes around the country" from "several quakes stacked on the same
    // spot in a few days" - the second pattern is the one that reads as a
    // mainshock-aftershock sequence. Quakes from the last few days are
    // bucketed into a coarse grid; a cell with 3+ quakes gets ringed on
    // the map and flagged in the notification history.
    var sequenceLayer = L.layerGroup().addTo(map);
    var QUAKE_SEQ_GRID_DEG = 0.3; // ~33 km per cell near the equator
    var QUAKE_SEQ_WINDOW_MS = 3 * 24 * 3600 * 1000; // last 3 days
    var QUAKE_SEQ_MIN_COUNT = 3;
    var sequenceNotifyState = {}; // key -> last-notified quake count
    var firstSequenceCheck = true;

    function minMagOf(quakes){
      return quakes.reduce(function(m, q){ return q.mag < m ? q.mag : m; }, Infinity);
    }

    function computeQuakeSequences(quakes){
      var now = Date.now();
      var cells = {};
      quakes.forEach(function(q){
        if (now - q.time > QUAKE_SEQ_WINDOW_MS) return;
        var gx = Math.floor(q.lon / QUAKE_SEQ_GRID_DEG);
        var gy = Math.floor(q.lat / QUAKE_SEQ_GRID_DEG);
        var key = gx + '_' + gy;
        if (!cells[key]) cells[key] = { key: key, quakes: [] };
        cells[key].quakes.push(q);
      });
      return Object.keys(cells).map(function(k){ return cells[k]; })
        .filter(function(c){ return c.quakes.length >= QUAKE_SEQ_MIN_COUNT; });
    }

    function renderQuakeSequences(){
      sequenceLayer.clearLayers();
      var sequences = computeQuakeSequences(collected.quakes);
      var activeKeys = {};

      sequences.forEach(function(seq){
        activeKeys[seq.key] = true;
        var latSum = 0, lonSum = 0, maxMag = 0, minTime = Infinity, maxTime = -Infinity;
        seq.quakes.forEach(function(q){
          latSum += q.lat; lonSum += q.lon;
          if (q.mag > maxMag) maxMag = q.mag;
          if (q.time < minTime) minTime = q.time;
          if (q.time > maxTime) maxTime = q.time;
        });
        var lat = latSum / seq.quakes.length;
        var lon = lonSum / seq.quakes.length;
        var region = regionFor(lat, lon);
        var hours = Math.max(1, Math.round((maxTime - minTime) / 3600000));

        var ring = L.circleMarker([lat, lon], {
          radius: 16 + Math.min(20, seq.quakes.length * 2),
          color: '#b23bff',
          fillColor: '#b23bff',
          fillOpacity: 0.12,
          weight: 2,
          dashArray: '4,3',
          className: 'arvi-sequence-pulse'
        });
        ring.bindPopup(
          '<b><i class="fa-solid fa-house-crack" style="color:#b23bff;"></i> Rangkaian Gempa</b><br>' +
          seq.quakes.length + ' gempa (M' + minMagOf(seq.quakes).toFixed(1) + '\u2013' + maxMag.toFixed(1) + ') dalam ' + hours + ' jam terakhir' +
          (region ? ' - ' + region.name : '') +
          '<br><span style="opacity:.75">Indikasi kemungkinan rangkaian gempa utama-susulan (aftershock). Bukan prediksi resmi BMKG.</span>'
        );
        ring.addTo(sequenceLayer);

        var lastCount = sequenceNotifyState[seq.key] || 0;
        if (firstSequenceCheck){
          sequenceNotifyState[seq.key] = seq.quakes.length; // establish baseline, no toast on first load
        } else if (seq.quakes.length > lastCount){
          sequenceNotifyState[seq.key] = seq.quakes.length;
          notify(
            'quake',
            'fa-house-crack',
            'Indikasi rangkaian gempa susulan',
            seq.quakes.length + ' gempa M' + minMagOf(seq.quakes).toFixed(1) + '-' + maxMag.toFixed(1) +
            ' di area yang sama' + (region ? ' (' + region.name + ')' : '') + ' dalam ' + hours + ' jam terakhir.'
          );
        }
      });

      Object.keys(sequenceNotifyState).forEach(function(k){
        if (!activeKeys[k]) delete sequenceNotifyState[k];
      });
      firstSequenceCheck = false;
    }

    loadQuakes();
    setInterval(loadQuakes, 5 * 60 * 1000);

    // ---- Titik api dipakai khusus untuk hitung statistik wilayah ----
    // Contoh secara default; jadi data asli FIRMS begitu MAP_KEY diisi.
    var usingLiveFireStats = false;

    // ---- Fire hotspot density / "zona kritis" clustering -----------------
    // A raw point count treats 30 hotspots scattered across a whole
    // province the same as 30 hotspots packed into one district - the
    // second case is the one that actually behaves like a spreading fire.
    // Points are bucketed into a coarse lat/lon grid; each occupied cell
    // is colored by how many hotspots fall inside it, and dense cells get
    // flagged "Zona Kritis" instead of just adding to the total.
    var FIRE_GRID_DEG = 0.5; // ~55 km per cell near the equator
    var DENSITY_LEVELS = [
      { min: 0,  max: 4,        id: 'low',      label: 'Rendah',      color: '#5fd3c4' },
      { min: 5,  max: 14,       id: 'medium',   label: 'Sedang',      color: '#f2c94c' },
      { min: 15, max: 29,       id: 'high',     label: 'Tinggi',      color: '#ff7a45' },
      { min: 30, max: Infinity, id: 'critical', label: 'Zona Kritis', color: '#ff3b3b' }
    ];

    function densityLevelFor(count){
      for (var i = DENSITY_LEVELS.length - 1; i >= 0; i--){
        if (count >= DENSITY_LEVELS[i].min) return DENSITY_LEVELS[i];
      }
      return DENSITY_LEVELS[0];
    }

    function computeFireClusters(points){
      var cells = {};
      points.forEach(function(p){
        var gx = Math.floor(p.lon / FIRE_GRID_DEG);
        var gy = Math.floor(p.lat / FIRE_GRID_DEG);
        var key = gx + '_' + gy;
        if (!cells[key]) cells[key] = { key: key, count: 0, latSum: 0, lonSum: 0 };
        cells[key].count++;
        cells[key].latSum += p.lat;
        cells[key].lonSum += p.lon;
      });
      return Object.keys(cells).map(function(k){
        var c = cells[k];
        return {
          key: c.key,
          count: c.count,
          lat: c.latSum / c.count,
          lon: c.lonSum / c.count,
          level: densityLevelFor(c.count)
        };
      });
    }

    // Grid cells already flagged "Zona Kritis" in a previous refresh, so a
    // notification only fires once per new critical cluster, not on every
    // 5-minute poll while it's still burning.
    var seenCriticalClusterKeys = {};
    var lastFireClusters = []; // used by the AQI panel below to pick a source point

    function renderFireClusters(points){
      fireClusterLayer.clearLayers();
      var clusters = computeFireClusters(points);
      lastFireClusters = clusters;
      var newCritical = [];
      var stillCritical = {};

      clusters.forEach(function(c){
        var radius = 10 + Math.min(26, Math.sqrt(c.count) * 4);
        var circle = L.circleMarker([c.lat, c.lon], {
          radius: radius,
          color: c.level.color,
          fillColor: c.level.color,
          fillOpacity: c.level.id === 'critical' ? 0.4 : 0.2,
          weight: c.level.id === 'critical' ? 2.5 : 1.5,
          className: c.level.id === 'critical' ? 'arvi-critical-pulse' : ''
        });
        var region = regionFor(c.lat, c.lon);
        circle.bindPopup(
          '<b><i class="fa-solid ' + (c.level.id === 'critical' ? 'fa-triangle-exclamation' : 'fa-fire') + '" style="color:' + c.level.color + ';"></i> ' + c.level.label + '</b><br>' +
          c.count + ' titik api dalam radius ~' + Math.round(FIRE_GRID_DEG * 111) + ' km' + (region ? ' - ' + region.name : '') +
          (c.level.id === 'critical' ? '<br><span style="opacity:.75">Kepadatan tinggi - berpotensi kebakaran meluas.</span>' : '')
        );
        circle.addTo(fireClusterLayer);

        if (c.level.id === 'critical'){
          stillCritical[c.key] = true;
          if (!seenCriticalClusterKeys[c.key]){
            seenCriticalClusterKeys[c.key] = true;
            newCritical.push(c);
          }
        }
      });

      // Let a cell re-trigger a notification later if it cools down and
      // then spikes again, instead of staying "seen" forever.
      Object.keys(seenCriticalClusterKeys).forEach(function(k){
        if (!stillCritical[k]) delete seenCriticalClusterKeys[k];
      });

      var countEl = document.getElementById('arviCriticalZoneCount');
      var wrapEl = document.getElementById('arviCriticalZoneWrap');
      var criticalCount = clusters.filter(function(c){ return c.level.id === 'critical'; }).length;
      if (countEl) countEl.textContent = criticalCount;
      if (wrapEl) wrapEl.hidden = criticalCount === 0;
      // Mirrored onto the collapsed legend pill so the zone count is still
      // visible without having to expand the (now collapsed-by-default)
      // legend box.
      var countElCollapsed = document.getElementById('arviCriticalZoneCountCollapsed');
      var wrapElCollapsed = document.getElementById('arviCriticalZoneWrapCollapsed');
      if (countElCollapsed) countElCollapsed.textContent = criticalCount;
      if (wrapElCollapsed) wrapElCollapsed.hidden = criticalCount === 0;

      if (newCritical.length){
        var body = newCritical.map(function(c){
          var region = regionFor(c.lat, c.lon);
          return c.count + ' titik' + (region ? ' (' + region.name + ')' : '');
        }).join(', ');
        notify(
          'fire',
          'fa-triangle-exclamation',
          newCritical.length > 1 ? newCritical.length + ' zona kritis titik api baru' : 'Zona kritis titik api baru',
          body + ' - kepadatan tinggi terdeteksi, berpotensi meluas.'
        );
      }
    }

    // ---- Kualitas udara (PM2.5/AQI) dari OpenAQ, dekat titik api ---------
    // Smoke from a fire hotspot is often more of a health risk than the
    // fire itself, so this pulls a live PM2.5 reading from the nearest
    // OpenAQ monitoring station - near the user's location if the radius
    // filter is on, otherwise near the densest active fire cluster.
    // OpenAQ v3 requires a free API key (same optional-key pattern as the
    // FIRMS key above). Categorization uses the standard US EPA 24-hour
    // PM2.5 breakpoints as a simple stand-in for "AQI", not an official
    // ISPU/AQI calculation.
    var OPENAQ_KEY_STORAGE = 'istrack_openaq_key';
    function getOpenAqKey(){
      try { return (localStorage.getItem(OPENAQ_KEY_STORAGE) || '').trim(); } catch(e){ return ''; }
    }
    function setOpenAqKey(key){
      try {
        if (key) localStorage.setItem(OPENAQ_KEY_STORAGE, key);
        else localStorage.removeItem(OPENAQ_KEY_STORAGE);
      } catch(e){}
    }

    var PM25_LEVELS = [
      { max: 15.5,     id: 'good',          label: 'Baik',                color: '#5fd3c4' },
      { max: 55.4,     id: 'moderate',      label: 'Sedang',              color: '#f2c94c' },
      { max: 150.4,    id: 'unhealthy',     label: 'Tidak Sehat',         color: '#ff7a45' },
      { max: 250.4,    id: 'veryunhealthy', label: 'Sangat Tidak Sehat',  color: '#ff3b3b' },
      { max: Infinity, id: 'hazardous',     label: 'Berbahaya',           color: '#b23bff' }
    ];
    function pm25Level(v){
      for (var i = 0; i < PM25_LEVELS.length; i++){ if (v <= PM25_LEVELS[i].max) return PM25_LEVELS[i]; }
      return PM25_LEVELS[PM25_LEVELS.length - 1];
    }

    function setOpenAqKeyStatus(text, kind){
      var el = document.getElementById('arviOpenAqKeyStatus');
      if (!el) return;
      el.textContent = 'Status: ' + text;
      el.classList.remove('is-live', 'is-error');
      if (kind) el.classList.add(kind);
    }

    // Two calls: find the nearest station with a PM2.5 sensor, then read
    // its latest value.
    function fetchAqiNear(lat, lon){
      var key = getOpenAqKey();
      if (!key) return Promise.reject(new Error('no-key'));
      var locUrl = 'https://api.openaq.org/v3/locations?coordinates=' + lat.toFixed(4) + ',' + lon.toFixed(4) +
        '&radius=25000&limit=5&order_by=distance&parameters_id=2'; // parameter id 2 = pm25
      return fetch(locUrl, { headers: { 'X-API-Key': key } }).then(function(r){
        if (!r.ok) throw new Error('http-' + r.status);
        return r.json();
      }).then(function(data){
        var stations = (data && data.results) || [];
        if (!stations.length) throw new Error('no-station');
        var station = stations[0];
        return fetch('https://api.openaq.org/v3/locations/' + station.id + '/latest', {
          headers: { 'X-API-Key': key }
        }).then(function(r2){
          if (!r2.ok) throw new Error('http-' + r2.status);
          return r2.json();
        }).then(function(latest){
          var results = (latest && latest.results) || [];
          var pm25 = results.filter(function(r3){ return r3.parameter && r3.parameter.id === 2; })[0] || results[0];
          if (!pm25) throw new Error('no-reading');
          return {
            value: pm25.value,
            stationName: station.name,
            distanceKm: station.distance ? station.distance / 1000 : null
          };
        });
      });
    }

    function renderAqi(reading, sourceLabel){
      var body = document.getElementById('arviAqiBody');
      if (!body) return;
      if (!reading){
        body.innerHTML = '<p class="placeholder">Tidak ada data AQI untuk area ini saat ini.</p>';
        return;
      }
      var level = pm25Level(reading.value);
      body.innerHTML =
        '<div class="arvi-aqi-badge" style="background:' + level.color + ';">' + level.label + '</div>' +
        '<p class="arvi-aqi-detail">PM2.5: <b>' + reading.value.toFixed(1) + ' \u00b5g/m\u00b3</b> - stasiun ' + esc(reading.stationName) +
        (reading.distanceKm != null ? ' (~' + reading.distanceKm.toFixed(0) + ' km)' : '') + '</p>' +
        '<p class="arvi-aqi-source">Sumber: ' + esc(sourceLabel) + '</p>';
    }

    function refreshAqi(){
      var lat, lon, sourceLabel;
      if (radiusFilterOn && userLoc){
        lat = userLoc.lat; lon = userLoc.lon; sourceLabel = 'lokasimu';
      } else if (lastFireClusters.length){
        var densest = lastFireClusters.slice().sort(function(a, b){ return b.count - a.count; })[0];
        lat = densest.lat; lon = densest.lon;
        var region = regionFor(lat, lon);
        sourceLabel = 'zona titik api terpadat' + (region ? ' (' + region.name + ')' : '');
      } else {
        renderAqi(null);
        return;
      }

      var key = getOpenAqKey();
      var body = document.getElementById('arviAqiBody');
      if (!key){
        setOpenAqKeyStatus('belum ada API key.');
        if (body) body.innerHTML = '<p class="placeholder">Masukkan API key OpenAQ lewat panel filter (☰) untuk mengaktifkan.</p>';
        return;
      }
      setOpenAqKeyStatus('memuat data AQI…');
      fetchAqiNear(lat, lon).then(function(reading){
        setOpenAqKeyStatus('AQI dimuat dari OpenAQ.', 'is-live');
        renderAqi(reading, sourceLabel);
      }).catch(function(err){
        var known = err && (err.message === 'no-station' || err.message === 'no-reading');
        var msg = known ? 'tidak ada stasiun OpenAQ PM2.5 di sekitar area ini.'
          : 'gagal memuat data OpenAQ (cek API key / koneksi / CORS).';
        setOpenAqKeyStatus(msg, known ? null : 'is-error');
        renderAqi(null);
      });
    }

    function renderFireStatMarkers(points, isLive){
      fireDemoLayer.clearLayers();
      fireStatMarkers = [];
      var color = isLive ? '#e2000d' : '#ff4d1a';
      var label = isLive ? 'Fire hotspot (FIRMS, real)' : 'Fire hotspot (sample)';
      var note = isLive ? 'Real data from NASA FIRMS Area API (your MAP_KEY)' : 'Demo data for statistics - the main map uses live NASA GIBS/FIRMS data';
      points.forEach(function(p){
        var marker = L.circleMarker([p.lat, p.lon], {
          radius: isLive ? 5 : 7,
          color: color,
          fillColor: color,
          fillOpacity: 0.85,
          weight: 1.4,
          dashArray: isLive ? null : '2,2'
        });
        marker.bindPopup('<b><i class="fa-solid fa-fire" style="color:' + color + ';"></i> ' + label + '</b><br>' + p.name + '<br><span style="opacity:.65">' + note + '</span>');
        marker.addTo(fireDemoLayer);
        fireStatMarkers.push({ marker: marker, lat: p.lat, lon: p.lon });
      });
      applyRadiusFilter();
    }

    function setKeyStatus(text, kind){
      var el = document.getElementById('arviFirmsKeyStatus');
      if (!el) return;
      el.textContent = 'Status: ' + text;
      el.classList.remove('is-live', 'is-error');
      if (kind) el.classList.add(kind);
    }

    function updateDemoTag(isLive){
      var tag = document.querySelector('.arvi-demo-tag');
      if (tag) tag.textContent = isLive ? 'LIVE' : 'DEMO';
      var legendSpan = document.getElementById('arviRegionFireLegend');
      if (legendSpan){
        var color = isLive ? '#ff3b3b' : '#5fd3c4';
        legendSpan.innerHTML = '<i class="fa-solid fa-fire" style="color:' + color + ';"></i> ' +
          (isLive ? 'Fire hotspots (FIRMS, real)' : 'Fire hotspots (demo)');
      }
    }

    function refreshFireStats(days){
      var key = getFirmsKey();
      if (!key){
        usingLiveFireStats = false;
        collected.fires = fetchFireDemoData();
        renderFireClusters(collected.fires);
        renderFireStatMarkers(collected.fires, false);
        updateDemoTag(false);
        setKeyStatus('using sample data (no MAP_KEY yet).');
        renderStats();
        return;
      }
      setKeyStatus('loading real FIRMS data…');
      fetchFireRealData(days, currentFireSource, currentFireScope).then(function(result){
        var points = result.points;
        var total = result.total;
        usingLiveFireStats = true;
        collected.fires = points;
        renderFireClusters(points);
        renderFireStatMarkers(points, true);
        updateDemoTag(true);
        var shownNote = total > points.length ? (' (menampilkan ' + points.length + ' titik di peta, sisanya cuma dihitung)') : '';
        setKeyStatus(total + ' real fire hotspots loaded (FIRMS)' + shownNote + '.', 'is-live');
        renderStats();
        checkFireUpdate(total, true);
      }).catch(function(err){
        usingLiveFireStats = false;
        collected.fires = fetchFireDemoData();
        renderFireClusters(collected.fires);
        renderFireStatMarkers(collected.fires, false);
        updateDemoTag(false);
        var msg = (err && err.message === 'no-key')
          ? 'using sample data (no MAP_KEY yet).'
          : 'MAP_KEY failed (check the key / connection) - reverted to sample data.';
        setKeyStatus(msg, err && err.message === 'no-key' ? null : 'is-error');
        renderStats();
      });
    }

    refreshFireStats(currentFireRange);

    // Poll periodically so the notification can fire even while the user
    // just leaves the map open (VIIRS NRT detections update every few
    // hours; polling every 5 minutes catches that without hammering the
    // API). Also refresh the live raster overlay in step. Polling faster
    // (every 60s) doesn't make NASA's own data land any sooner - it just
    // makes this app notice new data as soon as NASA has processed it,
    // instead of waiting up to 5 minutes to check.
    setInterval(function(){
      buildFireLiveLayer(currentFireRange);
      refreshFireStats(currentFireRange);
    }, 60 * 1000);

    // ---- One-time explainer: fire STATS/NOTIFICATIONS need a free key ----
    // The fire layer drawn ON the map is always NASA's real live data (no
    // key needed). But the "Zona Kritis" clustering, the region-by-region
    // percentages, and the fire notifications above are all computed from
    // collected.fires - which, until a free FIRMS MAP_KEY is added, is a
    // small FIXED sample (see fetchFireDemoData). A fixed sample never
    // grows, so it can never trigger a "new fire detected" notification -
    // that's not a bug, but it looks exactly like one from the outside.
    // Surface it once per browser instead of leaving people to find the
    // small print in the filter panel.
    var FIRE_HELP_SEEN_KEY = 'istrack_arvi_fire_help_seen_v1';
    function openFirmsKeySetup(){
      if (filterPanelEl){
        filterPanelEl.classList.add('open');
        if (filterToggleEl) filterToggleEl.setAttribute('aria-expanded', 'true');
      }
      var backdropEl = document.getElementById('arviModalBackdrop');
      if (backdropEl) backdropEl.classList.add('open');
      var group = document.getElementById('arviFirmsKeyGroup');
      if (group && group.scrollIntoView) group.scrollIntoView({ block: 'center', behavior: 'smooth' });
      var input = document.getElementById('arviFirmsKeyInput');
      if (input) setTimeout(function(){ input.focus(); }, 350);
    }
    // filterPanel/filterToggle are declared further down (function-scoped
    // via `var`, so this reference resolves fine even though it's wired
    // after this point runs) - grabbed here defensively in case that ever
    // changes.
    var filterPanelEl = document.getElementById('arviFilterPanel');
    var filterToggleEl = document.getElementById('arviFilterToggle');
    setTimeout(function(){
      try {
        if (localStorage.getItem(FIRE_HELP_SEEN_KEY)) return;
      } catch(e){}
      if (getFirmsKey()) return; // already set up, nothing to explain
      showToast(
        'fa-circle-info',
        'Titik api: peta vs statistik',
        'Peta titik api sudah data NASA asli & live. Statistik + notifikasi "zona kritis" masih contoh - ketuk ini buat isi API key FIRMS gratis biar ikut live.',
        14000,
        openFirmsKeySetup
      );
      try { localStorage.setItem(FIRE_HELP_SEEN_KEY, '1'); } catch(e){}
    }, 4500);

    // ---- One-time nudge: alarm is Indonesia-wide M5+ by default -----------
    // Without "Lokasi Saya" turned on, the alarm only fires for M5+ quakes
    // ANYWHERE in Indonesia - a M4.2 quake right under someone's city in
    // Balikpapan would NOT trigger it unless they've enabled location.
    // That's the exact "gempa di kotaku" behavior people expect by
    // default, so nudge them toward turning it on once.
    var LOC_HELP_SEEN_KEY = 'istrack_arvi_location_help_seen_v1';
    function openLocationSetup(){
      if (filterPanelEl){
        filterPanelEl.classList.add('open');
        if (filterToggleEl) filterToggleEl.setAttribute('aria-expanded', 'true');
      }
      var backdropEl = document.getElementById('arviModalBackdrop');
      if (backdropEl) backdropEl.classList.add('open');
      var group = document.getElementById('arviRadiusGroup');
      if (group && group.scrollIntoView) group.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    setTimeout(function(){
      try {
        if (localStorage.getItem(LOC_HELP_SEEN_KEY)) return;
      } catch(e){}
      if (radiusFilterOn) return; // already on, nothing to nudge about
      showToast(
        'fa-location-crosshairs',
        'Mau alarm khusus kotamu?',
        'Sekarang alarm cuma bunyi buat gempa M5+ di seluruh Indonesia. Ketuk ini buat aktifin alarm gempa berapapun magnitudonya yang deket lokasimu (mis. Balikpapan).',
        14000,
        openLocationSetup
      );
      try { localStorage.setItem(LOC_HELP_SEEN_KEY, '1'); } catch(e){}
    }, 8000);

    var firmsKeyInput = document.getElementById('arviFirmsKeyInput');
    var firmsKeySave = document.getElementById('arviFirmsKeySave');
    if (firmsKeyInput) firmsKeyInput.value = getFirmsKey();
    if (firmsKeySave && firmsKeyInput){
      firmsKeySave.addEventListener('click', function(){
        setFirmsKey(firmsKeyInput.value.trim());
        refreshFireStats(currentFireRange);
      });
    }

    // Satellite/sensor source switcher for the FIRMS Area API stats
    // (VIIRS SNPP / NOAA-20 / NOAA-21 / MODIS) - each is an independently
    // orbiting satellite, so switching catches detections the current one
    // might have missed on its last pass.
    var firmsSourceSelect = document.getElementById('arviFirmsSourceSelect');
    if (firmsSourceSelect){
      firmsSourceSelect.value = currentFireSource;
      firmsSourceSelect.addEventListener('change', function(){
        currentFireSource = FIRE_SOURCES.indexOf(firmsSourceSelect.value) > -1 ? firmsSourceSelect.value : FIRE_SOURCES[0];
        setFireSource(currentFireSource);
        refreshFireStats(currentFireRange);
      });
    }

    // Coverage switcher: Indonesia-only vs worldwide fire stats/alerts.
    var fireScopeToggle = document.getElementById('arviFireScopeToggle');
    if (fireScopeToggle){
      var fireScopeBtns = fireScopeToggle.querySelectorAll('.unit-toggle-btn');
      fireScopeBtns.forEach(function(btn){
        if (btn.dataset.scope === currentFireScope) btn.classList.add('active');
        else btn.classList.remove('active');
        btn.addEventListener('click', function(){
          fireScopeBtns.forEach(function(b){ b.classList.remove('active'); });
          btn.classList.add('active');
          currentFireScope = btn.dataset.scope === 'world' ? 'world' : 'idn';
          setFireScope(currentFireScope);
          // Baseline resets on scope change - jumping from "Indonesia"
          // count to "world" count is a different number, not new fires.
          prevFireTotal = null;
          refreshFireStats(currentFireRange);
        });
      });
    }

    var openAqKeyInput = document.getElementById('arviOpenAqKeyInput');
    var openAqKeySave = document.getElementById('arviOpenAqKeySave');
    if (openAqKeyInput) openAqKeyInput.value = getOpenAqKey();
    if (openAqKeySave && openAqKeyInput){
      openAqKeySave.addEventListener('click', function(){
        setOpenAqKey(openAqKeyInput.value.trim());
        refreshAqi();
      });
    }
    if (!getOpenAqKey()) setOpenAqKeyStatus('belum ada API key.');
    refreshAqi();

    // ---- Radar cuaca (RainViewer, live, animasi + filter) ----
    // Color scheme 6 = "NEXRAD Level III", the same classic dBZ reflectivity
    // palette used by NWS radar images (teal -> green -> yellow -> orange ->
    // red -> pink -> purple -> white).
    var RV_COLOR = 6;
    var weather = {
      host: 'https://tilecache.rainviewer.com',
      radarFrames: [],   // past + nowcast, chronological
      satFrames: [],
      mode: 'radar',     // 'radar' | 'satellite'
      snow: 0,
      index: 0,
      playing: false,
      timer: null,
      tileLayer: null
    };

    function currentFrames(){ return weather.mode === 'radar' ? weather.radarFrames : weather.satFrames; }

    function renderWeatherFrame(){
      var frames = currentFrames();
      if (!frames.length) return;
      if (weather.index >= frames.length) weather.index = frames.length - 1;
      if (weather.index < 0) weather.index = 0;
      var frame = frames[weather.index];

      radarLayer.clearLayers();
      var url;
      if (weather.mode === 'radar'){
        url = weather.host + frame.path + '/256/{z}/{x}/{y}/' + RV_COLOR + '/1_' + weather.snow + '.png';
      } else {
        url = weather.host + frame.path + '/256/{z}/{x}/{y}/0/0_0.png';
      }
      weather.tileLayer = L.tileLayer(url, {
        opacity: 0.75,
        attribution: 'Weather &copy; RainViewer',
        zIndex: 450
      });
      weather.tileLayer.addTo(radarLayer);

      var timeEl = document.getElementById('arviRadarTime');
      if (timeEl){
        var label = new Date(frame.time * 1000).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
        timeEl.textContent = (frame.isForecast ? 'Prakiraan ' : '') + label;
      }
      var sliderEl = document.getElementById('arviRadarSlider');
      if (sliderEl){
        sliderEl.max = frames.length - 1;
        sliderEl.value = weather.index;
      }
    }

    function stepWeather(delta){
      var frames = currentFrames();
      if (!frames.length) return;
      weather.index = (weather.index + delta + frames.length) % frames.length;
      renderWeatherFrame();
    }

    function playWeather(play){
      weather.playing = play;
      var btn = document.getElementById('arviRadarPlay');
      if (btn) btn.innerHTML = play ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
      if (weather.timer) clearInterval(weather.timer);
      if (play){
        weather.timer = setInterval(function(){ stepWeather(1); }, 700);
      }
    }

    fetch('https://api.rainviewer.com/public/weather-maps.json').then(function(r){ return r.json(); }).then(function(data){
      weather.host = data.host || weather.host;
      var past = (data.radar && data.radar.past) || [];
      var nowcast = (data.radar && data.radar.nowcast) || [];
      weather.radarFrames = past.concat(nowcast.map(function(f){ return { time: f.time, path: f.path, isForecast: true }; }));
      weather.satFrames = (data.satellite && data.satellite.infrared) || [];
      // Start on the latest observed (non-forecast) radar frame.
      weather.index = Math.max(0, past.length - 1);
      renderWeatherFrame();
    }).catch(function(){ /* radar optional, fail silently */ });

    var modeToggle = document.getElementById('arviWeatherMode');
    if (modeToggle){
      var modeBtns = modeToggle.querySelectorAll('.unit-toggle-btn');
      modeBtns.forEach(function(btn, idx){
        if (idx === 0) btn.classList.add('active');
        btn.addEventListener('click', function(){
          modeBtns.forEach(function(b){ b.classList.remove('active'); });
          btn.classList.add('active');
          weather.mode = btn.dataset.mode;
          weather.index = currentFrames().length - 1;
          renderWeatherFrame();
        });
      });
    }
    var snowToggle = document.getElementById('arviSnowToggle');
    if (snowToggle){
      snowToggle.addEventListener('change', function(){
        weather.snow = snowToggle.checked ? 1 : 0;
        renderWeatherFrame();
      });
    }
    var playBtn = document.getElementById('arviRadarPlay');
    if (playBtn) playBtn.addEventListener('click', function(){ playWeather(!weather.playing); });
    var prevBtn = document.getElementById('arviRadarPrev');
    if (prevBtn) prevBtn.addEventListener('click', function(){ playWeather(false); stepWeather(-1); });
    var nextBtn = document.getElementById('arviRadarNext');
    if (nextBtn) nextBtn.addEventListener('click', function(){ playWeather(false); stepWeather(1); });
    var sliderInput = document.getElementById('arviRadarSlider');
    if (sliderInput){
      sliderInput.addEventListener('input', function(){
        playWeather(false);
        weather.index = parseInt(sliderInput.value, 10);
        renderWeatherFrame();
      });
    }

    radarLayer.addTo(map);

    // ---- Filter panel (hamburger) -------------------------------------
    // Replaces Leaflet's default layer control with a custom slide-out
    // panel so all filters (base map, layers, weather, fire range, FIRMS
    // key) live behind a single hamburger button instead of cluttering
    // the map itself.
    var filterToggle = document.getElementById('arviFilterToggle');
    var filterPanel = document.getElementById('arviFilterPanel');
    var filterClose = document.getElementById('arviFilterClose');
    var statsToggle = document.getElementById('arviStatsToggle');
    var statsDrawer = document.getElementById('arviStatsDrawer');
    var statsClose = document.getElementById('arviStatsClose');
    // Both panels now live at the body root (see arvi.html) with a shared
    // dim+blur backdrop behind them, instead of being absolutely positioned
    // *inside* the map card where .wrap's overflow:hidden (fullmap mode)
    // could clip them and the floating header card could paint over them.
    var modalBackdrop = document.getElementById('arviModalBackdrop');
    function syncBackdrop(){
      var anyOpen = (filterPanel && filterPanel.classList.contains('open')) ||
                    (statsDrawer && statsDrawer.classList.contains('open'));
      if (modalBackdrop) modalBackdrop.classList.toggle('open', !!anyOpen);
    }
    function closeFilter(){
      if (!filterPanel) return;
      filterPanel.classList.remove('open');
      if (filterToggle) filterToggle.setAttribute('aria-expanded', 'false');
      syncBackdrop();
    }
    function closeStats(){
      if (!statsDrawer) return;
      statsDrawer.classList.remove('open');
      if (statsToggle) statsToggle.setAttribute('aria-expanded', 'false');
      syncBackdrop();
    }
    if (filterToggle && filterPanel){
      function toggleFilter(){
        closeStats();
        var open = filterPanel.classList.toggle('open');
        filterToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        syncBackdrop();
      }
      filterToggle.addEventListener('click', function(e){ e.stopPropagation(); toggleFilter(); });
      if (filterClose) filterClose.addEventListener('click', closeFilter);
    }
    if (statsToggle && statsDrawer){
      function toggleStats(){
        closeFilter();
        var open = statsDrawer.classList.toggle('open');
        statsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) setNotifBadge(false);
        syncBackdrop();
      }
      statsToggle.addEventListener('click', function(e){ e.stopPropagation(); toggleStats(); });
      if (statsClose) statsClose.addEventListener('click', closeStats);
    }
    // Tapping the dimmed/blurred backdrop closes whichever panel is open -
    // same "tap outside to dismiss" behavior as before, just explicit now
    // that the backdrop sits on top of (and visually covers) everything
    // else, including the filter/stats toggle buttons themselves.
    if (modalBackdrop) modalBackdrop.addEventListener('click', function(){ closeFilter(); closeStats(); });
    if (filterToggle || statsToggle){
      document.addEventListener('click', function(e){
        if (filterPanel && !filterPanel.contains(e.target) && !(filterToggle && filterToggle.contains(e.target))) closeFilter();
        if (statsDrawer && !statsDrawer.contains(e.target) && !(statsToggle && statsToggle.contains(e.target))) closeStats();
      });
      document.addEventListener('keydown', function(e){
        if (e.key === 'Escape'){ closeFilter(); closeStats(); }
      });
    }

    // ---- Map legend (collapsible) ---------------------------------------
    // Collapsed by default - on a phone screen the fully expanded legend
    // (earthquake/fire/sequence lines + the 4-level density key) took up
    // roughly a third of the map and overlapped the Leaflet attribution
    // text at the bottom. Tapping the pill expands it; the critical-zone
    // count still shows on the collapsed pill so nothing important is
    // hidden away.
    var legendBox = document.getElementById('arviMapLegend');
    var legendToggle = document.getElementById('arviLegendToggle');
    if (legendBox && legendToggle){
      legendToggle.addEventListener('click', function(e){
        e.stopPropagation();
        var open = legendBox.classList.toggle('open');
        legendToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    var zoomInBtn = document.getElementById('arviZoomIn');
    var zoomOutBtn = document.getElementById('arviZoomOut');
    if (zoomInBtn) zoomInBtn.addEventListener('click', function(){ map.zoomIn(); });
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', function(){ map.zoomOut(); });

    var baseToggle = document.getElementById('arviBaseToggle');
    if (baseToggle){
      var baseBtns = baseToggle.querySelectorAll('.unit-toggle-btn');
      baseBtns.forEach(function(btn){
        btn.addEventListener('click', function(){
          baseBtns.forEach(function(b){ b.classList.remove('active'); });
          btn.classList.add('active');
          if (btn.dataset.base === 'light'){
            L.DomUtil.removeClass(satBase.getContainer(), 'is-dark');
          } else {
            L.DomUtil.addClass(satBase.getContainer(), 'is-dark');
          }
        });
      });
    }

    function wireLayerCheckbox(id, layer){
      var el = document.getElementById(id);
      if (!el) return;
      if (el.checked) layer.addTo(map); else map.removeLayer(layer);
      el.addEventListener('change', function(){
        if (el.checked) layer.addTo(map); else map.removeLayer(layer);
      });
    }
    wireLayerCheckbox('arviLayerLabels', satLabels);
    wireLayerCheckbox('arviLayerQuake', quakeLayer);
    wireLayerCheckbox('arviLayerRadar', radarLayer);
    wireLayerCheckbox('arviLayerFireLive', fireLiveLayer);
    wireLayerCheckbox('arviLayerFireStat', fireDemoLayer);
    wireLayerCheckbox('arviLayerFireCluster', fireClusterLayer);
    wireLayerCheckbox('arviLayerQuakeSequence', sequenceLayer);

    // ---- Radius filter toggle ("Lokasi Saya") --------------------------
    var radiusToggle = document.getElementById('arviRadiusToggle');
    if (radiusToggle){
      radiusToggle.addEventListener('change', function(){
        if (!radiusToggle.checked){
          radiusFilterOn = false;
          // Fix #2: stop tracking - was previously a one-shot getCurrentPosition,
          // so if you moved cities the alarm kept using your OLD location until
          // you manually re-toggled this checkbox. clearWatch actually stops it.
          if (geoWatchId != null && navigator.geolocation){
            navigator.geolocation.clearWatch(geoWatchId);
            geoWatchId = null;
          }
          if (userLocMarker){ map.removeLayer(userLocMarker); userLocMarker = null; }
          if (userLocCircle){ map.removeLayer(userLocCircle); userLocCircle = null; }
          applyRadiusFilter();
          return;
        }
        if (!navigator.geolocation){
          radiusToggle.checked = false;
          showToast('fa-location-crosshairs', 'Lokasi tidak didukung', 'Browser ini tidak mendukung geolocation.');
          return;
        }
        radiusFilterOn = true;
        applyRadiusFilter(); // shows "Mencari lokasimu…" immediately
        var firstFix = true;
        // Fix #2: watchPosition instead of a single getCurrentPosition call -
        // the browser keeps calling this callback whenever your position
        // changes meaningfully (walking/driving/changing city), so the
        // 50km radius used for the map, stats, AND the personal alarm
        // always reflects where you actually are right now, not just
        // wherever you were the moment you flipped this switch on.
        geoWatchId = navigator.geolocation.watchPosition(function(pos){
          userLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude };

          if (userLocMarker) map.removeLayer(userLocMarker);
          userLocMarker = L.circleMarker([userLoc.lat, userLoc.lon], {
            radius: 7, color: '#5fd3c4', fillColor: '#5fd3c4', fillOpacity: 0.9, weight: 2
          }).bindPopup('Lokasi kamu (perkiraan, mengikuti pergerakanmu)').addTo(map);

          if (userLocCircle) map.removeLayer(userLocCircle);
          userLocCircle = L.circle([userLoc.lat, userLoc.lon], {
            radius: RADIUS_KM * 1000, color: '#5fd3c4', weight: 1, fillOpacity: 0.06, dashArray: '4,6'
          }).addTo(map);

          if (firstFix){ map.setView([userLoc.lat, userLoc.lon], 8); firstFix = false; }
          applyRadiusFilter();
          syncPushSubscriptionLocation(); // keep server-side push aware of where you are now (see below)
        }, function(err){
          radiusToggle.checked = false;
          radiusFilterOn = false;
          if (geoWatchId != null){ navigator.geolocation.clearWatch(geoWatchId); geoWatchId = null; }
          applyRadiusFilter();
          var msg = err && err.code === 1
            ? 'Izin lokasi ditolak. Aktifkan izin lokasi di browser untuk memakai fitur ini.'
            : 'Gagal mendapatkan lokasi. Coba lagi.';
          showToast('fa-location-crosshairs', 'Lokasi tidak tersedia', msg);
        }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 });
      });
    }

    // ---- "Gunakan Lokasi Saat Ini (GPS)" button, lives in the Stats -------
    // drawer (near the region/percentage stats it feeds, per user request -
    // it used to sit in the filter panel as a hardcoded preset coordinate
    // for one spot in Balikpapan, which wasn't real GPS at all). This is a
    // single real navigator.geolocation.getCurrentPosition() read: one fix,
    // not continuous tracking - same marker/radius-circle/alarm wiring as
    // the "Lokasi Saya" toggle above, just triggered once on tap instead of
    // watched continuously.
    var useGpsBtn = document.getElementById('arviUseGpsBtn');
    if (useGpsBtn){
      useGpsBtn.addEventListener('click', function(){
        var statusEl3 = document.getElementById('arviUseGpsStatus');
        if (!navigator.geolocation){
          if (statusEl3) statusEl3.textContent = 'Status: browser ini tidak mendukung geolocation.';
          showToast('fa-location-crosshairs', 'Lokasi tidak didukung', 'Browser ini tidak mendukung geolocation.');
          return;
        }
        if (statusEl3) statusEl3.textContent = 'Status: mencari lokasimu…';
        useGpsBtn.disabled = true;
        navigator.geolocation.getCurrentPosition(function(pos){
          useGpsBtn.disabled = false;

          // A one-shot fix should win outright instead of being overwritten
          // by a still-running continuous watch from the "Lokasi Saya"
          // toggle, so stop that first (matches the old manual-preset
          // behavior, just with a real coordinate now).
          if (geoWatchId != null && navigator.geolocation){
            navigator.geolocation.clearWatch(geoWatchId);
            geoWatchId = null;
          }
          if (radiusToggle) radiusToggle.checked = false;

          radiusFilterOn = true;
          userLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude };

          if (userLocMarker) map.removeLayer(userLocMarker);
          userLocMarker = L.circleMarker([userLoc.lat, userLoc.lon], {
            radius: 7, color: '#5fd3c4', fillColor: '#5fd3c4', fillOpacity: 0.9, weight: 2
          }).bindPopup('📍 Lokasi kamu saat ini (GPS)').addTo(map);

          if (userLocCircle) map.removeLayer(userLocCircle);
          userLocCircle = L.circle([userLoc.lat, userLoc.lon], {
            radius: RADIUS_KM * 1000, color: '#5fd3c4', weight: 1, fillOpacity: 0.06, dashArray: '4,6'
          }).addTo(map);

          map.setView([userLoc.lat, userLoc.lon], 11);
          applyRadiusFilter();
          syncPushSubscriptionLocation();

          if (statusEl3) statusEl3.textContent = 'Status: pakai lokasi GPS saat ini (' + userLoc.lat.toFixed(4) + ', ' + userLoc.lon.toFixed(4) + ').';
        }, function(err){
          useGpsBtn.disabled = false;
          var msg = err && err.code === 1
            ? 'Izin lokasi ditolak. Aktifkan izin lokasi di browser untuk memakai fitur ini.'
            : 'Gagal mendapatkan lokasi. Coba lagi.';
          if (statusEl3) statusEl3.textContent = 'Status: ' + msg;
          showToast('fa-location-crosshairs', 'Lokasi tidak tersedia', msg);
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
      });
    }

    // ---- Statistik persentase per wilayah ----
    var donutChart = null;
    var magTrendChart = null;

    function renderStats(){
      var apiColor = usingLiveFireStats ? '#ff3b3b' : '#5fd3c4';
      var apiLabel = usingLiveFireStats ? 'Fire Hotspots (FIRMS)' : 'Fire Hotspots (demo)';
      var regionCounts = {};
      REGIONS.forEach(function(r){ regionCounts[r.id] = { name: r.name, gempa: 0, api: 0 }; });

      collected.quakes.forEach(function(q){
        var r = regionFor(q.lat, q.lon);
        if (r) regionCounts[r.id].gempa++;
      });
      collected.fires.forEach(function(p){
        var r = regionFor(p.lat, p.lon);
        if (r) regionCounts[r.id].api++;
      });

      var rows = Object.keys(regionCounts).map(function(id){ return regionCounts[id]; })
        .map(function(r){ return { name: r.name, total: r.gempa + r.api, gempa: r.gempa, api: r.api }; })
        .filter(function(r){ return r.total > 0; })
        .sort(function(a,b){ return b.total - a.total; });

      var grandTotal = rows.reduce(function(s,r){ return s + r.total; }, 0) || 1;

      var listEl = document.getElementById('arviRegionList');
      if (listEl){
        listEl.innerHTML = '';
        rows.forEach(function(r){
          var pct = (r.total / grandTotal) * 100;
          var gempaPct = (r.gempa / r.total) * 100;
          var apiPct = (r.api / r.total) * 100;
          var row = document.createElement('div');
          row.className = 'arvi-region-row';
          row.innerHTML =
            '<div class="arvi-region-top">' +
              '<span class="arvi-region-name">' + r.name + '</span>' +
              '<span class="arvi-region-pct">' + fmtPct(pct) + '</span>' +
            '</div>' +
            '<div class="arvi-bar-track">' +
              '<div class="arvi-bar-seg" style="width:' + gempaPct + '%;background:#ff7a45;"></div>' +
              '<div class="arvi-bar-seg" style="width:' + apiPct + '%;background:' + apiColor + ';"></div>' +
            '</div>';
          listEl.appendChild(row);
        });
        if (!rows.length){
          listEl.innerHTML = '<p class="placeholder">No data to calculate yet.</p>';
        }
      }

      var totalGempa = collected.quakes.length;
      var totalApi = collected.fires.length;
      var totalAll = totalGempa + totalApi || 1;

      var canvas = document.getElementById('arviDonutChart');
      if (canvas && typeof Chart !== 'undefined'){
        if (donutChart) donutChart.destroy();
        donutChart = new Chart(canvas, {
          type: 'doughnut',
          data: {
            labels: ['Earthquakes', apiLabel],
            datasets: [{
              data: [totalGempa, totalApi],
              backgroundColor: ['#ff7a45', apiColor],
              borderColor: '#0b1122',
              borderWidth: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false }
            },
            cutout: '68%'
          }
        });
      }

      var capEl = document.getElementById('arviDonutCaption');
      if (capEl){
        capEl.innerHTML =
          '<span><i class="fa-solid fa-house-crack" style="color:#ff7a45;"></i> Earthquakes ' + fmtPct(totalGempa/totalAll*100) + '</span>' +
          '<span><i class="fa-solid fa-fire" style="color:' + apiColor + ';"></i> Fire hotspots ' + fmtPct(totalApi/totalAll*100) + '</span>';
      }

      renderMagTrendChart();
    }

    // ---- Tren magnitudo gempa per hari (30 hari terakhir) -----------------
    // Line = magnitudo maksimum hari itu, batang = jumlah gempa hari itu -
    // dua sumbu Y sekaligus biar "seberapa sering" dan "seberapa besar"
    // kelihatan dalam satu grafik, bukan cuma daftar/hitungan snapshot kayak
    // donut chart Event Distribution di atas. Dipanggil dari renderStats()
    // tiap kali data gempa diperbarui (initial load maupun polling), jadi
    // otomatis ikut ke-refresh tanpa perlu wiring terpisah.
    function renderMagTrendChart(){
      var canvas = document.getElementById('arviMagTrendChart');
      if (!canvas || typeof Chart === 'undefined') return;

      var selectEl = document.getElementById('arviMagTrendRegion');
      var regionId = selectEl ? selectEl.value : '';

      var filtered = collected.quakes.filter(function(q){
        if (!regionId) return true;
        var r = regionFor(q.lat, q.lon);
        return !!(r && r.id === regionId);
      });

      // Bangun daftar 30 hari penuh (kalender lokal) dulu, termasuk hari
      // TANPA gempa sama sekali - kalau cuma dorong hari yang ada datanya,
      // sumbu-X jadi rapat/miring dan bentuk trennya menyesatkan (hari sepi
      // gempa jadi keliatan seolah gak pernah ada).
      var days = [];
      for (var i = 29; i >= 0; i--){
        days.push(new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10));
      }
      var maxMagByDay = {}, countByDay = {};
      days.forEach(function(d){ maxMagByDay[d] = null; countByDay[d] = 0; });
      filtered.forEach(function(q){
        var day = new Date(q.time).toISOString().slice(0, 10);
        if (!(day in countByDay)) return; // di luar jendela 30 hari yang ditampilkan
        countByDay[day] += 1;
        if (maxMagByDay[day] === null || q.mag > maxMagByDay[day]) maxMagByDay[day] = q.mag;
      });

      var labels = days.map(function(d){
        return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      });
      var magData = days.map(function(d){ return maxMagByDay[d]; });
      var countData = days.map(function(d){ return countByDay[d]; });

      if (magTrendChart) magTrendChart.destroy();
      magTrendChart = new Chart(canvas, {
        data: {
          labels: labels,
          datasets: [
            {
              type: 'bar',
              label: 'Jumlah gempa/hari',
              data: countData,
              backgroundColor: 'rgba(95,211,196,0.35)',
              yAxisID: 'yCount',
              order: 2
            },
            {
              type: 'line',
              label: 'Magnitudo maksimum/hari',
              data: magData,
              borderColor: '#ff7a45',
              backgroundColor: '#ff7a45',
              spanGaps: true,
              tension: 0.25,
              pointRadius: 2.5,
              yAxisID: 'yMag',
              order: 1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false } },
          scales: {
            x: {
              ticks: { color: '#8493ae', maxRotation: 0, autoSkip: true, font: { size: 9 } },
              grid: { display: false }
            },
            yMag: {
              position: 'left', min: 0, suggestedMax: 7,
              ticks: { color: '#ff7a45', font: { size: 9 } },
              grid: { color: 'rgba(255,255,255,0.05)' }
            },
            yCount: {
              position: 'right', min: 0,
              ticks: { color: '#5fd3c4', font: { size: 9 }, precision: 0 },
              grid: { display: false }
            }
          }
        }
      });

      var trendCapEl = document.getElementById('arviMagTrendCaption');
      if (trendCapEl){
        var maxOverall = magData.reduce(function(m, v){ return (v !== null && v > m) ? v : m; }, 0);
        var regionLabel = 'Indonesia';
        if (regionId){
          var match = REGIONS.filter(function(r){ return r.id === regionId; })[0];
          if (match) regionLabel = match.name;
        }
        trendCapEl.innerHTML =
          '<span><i class="fa-solid fa-chart-line" style="color:#ff7a45;"></i> M maks/hari</span>' +
          '<span><i class="fa-solid fa-chart-column" style="color:#5fd3c4;"></i> Jumlah/hari</span>' +
          '<span style="opacity:.7;">' + filtered.length + ' gempa · ' + regionLabel + ' · tertinggi M' + maxOverall.toFixed(1) + '</span>';
      }
    }

    var magTrendRegionSelect = document.getElementById('arviMagTrendRegion');
    if (magTrendRegionSelect) magTrendRegionSelect.addEventListener('change', renderMagTrendChart);

    renderStats();
  });
})();
