const trail = [];
const MAX_TRAIL = 60;
let issTimer = null;
let running = true;
let lastKnownPos = null;
let lastWeatherFetchAt = 0;
let satrec = null;
let observer = null;
const tleStore = {};
let tleSelectedKey = 'iss';
let lastGeoFetchAt = 0;
let historyChart = null;
let lastHistorySampleAt = 0;

let unitSystem = localStorage.getItem('istrack_units') === 'imperial' ? 'imperial' : 'metric';
const KM_TO_MI = 0.621371;
function toDist(km){ return unitSystem === 'imperial' ? km * KM_TO_MI : km; }
function toSpeed(kmh){ return unitSystem === 'imperial' ? kmh * KM_TO_MI : kmh; }
function distUnitLabel(){ return unitSystem === 'imperial' ? 'mi' : 'km'; }
function speedUnitLabel(){ return unitSystem === 'imperial' ? 'mph' : 'km/jam'; }

const SPEED_REF_ROUTE_KM = 800;
const SPEED_REF_ROUTE_LABEL = 'Jakarta–Surabaya';

function autoFitText(el, minPx){
  if(!el) return;
  minPx = minPx || 9;
  if(!el.dataset.autofitBase){
    el.dataset.autofitBase = parseFloat(getComputedStyle(el).fontSize) || 13;
  }
  const base = parseFloat(el.dataset.autofitBase);
  let size = base;
  el.style.fontSize = size + 'px';
  let guard = 0;
  while(el.scrollWidth > el.clientWidth && size > minPx && guard < 60){
    size -= 0.5;
    el.style.fontSize = size + 'px';
    guard++;
  }
}
function autoFitAll(selector, minPx){
  document.querySelectorAll(selector).forEach(el=>autoFitText(el, minPx));
}

let _autoFitResizeTimer = null;
window.addEventListener('resize', ()=>{
  clearTimeout(_autoFitResizeTimer);
  _autoFitResizeTimer = setTimeout(()=>{
    autoFitAll('.pass-time, .pass-date', 9.5);
  }, 150);
});

function updateIssWindowView(isDay){
  const skyEl = document.getElementById('issWindowSky');
  const stateEl = document.getElementById('issWindowState');
  if(!skyEl || !stateEl) return;
  skyEl.classList.toggle('is-day', isDay);
  skyEl.classList.toggle('is-night', !isDay);
  stateEl.textContent = isDay
    ? (window.I18N ? I18N.t('js.visDaylight') : 'Tersinari matahari')
    : (window.I18N ? I18N.t('js.visNight') : 'Melintasi bayangan Bumi');
}

let lastTelemetry = null;
let lastDistKm = null;
let lastWeatherRaw = null;
const lastOtherSatAltKm = {};
const lastOtherSatVelKmh = {};
const lastOtherSatPos = {};

const OTHER_SATS = {
  tiangong: { catnr: 48274, label: 'Tiangong (CSS)', color: 0xffcc4d, colorCss: '#ffcc4d', cbColorCss: '#d65d00', flag: '🇨🇳', category: 'stasiun',
    wiki: { en: 'Tiangong_space_station', id: 'Stasiun_luar_angkasa_Tiangong' } },
  hubble:   { catnr: 20580, label: 'Hubble Space Telescope', color: 0xb98bf0, colorCss: '#b98bf0', cbColorCss: '#94386b', flag: '🇺🇸', category: 'teleskop',
    wiki: { en: 'Hubble_Space_Telescope', id: 'Teleskop_Antariksa_Hubble' } },
  noaa18:   { catnr: 28654, label: 'NOAA-18', color: 0x7cd992, colorCss: '#7cd992', cbColorCss: '#007052', flag: '🇺🇸', category: 'cuaca',
    wiki: { en: 'NOAA-18' } },
  noaa19:   { catnr: 33591, label: 'NOAA-19', color: 0x5fbf77, colorCss: '#5fbf77', cbColorCss: '#00916a', flag: '🇺🇸', category: 'cuaca',
    wiki: { en: 'NOAA-19' } },
  noaa20:   { catnr: 43013, label: 'NOAA-20 (JPSS-1)', color: 0x3fae66, colorCss: '#3fae66', cbColorCss: '#00b182', flag: '🇺🇸', category: 'cuaca',
    wiki: { en: 'NOAA-20' } },
  starlink1008: { catnr: 44714, label: 'Starlink-1008', color: 0x5b9bff, colorCss: '#5b9bff', cbColorCss: '#005485', flag: '<i class="fa-solid fa-satellite-dish"></i>', category: 'komunikasi',
    wiki: { en: 'Starlink' } },
  starlink1012: { catnr: 44718, label: 'Starlink-1012', color: 0x3f7fe0, colorCss: '#3f7fe0', cbColorCss: '#007ec7', flag: '<i class="fa-solid fa-satellite-dish"></i>', category: 'komunikasi',
    wiki: { en: 'Starlink' } },

  terra: { catnr: 25994, label: 'Terra (EOS AM-1)', color: 0x8bc98f, colorCss: '#8bc98f', cbColorCss: '#36a3e2', flag: '🇺🇸', category: 'sains',
    wiki: { en: 'Terra_(satellite)' } },
  aqua: { catnr: 27424, label: 'Aqua (EOS PM-1)', color: 0x4fc3f7, colorCss: '#4fc3f7', cbColorCss: '#47abe5', flag: '🇺🇸', category: 'sains',
    wiki: { en: 'Aqua_(satellite)' } },
  landsat8: { catnr: 39084, label: 'Landsat 8', color: 0xd4a054, colorCss: '#d4a054', cbColorCss: '#59b3e7', flag: '🇺🇸', category: 'sains',
    wiki: { en: 'Landsat_8' } },
  landsat9: { catnr: 49260, label: 'Landsat 9', color: 0xc98b3f, colorCss: '#c98b3f', cbColorCss: '#6abbea', flag: '🇺🇸', category: 'sains',
    wiki: { en: 'Landsat_9' } },
  sentinel2a: { catnr: 40697, label: 'Sentinel-2A', color: 0x4ecdc4, colorCss: '#4ecdc4', cbColorCss: '#7bc3ec', flag: '🇪🇺', category: 'sains',
    wiki: { en: 'Sentinel-2A' } },

  chandra: { catnr: 25867, label: 'Chandra X-ray Observatory', color: 0xff6b9d, colorCss: '#ff6b9d', cbColorCss: '#bb4c89', flag: '🇺🇸', category: 'teleskop',
    wiki: { en: 'Chandra_X-ray_Observatory', id: 'Chandra_X-ray_Observatory' } },

  goes16: { catnr: 41866, label: 'GOES-16', color: 0xffa64d, colorCss: '#ffa64d', cbColorCss: '#00d199', flag: '🇺🇸', category: 'cuaca',
    wiki: { en: 'GOES-16' } },

  gpsbiif10: { catnr: 40730, label: 'GPS BIIF-10 (PRN 08)', color: 0xffe066, colorCss: '#ffe066', cbColorCss: '#ecdd13', flag: '🇺🇸', category: 'navigasi',
    wiki: { en: 'GPS_Block_IIF' } },
  galileo5: { catnr: 40128, label: 'Galileo 5 (GSAT0201)', color: 0xffc93f, colorCss: '#ffc93f', cbColorCss: '#f0e547', flag: '🇪🇺', category: 'navigasi',
    wiki: { en: 'Galileo_(satellite_navigation)' } },

  himawari9: { catnr: 41836, label: 'Himawari-9', color: 0xffb570, colorCss: '#ffb570', cbColorCss: '#00f1b1', flag: '🇯🇵', category: 'cuaca',
    wiki: { en: 'Himawari_9' } },
  aura: { catnr: 28376, label: 'Aura (EOS CH-1)', color: 0x7ee8fa, colorCss: '#7ee8fa', cbColorCss: '#8ccbef', flag: '🇺🇸', category: 'sains',
    wiki: { en: 'Aura_(satellite)' } },
  icesat2: { catnr: 43613, label: 'ICESat-2', color: 0xa8e063, colorCss: '#a8e063', cbColorCss: '#9dd2f1', flag: '🇺🇸', category: 'sains',
    wiki: { en: 'ICESat-2' } },
  nustar: { catnr: 38358, label: 'NuSTAR', color: 0xc9a0ff, colorCss: '#c9a0ff', cbColorCss: '#cc77a6', flag: '🇺🇸', category: 'teleskop',
    wiki: { en: 'NuSTAR' } },
  fermi: { catnr: 33053, label: 'Fermi Gamma-ray Space Telescope', color: 0x9b7fd4, colorCss: '#9b7fd4', cbColorCss: '#dca3c2', flag: '🇺🇸', category: 'teleskop',
    wiki: { en: 'Fermi_Gamma-ray_Space_Telescope' } },

  suominpp: { catnr: 37849, label: 'Suomi NPP', color: 0xffcf80, colorCss: '#ffcf80', cbColorCss: '#13ffc0', flag: '🇺🇸', category: 'cuaca',
    wiki: { en: 'Suomi_NPP', id: 'Suomi_NPP' } },
  goes19: { catnr: 60133, label: 'GOES-19', color: 0xff8c42, colorCss: '#ff8c42', cbColorCss: '#33ffc9', flag: '🇺🇸', category: 'cuaca',
    wiki: { en: 'GOES-19' } },
  iridium106: { catnr: 41917, label: 'Iridium 106', color: 0x6fc2ff, colorCss: '#6fc2ff', cbColorCss: '#0aa5ff', flag: '<i class="fa-solid fa-satellite-dish"></i>', category: 'komunikasi',
    wiki: { en: 'Iridium_satellite_constellation' } },
  smap: { catnr: 40376, label: 'SMAP', color: 0x8fd9a8, colorCss: '#8fd9a8', cbColorCss: '#afdaf4', flag: '🇺🇸', category: 'sains',
    wiki: { en: 'Soil_Moisture_Active_Passive' } },
  beidou3m1: { catnr: 43001, label: 'BeiDou-3 M1', color: 0xef6c6c, colorCss: '#ef6c6c', cbColorCss: '#f4ec7b', flag: '🇨🇳', category: 'navigasi',
    wiki: { en: 'BeiDou-3_M1' } },

  lapana2: { catnr: 40931, label: 'LAPAN-A2', color: 0xef4444, colorCss: '#ef4444', cbColorCss: '#ad7600', flag: '🇮🇩', category: 'indonesia',
    wiki: { en: 'LAPAN-A2' } },
  telkom3s: { catnr: 41944, label: 'Telkom-3S', color: 0xf97316, colorCss: '#f97316', cbColorCss: '#dd9700', flag: '🇮🇩', category: 'indonesia',
    wiki: { en: 'Telkom-3S' } },
  palapad: { catnr: 35812, label: 'Palapa D', color: 0xfacc15, colorCss: '#facc15', cbColorCss: '#ffb30e', flag: '🇮🇩', category: 'indonesia',
    wiki: { en: 'Palapa' } },
  nusantarasatu: { catnr: 44048, label: 'Nusantara Satu', color: 0xfb7185, colorCss: '#fb7185', cbColorCss: '#ffc23d', flag: '🇮🇩', category: 'indonesia',
    wiki: { en: 'Nusantara_Satu' } }
};

function isColorblindMode(){
  try{ return localStorage.getItem('istrack_a11y_colorblind') === '1'; }catch(e){ return false; }
}
function applyColorblindPalette(){
  if(!isColorblindMode()) return;
  Object.keys(OTHER_SATS).forEach(key=>{
    const cfg = OTHER_SATS[key];
    if(cfg && cfg.cbColorCss){
      cfg.colorCss = cfg.cbColorCss;
      cfg.color = parseInt(cfg.cbColorCss.slice(1), 16);
    }
  });
}
applyColorblindPalette();

const ISS_WIKI = { en: 'International_Space_Station', id: 'Stasiun_Luar_Angkasa_Internasional' };
const SAT_CATEGORIES = [
  { key: 'all', get label(){ return I18N.t('js.cat.all'); } },
  { key: 'indonesia', get label(){ return I18N.t('js.cat.indonesia'); } },
  { key: 'stasiun', get label(){ return I18N.t('js.cat.stasiun'); } },
  { key: 'teleskop', get label(){ return I18N.t('js.cat.teleskop'); } },
  { key: 'cuaca', get label(){ return I18N.t('js.cat.cuaca'); } },
  { key: 'komunikasi', get label(){ return I18N.t('js.cat.komunikasi'); } },
  { key: 'sains', get label(){ return I18N.t('js.cat.sains'); } },
  { key: 'navigasi', get label(){ return I18N.t('js.cat.navigasi'); } },
  { key: 'custom', get label(){ return I18N.t('js.cat.custom'); } }
];
let activeSatFilter = 'all';
const otherSatState = {};

const ISS_CATNR = 25544;
const CUSTOM_SATS_STORAGE_KEY = 'istrack_custom_sats';
const CUSTOM_SAT_COLORS = [
  '#ff6b6b', '#4ecdc4', '#ffd93d', '#95e1d3', '#c7a4ff',
  '#ff9f68', '#6bcf7f', '#ff8fc7', '#7fd4ff', '#e0c068'
];

