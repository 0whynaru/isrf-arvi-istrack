(function(){
  'use strict';

  const C_KMS = 299792.458; // kecepatan cahaya, km/detik
  const DT_SEC = 0.25; // delta waktu untuk turunan numerik jarak (range-rate)

  const PRESETS = [
    { id:'voice', mhz:145.800, key:'mech.presetVoice' },
    { id:'aprs',  mhz:145.825, key:'mech.presetAprs' },
    { id:'xband', mhz:437.800, key:'mech.presetXband' }
  ];

  let satrec = null;
  let tleSource = '';
  let observer = null; // {lat, lon, alt(km)}
  let freqMHz = PRESETS[0].mhz;
  let tickTimer = null;
  let chart = null;
  const chartPoints = [];
  const CHART_MAX_POINTS = 90;

  const $ = (id)=>document.getElementById(id);

  function fmt(n, d){
    if(n === null || n === undefined || isNaN(n)) return '--';
    return n.toLocaleString('id-ID', { minimumFractionDigits:d, maximumFractionDigits:d });
  }

  async function fetchTLE(){
    try{
      const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544/tles');
      if(!res.ok) throw new Error('wheretheiss gagal');
      const data = await res.json();
      satrec = satellite.twoline2satrec(data.line1, data.line2);
      tleSource = 'wheretheiss.at';
      return true;
    }catch(e){
      try{
        const res2 = await fetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE');
        if(!res2.ok) throw new Error('celestrak gagal');
        const text = await res2.text();
        const lines = text.trim().split('\n').map(l=>l.trim());
        const l1 = lines.find(l=>l.startsWith('1 '));
        const l2 = lines.find(l=>l.startsWith('2 '));
        if(!l1 || !l2) throw new Error('format TLE tidak dikenali');
        satrec = satellite.twoline2satrec(l1, l2);
        tleSource = 'CelesTrak';
        return true;
      }catch(e2){
        console.warn('Gagal ambil TLE ISS:', e, e2);
        return false;
      }
    }
  }

  function rangeKmAt(date){
    const eci = ISSAstro.propagateEci(satrec, date);
    if(!eci) return null;
    const gmst = satellite.gstime(date);
    const ecf = satellite.eciToEcf(eci, gmst);
    const obsRad = {
      longitude: observer.lon * ISSAstro.DEG2RAD,
      latitude: observer.lat * ISSAstro.DEG2RAD,
      height: observer.alt || 0
    };
    const look = satellite.ecfToLookAngles(obsRad, ecf);
    return { rangeKm: look.rangeSat, azDeg: ((look.azimuth*ISSAstro.RAD2DEG)%360+360)%360, elDeg: look.elevation*ISSAstro.RAD2DEG };
  }

  function computeDoppler(date){
    const mid = rangeKmAt(date);
    if(!mid) return null;
    const before = rangeKmAt(new Date(date.getTime() - (DT_SEC/2)*1000));
    const after = rangeKmAt(new Date(date.getTime() + (DT_SEC/2)*1000));
    if(!before || !after) return null;

    const rangeRateKmS = (after.rangeKm - before.rangeKm) / DT_SEC; // + = menjauh, - = mendekat
    const f0Hz = freqMHz * 1e6;
    const shiftHz = -f0Hz * (rangeRateKmS / C_KMS);
    const receivedHz = f0Hz + shiftHz;

    return {
      rangeKm: mid.rangeKm,
      azDeg: mid.azDeg,
      elDeg: mid.elDeg,
      rangeRateKmS,
      shiftHz,
      receivedHz,
      f0Hz
    };
  }

  function renderPresets(){
    const wrap = $('mechFreqPresets');
    if(!wrap) return;
    wrap.innerHTML = '';
    PRESETS.forEach(p=>{
      const btn = document.createElement('button');
      btn.className = 'unit-toggle-btn';
      btn.dataset.mhz = String(p.mhz);
      btn.setAttribute('data-i18n', p.key);
      btn.textContent = (window.I18N ? I18N.t(p.key) : p.id) + ' · ' + p.mhz.toFixed(3) + ' MHz';
      if(p.mhz === freqMHz) btn.classList.add('active');
      btn.addEventListener('click', ()=>{
        freqMHz = p.mhz;
        $('mechFreqCustom').value = p.mhz.toFixed(3);
        wrap.querySelectorAll('.unit-toggle-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
      });
      wrap.appendChild(btn);
    });
  }

  function initChart(){
    const canvas = $('mechDopplerChart');
    if(!canvas || typeof Chart === 'undefined') return;
    chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: '#5fd3c4',
          backgroundColor: 'rgba(95,211,196,0.12)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          fill: true
        }]
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { display: false },
          y: {
            ticks: { color: '#7d8aa3', font: { family:'IBM Plex Mono', size:10 } },
            grid: { color: 'rgba(255,255,255,0.06)' }
          }
        },
        plugins: { legend: { display:false } }
      }
    });
  }

  function pushChartPoint(shiftHz){
    if(!chart) return;
    chartPoints.push(shiftHz);
    if(chartPoints.length > CHART_MAX_POINTS) chartPoints.shift();
    chart.data.labels = chartPoints.map((_,i)=>i);
    chart.data.datasets[0].data = chartPoints.map(v=>v/1000); // kHz
    chart.update('none');
  }

  function setStatus(text, cls){
    const el = $('mechStatus');
    if(!el) return;
    el.textContent = text;
    el.className = 'status mech-status-badge ' + (cls||'');
  }

  function tick(){
    if(!satrec || !observer){ return; }
    const now = new Date();
    const d = computeDoppler(now);
    if(!d) return;

    const visible = d.elDeg > 0;
    setStatus(
      visible
        ? (window.I18N ? I18N.t('mech.statusVisible') : 'Di atas horizon')
        : (window.I18N ? I18N.t('mech.statusHidden') : 'Di bawah horizon'),
      visible ? 'is-visible' : 'is-hidden'
    );

    const card = $('mechReadoutGrid');
    if(card) card.classList.toggle('mech-dim', !visible);

    $('mechRange').innerHTML = fmt(d.rangeKm,0) + '<span class="unit">km</span>';
    $('mechElev').innerHTML = fmt(d.elDeg,1) + '<span class="unit">°</span>';
    $('mechRadialVel').innerHTML = fmt(Math.abs(d.rangeRateKmS*3600),0) + '<span class="unit">km/jam</span>';
    $('mechRadialDir').textContent = d.rangeRateKmS < 0
      ? (window.I18N ? I18N.t('mech.approaching') : 'Mendekat')
      : (window.I18N ? I18N.t('mech.receding') : 'Menjauh');
    $('mechRadialDir').className = 'mech-dir ' + (d.rangeRateKmS < 0 ? 'approaching' : 'receding');

    $('mechBaseFreq').textContent = freqMHz.toFixed(3) + ' MHz';
    $('mechShiftHz').textContent = (d.shiftHz >= 0 ? '+' : '') + fmt(d.shiftHz,0) + ' Hz';
    $('mechShiftHz').className = 'value ' + (d.shiftHz >= 0 ? 'cyan' : 'ember');
    $('mechReceivedFreq').innerHTML = fmt(d.receivedHz/1e6, 6) + '<span class="unit">MHz</span>';

    pushChartPoint(d.shiftHz);
  }

  function startTicking(){
    if(tickTimer) clearInterval(tickTimer);
    tick();
    tickTimer = setInterval(tick, 1000);
  }

  function requestLocation(){
    const btn = $('mechLocateBtn');
    const manual = $('mechManualLoc');
    if(!navigator.geolocation){
      if(manual) manual.classList.remove('hidden');
      return;
    }
    btn.disabled = true;
    btn.textContent = (window.I18N ? I18N.t('js.requestingPermission') : 'Meminta izin…');
    navigator.geolocation.getCurrentPosition(pos=>{
      observer = { lat: pos.coords.latitude, lon: pos.coords.longitude, alt: 0 };
      btn.classList.add('hidden');
      $('mechLocLabel').textContent = fmt(observer.lat,3) + '°, ' + fmt(observer.lon,3) + '°';
      $('mechLocRow').classList.remove('hidden');
      startTicking();
    }, ()=>{
      btn.disabled = false;
      btn.textContent = (window.I18N ? I18N.t('js.tryAgain') : 'Coba lagi');
      if(manual) manual.classList.remove('hidden');
    }, { enableHighAccuracy:false, timeout:10000 });
  }

  function setupManualLocation(){
    const form = $('mechManualForm');
    if(!form) return;
    form.addEventListener('submit', (e)=>{
      e.preventDefault();
      const lat = parseFloat($('mechManualLat').value);
      const lon = parseFloat($('mechManualLon').value);
      if(isNaN(lat) || isNaN(lon)) return;
      observer = { lat, lon, alt: 0 };
      $('mechLocLabel').textContent = fmt(lat,3) + '°, ' + fmt(lon,3) + '°';
      $('mechLocRow').classList.remove('hidden');
      $('mechLocateBtn').classList.add('hidden');
      $('mechManualLoc').classList.add('hidden');
      startTicking();
    });
  }

  async function init(){
    renderPresets();
    initChart();
    setupManualLocation();

    const customInput = $('mechFreqCustom');
    if(customInput){
      customInput.value = freqMHz.toFixed(3);
      customInput.addEventListener('change', ()=>{
        const v = parseFloat(customInput.value);
        if(!isNaN(v) && v > 0){
          freqMHz = v;
          document.querySelectorAll('#mechFreqPresets .unit-toggle-btn').forEach(b=>{
            b.classList.toggle('active', parseFloat(b.dataset.mhz) === v);
          });
        }
      });
    }

    const locateBtn = $('mechLocateBtn');
    if(locateBtn) locateBtn.addEventListener('click', requestLocation);

    setStatus(window.I18N ? I18N.t('mech.loadingTle') : 'Memuat data orbit ISS…', '');
    const ok = await fetchTLE();
    if(!ok){
      setStatus(window.I18N ? I18N.t('mech.tleFailed') : 'Gagal memuat data orbit ISS', 'is-error');
      return;
    }
    const srcEl = $('mechTleSource');
    if(srcEl) srcEl.textContent = tleSource;
    setStatus(window.I18N ? I18N.t('mech.waitingLocation') : 'Menunggu lokasimu…', '');
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
