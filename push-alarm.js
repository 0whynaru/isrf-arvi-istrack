// Core "enable earthquake background alarm" logic, shared across the whole
// site. Two things use this:
//   1. The toggle on settings.html (#istrackPushAlarmToggle /
//      #istrackPushAlarmStatus) - wired up automatically below if those
//      elements exist on the page.
//   2. The onboarding consent modal on index.html (quake-consent.js), which
//      calls window.ISTrackPushAlarm.enable()/disable() directly - no
//      toggle element needed for that.
//
// Important: this uses the SAME localStorage key and the SAME backend
// endpoint (/.netlify/functions/subscribe) as arvi.js's own toggle, so
// turning it on from ANY of these three places represents one single
// subscription - they all just read the real Notification permission +
// this shared flag on load, so they stay in sync automatically.

(function(){
  var VAPID_PUBLIC_KEY = 'BBjqUCVLpF-kLlH9gwkwDCvxUNl01LvFN5R1zYA1zcDwx2GUskZBZ-GdIoIZ-l5vVFR3DrGd5qEuqxcj_GKCMNI';
  var PUSH_BG_PREF_STORAGE = 'istrack_arvi_push_bg_pref';

  var supported = 'serviceWorker' in navigator && 'PushManager' in window && typeof window.Notification !== 'undefined';

  function urlBase64ToUint8Array(base64String){
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function getPref(){ try { return localStorage.getItem(PUSH_BG_PREF_STORAGE) === '1'; } catch(e){ return false; } }
  function setPref(on){ try { localStorage.setItem(PUSH_BG_PREF_STORAGE, on ? '1' : '0'); } catch(e){} }

  // Best-effort, one-shot location grab (only if the browser already has
  // permission - never prompts on its own) so "quake near you" distance
  // filtering works no matter which page/flow subscribed the user.
  function getLocationBestEffort(){
    return new Promise(function(resolve){
      if (!('permissions' in navigator) || !navigator.geolocation){ resolve(null); return; }
      navigator.permissions.query({ name: 'geolocation' }).then(function(status){
        if (status.state !== 'granted'){ resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
          function(pos){ resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }); },
          function(){ resolve(null); },
          { timeout: 4000 }
        );
      }).catch(function(){ resolve(null); });
    });
  }

  function postSubscription(action, subscription, loc){
    var body = { action: action };
    if (action === 'subscribe'){
      body.subscription = subscription.toJSON ? subscription.toJSON() : subscription;
      if (loc){ body.lat = loc.lat; body.lon = loc.lon; }
    } else {
      body.endpoint = subscription.endpoint || subscription;
    }
    return fetch('/.netlify/functions/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(function(){ /* backend unreachable - fail quietly */ });
  }

  // enable()/disable() resolve with a small result object instead of
  // throwing, so callers (toggle UI, consent modal) can each show their own
  // messaging without duplicating try/catch handling.
  function enable(){
    if (!supported){
      return Promise.resolve({ ok: false, reason: 'unsupported' });
    }
    return navigator.serviceWorker.register('/sw.js').then(function(reg){
      return Notification.requestPermission().then(function(perm){
        if (perm !== 'granted'){
          setPref(false);
          return { ok: false, reason: 'denied' };
        }
        return reg.pushManager.getSubscription().then(function(existing){
          return existing || reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
          });
        }).then(function(sub){
          return getLocationBestEffort().then(function(loc){
            return postSubscription('subscribe', sub, loc);
          });
        }).then(function(){
          setPref(true);
          return { ok: true };
        });
      });
    }).catch(function(err){
      setPref(false);
      return { ok: false, reason: 'error', error: err };
    });
  }

  function disable(){
    setPref(false);
    if (!supported) return Promise.resolve({ ok: true });
    return navigator.serviceWorker.getRegistration().then(function(reg){
      if (!reg) return;
      return reg.pushManager.getSubscription().then(function(sub){
        if (!sub) return;
        return postSubscription('unsubscribe', sub).then(function(){ return sub.unsubscribe(); });
      });
    }).then(function(){ return { ok: true }; }).catch(function(){ return { ok: true }; });
  }

  // Exposed globally so other scripts (quake-consent.js) can trigger the
  // exact same subscribe/unsubscribe flow without re-implementing it.
  window.ISTrackPushAlarm = {
    enable: enable,
    disable: disable,
    getPref: getPref,
    isSupported: supported,
    permission: function(){ return supported ? Notification.permission : 'unsupported'; }
  };

  // ---- Optional UI wiring: only runs if this page has the toggle --------
  var toggle = document.getElementById('istrackPushAlarmToggle');
  var statusEl = document.getElementById('istrackPushAlarmStatus');
  if (!toggle) return;

  function setStatus(text, kind){
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.remove('is-live', 'is-error');
    if (kind) statusEl.classList.add(kind);
  }

  function refreshFromResult(result){
    if (result.ok){
      toggle.checked = true;
      setStatus('Aktif - kamu akan dapat alarm gempa walau lagi di halaman lain / tab tertutup.', 'is-live');
    } else {
      toggle.checked = false;
      if (result.reason === 'unsupported') setStatus('Browser ini tidak mendukung push notification.', 'is-error');
      else if (result.reason === 'denied') setStatus('Izin notifikasi ditolak - aktifkan lewat pengaturan situs di browser.', 'is-error');
      else setStatus('Gagal mengaktifkan' + (result.error && result.error.message ? ': ' + result.error.message : '') + '.', 'is-error');
    }
  }

  if (!supported){
    toggle.disabled = true;
    setStatus('Browser ini tidak mendukung push notification.', 'is-error');
  } else {
    toggle.checked = getPref() && Notification.permission === 'granted';
    if (getPref() && Notification.permission === 'granted'){
      setStatus('Aktif - kamu akan dapat alarm gempa walau lagi di halaman lain / tab tertutup.', 'is-live');
      enable(); // silently confirms the server-side subscription still exists
    } else if (Notification.permission === 'denied'){
      setStatus('Izin notifikasi ditolak - aktifkan lewat pengaturan situs di browser.', 'is-error');
    } else {
      setStatus('Nonaktif. Nyalakan untuk dapat alarm gempa (ISFR-ARVI) di semua halaman ISTrack.');
    }
  }

  toggle.addEventListener('change', function(){
    if (toggle.checked) enable().then(refreshFromResult);
    else disable().then(function(){ setStatus('Nonaktif - kamu tidak akan menerima alarm gempa di latar belakang.'); });
  });
})();