const CUSTOM_SAT_COLORS_CB = [
  '#49396a', '#534077', '#5c4785', '#654f92', '#6e569f',
  '#7860a9', '#846db0', '#8f7ab8', '#9a88bf', '#a595c6'
];
function colorForCustomSat(catnr){
  const n = Number(catnr) || 0;
  const list = isColorblindMode() ? CUSTOM_SAT_COLORS_CB : CUSTOM_SAT_COLORS;
  return list[n % list.length];
}
function loadCustomSatsRaw(){
  try{
    const raw = localStorage.getItem(CUSTOM_SATS_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  }catch(e){ return []; }
}
function saveCustomSatsRaw(list){
  try{ localStorage.setItem(CUSTOM_SATS_STORAGE_KEY, JSON.stringify(list)); }catch(e){}
}
function customSatKey(catnr){ return `custom_${catnr}`; }

function loadCustomSatsIntoOtherSats(){
  loadCustomSatsRaw().forEach(item=>{
    if(!item || !item.catnr || !item.label) return;
    const key = customSatKey(item.catnr);
    if(OTHER_SATS[key]) return;
    const colorCss = colorForCustomSat(item.catnr);
    OTHER_SATS[key] = {
      catnr: item.catnr,
      label: item.label,
      color: parseInt(colorCss.slice(1), 16),
      colorCss,
      flag: '<i class="fa-solid fa-satellite"></i>',
      category: 'custom',
      custom: true,
      wiki: { en: item.label }
    };
  });
}
loadCustomSatsIntoOtherSats();

const canvas = document.getElementById('stars');
const ctx = canvas.getContext('2d');
function sizeCanvas(){
  canvas.width = window.innerWidth;
  canvas.height = document.documentElement.scrollHeight;
}
function drawStars(){
  sizeCanvas();
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  const n = Math.floor((canvas.width*canvas.height)/6000);
  for(let i=0;i<n;i++){
    const x = Math.random()*canvas.width;
    const y = Math.random()*canvas.height;
    const r = Math.random()*1.2;
    ctx.fillStyle = `rgba(233,237,246,${Math.random()*0.6+0.1})`;
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fill();
  }
}
drawStars();
window.addEventListener('resize', drawStars);

const globeCanvas = document.getElementById('globe');
try{
  ISSGlobe.init(globeCanvas);
  new ResizeObserver(()=>ISSGlobe.resize()).observe(globeCanvas.parentElement);
}catch(err){
  globeCanvas.parentElement.innerHTML = '<p class="error-note">'+I18N.t('idx.globeUnavailable')+'</p>';
  globeVisualReady = true;
  tryHideAppLoading();
}

let globeVisualReady = false;
let firstIssRendered = false;
let appLoadingHidden = false;
const APP_LOADING_HARD_TIMEOUT_MS = 8000;

function tryHideAppLoading(){
  if(appLoadingHidden) return;
  if(!(globeVisualReady && firstIssRendered)) return;
  appLoadingHidden = true;
  const el = document.getElementById('appLoading');
  document.body.classList.remove('app-is-loading');
  // Lets other scripts (quake-consent.js) know the loading screen is
  // gone, so they can show their own modal without overlapping it.
  window.dispatchEvent(new CustomEvent('istrack:appLoaded'));
  if(!el) return;
  el.classList.add('app-loading-hide');
  el.addEventListener('transitionend', ()=>{ el.remove(); }, {once:true});

  setTimeout(()=>{ if(el.parentNode) el.remove(); }, 800);
}

if(window.ISSGlobe && ISSGlobe.onReady){
  ISSGlobe.onReady(()=>{ globeVisualReady = true; tryHideAppLoading(); });
} else {
  globeVisualReady = true;
}

setTimeout(()=>{
  globeVisualReady = true;
  firstIssRendered = true;
  tryHideAppLoading();
}, APP_LOADING_HARD_TIMEOUT_MS);

function renderISS(lat, lon){
  ISSGlobe.setISSPosition(lat, lon);
  ISSGlobe.setTrail(trail);
}

const groundTrackCanvas = document.getElementById('groundTrackCanvas');
const gtCtx = groundTrackCanvas ? groundTrackCanvas.getContext('2d') : null;

function lonLatToXY(lon, lat, w, h){
  return { x: ((lon+180)/360)*w, y: ((90-lat)/180)*h };
}

function renderGroundTrack(lat, lon){
  if(!gtCtx) return;
  const wrap = groundTrackCanvas.parentElement;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if(w===0||h===0) return;
  const dpr = Math.min(window.devicePixelRatio||1, 2);
  if(groundTrackCanvas.width !== w*dpr || groundTrackCanvas.height !== h*dpr){
    groundTrackCanvas.width = w*dpr;
    groundTrackCanvas.height = h*dpr;
  }
  gtCtx.setTransform(dpr,0,0,dpr,0,0);
  gtCtx.clearRect(0,0,w,h);

  gtCtx.strokeStyle = '#1c2744';
  gtCtx.lineWidth = 1;
  for(let lo=-180; lo<=180; lo+=30){
    const p = lonLatToXY(lo, 0, w, h);
    gtCtx.beginPath(); gtCtx.moveTo(p.x,0); gtCtx.lineTo(p.x,h); gtCtx.stroke();
  }
  for(let la=-60; la<=60; la+=30){
    const p = lonLatToXY(0, la, w, h);
    gtCtx.beginPath(); gtCtx.moveTo(0,p.y); gtCtx.lineTo(w,p.y); gtCtx.stroke();
  }

  gtCtx.strokeStyle = '#2a3a63';
  const eq = lonLatToXY(0,0,w,h);
  gtCtx.beginPath(); gtCtx.moveTo(0,eq.y); gtCtx.lineTo(w,eq.y); gtCtx.stroke();
  gtCtx.beginPath(); gtCtx.moveTo(eq.x,0); gtCtx.lineTo(eq.x,h); gtCtx.stroke();

  if(trail.length > 1){
    for(let i=1;i<trail.length;i++){
      const a = trail[i-1], b = trail[i];
      if(Math.abs(a.lon-b.lon) > 180) continue;
      const pa = lonLatToXY(a.lon, a.lat, w, h);
      const pb = lonLatToXY(b.lon, b.lat, w, h);
      gtCtx.strokeStyle = `rgba(255,122,69,${0.12 + (i/trail.length)*0.5})`;
      gtCtx.lineWidth = 1.8;
      gtCtx.beginPath(); gtCtx.moveTo(pa.x,pa.y); gtCtx.lineTo(pb.x,pb.y); gtCtx.stroke();
    }
  }

  const cur = lonLatToXY(lon, lat, w, h);
  gtCtx.beginPath();
  gtCtx.fillStyle = 'rgba(255,122,69,0.25)';
  gtCtx.arc(cur.x, cur.y, 7, 0, Math.PI*2);
  gtCtx.fill();
  gtCtx.beginPath();
  gtCtx.fillStyle = '#ff7a45';
  gtCtx.arc(cur.x, cur.y, 3.2, 0, Math.PI*2);
  gtCtx.fill();
}
window.addEventListener('resize', ()=>{ if(lastKnownPos) renderGroundTrack(lastKnownPos.lat, lastKnownPos.lon); });

function requestLocation(onGranted, onDenied){
  if(!navigator.geolocation){
    if(onDenied) onDenied({message:I18N.t('idx.geoNotSupported')});
    return;
  }
  navigator.geolocation.getCurrentPosition(pos=>{
    observer = { lat: pos.coords.latitude, lon: pos.coords.longitude, alt: 0 };
    try{ ISSGlobe.setObserver(observer.lat, observer.lon); }catch(e){}
    if(onGranted) onGranted(observer);
  }, err=>{
    if(onDenied) onDenied(err);
  }, { enableHighAccuracy:false, timeout:10000 });
}

function toECEF(latDeg, lonDeg, altKm){
  const R = 6378.137;
  const lat = latDeg*Math.PI/180, lon = lonDeg*Math.PI/180;
  const r = R + altKm;
  return {
    x: r*Math.cos(lat)*Math.cos(lon),
    y: r*Math.cos(lat)*Math.sin(lon),
    z: r*Math.sin(lat)
  };
}
function distanceToISSKm(issLat, issLon, issAltKm){
  if(!observer) return null;
  const a = toECEF(observer.lat, observer.lon, 0);
  const b = toECEF(issLat, issLon, issAltKm);
  return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
}

const distanceLocateBtn = document.getElementById('distanceLocateBtn');
distanceLocateBtn.addEventListener('click', ()=>{
  distanceLocateBtn.disabled = true;
  distanceLocateBtn.textContent = I18N.t('js.requestingPermission');
  requestLocation(()=>{
    distanceLocateBtn.classList.add('hidden');
  }, err=>{
    distanceLocateBtn.disabled = false;
    distanceLocateBtn.textContent = I18N.t('js.tryAgain');
  });
});

async function fetchOverLocation(lat, lon){
  const el = document.getElementById('overLocation');
  const liveEl = document.getElementById('liveOver');
  try{
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=id`;
    const res = await fetch(url);
    if(!res.ok) throw new Error('gagal');
    const data = await res.json();

    let label;
    if(data.countryName){
      label = data.countryName;
    } else if(data.localityInfo && Array.isArray(data.localityInfo.informative) && data.localityInfo.informative.length){
      label = data.localityInfo.informative[0].name;
    } else {
      label = I18N.t('js.overWater');
    }
    el.textContent = label;
    if(liveEl) liveEl.textContent = label;
    const windowBelowEl = document.getElementById('issWindowBelow');
    if(windowBelowEl) windowBelowEl.textContent = label;
  }catch(err){
    el.textContent = I18N.t('js.cannotDetect');
    if(liveEl) liveEl.textContent = I18N.t('js.cannotDetect');
    const windowBelowEl = document.getElementById('issWindowBelow');
    if(windowBelowEl) windowBelowEl.textContent = I18N.t('js.cannotDetect');
  }
}

const HISTORY_KEY = 'iss_tracker_history_v1';
const HISTORY_MAX_HOURS = 6;
const HISTORY_SAMPLE_INTERVAL_MS = 60000;

function loadHistory(){
  try{
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(e){ return []; }
}
function saveHistory(arr){
  try{ localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); }catch(e){}
}
function pruneHistory(arr){
  const cutoff = Date.now() - HISTORY_MAX_HOURS*3600*1000;
  return arr.filter(s => s.t >= cutoff);
}

let historySamples = pruneHistory(loadHistory());

function addHistorySample(alt, vel){
  const now = Date.now();
  if(now - lastHistorySampleAt < HISTORY_SAMPLE_INTERVAL_MS) return;
  lastHistorySampleAt = now;
  historySamples.push({t: now, alt, vel});
  historySamples = pruneHistory(historySamples);
  saveHistory(historySamples);
  renderHistoryChart();
}

function renderHistoryChart(){
  const canvas = document.getElementById('historyChart');
  const wrap = canvas.parentElement;
  const placeholder = document.getElementById('historyPlaceholder');
  if(historySamples.length < 2){
    if(placeholder) placeholder.style.display = 'block';
    wrap.style.display = 'none';
    return;
  }
  if(placeholder) placeholder.style.display = 'none';
  wrap.style.display = 'block';

  const labels = historySamples.map(s => new Date(s.t).toLocaleTimeString(I18N.locale(), {hour:'2-digit', minute:'2-digit'}));
  const altData = historySamples.map(s => toDist(s.alt));
  const velData = historySamples.map(s => toSpeed(s.vel));
  const altLabel = I18N.t('idx.cardAlt') + ' (' + distUnitLabel() + ')';
  const velLabel = I18N.t('idx.cardVel') + ' (' + speedUnitLabel() + ')';

  if(historyChart){
    historyChart.data.labels = labels;
    historyChart.data.datasets[0].data = altData;
    historyChart.data.datasets[0].label = altLabel;
    historyChart.data.datasets[1].data = velData;
    historyChart.data.datasets[1].label = velLabel;
    historyChart.update('none');
    return;
  }

  const ctx2d = canvas.getContext('2d');
  historyChart = new Chart(ctx2d, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: altLabel,
          data: altData,
          borderColor: '#ff7a45',
          backgroundColor: 'rgba(255,122,69,0.08)',
          yAxisID: 'yAlt',
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2,
          fill: true
        },
        {
          label: velLabel,
          data: velData,
          borderColor: '#5fd3c4',
          yAxisID: 'yVel',
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {mode:'index', intersect:false},
      plugins: {
        legend: { labels: { color:'#8493ae', boxWidth:12, font:{family:"'IBM Plex Mono',monospace", size:11} } }
      },
      scales: {
        x: { ticks: { color:'#8493ae', maxTicksLimit:8, font:{family:"'IBM Plex Mono',monospace", size:10} }, grid:{color:'#1c2744'} },
        yAlt: { position:'left', ticks:{color:'#ff7a45', font:{size:10}}, grid:{color:'#1c2744'} },
        yVel: { position:'right', ticks:{color:'#5fd3c4', font:{size:10}}, grid:{drawOnChartArea:false} }
      }
    }
  });
}
renderHistoryChart();

function fmt(n, d=2){ return Number(n).toFixed(d); }

async function fetchISS(){
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  try{
    const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544?units=kilometers');
    if(!res.ok) throw new Error('Respons tidak valid');
    const data = await res.json();

    dot.classList.remove('err');
    text.textContent = I18N.t('js.statusLive');

    trail.push({lat:data.latitude, lon:data.longitude});
    if(trail.length > MAX_TRAIL) trail.shift();
    lastKnownPos = {lat:data.latitude, lon:data.longitude};

    lastTelemetry = data;
    applyTelemetryToDOM(data);

    const dt = new Date(data.timestamp*1000);

    renderGroundTrack(data.latitude, data.longitude);

    renderISS(data.latitude, data.longitude);
    if(!firstIssRendered){ firstIssRendered = true; tryHideAppLoading(); }
    addHistorySample(data.altitude, data.velocity);

    const now = Date.now();
    if(now - lastWeatherFetchAt > 29000){
      lastWeatherFetchAt = now;
      fetchWeather(data.latitude, data.longitude);
    }
    if(now - lastGeoFetchAt > 30000){
      lastGeoFetchAt = now;
      fetchOverLocation(data.latitude, data.longitude);
    }

    if(observer){
      const distKm = distanceToISSKm(data.latitude, data.longitude, data.altitude);
      if(distKm !== null){
        lastDistKm = distKm;
        document.getElementById('distanceValue').innerHTML = fmt(toDist(distKm),0)+'<span class="unit">'+distUnitLabel()+'</span>';
      }
    }

    if(satrec){
      const futurePts = [];
      const nowDate = new Date();
      for(let m=0; m<=45; m+=3){
        const t = new Date(nowDate.getTime() + m*60000);
        const eci = ISSAstro.propagateEci(satrec, t);
        if(!eci) continue;
        const gmst = satellite.gstime(t);
        const geo = satellite.eciToGeodetic(eci, gmst);
        futurePts.push({lat: satellite.degreesLat(geo.latitude), lon: satellite.degreesLong(geo.longitude)});
      }
      ISSGlobe.setFuturePath(futurePts);
    }

    tickOtherSatellites();
    updateMarkerPopup();
  }catch(err){
    dot.classList.add('err');
    text.textContent = I18N.t('js.statusError');
    document.getElementById('lastUpdate').textContent = I18N.t('js.lastUpdateFail');
  }
}

function applyTelemetryToDOM(data){
  const dU = distUnitLabel(), sU = speedUnitLabel();

  document.getElementById('lat').textContent = fmt(data.latitude)+'°';
  document.getElementById('lon').textContent = fmt(data.longitude)+'°';
  document.getElementById('alt').innerHTML = fmt(toDist(data.altitude),1)+'<span class="unit">'+dU+'</span>';
  document.getElementById('vel').innerHTML = fmt(toSpeed(data.velocity),0)+'<span class="unit">'+sU+'</span>';
  document.getElementById('fp').innerHTML = fmt(toDist(data.footprint),0)+'<span class="unit">'+dU+'</span>';

  const velCompareEl = document.getElementById('velCompare');
  if(velCompareEl && data.velocity > 0){
    const timeSec = SPEED_REF_ROUTE_KM / data.velocity * 3600;
    velCompareEl.textContent = I18N.t('js.velCompare', {
      route: SPEED_REF_ROUTE_LABEL,
      time: formatDuration(timeSec)
    });
  }

  document.getElementById('vis').textContent =
    data.visibility === 'daylight' ? I18N.t('js.visDaylight') : I18N.t('js.visNight');

  updateIssWindowView(data.visibility === 'daylight');

  document.getElementById('coordread').innerHTML =
    `${I18N.t('js.latLabel')} <b>${fmt(data.latitude)}°</b><br>${I18N.t('js.lonLabel')} <b>${fmt(data.longitude)}°</b>`;

  const dt = new Date(data.timestamp*1000);
  document.getElementById('lastUpdate').textContent =
    I18N.t('js.lastUpdatedAt', {time: dt.toLocaleTimeString(I18N.locale())});

  document.getElementById('liveLat').textContent = fmt(data.latitude)+'°';
  document.getElementById('liveLon').textContent = fmt(data.longitude)+'°';
  document.getElementById('liveAlt').innerHTML = fmt(toDist(data.altitude),1)+' '+dU;
  document.getElementById('liveVel').innerHTML = fmt(toSpeed(data.velocity),0)+' '+sU;
  document.getElementById('liveUpdated').textContent = I18N.t('js.liveUpdatedAt', {time: dt.toLocaleTimeString(I18N.locale())});
  const satAltIss = document.getElementById('satAlt-iss');
  if(satAltIss) satAltIss.innerHTML = `<b>${fmt(toDist(data.altitude),0)}</b> ${dU}`;

  updateA11yStatusSummary(data);
}

function a11yStatusSentence(data){
  if(!data) return I18N.t('a11y.statusSummaryNoData');
  const dU = distUnitLabel(), sU = speedUnitLabel();
  const overEl = document.getElementById('overLocation');
  const overText = (overEl && overEl.textContent && overEl.textContent !== '--') ? overEl.textContent : I18N.t('a11y.overOcean');
  return I18N.t('a11y.statusSummary', {
    lat: fmt(data.latitude) + '°',
    lon: fmt(data.longitude) + '°',
    alt: fmt(toDist(data.altitude), 1),
    distUnit: dU,
    vel: fmt(toSpeed(data.velocity), 0),
    speedUnit: sU,
    vis: data.visibility === 'daylight' ? I18N.t('js.visDaylight') : I18N.t('js.visNight'),
    over: overText
  });
}

function updateA11yStatusSummary(data){
  const el = document.getElementById('a11yStatusSummary');
  if(el) el.textContent = a11yStatusSentence(data);
}

let a11ySpeechUtterance = null;

function speakA11yStatus(){
  const btn = document.getElementById('a11yReadBtn');
  if(!('speechSynthesis' in window)){
    if(btn) btn.title = I18N.t('a11y.speechUnsupported');
    return;
  }

  if(window.speechSynthesis.speaking){
    window.speechSynthesis.cancel();
    if(btn){
      btn.classList.remove('speaking');
      btn.innerHTML = `<i class="fa-solid fa-volume-high" aria-hidden="true"></i> <span>${I18N.t('a11y.readStatusBtn')}</span>`;
    }
    return;
  }
  const text = a11yStatusSentence(lastTelemetry);
  a11ySpeechUtterance = new SpeechSynthesisUtterance(text);
  a11ySpeechUtterance.lang = I18N.getLang() === 'en' ? 'en-US' : 'id-ID';
  if(btn){
    btn.classList.add('speaking');
    btn.innerHTML = `<i class="fa-solid fa-stop" aria-hidden="true"></i> <span>${I18N.t('a11y.stopReading')}</span>`;
  }
  a11ySpeechUtterance.onend = a11ySpeechUtterance.onerror = ()=>{
    if(btn){
      btn.classList.remove('speaking');
      btn.innerHTML = `<i class="fa-solid fa-volume-high" aria-hidden="true"></i> <span>${I18N.t('a11y.readStatusBtn')}</span>`;
    }
  };
  window.speechSynthesis.speak(a11ySpeechUtterance);
}

const a11yReadBtn = document.getElementById('a11yReadBtn');
if(a11yReadBtn) a11yReadBtn.addEventListener('click', speakA11yStatus);

const A11Y_AUTOREAD_KEY = 'istrack_a11y_autoread';
function isA11yAutoReadOn(){
  try{ return localStorage.getItem(A11Y_AUTOREAD_KEY) === '1'; }catch(e){ return false; }
}
let a11yAutoReadTimer = null;
function startA11yAutoRead(){
  clearInterval(a11yAutoReadTimer);
  if(!isA11yAutoReadOn()) return;
  a11yAutoReadTimer = setInterval(()=>{
    if(!('speechSynthesis' in window) || window.speechSynthesis.speaking) return;
    if(!lastTelemetry) return;
    const utt = new SpeechSynthesisUtterance(a11yStatusSentence(lastTelemetry));
    utt.lang = I18N.getLang() === 'en' ? 'en-US' : 'id-ID';
    window.speechSynthesis.speak(utt);
  }, 60000);
}
startA11yAutoRead();

function reapplyUnits(){
  if(lastTelemetry) applyTelemetryToDOM(lastTelemetry);

  if(observer && lastDistKm !== null){
    document.getElementById('distanceValue').innerHTML = fmt(toDist(lastDistKm),0)+'<span class="unit">'+distUnitLabel()+'</span>';
  }

  applyWeatherToDOM();

  Object.keys(OTHER_SATS).forEach(key=>{
    const altKm = lastOtherSatAltKm[key];
    if(altKm === undefined) return;
    const altEl = document.getElementById(`satAlt-${key}`);
    if(altEl) altEl.innerHTML = `<b>${fmt(toDist(altKm),0)}</b> ${distUnitLabel()}`;
  });

  updateCompareCharts();
  renderHistoryChart();
}

function start(){
  fetchISS();
  issTimer = setInterval(fetchISS, 5000);
  running = true;
  const btn = document.getElementById('toggleBtn');
  btn.textContent = I18N.t('js.pauseUpdates');
  btn.classList.remove('is-paused');
}
function stop(){
  clearInterval(issTimer);
  running = false;
  const btn = document.getElementById('toggleBtn');
  btn.textContent = I18N.t('js.resumeUpdates');
  btn.classList.add('is-paused');
}
document.getElementById('toggleBtn').addEventListener('click', ()=>{
  if(running) stop(); else start();
});

function weatherCodeLabel(code){
  return I18N.t('js.weather.'+code) !== ('js.weather.'+code) ? I18N.t('js.weather.'+code) : null;
}

async function fetchWeather(lat, lon){
  const body = document.getElementById('weatherBody');
  try{
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current_weather=true`;
    const res = await fetch(url);
    if(!res.ok) throw new Error('gagal');
    const data = await res.json();
    lastWeatherRaw = data.current_weather;
    applyWeatherToDOM();
  }catch(err){
    body.innerHTML = `<p class="error-note">${I18N.t('js.weatherUnavailable')}</p>`;
  }
}

function applyWeatherToDOM(){
  if(!lastWeatherRaw) return;
  const body = document.getElementById('weatherBody');
  const w = lastWeatherRaw;
  const desc = weatherCodeLabel(w.weathercode) || I18N.t('js.weatherUnknown');

  body.innerHTML = `
    <div class="weather-row">
      <div class="weather-temp">${fmt(w.temperature,1)}°C</div>
      <div class="weather-detail">
        <b>${desc}</b><br>
        ${I18N.t('js.windLabel', {speed: fmt(toSpeed(w.windspeed),0), unit: speedUnitLabel()})}<br>
        ${I18N.t('js.atThatPoint', {state: w.is_day ? I18N.t('js.dayTime') : I18N.t('js.nightTime')})}
      </div>
    </div>
  `;
}

function normalizeName(n){
  return n.toLowerCase().replace(/[^a-z\s]/g,'').trim();
}

async function fetchCrewFrom(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error('gagal '+res.status);
  const data = await res.json();
  if(!Array.isArray(data.people)) throw new Error('format tidak dikenali');
  return data;
}

async function fetchCrewData(){
  const sources = [
    'https://cdn.jsdelivr.net/gh/corquaid/international-space-station-APIs/JSON/people-in-space.json',
    'https://raw.githubusercontent.com/corquaid/international-space-station-APIs/master/JSON/people-in-space.json'
  ];
  for(const url of sources){
    try{
      return await fetchCrewFrom(url);
    }catch(err){

    }
  }
  return null;
}

function formatMissionDuration(person){
  if(typeof person.launched !== 'number') return null;
  const priorDays = typeof person.days_in_space === 'number' ? person.days_in_space : 0;
  const currentMissionDays = (Date.now()/1000 - person.launched) / 86400;
  const totalDays = Math.max(0, Math.round(priorDays + currentMissionDays));
  return I18N.t('js.missionDuration', {days: totalDays});
}

async function fetchCrew(){
  const body = document.getElementById('crewBody');
  try{
    const data = await fetchCrewData();
    if(!data) throw new Error('semua sumber data kru gagal');

    const items = data.people.map(p=>{
      const flag = p.flag_code
        ? `<img class="crew-flag" src="https://flagcdn.com/24x18/${p.flag_code}.png" alt="${p.country||''}" loading="lazy">`
        : '';
      const duration = formatMissionDuration(p);
      const parts = [p.country, duration].filter(Boolean).join(' · ');
      const subHtml = (flag || parts) ? `<div class="crew-sub">${flag}<span>${parts}</span></div>` : '';
      const craft = p.spacecraft || p.craft || '';
      return `<li><div class="crew-row-top"><span>${p.name}</span><span class="craft">${craft}</span></div>${subHtml}</li>`;
    }).join('');

    body.innerHTML = `
      <div class="crew-count">${data.number != null ? data.number : data.people.length}</div>
      <ul class="crew-list">${items}</ul>
    `;
  }catch(err){
    body.innerHTML = `<p class="error-note">${I18N.t('js.crewUnavailable')}</p>`;
  }
}

async function fetchDockingFrom(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error('gagal '+res.status);
  const data = await res.json();
  if(!Array.isArray(data.spacecraft)) throw new Error('format tidak dikenali');
  return data;
}

async function fetchDockingData(){
  const sources = [
    'https://cdn.jsdelivr.net/gh/corquaid/international-space-station-APIs/JSON/iss-docked-spacecraft.json',
    'https://raw.githubusercontent.com/corquaid/international-space-station-APIs/master/JSON/iss-docked-spacecraft.json'
  ];
  for(const url of sources){
    try{
      return await fetchDockingFrom(url);
    }catch(err){

    }
  }
  return null;
}

function formatDockedDuration(dockedTs){
  if(typeof dockedTs !== 'number') return null;
  const days = Math.max(0, Math.floor((Date.now()/1000 - dockedTs) / 86400));
  return I18N.t('js.dockedDaysCount', {days});
}

function renderDockingCard2(sc){
  const isCrew = sc.mission_type === 'Crew';
  const typeLabel = isCrew ? I18N.t('js.dockingTypeCrew') : I18N.t('js.dockingTypeCargo');
  const flag = sc.flag_code
    ? `<img class="docking-flag" src="https://flagcdn.com/24x18/${sc.flag_code}.png" alt="${sc.country||''}" loading="lazy">`
    : '';
  const duration = formatDockedDuration(sc.docked);
  const crewNames = Array.isArray(sc.crew) && sc.crew.length
    ? `<div class="docking-crew-names">${I18N.t('js.dockingCrewOnboard')}: ${sc.crew.join(', ')}</div>`
    : '';

  return `
    <div class="docking-card">
      <div class="docking-card-head">
        ${flag}
        <span class="docking-name">${sc.name || '--'}</span>
        <span class="docking-type ${isCrew ? 'docking-type-crew' : 'docking-type-cargo'}">${typeLabel}</span>
      </div>
      <p class="docking-port">${I18N.t('js.dockingPortLabel')}: <b>${sc.docking_port || '--'}</b></p>
      <div class="docking-rows">
        <div class="docking-row"><span>${I18N.t('js.dockingOperator')}</span><b>${sc.operator || '--'}</b></div>
        ${duration ? `<div class="docking-row"><span>${I18N.t('js.dockingSince')}</span><b>${duration}</b></div>` : ''}
      </div>
      ${crewNames}
    </div>
  `;
}

async function fetchDocking(){
  const body = document.getElementById('dockingBody');
  if(!body) return;
  try{
    const data = await fetchDockingData();
    if(!data) throw new Error('semua sumber data docking gagal');

    const cards = data.spacecraft.map(renderDockingCard2).join('');
    const count = data.number != null ? data.number : data.spacecraft.length;

    body.innerHTML = `
      <div>
        <div class="docking-count">${count}</div>
        <div class="docking-count-label">${I18N.t('js.dockingCountLabel')}</div>
      </div>
      <div class="docking-grid">${cards}</div>
    `;
  }catch(err){
    body.innerHTML = `<p class="error-note">${I18N.t('js.dockingUnavailable')}</p>`;
  }
}

const CREW_TIMELINE_SEGMENTS = [
  {startHour:0,   endHour:6,    key:'sleep'},
  {startHour:6,   endHour:6.5,  key:'meal'},
  {startHour:6.5, endHour:8,    key:'exercise'},
  {startHour:8,   endHour:8.5,  key:'meal'},
  {startHour:8.5, endHour:13,   key:'science'},
  {startHour:13,  endHour:14,   key:'meal'},
  {startHour:14,  endHour:16.5, key:'science'},
  {startHour:16.5,endHour:18,   key:'exercise'},
  {startHour:18,  endHour:19.5, key:'meal'},
  {startHour:19.5,endHour:21.5, key:'science'},
  {startHour:21.5,endHour:24,   key:'sleep'}
];
const CREW_TIMELINE_COLORS = {
  sleep:'#5b6b8c',
  exercise:'#ff7a45',
  meal:'#f2c14e',
  science:'#5fd3c4'
};

function renderCrewTimeline(){
  const track = document.getElementById('crewTimelineTrack');
  const legend = document.getElementById('crewTimelineLegend');
  const clock = document.getElementById('crewTimelineClock');
  const nowMarker = document.getElementById('crewTimelineNow');
  if(!track || !legend || !clock || !nowMarker) return;

  const now = new Date();
  const hourFrac = now.getUTCHours() + now.getUTCMinutes()/60 + now.getUTCSeconds()/3600;
  clock.textContent = String(now.getUTCHours()).padStart(2,'0')+':'+String(now.getUTCMinutes()).padStart(2,'0');
  nowMarker.style.left = (hourFrac/24*100)+'%';

  if(!track.dataset.built){
    const segHtml = CREW_TIMELINE_SEGMENTS.map(seg=>{
      const widthPct = (seg.endHour - seg.startHour)/24*100;
      return `<div class="crew-timeline-seg" style="width:${widthPct}%;background:${CREW_TIMELINE_COLORS[seg.key]}" title="${I18N.t('js.timelineSeg_'+seg.key)}"></div>`;
    }).join('');
    track.insertAdjacentHTML('afterbegin', segHtml);
    track.dataset.built = '1';

    const seen = new Set();
    legend.innerHTML = CREW_TIMELINE_SEGMENTS.filter(seg=>{
      if(seen.has(seg.key)) return false;
      seen.add(seg.key);
      return true;
    }).map(seg=>`
      <span class="crew-timeline-legend-item">
        <span class="crew-timeline-legend-dot" style="background:${CREW_TIMELINE_COLORS[seg.key]}"></span>
        ${I18N.t('js.timelineSeg_'+seg.key)}
      </span>
    `).join('');
  }
}

const LL2_BASE = 'https://ll.thespacedevs.com/2.2.0';
const ACTIVITY_CACHE_MS = 45*60*1000;
const ACTIVITY_PAST_WINDOW_MS = 2*24*60*60*1000;
const ACTIVITY_FUTURE_WINDOW_MS = 60*24*60*60*1000;

function loadActivityCache(key){
  try{
    const raw = JSON.parse(localStorage.getItem(key));
    if(!raw || typeof raw.fetchedAt !== 'number' || !Array.isArray(raw.data)) return null;
    if(Date.now() - raw.fetchedAt > ACTIVITY_CACHE_MS) return null;
    return raw.data;
  }catch(e){ return null; }
}

function saveActivityCache(key, data){
  try{ localStorage.setItem(key, JSON.stringify({fetchedAt: Date.now(), data})); }catch(e){  }
}

async function fetchLL2(path){
  const res = await fetch(LL2_BASE + path);
  if(!res.ok) throw new Error('LL2 '+res.status);
  return res.json();
}

function pickIssSpacewalk(results){
  const now = Date.now();
  const candidates = (results||[]).filter(sw=>{
    if(!sw || !sw.start) return false;
    if(sw.location && !/space station/i.test(sw.location)) return false;
    const startMs = new Date(sw.start).getTime();
    const endMs = sw.end ? new Date(sw.end).getTime() : startMs;
    if(Number.isNaN(startMs)) return false;
    return (now-endMs) <= ACTIVITY_PAST_WINDOW_MS && (startMs-now) <= ACTIVITY_FUTURE_WINDOW_MS;
  });
  const ongoing = candidates.find(sw=>{
    const startMs = new Date(sw.start).getTime();
    const endMs = sw.end ? new Date(sw.end).getTime() : startMs;
    return now >= startMs && now <= endMs;
  });
  if(ongoing) return ongoing;
  candidates.sort((a,b)=> Math.abs(new Date(a.start)-now) - Math.abs(new Date(b.start)-now));
  return candidates[0] || null;
}

function pickIssDocking(results){
  const now = Date.now();
  const candidates = (results||[]).filter(ev=>{
    if(!ev || !ev.docking) return false;
    const dest = ev.flight_vehicle && ev.flight_vehicle.destination;
    if(!dest || !/international space station/i.test(dest)) return false;
    const dockMs = new Date(ev.docking).getTime();
    const endMs = ev.departure ? new Date(ev.departure).getTime() : dockMs;
    if(Number.isNaN(dockMs)) return false;
    return (now-endMs) <= ACTIVITY_PAST_WINDOW_MS && (dockMs-now) <= ACTIVITY_FUTURE_WINDOW_MS;
  });
  const ongoing = candidates.find(ev=>{
    const dockMs = new Date(ev.docking).getTime();
    const departMs = ev.departure ? new Date(ev.departure).getTime() : Infinity;
    return now >= dockMs && now <= departMs;
  });
  if(ongoing) return ongoing;
  candidates.sort((a,b)=> Math.abs(new Date(a.docking)-now) - Math.abs(new Date(b.docking)-now));
  return candidates[0] || null;
}

function formatActivityDateTime(iso){
  const d = new Date(iso);
  if(Number.isNaN(d.getTime())) return '--';
  const isEn = window.I18N && I18N.locale() === 'en-US';
  return d.toLocaleString(isEn?'en-US':'id-ID', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
}

function formatIsoDurationShort(iso){
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso||'');
  if(!m || (!m[1] && !m[2] && !m[3])) return null;
  const isEn = window.I18N && I18N.locale() === 'en-US';
  const hUnit = isEn ? 'h' : 'j';
  const h = parseInt(m[1]||'0',10), mi = parseInt(m[2]||'0',10);
  const parts = [];
  if(h) parts.push(h+hUnit);
  if(mi) parts.push(mi+'m');
  return parts.length ? parts.join(' ') : '<1m';
}

function activityStateInfo(state){

  const cls = state === 'live' ? 'activity-state-live' : (state === 'done' ? 'activity-state-done' : 'activity-state-upcoming');
  return cls;
}

function renderEvaCard(sw){
  const now = Date.now();
  const startMs = new Date(sw.start).getTime();
  const endMs = sw.end ? new Date(sw.end).getTime() : startMs;
  const state = (now >= startMs && now <= endMs) ? 'live' : (now > endMs ? 'done' : 'upcoming');
  const stateLabel = state === 'live' ? I18N.t('js.activityLive') : (state === 'done' ? I18N.t('js.activityDone') : I18N.t('js.activityUpcoming'));
  const crewNames = Array.isArray(sw.crew)
    ? sw.crew.map(c=> c.astronaut && c.astronaut.name).filter(Boolean).join(', ')
    : '';
  const durText = formatIsoDurationShort(sw.duration);

  return `
    <div class="activity-card">
      <div class="activity-card-head">
        <span class="activity-icon"><i class="fa-solid fa-person-walking-arrow-right"></i></span>
        <div class="activity-card-title-wrap">
          <span class="activity-card-title">${I18N.t('js.activityEvaTitle')}</span>
          <span class="activity-state ${activityStateInfo(state)}">${stateLabel}</span>
        </div>
      </div>
      ${sw.name ? `<p class="activity-card-name">${sw.name}</p>` : ''}
      <div class="activity-card-rows">
        <div class="activity-row"><span>${I18N.t('js.activityWhen')}</span><b>${formatActivityDateTime(sw.start)}</b></div>
        ${durText ? `<div class="activity-row"><span>${I18N.t('js.activityDuration')}</span><b>${durText}</b></div>` : ''}
        ${crewNames ? `<div class="activity-row"><span>${I18N.t('js.activityCrew')}</span><b>${crewNames}</b></div>` : ''}
      </div>
    </div>
  `;
}

function renderDockingCard(ev){
  const now = Date.now();
  const dockMs = new Date(ev.docking).getTime();
  const departMs = ev.departure ? new Date(ev.departure).getTime() : null;
  const state = (now >= dockMs && (departMs === null || now <= departMs)) ? 'live'
    : (departMs !== null && now > departMs ? 'done' : 'upcoming');
  const stateLabel = state === 'live' ? I18N.t('js.activityDocked') : (state === 'done' ? I18N.t('js.activityDeparted') : I18N.t('js.activityUpcoming'));
  const craftName = (ev.flight_vehicle && ev.flight_vehicle.spacecraft && ev.flight_vehicle.spacecraft.name) || '--';

  return `
    <div class="activity-card">
      <div class="activity-card-head">
        <span class="activity-icon"><i class="fa-solid fa-link"></i></span>
        <div class="activity-card-title-wrap">
          <span class="activity-card-title">${I18N.t('js.activityDockingTitle')}</span>
          <span class="activity-state ${activityStateInfo(state)}">${stateLabel}</span>
        </div>
      </div>
      <p class="activity-card-name">${craftName}</p>
      <div class="activity-card-rows">
        <div class="activity-row"><span>${I18N.t('js.activityDocking')}</span><b>${formatActivityDateTime(ev.docking)}</b></div>
        ${ev.departure ? `<div class="activity-row"><span>${I18N.t('js.activityDeparture')}</span><b>${formatActivityDateTime(ev.departure)}</b></div>` : ''}
      </div>
    </div>
  `;
}

async function loadIssActivity(){
  const body = document.getElementById('activityBody');
  if(!body) return;

  const cachedEva = loadActivityCache('istrack_activity_eva');
  const cachedDock = loadActivityCache('istrack_activity_dock');
  let evaResults = cachedEva, dockResults = cachedDock;
  let evaFailed = false, dockFailed = false;

  const jobs = [];

  if(cachedEva === null){
    jobs.push(
      fetchLL2('/spacewalks/?ordering=-start&limit=15')
        .then(d=>{ evaResults = Array.isArray(d.results) ? d.results : []; saveActivityCache('istrack_activity_eva', evaResults); })
        .catch(()=>{ evaFailed = true; evaResults = evaResults || []; })
    );
  }
  if(cachedDock === null){
    jobs.push(
      fetchLL2('/docking_event/?ordering=-docking&limit=15')
        .then(d=>{ dockResults = Array.isArray(d.results) ? d.results : []; saveActivityCache('istrack_activity_dock', dockResults); })
        .catch(()=>{ dockFailed = true; dockResults = dockResults || []; })
    );
  }
  if(jobs.length) await Promise.allSettled(jobs);

  const eva = pickIssSpacewalk(evaResults || []);
  const dock = pickIssDocking(dockResults || []);

  if(!eva && !dock){
    body.innerHTML = (evaFailed && dockFailed)
      ? `<p class="error-note">${I18N.t('js.activityUnavailable')}</p>`
      : `<p class="placeholder">${I18N.t('js.activityEmpty')}</p>`;
    return;
  }
  body.innerHTML = [eva ? renderEvaCard(eva) : '', dock ? renderDockingCard(dock) : ''].join('');
}

function parseTleText(text){
  const lines = text.trim().split('\n').map(l=>l.trim()).filter(Boolean);
  if(lines.length < 3) return null;

  const l1 = lines.find(l=>l.startsWith('1 '));
  const l2 = lines.find(l=>l.startsWith('2 '));
  if(!l1 || !l2) return null;
  return { line1: l1, line2: l2 };
}

const CORS_PROXY = 'https://corsproxy.io/?url=';

async function fetchTleFromCelesTrak(catnr){
  const target = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${catnr}&FORMAT=TLE`;

  try{
    const res = await fetch(target);
    if(res.ok){
      const tle = parseTleText(await res.text());
      if(tle) return { line1: tle.line1, line2: tle.line2, source: 'CelesTrak' };
    }
  }catch(err){  }

  const res2 = await fetch(`${CORS_PROXY}${encodeURIComponent(target)}`);
  if(!res2.ok) throw new Error('CelesTrak gagal (langsung & lewat proxy)');
  const tle2 = parseTleText(await res2.text());
  if(!tle2) throw new Error('CelesTrak: format TLE tidak dikenali');
  return { line1: tle2.line1, line2: tle2.line2, source: 'CelesTrak (proxy)' };
}

async function fetchTleFromIvanstanojevic(catnr){
  const target = `https://tle.ivanstanojevic.me/api/tle/${catnr}`;
  const pickTle = (data) => (data && data.line1 && data.line2) ? { line1: data.line1, line2: data.line2 } : null;

  try{
    const res = await fetch(target);
    if(res.ok){
      const tle = pickTle(await res.json());
      if(tle) return { ...tle, source: 'Sumber cadangan TLE (ivanstanojevic.me)' };
    }
  }catch(err){  }

  const res2 = await fetch(`${CORS_PROXY}${encodeURIComponent(target)}`);
  if(!res2.ok) throw new Error('Sumber cadangan TLE gagal (langsung & lewat proxy)');
  const tle2 = pickTle(await res2.json());
  if(!tle2) throw new Error('Sumber cadangan TLE: format data tidak dikenali');
  return { ...tle2, source: 'Sumber cadangan TLE (ivanstanojevic.me, proxy)' };
}

async function fetchTleMultiSource(catnr){
  const sources = [fetchTleFromCelesTrak, fetchTleFromIvanstanojevic];
  let lastErr = null;
  for(const src of sources){
    try{ return await src(catnr); }
    catch(err){ lastErr = err; }
  }
  throw lastErr || new Error('semua sumber TLE gagal');
}

async function fetchJsonWithProxy(target){
  try{
    const res = await fetch(target);
    if(res.ok) return await res.json();
  }catch(e){  }
  const res2 = await fetch(`${CORS_PROXY}${encodeURIComponent(target)}`);
  if(!res2.ok) throw new Error('permintaan gagal (langsung & lewat proxy)');
  return await res2.json();
}

function celestrakGpToCandidate(o){
  if(!o || !o.NORAD_CAT_ID || !o.TLE_LINE1 || !o.TLE_LINE2) return null;
  return { catnr: o.NORAD_CAT_ID, name: o.OBJECT_NAME || `NORAD ${o.NORAD_CAT_ID}`, line1: o.TLE_LINE1, line2: o.TLE_LINE2, source: 'CelesTrak' };
}
function ivanstanojevicToCandidate(o){
  const catnr = o && (o.satelliteId || o.norad_cat_id || o.noradCatId);
  if(!o || !catnr || !o.line1 || !o.line2) return null;
  return { catnr, name: o.name || `NORAD ${catnr}`, line1: o.line1, line2: o.line2, source: 'Sumber cadangan TLE (ivanstanojevic.me)' };
}

async function lookupSatelliteByCatnr(catnr){
  try{
    const data = await fetchJsonWithProxy(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${catnr}&FORMAT=json`);
    const found = Array.isArray(data) ? data.map(celestrakGpToCandidate).find(Boolean) : null;
    if(found) return found;
  }catch(e){  }
  const data2 = await fetchJsonWithProxy(`https://tle.ivanstanojevic.me/api/tle/${catnr}`);
  const found2 = ivanstanojevicToCandidate(data2);
  if(!found2) throw new Error('satelit tidak ditemukan');
  return found2;
}

async function searchSatellitesByName(query){
  try{
    const data = await fetchJsonWithProxy(`https://celestrak.org/NORAD/elements/gp.php?NAME=${encodeURIComponent(query)}&FORMAT=json`);
    const list = Array.isArray(data) ? data.map(celestrakGpToCandidate).filter(Boolean) : [];
    if(list.length) return list.slice(0, 15);
  }catch(e){  }
  try{
    const data2 = await fetchJsonWithProxy(`https://tle.ivanstanojevic.me/api/tle?search=${encodeURIComponent(query)}&page-size=15`);
    const items = Array.isArray(data2) ? data2 : (data2 && (data2.member || data2['hydra:member'])) || [];
    return items.map(ivanstanojevicToCandidate).filter(Boolean);
  }catch(e){ return []; }
}

function findExistingSatByCatnr(catnr){
  const n = Number(catnr);
  if(n === ISS_CATNR) return 'iss';
  return Object.keys(OTHER_SATS).find(k => Number(OTHER_SATS[k].catnr) === n) || null;
}

function addCustomSatellite(candidate){
  const existingKey = findExistingSatByCatnr(candidate.catnr);
  if(existingKey) return { ok: false, reason: 'already-tracked', key: existingKey };

  const key = customSatKey(candidate.catnr);
  const colorCss = colorForCustomSat(candidate.catnr);
  OTHER_SATS[key] = {
    catnr: candidate.catnr,
    label: candidate.name,
    color: parseInt(colorCss.slice(1), 16),
    colorCss,
    flag: '<i class="fa-solid fa-satellite"></i>',
    category: 'custom',
    custom: true,
    wiki: { en: candidate.name }
  };

  const satrecOther = satellite.twoline2satrec(candidate.line1, candidate.line2);
  otherSatState[key] = { satrec: satrecOther, failed: false };
  tleStore[key] = { label: candidate.name, catnr: candidate.catnr, line1: candidate.line1, line2: candidate.line2, source: candidate.source, satrec: satrecOther, fetchedAt: new Date() };

  const saved = loadCustomSatsRaw();
  saved.push({ catnr: candidate.catnr, label: candidate.name });
  saveCustomSatsRaw(saved);

  refreshAfterCustomSatChange();
  return { ok: true, key };
}

function removeCustomSatellite(key){
  const cfg = OTHER_SATS[key];
  if(!cfg || !cfg.custom) return;

  delete OTHER_SATS[key];
  delete otherSatState[key];
  delete tleStore[key];
  delete lastOtherSatAltKm[key];
  delete lastOtherSatVelKmh[key];
  delete lastOtherSatPos[key];
  if(selectedMarker && selectedMarker.type === 'other' && selectedMarker.id === key){
    showMarkerPopup(null);
  }
  if(tleSelectedKey === key) tleSelectedKey = 'iss';

  saveCustomSatsRaw(loadCustomSatsRaw().filter(item => customSatKey(item.catnr) !== key));
  refreshAfterCustomSatChange();
}
window.removeCustomSatellite = removeCustomSatellite;

function refreshAfterCustomSatChange(){
  renderCompareInitial();
  tickOtherSatellites();
  renderTlePanel();
  if(window.renderMapFilterPanel) window.renderMapFilterPanel();
  refreshTleSelectOptions();
}

function refreshTleSelectOptions(){
  const select = document.getElementById('tleSelect');
  if(!select) return;
  const options = tleObjectList().map(o=>`<option value="${o.key}">${o.label}</option>`).join('');
  select.innerHTML = options;
  select.value = tleSelectedKey;
}

async function fetchOtherSatTLE(key){
  const cfg = OTHER_SATS[key];
  try{
    const tle = await fetchTleMultiSource(cfg.catnr);
    const satrecOther = satellite.twoline2satrec(tle.line1, tle.line2);
    otherSatState[key] = { satrec: satrecOther, failed: false };
    tleStore[key] = { label: cfg.label, catnr: cfg.catnr, line1: tle.line1, line2: tle.line2, source: tle.source, satrec: satrecOther, fetchedAt: new Date() };
  }catch(err){
    console.warn(`Gagal ambil TLE untuk ${cfg.label} (CATNR ${cfg.catnr}) dari semua sumber:`, err);
    otherSatState[key] = { satrec: null, failed: true };
  }
}

async function fetchAllOtherSatTLEs(){
  await Promise.all(Object.keys(OTHER_SATS).map(fetchOtherSatTLE));
  renderCompareInitial();
  tickOtherSatellites();
  renderTlePanel();
}

function renderCompareInitial(){
  const body = document.getElementById('compareBody');

  const filterBar = `
    <div class="sat-filter-bar" id="satFilterBar">
      ${SAT_CATEGORIES.map(c => `<button class="sat-filter-btn${c.key===activeSatFilter?' active':''}" data-filter="${c.key}">${c.label}</button>`).join('')}
    </div>
  `;

  const issRow = `
    <div class="sat-row sat-primary">
      <span class="sat-dot" style="background:var(--ember)"></span>
      <span class="sat-flag"><i class="fa-solid fa-satellite"></i></span>
      <span class="sat-name">ISS (ZARYA)</span>
      <span class="sat-badge">LIVE</span>
      <span class="sat-alt" id="satAlt-iss">--</span>
    </div>
  `;

  const otherRows = Object.keys(OTHER_SATS).map(key=>{
    const cfg = OTHER_SATS[key];
    const state = otherSatState[key];
    const removeBtn = cfg.custom
      ? `<button class="sat-remove-btn" data-remove-key="${key}" title="${I18N.t('js.satRemoveBtnTitle')}" aria-label="${I18N.t('js.satRemoveBtnTitle')}"><i class="fa-solid fa-xmark"></i></button>`
      : '';
    if(!state || state.failed){
      return `
        <div class="sat-row" data-category="${cfg.category}">
          <span class="sat-dot" style="background:${cfg.colorCss}"></span>
          <span class="sat-flag">${cfg.flag||'<i class="fa-solid fa-satellite"></i>'}</span>
          <span class="sat-name">${cfg.label}</span>
          <span class="sat-error">${I18N.t('js.satFailedToLoad')}</span>
          ${removeBtn}
        </div>
      `;
    }
    return `
      <div class="sat-row" data-category="${cfg.category}">
        <span class="sat-dot" style="background:${cfg.colorCss}"></span>
        <span class="sat-flag">${cfg.flag||'<i class="fa-solid fa-satellite"></i>'}</span>
        <span class="sat-name">${cfg.label}</span>
        <span class="sat-alt" id="satAlt-${key}">--</span>
        ${removeBtn}
      </div>
    `;
  }).join('');

  const chartsHtml = `
    <div class="compare-charts">
      <div class="compare-chart-card">
        <p class="compare-chart-title">${I18N.t('js.compareAltChartTitle')} (${distUnitLabel()})</p>
        <div class="compare-chart-wrap"><canvas id="compareAltChart"></canvas></div>
      </div>
      <div class="compare-chart-card">
        <p class="compare-chart-title">${I18N.t('js.compareVelChartTitle')} (${speedUnitLabel()})</p>
        <div class="compare-chart-wrap"><canvas id="compareVelChart"></canvas></div>
      </div>
    </div>
  `;

  body.innerHTML = `${filterBar}<div class="sat-list">${issRow}${otherRows}</div>${chartsHtml}`;
  applyCompareFilter();
  initCompareCharts();

  body.querySelectorAll('.sat-filter-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(window.setActiveSatFilter){
        window.setActiveSatFilter(btn.dataset.filter);
        return;
      }
      activeSatFilter = btn.dataset.filter;
      body.querySelectorAll('.sat-filter-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      applyCompareFilter();
      updateCompareCharts();
    });
  });

  body.querySelectorAll('[data-remove-key]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      removeCustomSatellite(btn.dataset.removeKey);
    });
  });

}

