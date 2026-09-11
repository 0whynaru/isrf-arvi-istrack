// Onboarding consent modal for the ISFR-ARVI earthquake background alarm.
// Only used on index.html. Waits for the "istrack:appLoaded" event
// (dispatched by script.js right when the globe loading screen finishes)
// so it never overlaps the loading animation, then shows a custom,
// site-styled modal asking for consent BEFORE touching the browser's own
// native permission prompt.
//
// Why two steps instead of just calling Notification.requestPermission()
// directly on page load: browsers only let a site ask for notification
// permission a limited number of times before silently treating further
// requests as denied / offering to auto-block. Asking cold, on first
// paint, with no context, is the single worst time to spend that - most
// people reflexively hit "Block". A custom modal first (which can't be
// permanently blocked by the OS) lets us explain WHY, and only spends the
// real browser prompt on people who already said yes here.
//
// Shows at most once per browser (tracked in localStorage) - whether the
// person accepts or declines. They can still turn it on later any time
// from Pengaturan (settings.html).

(function(){
  var SEEN_KEY = 'istrack_quake_consent_seen';

  function alreadyHandled(){
    // Don't nag someone who's already subscribed, already permanently
    // denied at the browser level (asking again is pointless - it won't
    // even show a real prompt), or who has already seen+dismissed this
    // modal before.
    if (window.ISTrackPushAlarm && window.ISTrackPushAlarm.getPref() &&
        window.ISTrackPushAlarm.permission() === 'granted') return true;
    if (window.ISTrackPushAlarm && window.ISTrackPushAlarm.permission() === 'denied') return true;
    try { return localStorage.getItem(SEEN_KEY) === '1'; } catch(e){ return false; }
  }
  function markSeen(){ try { localStorage.setItem(SEEN_KEY, '1'); } catch(e){} }

  function buildModal(){
    var overlay = document.createElement('div');
    overlay.id = 'quakeConsentOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'quakeConsentTitle');
    overlay.innerHTML =
      '<style>' +
      '#quakeConsentOverlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
        'background:rgba(5,8,14,.72);backdrop-filter:blur(3px);padding:20px;opacity:0;transition:opacity .25s ease;}' +
      '#quakeConsentOverlay.show{opacity:1;}' +
      '#quakeConsentCard{width:100%;max-width:420px;background:#131a26;border:1px solid #26324a;border-radius:16px;' +
        'padding:26px;color:#e8edf7;font-family:"Space Grotesk","IBM Plex Mono",monospace,sans-serif;' +
        'transform:translateY(12px);transition:transform .25s ease;box-shadow:0 20px 60px rgba(0,0,0,.5);}' +
      '#quakeConsentOverlay.show #quakeConsentCard{transform:translateY(0);}' +
      '#quakeConsentCard h2{margin:0 0 8px;font-size:1.1rem;display:flex;align-items:center;gap:8px;}' +
      '#quakeConsentCard p{margin:0 0 12px;font-size:.85rem;line-height:1.55;color:#b7c0d4;}' +
      '#quakeConsentCard .qc-btns{display:flex;gap:10px;margin-top:18px;}' +
      '#quakeConsentCard button{flex:1;padding:12px;border-radius:10px;border:none;font:inherit;font-size:.88rem;' +
        'font-weight:600;cursor:pointer;}' +
      '#qcAccept{background:#ff4d4d;color:#fff;}' +
      '#qcDecline{background:#1c2536;color:#b7c0d4;border:1px solid #26324a !important;}' +
      '#quakeConsentCard .qc-note{font-size:.72rem;color:#6f7890;margin-top:14px;margin-bottom:0;}' +
      '#quakeConsentCard .qc-status{font-size:.78rem;margin-top:10px;display:none;}' +
      '#quakeConsentCard .qc-status.show{display:block;}' +
      '</style>' +
      '<div id="quakeConsentCard">' +
        '<h2>🌏 Alarm Gempa ISFR-ARVI</h2>' +
        '<p>ISTrack bisa ngirim notifikasi otomatis kalau ada gempa signifikan di Indonesia (data BMKG/USGS), langsung ke perangkat kamu - walau lagi buka halaman lain atau HP terkunci.</p>' +
        '<p>Aktifkan notifikasi ini sekarang?</p>' +
        '<div class="qc-btns">' +
          '<button type="button" id="qcDecline">Nanti aja</button>' +
          '<button type="button" id="qcAccept">Aktifkan</button>' +
        '</div>' +
        '<div class="qc-status" id="qcStatus"></div>' +
        '<p class="qc-note">Bisa diaktifkan/dimatikan kapan aja lewat halaman Pengaturan.</p>' +
      '</div>';
    return overlay;
  }

  function closeModal(overlay){
    overlay.classList.remove('show');
    setTimeout(function(){ if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 250);
  }

  function showModal(){
    if (alreadyHandled()) return;
    if (!window.ISTrackPushAlarm || !window.ISTrackPushAlarm.isSupported) return;

    var overlay = buildModal();
    document.body.appendChild(overlay);
    requestAnimationFrame(function(){ overlay.classList.add('show'); });

    var statusEl = overlay.querySelector('#qcStatus');
    var acceptBtn = overlay.querySelector('#qcAccept');
    var declineBtn = overlay.querySelector('#qcDecline');

    declineBtn.addEventListener('click', function(){
      markSeen();
      closeModal(overlay);
    });

    acceptBtn.addEventListener('click', function(){
      acceptBtn.disabled = true;
      declineBtn.disabled = true;
      statusEl.className = 'qc-status show';
      statusEl.textContent = 'Meminta izin notifikasi...';

      // THIS is the step that actually pops the browser's own native
      // permission prompt ("Allow notifications?") - the real
      // confirmation-to-the-device the modal above was building up to.
      window.ISTrackPushAlarm.enable().then(function(result){
        markSeen();
        if (result.ok){
          statusEl.textContent = 'Aktif! Kamu akan dapat alarm gempa dari ISFR-ARVI.';
          setTimeout(function(){ closeModal(overlay); }, 1400);
        } else if (result.reason === 'denied'){
          statusEl.textContent = 'Izin ditolak - kamu bisa coba lagi kapan aja lewat Pengaturan.';
          setTimeout(function(){ closeModal(overlay); }, 2200);
        } else {
          statusEl.textContent = 'Gagal mengaktifkan - coba lagi lewat Pengaturan.';
          setTimeout(function(){ closeModal(overlay); }, 2200);
        }
      });
    });
  }

  window.addEventListener('istrack:appLoaded', function(){
    // Small delay so the modal doesn't visually collide with the loading
    // screen's own fade-out transition.
    setTimeout(showModal, 900);
  });
})();