function applyCompareFilter(){
  document.querySelectorAll('#compareBody .sat-row:not(.sat-primary)').forEach(row=>{
    const show = activeSatFilter === 'all' || row.dataset.category === activeSatFilter;
    row.style.display = show ? '' : 'none';
  });
}

function tickOtherSatellites(){
  const now = new Date();
  const globeList = [];
  Object.keys(OTHER_SATS).forEach(key=>{
    const cfg = OTHER_SATS[key];
    const state = otherSatState[key];
    if(!state || !state.satrec) return;
    const g = ISSAstro.propagateGeodetic(state.satrec, now);
    if(!g) return;

    lastOtherSatAltKm[key] = g.altKm;
    lastOtherSatVelKmh[key] = g.velKmh;
    lastOtherSatPos[key] = { lat: g.lat, lon: g.lon };
    const altEl = document.getElementById(`satAlt-${key}`);
    if(altEl) altEl.innerHTML = `<b>${fmt(toDist(g.altKm),0)}</b> ${distUnitLabel()}`;

    const toggleEl = document.getElementById(`compareToggle-${key}`);
    const visible = toggleEl ? toggleEl.checked : true;
    globeList.push({ id: key, lat: g.lat, lon: g.lon, color: cfg.color, altKm: g.altKm, visible });
  });
  try{ ISSGlobe.setOtherSatellites(globeList); }catch(e){}
  updateCompareCharts();
}

let selectedMarker = null;

const globeLabelEls = {};
let globeLabelsContainer = null;

function ensureGlobeLabelEl(key, name, colorCss, isIss){
  let el = globeLabelEls[key];
  if(!el){
    if(!globeLabelsContainer) globeLabelsContainer = document.getElementById('globeLabels');
    if(!globeLabelsContainer) return null;
    el = document.createElement('div');
    el.className = 'globe-label' + (isIss ? ' globe-label-iss' : '');
    el.innerHTML = '<span class="globe-label-dot"></span><span class="globe-label-text"></span>';
    globeLabelsContainer.appendChild(el);
    globeLabelEls[key] = el;
  }
  const dotEl = el.querySelector('.globe-label-dot');
  const textEl = el.querySelector('.globe-label-text');
  if(dotEl) dotEl.style.background = colorCss;
  if(dotEl) dotEl.style.color = colorCss;
  if(textEl && textEl.textContent !== name) textEl.textContent = name;
  return el;
}

function updateGlobeLabels(markers){
  if(!Array.isArray(markers)) return;
  const seen = new Set();
  markers.forEach(m=>{
    let key, name, colorCss, isIss = false;
    if(m.type === 'iss'){
      key = 'iss'; name = 'ISS'; colorCss = 'var(--ember)'; isIss = true;
    } else {
      const cfg = OTHER_SATS[m.id];
      if(!cfg) return;
      key = 'sat-' + m.id; name = cfg.label; colorCss = cfg.colorCss;
    }
    seen.add(key);
    const el = ensureGlobeLabelEl(key, name, colorCss, isIss);
    if(!el) return;
    el.style.transform = `translate(${m.x}px, ${m.y}px) translate(-50%, -170%)`;
    el.classList.toggle('visible', !!m.visible);
  });
  Object.keys(globeLabelEls).forEach(key=>{
    if(!seen.has(key)) globeLabelEls[key].classList.remove('visible');
  });
}

function formatLatLon(lat, lon){
  if(typeof lat !== 'number' || typeof lon !== 'number') return '--';
  const ns = lat >= 0 ? 'LU' : 'LS';
  const ew = lon >= 0 ? 'BT' : 'BB';
  return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lon).toFixed(1)}°${ew}`;
}

function updateMarkerPopup(){
  if(!selectedMarker) return;
  const dotEl = document.getElementById('satInfoDot');
  const nameEl = document.getElementById('satInfoName');
  const liveEl = document.getElementById('satInfoLive');
  const altEl = document.getElementById('satInfoAlt');
  const velEl = document.getElementById('satInfoVel');
  const posEl = document.getElementById('satInfoPos');
  if(!dotEl || !nameEl || !altEl || !velEl || !posEl) return;

  if(selectedMarker.type === 'iss'){
    dotEl.style.background = 'var(--ember)';
    dotEl.style.color = 'var(--ember)';
    nameEl.textContent = 'ISS (ZARYA)';
    if(liveEl) liveEl.classList.remove('hidden');
    if(lastTelemetry){
      altEl.textContent = `${fmt(toDist(lastTelemetry.altitude),0)} ${distUnitLabel()}`;
      velEl.textContent = `${fmt(toSpeed(lastTelemetry.velocity),0)} ${speedUnitLabel()}`;
    }
    if(lastKnownPos) posEl.textContent = formatLatLon(lastKnownPos.lat, lastKnownPos.lon);
  } else {
    const cfg = OTHER_SATS[selectedMarker.id];
    if(!cfg) return;
    dotEl.style.background = cfg.colorCss;
    dotEl.style.color = cfg.colorCss;
    nameEl.textContent = cfg.label;
    if(liveEl) liveEl.classList.add('hidden');
    const altKm = lastOtherSatAltKm[selectedMarker.id];
    const velKmh = lastOtherSatVelKmh[selectedMarker.id];
    if(altKm !== undefined) altEl.textContent = `${fmt(toDist(altKm),0)} ${distUnitLabel()}`;
    if(velKmh !== undefined) velEl.textContent = `${fmt(toSpeed(velKmh),0)} ${speedUnitLabel()}`;
    const pos = lastOtherSatPos[selectedMarker.id];
    if(pos) posEl.textContent = formatLatLon(pos.lat, pos.lon);
  }
}

function showMarkerPopup(info){
  selectedMarker = info;
  const popup = document.getElementById('satInfoPopup');
  if(!popup) return;
  if(!info){
    popup.classList.add('hidden');
    return;
  }
  popup.classList.remove('hidden');
  updateMarkerPopup();
  loadSatelliteMedia(info);
}

try{ ISSGlobe.onMarkerSelect(showMarkerPopup); }catch(e){}
try{ ISSGlobe.onLabelUpdate(updateGlobeLabels); }catch(e){}

const WIKI_SUMMARY_CACHE = {};

function fetchWikiSummary(lang, title){
  const cacheKey = lang + ':' + title;
  if(WIKI_SUMMARY_CACHE[cacheKey]) return WIKI_SUMMARY_CACHE[cacheKey];
  const promise = fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
    .then(res => { if(!res.ok) throw new Error('wiki fetch failed'); return res.json(); })
    .then(data => ({
      photo: (data.thumbnail && data.thumbnail.source) || (data.originalimage && data.originalimage.source) || null,
      extract: data.extract || '',
      pageUrl: (data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page) || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`
    }))
    .catch(err => { delete WIKI_SUMMARY_CACHE[cacheKey]; throw err; });
  WIKI_SUMMARY_CACHE[cacheKey] = promise;
  return promise;
}

async function loadWikiSummaryForTitles(titles){
  if(!titles) return null;
  const preferredLang = I18N.getLang();
  if(preferredLang === 'id' && titles.id){
    try{ return await fetchWikiSummary('id', titles.id); }catch(e){  }
  }
  if(titles.en){
    try{ return await fetchWikiSummary('en', titles.en); }catch(e){ return null; }
  }
  return null;
}

function getWikiTitlesForMarker(marker){
  if(!marker) return null;
  if(marker.type === 'iss') return ISS_WIKI;
  const cfg = OTHER_SATS[marker.id];
  return cfg ? cfg.wiki : null;
}

let satMediaToken = 0;
let currentSatSummary = null;

async function loadSatelliteMedia(marker){
  const token = ++satMediaToken;
  currentSatSummary = null;
  const photoWrap = document.getElementById('satInfoPhotoWrap');
  const photoImg = document.getElementById('satInfoPhoto');
  const moreBtn = document.getElementById('satInfoMoreBtn');
  if(moreBtn) moreBtn.disabled = true;
  if(photoWrap) photoWrap.classList.add('hidden');

  const titles = getWikiTitlesForMarker(marker);
  if(!titles) return;

  if(photoWrap){ photoWrap.classList.remove('hidden'); photoWrap.classList.add('loading'); }
  const summary = await loadWikiSummaryForTitles(titles);
  if(token !== satMediaToken) return;

  if(photoWrap) photoWrap.classList.remove('loading');
  if(summary && summary.photo && photoImg){
    photoImg.src = summary.photo;
    if(photoWrap) photoWrap.classList.remove('hidden');
  } else if(photoWrap){
    photoWrap.classList.add('hidden');
  }
  currentSatSummary = summary;
  if(moreBtn) moreBtn.disabled = false;
}

function openSatDetailModal(){
  if(!selectedMarker) return;
  const backdrop = document.getElementById('satDetailModalBackdrop');
  if(!backdrop) return;

  const titleEl = document.getElementById('satDetailModalTitle');
  const photoWrap = document.getElementById('satDetailPhotoWrap');
  const photoImg = document.getElementById('satDetailPhoto');
  const altEl = document.getElementById('satDetailAlt');
  const velEl = document.getElementById('satDetailVel');
  const posEl = document.getElementById('satDetailPos');
  const extractEl = document.getElementById('satDetailExtract');
  const sourceEl = document.getElementById('satDetailSource');
  const wikiLink = document.getElementById('satDetailWikiLink');

  const nameEl = document.getElementById('satInfoName');
  if(titleEl) titleEl.textContent = nameEl ? nameEl.textContent : '--';

  const infoAlt = document.getElementById('satInfoAlt');
  const infoVel = document.getElementById('satInfoVel');
  const infoPos = document.getElementById('satInfoPos');
  if(altEl && infoAlt) altEl.textContent = infoAlt.textContent;
  if(velEl && infoVel) velEl.textContent = infoVel.textContent;
  if(posEl && infoPos) posEl.textContent = infoPos.textContent;

  if(currentSatSummary && currentSatSummary.photo){
    photoImg.src = currentSatSummary.photo;
    photoWrap.classList.remove('hidden');
  } else if(photoWrap){
    photoWrap.classList.add('hidden');
  }

  if(currentSatSummary && currentSatSummary.extract){
    extractEl.textContent = currentSatSummary.extract;
    if(sourceEl) sourceEl.classList.remove('hidden');
  } else {
    extractEl.textContent = I18N.t('js.satDetailNoInfo');
    if(sourceEl) sourceEl.classList.add('hidden');
  }

  if(currentSatSummary && currentSatSummary.pageUrl && wikiLink){
    wikiLink.href = currentSatSummary.pageUrl;
    wikiLink.classList.remove('hidden');
  } else if(wikiLink){
    wikiLink.classList.add('hidden');
  }

  backdrop.classList.remove('hidden');
}

function closeSatDetailModal(){
  const backdrop = document.getElementById('satDetailModalBackdrop');
  if(backdrop) backdrop.classList.add('hidden');
}

const satInfoMoreBtn = document.getElementById('satInfoMoreBtn');
if(satInfoMoreBtn) satInfoMoreBtn.addEventListener('click', openSatDetailModal);

const satDetailModalClose = document.getElementById('satDetailModalClose');
if(satDetailModalClose) satDetailModalClose.addEventListener('click', closeSatDetailModal);

const satDetailModalBackdrop = document.getElementById('satDetailModalBackdrop');
if(satDetailModalBackdrop){
  satDetailModalBackdrop.addEventListener('click', (e)=>{
    if(e.target === satDetailModalBackdrop) closeSatDetailModal();
  });
}

const satInfoCloseBtn = document.getElementById('satInfoClose');
if(satInfoCloseBtn){
  satInfoCloseBtn.addEventListener('click', ()=>{
    selectedMarker = null;
    satMediaToken++;
    const popup = document.getElementById('satInfoPopup');
    if(popup) popup.classList.add('hidden');
    try{ ISSGlobe.clearMarkerSelection(); }catch(e){}
  });
}
document.addEventListener('click', (e)=>{

  const popup = document.getElementById('satInfoPopup');
  const mapcard = document.querySelector('.mapcard');
  if(!popup || popup.classList.contains('hidden')) return;
  if(mapcard && mapcard.contains(e.target)) return;
  selectedMarker = null;
  satMediaToken++;
  popup.classList.add('hidden');
  try{ ISSGlobe.clearMarkerSelection(); }catch(e){}
});

let compareAltChartInst = null;
let compareVelChartInst = null;

function cssVar(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getComparisonEntries(){
  const entries = [];
  if(lastTelemetry){
    entries.push({
      key: 'iss',
      label: 'ISS (ZARYA)',
      color: cssVar('--ember') || '#ff7a45',
      altKm: lastTelemetry.altitude,
      velKmh: lastTelemetry.velocity
    });
  }
  Object.keys(OTHER_SATS).forEach(key=>{
    const cfg = OTHER_SATS[key];
    const state = otherSatState[key];
    if(!state || !state.satrec) return;
    if(activeSatFilter !== 'all' && cfg.category !== activeSatFilter) return;
    const toggleEl = document.getElementById(`compareToggle-${key}`);
    if(toggleEl && !toggleEl.checked) return;
    const altKm = lastOtherSatAltKm[key];
    const velKmh = lastOtherSatVelKmh[key];
    if(altKm === undefined) return;
    entries.push({ key, label: cfg.label, color: cfg.colorCss, altKm, velKmh });
  });
  return entries;
}

function initCompareCharts(){
  const altCanvas = document.getElementById('compareAltChart');
  const velCanvas = document.getElementById('compareVelChart');
  if(!altCanvas || !velCanvas || typeof Chart === 'undefined') return;

  if(compareAltChartInst){ compareAltChartInst.destroy(); compareAltChartInst = null; }
  if(compareVelChartInst){ compareVelChartInst.destroy(); compareVelChartInst = null; }

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    animation: { duration: 250 },
    plugins: { legend: { display: false } },
    scales: {
      x: { beginAtZero: true, ticks: { color: cssVar('--muted') }, grid: { color: cssVar('--grid-line') } },
      y: { ticks: { color: cssVar('--star'), font: { size: 11 } }, grid: { display: false } }
    }
  };

  compareAltChartInst = new Chart(altCanvas.getContext('2d'), {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] },
    options: baseOptions
  });
  compareVelChartInst = new Chart(velCanvas.getContext('2d'), {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] },
    options: baseOptions
  });

  updateCompareCharts();
}

function updateCompareCharts(){
  if(!compareAltChartInst || !compareVelChartInst) return;
  const entries = getComparisonEntries();

  const altTitle = document.querySelector('.compare-chart-card:nth-child(1) .compare-chart-title');
  const velTitle = document.querySelector('.compare-chart-card:nth-child(2) .compare-chart-title');
  if(altTitle) altTitle.textContent = `${I18N.t('js.compareAltChartTitle')} (${distUnitLabel()})`;
  if(velTitle) velTitle.textContent = `${I18N.t('js.compareVelChartTitle')} (${speedUnitLabel()})`;

  const labels = entries.map(e => e.label);
  const colors = entries.map(e => e.color);

  compareAltChartInst.data.labels = labels;
  compareAltChartInst.data.datasets[0].data = entries.map(e => toDist(e.altKm));
  compareAltChartInst.data.datasets[0].backgroundColor = colors;
  compareAltChartInst.update('none');

  compareVelChartInst.data.labels = labels;
  compareVelChartInst.data.datasets[0].data = entries.map(e => e.velKmh != null ? toSpeed(e.velKmh) : 0);
  compareVelChartInst.data.datasets[0].backgroundColor = colors;
  compareVelChartInst.update('none');
}

const APOD_CACHE_KEY = 'istrack_apod_cache';

function loadApodCache(){
  try{ return JSON.parse(localStorage.getItem(APOD_CACHE_KEY)); }catch(e){ return null; }
}
function saveApodCache(data){
  try{ localStorage.setItem(APOD_CACHE_KEY, JSON.stringify(data)); }catch(e){  }
}

function renderApod(data, { stale } = {}){
  const body = document.getElementById('apodBody');
  if(data.media_type !== 'image'){
    body.innerHTML = `<p class="placeholder">${I18N.t('js.apodVideoPrefix')} <a href="${data.url}" target="_blank" rel="noopener">nasa.gov</a>.</p>`;
    return;
  }
  const staleNote = stale ? `<p class="apod-date">${I18N.t('js.apodCached')}</p>` : '';
  body.innerHTML = `
    <div class="apod-row">
      <img src="${data.url}" alt="${data.title}">
      <div>
        ${staleNote || `<p class="apod-date">${data.date}</p>`}
        <p class="apod-title">${data.title}</p>
        <p class="apod-text">${data.explanation}</p>
      </div>
    </div>
  `;
}

async function fetchApodOnce(){
  const res = await fetch('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY');
  if(!res.ok) throw new Error('HTTP '+res.status);
  return res.json();
}

async function fetchApod(){
  const body = document.getElementById('apodBody');
  const today = new Date().toISOString().slice(0,10);
  const cached = loadApodCache();
  if(cached && cached.date === today){
    renderApod(cached);
    return;
  }
  try{
    let data;
    try{
      data = await fetchApodOnce();
    }catch(firstErr){

      await new Promise(r=>setTimeout(r, 1500));
      data = await fetchApodOnce();
    }
    saveApodCache(data);
    renderApod(data);
  }catch(err){
    if(cached){
      renderApod(cached, { stale: true });
    } else {
      body.innerHTML = `<p class="error-note">${I18N.t('js.apodUnavailable')}</p>`;
    }
  }
}

async function fetchTLE(){
  try{
    let line1, line2, source;
    try{
      const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544/tles');
      if(!res.ok) throw new Error('gagal');
      const data = await res.json();
      line1 = data.line1; line2 = data.line2; source = 'wheretheiss.at';
    }catch(primaryErr){
      const tle = await fetchTleMultiSource(25544);
      line1 = tle.line1; line2 = tle.line2; source = tle.source;
    }
    satrec = satellite.twoline2satrec(line1, line2);
    tleStore.iss = { label: 'ISS (ZARYA)', catnr: 25544, line1, line2, source, satrec, fetchedAt: new Date() };
    renderTlePanel();
    scheduleDayNightUpdate();
    initOrbitHistoryPlayback();
  }catch(err){
    document.getElementById('dayNightState').textContent = I18N.t('js.tleUnavailableState');
    document.getElementById('dayNightCountdown').textContent = I18N.t('js.tleUnavailableCountdown');
    const ph = document.getElementById('playbackPlaceholder');
    if(ph) ph.textContent = I18N.t('js.tleUnavailablePlayback');
  }
}

let orbitHistoryPoints = [];
let playbackTimer = null;
let playbackPlaying = false;

function initOrbitHistoryPlayback(){
  if(!satrec) return;
  orbitHistoryPoints = ISSAstro.computeOrbitHistory(satrec, new Date(), 24, 2);
  if(orbitHistoryPoints.length < 2) return;

  stopPlayback();
  const placeholder = document.getElementById('playbackPlaceholder');
  const controls = document.getElementById('playbackControls');
  if(placeholder) placeholder.style.display = 'none';
  if(controls) controls.classList.remove('hidden');

  const slider = document.getElementById('playbackSlider');
  slider.max = orbitHistoryPoints.length - 1;
  slider.value = orbitHistoryPoints.length - 1;
  try{ ISSGlobe.setHistoryPath(orbitHistoryPoints); }catch(e){}
  updatePlaybackFrame(orbitHistoryPoints.length - 1);
}

function updatePlaybackFrame(idx){
  if(!orbitHistoryPoints.length) return;
  idx = Math.max(0, Math.min(orbitHistoryPoints.length-1, idx));
  const pt = orbitHistoryPoints[idx];
  const timeEl = document.getElementById('playbackTime');
  if(timeEl){
    const isNow = idx === orbitHistoryPoints.length - 1;
    timeEl.textContent = isNow ? I18N.t('js.playbackNow') :
      pt.t.toLocaleString(I18N.locale(), {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}) + I18N.t('js.playbackAgoSuffix');
  }
  try{ ISSGlobe.setPlaybackMarker(pt.lat, pt.lon, true); }catch(e){}
}

function stopPlayback(){
  playbackPlaying = false;
  clearInterval(playbackTimer);
  const btn = document.getElementById('playbackToggleBtn');
  if(btn) btn.textContent = I18N.t('js.playbackPlay');
}

function startPlayback(){
  if(!orbitHistoryPoints.length) return;
  playbackPlaying = true;
  const btn = document.getElementById('playbackToggleBtn');
  if(btn) btn.textContent = I18N.t('js.playbackPause');
  const slider = document.getElementById('playbackSlider');
  if(Number(slider.value) >= orbitHistoryPoints.length-1) slider.value = 0;

  clearInterval(playbackTimer);
  playbackTimer = setInterval(()=>{
    const speedEl = document.getElementById('playbackSpeed');
    const speed = speedEl ? (Number(speedEl.value)||1) : 1;
    let v = Number(slider.value) + speed;
    if(v >= orbitHistoryPoints.length-1){
      v = orbitHistoryPoints.length-1;
      slider.value = v;
      updatePlaybackFrame(v);
      stopPlayback();
      return;
    }
    slider.value = v;
    updatePlaybackFrame(v);
  }, 90);
}

const playbackSliderEl = document.getElementById('playbackSlider');
playbackSliderEl.addEventListener('input', ()=>{
  stopPlayback();
  updatePlaybackFrame(Number(playbackSliderEl.value));
});
const playbackToggleBtnEl = document.getElementById('playbackToggleBtn');
playbackToggleBtnEl.addEventListener('click', ()=>{
  if(playbackPlaying) stopPlayback(); else startPlayback();
});

let dayNightTimer = null;
let nextTransition = null;

async function scheduleDayNightUpdate(){
  if(!satrec) return;
  const stateEl = document.getElementById('dayNightState');
  const cdEl = document.getElementById('dayNightCountdown');

  const result = ISSAstro.findNextIlluminationChange(satrec, new Date());
  if(!result){
    cdEl.textContent = I18N.t('js.cannotCalculateNow');
    return;
  }
  nextTransition = result;
  stateEl.textContent = result.fromIlluminated ? I18N.t('js.towardNight') : I18N.t('js.towardDay');
  tickDayNight();
}

function tickDayNight(){
  clearInterval(dayNightTimer);
  dayNightTimer = setInterval(()=>{
    if(!nextTransition) return;
    const diff = nextTransition.time - new Date();
    const cdEl = document.getElementById('dayNightCountdown');
    if(diff <= 0){
      const label = nextTransition.toIlluminated ? I18N.t('js.sunrise') : I18N.t('js.sunset');
      cdEl.textContent = label + I18N.t('js.justHappened');
      clearInterval(dayNightTimer);
      scheduleDayNightUpdate();
      return;
    }
    const label = nextTransition.toIlluminated ? I18N.t('js.riseShort') : I18N.t('js.setShort');
    cdEl.textContent = I18N.t('js.nextInLabel', {label, dur: formatDuration(diff/1000)});
  }, 1000);
}

function formatDuration(totalSec){
  totalSec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(totalSec/3600);
  const m = Math.floor((totalSec%3600)/60);
  const s = Math.floor(totalSec%60);
  const parts = [];
  if(h>0) parts.push(h+' '+I18N.t('js.hourUnit'));
  if(m>0 || h>0) parts.push(m+' '+I18N.t('js.minuteUnit'));
  parts.push(s+' '+I18N.t('js.secondUnit'));
  return parts.join(' ');
}

const NOTIFY_LEAD_OPTIONS = [5, 10, 15, 30];
const NOTIFY_LEAD_DEFAULT = 5;
let notifyTimers = {};
let alarmTimerId = null;

function getNotifyLeadMin(){
  const sel = document.getElementById('notifyLeadSelect');
  if(sel && sel.value) return parseInt(sel.value, 10);
  try{
    const saved = parseInt(localStorage.getItem('istrack_notify_lead_min'), 10);
    if(NOTIFY_LEAD_OPTIONS.includes(saved)) return saved;
  }catch(e){}
  return NOTIFY_LEAD_DEFAULT;
}

function saveNotifyLeadMin(min){
  try{ localStorage.setItem('istrack_notify_lead_min', String(min)); }catch(e){}
}

function notifyStorageKey(date){
  return Math.round(date.getTime() / 60000);
}

function loadScheduledNotifyKeys(){
  try{
    const raw = JSON.parse(localStorage.getItem('istrack_notify_scheduled') || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  }catch(e){
    return new Set();
  }
}

function addScheduledNotifyKey(key){
  const set = loadScheduledNotifyKeys();
  set.add(key);
  try{ localStorage.setItem('istrack_notify_scheduled', JSON.stringify([...set])); }catch(e){}
}

function removeScheduledNotifyKey(key){
  const set = loadScheduledNotifyKeys();
  set.delete(key);
  try{ localStorage.setItem('istrack_notify_scheduled', JSON.stringify([...set])); }catch(e){}
}

function showPassNotification(pass, leadMin){
  const dir = ISSAstro.compassLabel(pass.maxAzRad);
  try{
    new Notification(I18N.t('js.notifyTitle'), {
      body: I18N.t('js.notifyBody', {elev: Math.round(pass.maxElevDeg), dir, min: leadMin}),
      tag: 'iss-pass-'+pass.start.getTime()
    });
  }catch(e){}
}

function armNotifyTimer(pass, leadMin, btn){
  const key = pass.start.getTime();
  clearTimeout(notifyTimers[key]);
  const leadMs = leadMin*60000;
  const delay = (pass.start.getTime() - leadMs) - Date.now();
  const fire = ()=>{
    showPassNotification(pass, leadMin);
    removeScheduledNotifyKey(notifyStorageKey(pass.start));
    delete notifyTimers[key];
    if(btn){ btn.innerHTML = `<i class="fa-regular fa-bell"></i> ${I18N.t('js.remindMe', {min: leadMin})}`; btn.classList.remove('active'); }
  };
  if(delay <= 0){
    if(pass.start.getTime() > Date.now()) fire();
    return;
  }
  notifyTimers[key] = setTimeout(fire, delay);
}

function scheduleNotificationForPass(pass, btn){
  if(!('Notification' in window)){
    if(btn) btn.textContent = I18N.t('js.notifyNotSupported');
    return;
  }
  const key = pass.start.getTime();

  if(btn && btn.classList.contains('active')){
    clearTimeout(notifyTimers[key]);
    delete notifyTimers[key];
    removeScheduledNotifyKey(notifyStorageKey(pass.start));
    btn.classList.remove('active');
    btn.innerHTML = `<i class="fa-regular fa-bell"></i> ${I18N.t('js.remindMe', {min: getNotifyLeadMin()})}`;
    return;
  }
  const leadMin = getNotifyLeadMin();
  const activate = ()=>{
    armNotifyTimer(pass, leadMin, btn);
    addScheduledNotifyKey(notifyStorageKey(pass.start));
    if(btn){
      btn.innerHTML = `<i class="fa-solid fa-bell"></i> ${I18N.t('js.notifyEnabled')}`;
      btn.classList.add('active');
    }
  };
  if(Notification.permission === 'granted'){
    activate();
  } else if(Notification.permission === 'denied'){
    if(btn) btn.textContent = I18N.t('js.notifyBlocked');
  } else {
    Notification.requestPermission().then(perm=>{
      if(perm === 'granted') activate();
      else if(btn) btn.textContent = I18N.t('js.notifyDenied');
    });
  }
}

function restoreScheduledNotifications(passes){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const scheduled = loadScheduledNotifyKeys();
  if(scheduled.size === 0) return;
  const leadMin = getNotifyLeadMin();
  passes.forEach((pass, i)=>{
    if(pass.start.getTime() <= Date.now()) return;
    if(!scheduled.has(notifyStorageKey(pass.start))) return;
    const btn = document.getElementById(`notifyBtn-${i}`);
    armNotifyTimer(pass, leadMin, btn);
    if(btn){
      btn.innerHTML = `<i class="fa-solid fa-bell"></i> ${I18N.t('js.notifyEnabled')}`;
      btn.classList.add('active');
    }
  });
}

function sendTestNotification(btn){
  if(!('Notification' in window)){
    if(btn) btn.textContent = I18N.t('js.notifyNotSupported');
    return;
  }
  const fire = ()=>{
    try{
      new Notification(I18N.t('js.notifyTitle'), { body: I18N.t('js.notifyTestBody'), tag: 'iss-pass-test' });
    }catch(e){}
  };
  if(Notification.permission === 'granted'){
    fire();
  } else if(Notification.permission === 'denied'){
    if(btn) btn.textContent = I18N.t('js.notifyBlocked');
  } else {
    Notification.requestPermission().then(perm=>{
      if(perm === 'granted') fire();
      else if(btn) btn.textContent = I18N.t('js.notifyDenied');
    });
  }
}

function pad2(n){ return String(n).padStart(2,'0'); }
function toICSDate(d){
  return d.getUTCFullYear()+pad2(d.getUTCMonth()+1)+pad2(d.getUTCDate())+'T'+
    pad2(d.getUTCHours())+pad2(d.getUTCMinutes())+pad2(d.getUTCSeconds())+'Z';
}
function buildICSForPass(pass, obs){
  const dir = ISSAstro.compassLabel(pass.maxAzRad);
  const uid = 'iss-pass-'+pass.start.getTime()+'@pos-kendali-iss';
  const lines = [
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Pos Kendali ISS//Lintasan ISS//ID',
    'BEGIN:VEVENT',
    'UID:'+uid,
    'DTSTAMP:'+toICSDate(new Date()),
    'DTSTART:'+toICSDate(pass.start),
    'DTEND:'+toICSDate(pass.end),
    'SUMMARY:'+I18N.t('js.icsSummary'),
    'DESCRIPTION:'+I18N.t('js.icsDescription', {elev: Math.round(pass.maxElevDeg), dir, dur: Math.round(pass.durationSec)}),
    'LOCATION:'+fmt(obs.lat)+', '+fmt(obs.lon),
    'END:VEVENT','END:VCALENDAR'
  ];
  return lines.join('\r\n');
}
function downloadICSForPass(pass){
  const ics = buildICSForPass(pass, observer);
  const blob = new Blob([ics], {type:'text/calendar;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lintasan-iss-'+pass.start.toISOString().slice(0,16).replace(/[:T]/g,'-')+'.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}

let audioCtx = null;
function ensureAudioCtx(){
  if(!audioCtx){
    try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){}
  }
  return audioCtx;
}
function playBeep(){
  const ctx = ensureAudioCtx();
  if(!ctx) return;
  if(ctx.state === 'suspended') ctx.resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime+0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.55);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime+0.6);
  if(navigator.vibrate) navigator.vibrate([180,80,180]);
}
function toggleAlarmForPass(pass, checkbox){
  clearTimeout(alarmTimerId);
  if(!checkbox.checked) return;
  ensureAudioCtx();
  const delay = pass.maxElevTime.getTime() - Date.now();
  if(delay <= 0) return;
  alarmTimerId = setTimeout(playBeep, delay);
}

const locateBtn = document.getElementById('locateBtn');
const passBody = document.getElementById('passBody');

locateBtn.addEventListener('click', ()=>{
  locateBtn.disabled = true;
  locateBtn.textContent = I18N.t('js.requestingLocationPermission');

  requestLocation(()=>{
    distanceLocateBtn.classList.add('hidden');
    runPassPrediction();
  }, err=>{
    locateBtn.disabled = false;
    locateBtn.textContent = I18N.t('js.tryAgain');
    passBody.innerHTML = `<button id="locateBtn2" class="locate-btn">${I18N.t('js.tryAgain')}</button><p class="error-note">${I18N.t('js.locationDeniedNote', {msg: err.message})}</p>`;
    document.getElementById('locateBtn2').addEventListener('click', ()=>location.reload());
  });
});

async function runPassPrediction(){
  if(!satrec){
    passBody.innerHTML = `<p class="placeholder">${I18N.t('js.waitingForTLE')}</p>`;
    setTimeout(runPassPrediction, 1200);
    return;
  }

  passBody.innerHTML = `
    <div class="pass-coords">${I18N.t('js.yourLocation', {lat: fmt(observer.lat), lon: fmt(observer.lon)})}</div>
    <div class="pass-progress" id="passProgress">${I18N.t('js.computingPasses', {pct: 0})}</div>
  `;

  const passes = await ISSAstro.findVisiblePasses(satrec, observer.lat, observer.lon, observer.alt, {
    days: 10,
    onProgress: (f)=>{
      const p = document.getElementById('passProgress');
      if(p) p.textContent = I18N.t('js.computingPasses', {pct: Math.round(f*100)});
    }
  });

  if(passes.length === 0){
    passBody.innerHTML = `
      <div class="pass-coords">${I18N.t('js.yourLocation', {lat: fmt(observer.lat), lon: fmt(observer.lon)})}</div>
      <p class="placeholder">${I18N.t('js.noPassesFound')}</p>
    `;
    return;
  }

  const rows = passes.map((p,i)=>{
    const dateStr = p.start.toLocaleDateString(I18N.locale(), {weekday:'long', day:'numeric', month:'long'});
    const timeStr = p.start.toLocaleTimeString(I18N.locale(), {hour:'2-digit', minute:'2-digit'});
    const endStr = p.end.toLocaleTimeString(I18N.locale(), {hour:'2-digit', minute:'2-digit'});
    const dir = ISSAstro.compassLabel(p.maxAzRad);
    const highlight = i===0 ? ' class="pass-row featured"' : ' class="pass-row"';

    const actionsHtml = `
        <div class="pass-actions">
          <button class="pass-action-btn" id="notifyBtn-${i}" data-pass-index="${i}"><i class="fa-regular fa-bell"></i> ${I18N.t('js.remindMe', {min: getNotifyLeadMin()})}</button>
          <button class="pass-action-btn" id="icsBtn-${i}" data-pass-index="${i}"><i class="fa-solid fa-calendar-plus"></i> ${I18N.t('js.addToCalendar')}</button>
        </div>
        ${i===0 ? `<label class="pass-alarm-row"><input type="checkbox" id="alarmCheckbox"> ${I18N.t('js.alarmLabel')}</label>` : ''}
      `;
    return `
      <div${highlight}>
        <div class="pass-date">${i===0?I18N.t('js.nextPassPrefix'):''}${dateStr}</div>
        <div class="pass-time">${timeStr}–${endStr} <span class="pass-detail">${I18N.t('js.durationPeakDir', {dur: Math.round(p.durationSec), elev: Math.round(p.maxElevDeg), dir})}</span></div>
        ${i===0 ? `<div class="pass-countdown" id="nextPassCountdown"></div>` : ''}
        ${actionsHtml}
      </div>
    `;
  }).join('');

  const leadOptionsHtml = NOTIFY_LEAD_OPTIONS.map(min=>
    `<option value="${min}"${min===getNotifyLeadMin()?' selected':''}>${I18N.t('js.notifyLeadOption', {min})}</option>`
  ).join('');

  passBody.innerHTML = `
    <div class="pass-coords">${I18N.t('js.yourLocation', {lat: fmt(observer.lat), lon: fmt(observer.lon)})}</div>
    <div class="notify-settings-row">
      <label for="notifyLeadSelect">${I18N.t('js.notifyLeadLabel')}</label>
      <select id="notifyLeadSelect">${leadOptionsHtml}</select>
      <button class="pass-action-btn" id="notifyTestBtn"><i class="fa-solid fa-bell"></i> ${I18N.t('js.notifyTest')}</button>
    </div>
    <div class="pass-list">${rows}</div>
    <p class="pass-action-note">${I18N.t('js.notifyOnlyTabOpen')}</p>
  `;

  const notifyLeadSelect = document.getElementById('notifyLeadSelect');

  autoFitAll('.pass-time, .pass-date', 9.5);
  if(notifyLeadSelect){
    notifyLeadSelect.addEventListener('change', ()=>{
      const min = parseInt(notifyLeadSelect.value, 10);
      saveNotifyLeadMin(min);

      passes.forEach((p,i)=>{
        const b = document.getElementById(`notifyBtn-${i}`);
        if(b && !b.classList.contains('active')) b.innerHTML = `<i class="fa-regular fa-bell"></i> ${I18N.t('js.remindMe', {min})}`;
      });
    });
  }
  const notifyTestBtn = document.getElementById('notifyTestBtn');
  if(notifyTestBtn) notifyTestBtn.addEventListener('click', ()=>sendTestNotification(notifyTestBtn));

  passes.forEach((p,i)=>{
    const notifyBtn = document.getElementById(`notifyBtn-${i}`);
    if(notifyBtn) notifyBtn.addEventListener('click', ()=>scheduleNotificationForPass(p, notifyBtn));
    const icsBtn = document.getElementById(`icsBtn-${i}`);
    if(icsBtn) icsBtn.addEventListener('click', ()=>downloadICSForPass(p));
  });
  const alarmCheckbox = document.getElementById('alarmCheckbox');
  if(alarmCheckbox) alarmCheckbox.addEventListener('change', ()=>toggleAlarmForPass(passes[0], alarmCheckbox));

  restoreScheduledNotifications(passes);

  const firstStart = passes[0].start;
  const cdEl = document.getElementById('nextPassCountdown');
  clearInterval(window._passCdTimer);
  window._passCdTimer = setInterval(()=>{
    const diff = firstStart - new Date();
    if(!cdEl) return;
    cdEl.textContent = diff > 0 ? I18N.t('js.inTime', {dur: formatDuration(diff/1000)}) : I18N.t('js.happeningNow');
  }, 1000);
}

const transitLocateBtn = document.getElementById('transitLocateBtn');
const transitBody = document.getElementById('transitBody');

if(transitLocateBtn){
  transitLocateBtn.addEventListener('click', ()=>{
    transitLocateBtn.disabled = true;
    transitLocateBtn.textContent = I18N.t('js.requestingLocationPermission');

    requestLocation(()=>{
      runTransitSearch();
    }, err=>{
      transitLocateBtn.disabled = false;
      transitLocateBtn.textContent = I18N.t('js.tryAgain');
      transitBody.innerHTML = `<button id="transitLocateBtn2" class="locate-btn">${I18N.t('js.tryAgain')}</button><p class="error-note">${I18N.t('js.locationDeniedNote', {msg: err.message})}</p>`;
      document.getElementById('transitLocateBtn2').addEventListener('click', ()=>location.reload());
    });
  });
}

async function runTransitSearch(){
  if(!satrec){
    transitBody.innerHTML = `<p class="placeholder">${I18N.t('js.waitingForTLE')}</p>`;
    setTimeout(runTransitSearch, 1200);
    return;
  }

  transitBody.innerHTML = `
    <div class="pass-coords">${I18N.t('js.yourLocation', {lat: fmt(observer.lat), lon: fmt(observer.lon)})}</div>
    <div class="pass-progress" id="transitProgress">${I18N.t('js.computingTransits', {pct: 0})}</div>
  `;

  const events = await ISSAstro.findIssTransits(satrec, observer.lat, observer.lon, observer.alt, {
    days: 10,
    onProgress: (f)=>{
      const p = document.getElementById('transitProgress');
      if(p) p.textContent = I18N.t('js.computingTransits', {pct: Math.round(f*100)});
    }
  });

  if(events.length === 0){
    transitBody.innerHTML = `
      <div class="pass-coords">${I18N.t('js.yourLocation', {lat: fmt(observer.lat), lon: fmt(observer.lon)})}</div>
      <p class="placeholder">${I18N.t('js.noTransitsFound')}</p>
    `;
    return;
  }

  const rows = events.map(e=>{
    const dateStr = e.time.toLocaleDateString(I18N.locale(), {weekday:'long', day:'numeric', month:'long'});
    const timeStr = e.time.toLocaleTimeString(I18N.locale(), {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    const dir = ISSAstro.compassLabel(e.issAzimuthDeg * ISSAstro.DEG2RAD);
    const targetLabel = e.target === 'sun' ? I18N.t('js.transitSun') : I18N.t('js.transitMoon');
    const targetIcon = e.target === 'sun' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
    const rowClass = e.isTransit ? 'pass-row featured' : 'pass-row';
    const statusLabel = e.isTransit ? `<i class="fa-solid fa-sparkles"></i> ${I18N.t('js.transitLikely')}` : I18N.t('js.transitNearMiss');
    const statusClass = e.isTransit ? 'transit-status transit-status-likely' : 'transit-status';
    return `
      <div class="${rowClass}">
        <div class="pass-date">${targetIcon} ${dateStr}</div>
        <div class="pass-time">${timeStr} <span class="pass-detail">${I18N.t('js.transitDetail', {target: targetLabel, sep: e.sepDeg.toFixed(2), elev: Math.round(e.issElevationDeg), dir})}</span></div>
        <div class="${statusClass}">${statusLabel}</div>
      </div>
    `;
  }).join('');

  transitBody.innerHTML = `
    <div class="pass-coords">${I18N.t('js.yourLocation', {lat: fmt(observer.lat), lon: fmt(observer.lon)})}</div>
    <div class="pass-list">${rows}</div>
  `;
  autoFitAll('.pass-time, .pass-date', 9.5);
}

const arActivateBtn = document.getElementById('arActivateBtn');
const arUnsupportedNote = document.getElementById('arUnsupportedNote');
const arFabBtn = document.getElementById('arFabBtn');
const arPanelEl = document.getElementById('arPanel');

function setArTriggersBusy(busy){
  if(arActivateBtn){
    arActivateBtn.disabled = busy;
    arActivateBtn.textContent = busy ? I18N.t('js.requestingLocationPermission') : I18N.t('idx.arActivate');
  }
  if(arFabBtn) arFabBtn.disabled = busy;
}

function startArOverlay(){
  ISSAR.open({
    getSatrec: ()=>satrec,
    getObserver: ()=>observer,

    getOtherSats: ()=> Object.keys(OTHER_SATS).map(key=>{
      const cfg = OTHER_SATS[key];
      const state = otherSatState[key];
      if(!state || !state.satrec) return null;
      const toggleEl = document.getElementById(`compareToggle-${key}`);
      if(toggleEl && !toggleEl.checked) return null;
      return { key, label: cfg.label, colorCss: cfg.colorCss, flag: cfg.flag, satrec: state.satrec };
    }).filter(Boolean),

    getNightSkyBodies: (lat, lon, alt, date)=> ISSAstro.getNightSkyBodies(lat, lon, alt, date),
    onClose: ()=>{}
  });
}

function requestArActivation(){
  if(!satrec){
    alert(I18N.t('ar.needTLE'));
    return;
  }
  // PENTING (iOS Safari): DeviceOrientationEvent.requestPermission() cuma mau
  // munculin dialog izin kalau dipanggil LANGSUNG dari dalam user-gesture
  // handler (klik ini). Kalau geolocation diminta duluan (di bawah), lalu
  // baru orientation permission diminta di dalam callback async-nya, iOS
  // sering nolak diam-diam karena "gesture"-nya udah dianggap kepakai/basi.
  // Makanya ini dipanggil di baris PALING AWAL handler klik, sebelum request
  // lokasi apa pun - begitu granted/denied, hasilnya nempel di ISSAR.open()
  // (yang manggil fungsi sama lagi nanti) tanpa perlu gesture baru.
  if(typeof ISSAR !== 'undefined' && ISSAR.requestOrientationPermission){
    ISSAR.requestOrientationPermission();
  }
  if(!observer){
    setArTriggersBusy(true);
    requestLocation(()=>{
      setArTriggersBusy(false);
      startArOverlay();
    }, err=>{
      setArTriggersBusy(false);
      alert(I18N.t('js.locationDeniedNote', {msg: err.message}));
    });
  } else {
    startArOverlay();
  }
}

if(arActivateBtn){
  if(typeof ISSAR === 'undefined' || !ISSAR.isSupported()){
    arActivateBtn.classList.add('hidden');
    if(arUnsupportedNote) arUnsupportedNote.classList.remove('hidden');
    if(arFabBtn) arFabBtn.classList.add('hidden');
  } else {
    arActivateBtn.addEventListener('click', requestArActivation);

    if(arFabBtn){
      arFabBtn.addEventListener('click', requestArActivation);

      if(arPanelEl && 'IntersectionObserver' in window){
        const arFabObserver = new IntersectionObserver((entries)=>{
          entries.forEach(entry=>{
            arFabBtn.classList.toggle('hidden', entry.isIntersecting);
          });
        }, { rootMargin: '-72px 0px 0px 0px', threshold: 0 });
        arFabObserver.observe(arPanelEl);
      } else {

        arFabBtn.classList.remove('hidden');
      }
    }
  }
}

function setUnitSystem(system){
  if(system !== 'metric' && system !== 'imperial') return;
  unitSystem = system;
  localStorage.setItem('istrack_units', unitSystem);
  const metricBtn = document.getElementById('unitBtnMetric');
  const imperialBtn = document.getElementById('unitBtnImperial');
  if(metricBtn) metricBtn.classList.toggle('active', unitSystem === 'metric');
  if(imperialBtn) imperialBtn.classList.toggle('active', unitSystem === 'imperial');
  reapplyUnits();
}
const unitBtnMetric = document.getElementById('unitBtnMetric');
const unitBtnImperial = document.getElementById('unitBtnImperial');
if(unitBtnMetric) unitBtnMetric.addEventListener('click', ()=>setUnitSystem('metric'));
if(unitBtnImperial) unitBtnImperial.addEventListener('click', ()=>setUnitSystem('imperial'));
setUnitSystem(unitSystem);

function tleObjectList(){
  const list = [{ key: 'iss', label: 'ISS (ZARYA)' }];
  Object.keys(OTHER_SATS).forEach(key=>list.push({ key, label: OTHER_SATS[key].label }));
  return list;
}

function parseTleEpoch(line1){
  const epochStr = line1.substring(18, 32).trim();
  const yy = parseInt(epochStr.substring(0, 2), 10);
  const dayOfYear = parseFloat(epochStr.substring(2));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const jan1 = Date.UTC(year, 0, 1);
  return new Date(jan1 + (dayOfYear - 1) * 86400000);
}

function tleAgeLabel(fetchedAt){
  const diffMin = Math.max(0, Math.round((new Date() - fetchedAt) / 60000));
  if(diffMin < 60) return I18N.t('idx.tleAgeValMin', {m: diffMin});
  return I18N.t('idx.tleAgeVal', {h: Math.round(diffMin / 60)});
}

function initTlePanel(){
  const body = document.getElementById('tleBody');
  if(!body) return;
  const options = tleObjectList().map(o=>`<option value="${o.key}">${o.label}</option>`).join('');
  body.innerHTML = `
    <div class="tle-select-row">
      <label for="tleSelect">${I18N.t('idx.tleSelectLabel')}</label>
      <select class="tle-select" id="tleSelect">${options}</select>
    </div>
    <div id="tleContent"><p class="placeholder">${I18N.t('idx.tleLoading')}</p></div>
  `;
  const select = document.getElementById('tleSelect');
  select.value = tleSelectedKey;
  select.addEventListener('change', ()=>{
    tleSelectedKey = select.value;
    renderTlePanel();
  });
  renderTlePanel();
}

function renderTlePanel(){
  const content = document.getElementById('tleContent');
  if(!content) return;
  const entry = tleStore[tleSelectedKey];
  if(!entry){
    content.innerHTML = `<p class="placeholder">${I18N.t('idx.tleUnavailable')}</p>`;
    return;
  }

  const epoch = parseTleEpoch(entry.line1);
  const epochStr = epoch.toLocaleString(I18N.locale(), { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC' }) + ' UTC';
  const ageStale = (new Date() - entry.fetchedAt) > 6*60*60*1000;

  const rec = entry.satrec;
  const incDeg = rec.inclo * 180 / Math.PI;
  const raanDeg = rec.nodeo * 180 / Math.PI;
  const argpDeg = rec.argpo * 180 / Math.PI;
  const maDeg = rec.mo * 180 / Math.PI;
  const meanMotionRevDay = rec.no * 1440 / (2 * Math.PI);
  const periodMin = 1440 / meanMotionRevDay;

  content.innerHTML = `
    <div class="tle-meta-row">
      <div class="tle-meta-item"><span class="k">${I18N.t('idx.tleNoradId')}</span><span class="v">${entry.catnr}</span></div>
      <div class="tle-meta-item"><span class="k">${I18N.t('idx.tleEpoch')}</span><span class="v">${epochStr}</span></div>
      <div class="tle-meta-item"><span class="k">${I18N.t('idx.tleAge')}</span><span class="v${ageStale ? ' stale' : ''}">${tleAgeLabel(entry.fetchedAt)}</span></div>
      <div class="tle-meta-item"><span class="k">${I18N.t('idx.tleSource')}</span><span class="v">${entry.source}</span></div>
    </div>

    <div class="tle-raw-block">
      <div class="tle-raw-name">${entry.label}</div>
      <div class="tle-raw-line">${entry.line1}</div>
      <div class="tle-raw-line">${entry.line2}</div>
    </div>

    <h3 class="tle-orbital-heading">${I18N.t('idx.tleOrbitalElements')}</h3>
    <div class="tle-orbital-grid">
      <div class="tle-orbital-item"><span class="k">${I18N.t('idx.tleInclination')}</span><span class="v">${fmt(incDeg,4)}°</span></div>
      <div class="tle-orbital-item"><span class="k">${I18N.t('idx.tleEccentricity')}</span><span class="v">${rec.ecco.toFixed(7)}</span></div>
      <div class="tle-orbital-item"><span class="k">${I18N.t('idx.tleRaan')}</span><span class="v">${fmt(raanDeg,4)}°</span></div>
      <div class="tle-orbital-item"><span class="k">${I18N.t('idx.tleArgPerigee')}</span><span class="v">${fmt(argpDeg,4)}°</span></div>
      <div class="tle-orbital-item"><span class="k">${I18N.t('idx.tleMeanAnomaly')}</span><span class="v">${fmt(maDeg,4)}°</span></div>
      <div class="tle-orbital-item"><span class="k">${I18N.t('idx.tleMeanMotion')}</span><span class="v">${fmt(meanMotionRevDay,8)} ${I18N.t('idx.tleMeanMotionUnit')}</span></div>
      <div class="tle-orbital-item"><span class="k">${I18N.t('idx.tlePeriod')}</span><span class="v">${fmt(periodMin,2)} min</span></div>
    </div>

    <div class="tle-actions">
      <button class="pass-action-btn" id="tleCopyBtn"><i class="fa-regular fa-copy"></i> ${I18N.t('idx.tleCopyBtn')}</button>
      <button class="pass-action-btn" id="tleDownloadBtn"><i class="fa-solid fa-download"></i> ${I18N.t('idx.tleDownloadBtn')}</button>
    </div>
  `;

  const copyBtn = document.getElementById('tleCopyBtn');
  if(copyBtn){
    copyBtn.addEventListener('click', async ()=>{
      const text = `${entry.label}\n${entry.line1}\n${entry.line2}`;
      try{
        await navigator.clipboard.writeText(text);
        const original = copyBtn.innerHTML;
        copyBtn.innerHTML = `<i class="fa-solid fa-check"></i> ${I18N.t('idx.tleCopiedBtn')}`;
        setTimeout(()=>{ copyBtn.innerHTML = original; }, 1800);
      }catch(e){  }
    });
  }
  const downloadBtn = document.getElementById('tleDownloadBtn');
  if(downloadBtn){
    downloadBtn.addEventListener('click', ()=>{
      const text = `${entry.label}\n${entry.line1}\n${entry.line2}\n`;
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tleSelectedKey}.tle`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }
}

initTlePanel();

function initSatAddBox(){
  const form = document.getElementById('satAddForm');
  const input = document.getElementById('satAddInput');
  const resultsEl = document.getElementById('satAddResults');
  if(!form || !input || !resultsEl) return;

  let searchToken = 0;

  function renderAddResultRow(candidate){
    const row = document.createElement('div');
    row.className = 'sat-add-result-row';
    row.innerHTML = `
      <span class="sat-add-result-name">${candidate.name}</span>
      <span class="sat-add-result-meta">NORAD ${candidate.catnr}</span>
      <button type="button" class="sat-add-take-btn">${I18N.t('js.satAddBtnLabel')}</button>
    `;
    const btn = row.querySelector('.sat-add-take-btn');
    btn.addEventListener('click', ()=>{
      btn.disabled = true;
      const result = addCustomSatellite(candidate);
      if(result.ok){
        btn.textContent = I18N.t('js.satAddedToast');
        row.classList.add('is-added');
      } else {
        btn.textContent = I18N.t('js.satAddAlreadyTracked');
      }
    });
    return row;
  }

  function renderStatus(text, isError){
    resultsEl.innerHTML = `<p class="${isError ? 'error-note' : 'placeholder'}">${text}</p>`;
  }

  async function runSearch(query){
    const token = ++searchToken;
    query = query.trim();
    if(!query) return;
    renderStatus(I18N.t('js.satAddSearching'), false);

    let candidates = [];
    try{
      if(/^\d+$/.test(query)){
        candidates = [await lookupSatelliteByCatnr(query)];
      } else {
        candidates = await searchSatellitesByName(query);
      }
    }catch(err){
      if(token !== searchToken) return;
      renderStatus(I18N.t('js.satAddError'), true);
      return;
    }
    if(token !== searchToken) return;

    if(!candidates.length){
      renderStatus(I18N.t('js.satAddNoResults'), false);
      return;
    }
    resultsEl.innerHTML = '';
    candidates.forEach(c => resultsEl.appendChild(renderAddResultRow(c)));
  }

  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    runSearch(input.value);
  });
}
initSatAddBox();

start();
fetchCrew();
fetchDocking();
renderCrewTimeline();
fetchApod();
fetchTLE();
fetchAllOtherSatTLEs();
loadIssActivity();
setInterval(fetchCrew, 60000);
setInterval(fetchDocking, 5*60*1000);
setInterval(renderCrewTimeline, 60*1000);
setInterval(fetchTLE, 6*60*60*1000);
setInterval(fetchAllOtherSatTLEs, 6*60*60*1000);

setInterval(loadIssActivity, 30*60*1000);
