(function(){
  'use strict';

  const CARD_W = 1080, CARD_H = 1920;

  const EARTH_MAP_URL = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg';

  const COLOR = {
    bgDeep: '#000000',
    bgPanel: '#0b1122',
    bgPanel2: '#0e1528',
    grid: '#1c2744',
    gridStrong: '#2a3a63',
    ember: '#ff7a45',
    emberDim: '#7a3d24',
    cyan: '#5fd3c4',
    star: '#e9edf6',
    muted: '#8493ae'
  };

  let earthImg = null, earthImgPromise = null;
  function loadEarthImage(){
    if(earthImgPromise) return earthImgPromise;
    earthImgPromise = new Promise((resolve)=>{
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = ()=>{ earthImg = img; resolve(img); };
      img.onerror = ()=> resolve(null);
      img.src = EARTH_MAP_URL;
    });
    return earthImgPromise;
  }

  let logoImg = null, logoImgPromise = null;
  function loadLogo(){
    if(logoImgPromise) return logoImgPromise;
    logoImgPromise = new Promise((resolve)=>{
      const img = new Image();
      img.onload = ()=>{ logoImg = img; resolve(img); };
      img.onerror = ()=> resolve(null);
      img.src = 'assets/istrack-logo.png';
    });
    return logoImgPromise;
  }

  async function ensureFonts(){
    if(!document.fonts || !document.fonts.load) return;
    const specs = [
      '700 88px "Space Grotesk"', '600 40px "Space Grotesk"',
      '600 30px "IBM Plex Mono"', '600 48px "IBM Plex Mono"',
      '500 30px "IBM Plex Mono"', '600 26px "IBM Plex Mono"',
      '500 32px "Inter"', '500 30px "Inter"'
    ];
    try{ await Promise.all(specs.map(s=>document.fonts.load(s))); }catch(e){}
    try{ await document.fonts.ready; }catch(e){}
  }

  function lonLatToXY(lon, lat, x0, y0, w, h){
    return { x: x0 + ((lon+180)/360)*w, y: y0 + ((90-lat)/180)*h };
  }

  function roundRect(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  function drawStars(ctx, w, h, n){
    ctx.save();
    ctx.fillStyle = COLOR.star;
    for(let i=0;i<n;i++){
      const x = Math.random()*w, y = Math.random()*h*0.6;
      const r = Math.random()*1.3 + 0.2;
      ctx.globalAlpha = Math.random()*0.55 + 0.12;
      ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  async function buildIssNowCard(){
    const data = (typeof lastTelemetry !== 'undefined') ? lastTelemetry : null;
    if(!data) throw new Error('no-telemetry');

    await Promise.all([loadEarthImage(), loadLogo(), ensureFonts()]);

    const canvas = document.createElement('canvas');
    canvas.width = CARD_W; canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');

    const bgGrad = ctx.createLinearGradient(0,0,0,CARD_H);
    bgGrad.addColorStop(0, COLOR.bgDeep);
    bgGrad.addColorStop(0.55, COLOR.bgPanel);
    bgGrad.addColorStop(1, COLOR.bgDeep);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0,0,CARD_W,CARD_H);
    drawStars(ctx, CARD_W, CARD_H, 130);

    const pad = 64;
    const headerY = 108;

    if(logoImg){ ctx.drawImage(logoImg, pad, headerY-34, 68, 68); }
    ctx.fillStyle = COLOR.star;
    ctx.font = '600 40px "Space Grotesk", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('ISTrack', pad + (logoImg?86:0), headerY);

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLOR.ember;
    ctx.font = '600 30px "IBM Plex Mono", monospace';
    ctx.fillText(I18N.t('share.cardEyebrow').toUpperCase(), pad, headerY + 96);

    ctx.fillStyle = COLOR.star;
    ctx.font = '700 88px "Space Grotesk", sans-serif';
    ctx.fillText(I18N.t('share.cardTitle'), pad, headerY + 176);

    const mapX = pad, mapY = headerY + 220, mapW = CARD_W - pad*2, mapH = Math.round(mapW*0.62);
    ctx.save();
    roundRect(ctx, mapX, mapY, mapW, mapH, 28);
    ctx.clip();
    ctx.fillStyle = COLOR.bgPanel2;
    ctx.fillRect(mapX, mapY, mapW, mapH);

    if(earthImg){
      const srcAspect = earthImg.width/earthImg.height;
      const dstAspect = mapW/mapH;
      let sx=0, sy=0, sw=earthImg.width, sh=earthImg.height;
      if(srcAspect > dstAspect){ sw = sh*dstAspect; sx = (earthImg.width-sw)/2; }
      else { sh = sw/dstAspect; sy = (earthImg.height-sh)/2; }
      ctx.globalAlpha = 0.85;
      ctx.drawImage(earthImg, sx, sy, sw, sh, mapX, mapY, mapW, mapH);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(11,17,34,0.45)';
      ctx.fillRect(mapX, mapY, mapW, mapH);
    }

    ctx.strokeStyle = COLOR.grid;
    ctx.lineWidth = 1;
    for(let lo=-180; lo<=180; lo+=30){
      const p = lonLatToXY(lo, 0, mapX, mapY, mapW, mapH);
      ctx.beginPath(); ctx.moveTo(p.x, mapY); ctx.lineTo(p.x, mapY+mapH); ctx.stroke();
    }
    for(let la=-60; la<=60; la+=30){
      const p = lonLatToXY(0, la, mapX, mapY, mapW, mapH);
      ctx.beginPath(); ctx.moveTo(mapX, p.y); ctx.lineTo(mapX+mapW, p.y); ctx.stroke();
    }
    ctx.strokeStyle = COLOR.gridStrong;
    const eq = lonLatToXY(0,0,mapX,mapY,mapW,mapH);
    ctx.beginPath(); ctx.moveTo(mapX, eq.y); ctx.lineTo(mapX+mapW, eq.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(eq.x, mapY); ctx.lineTo(eq.x, mapY+mapH); ctx.stroke();

    const trailPts = (typeof trail !== 'undefined') ? trail : [];
    if(trailPts.length > 1){
      for(let i=1;i<trailPts.length;i++){
        const a = trailPts[i-1], b = trailPts[i];
        if(Math.abs(a.lon-b.lon) > 180) continue;
        const pa = lonLatToXY(a.lon, a.lat, mapX, mapY, mapW, mapH);
        const pb = lonLatToXY(b.lon, b.lat, mapX, mapY, mapW, mapH);
        ctx.strokeStyle = `rgba(255,122,69,${0.1 + (i/trailPts.length)*0.55})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(pa.x,pa.y); ctx.lineTo(pb.x,pb.y); ctx.stroke();
      }
    }

    const cur = lonLatToXY(data.longitude, data.latitude, mapX, mapY, mapW, mapH);
    const halo = ctx.createRadialGradient(cur.x,cur.y,0,cur.x,cur.y,34);
    halo.addColorStop(0, 'rgba(255,122,69,0.55)');
    halo.addColorStop(1, 'rgba(255,122,69,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cur.x, cur.y, 34, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = COLOR.ember;
    ctx.beginPath(); ctx.arc(cur.x, cur.y, 9, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = COLOR.star;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.restore();

    ctx.strokeStyle = COLOR.gridStrong;
    ctx.lineWidth = 2;
    roundRect(ctx, mapX, mapY, mapW, mapH, 28);
    ctx.stroke();

    let statsY = mapY + mapH + 76;

    const overEl = document.getElementById('liveOver');
    const overText = (overEl && overEl.textContent && overEl.textContent.trim() !== '--')
      ? overEl.textContent.trim() : null;
    if(overText){
      ctx.fillStyle = COLOR.muted;
      ctx.font = '500 30px "Inter", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(I18N.t('share.overPrefix') + ': ' + overText, mapX, statsY);
      statsY += 60;
    }

    const dU = distUnitLabel(), sU = speedUnitLabel();
    const stats = [
      { k: I18N.t('share.lat'), v: fmt(data.latitude) + '°' },
      { k: I18N.t('share.lon'), v: fmt(data.longitude) + '°' },
      { k: I18N.t('share.alt'), v: fmt(toDist(data.altitude),1) + ' ' + dU },
      { k: I18N.t('share.vel'), v: fmt(toSpeed(data.velocity),0) + ' ' + sU }
    ];
    const colW = mapW/2, rowH = 128;
    stats.forEach((s, i)=>{
      const col = i % 2, row = Math.floor(i/2);
      const cx = mapX + col*colW;
      const cy = statsY + row*rowH;
      ctx.fillStyle = COLOR.muted;
      ctx.font = '600 26px "IBM Plex Mono", monospace';
      ctx.fillText(s.k, cx, cy);
      ctx.fillStyle = COLOR.star;
      ctx.font = '600 48px "IBM Plex Mono", monospace';
      ctx.fillText(s.v, cx, cy + 52);
    });

    const dt = new Date(data.timestamp*1000);
    const timeStr = dt.toLocaleString(I18N.locale(), {
      hour:'2-digit', minute:'2-digit', day:'2-digit', month:'short', year:'numeric', hour12:false
    });
    let tzLabel = '';
    try{ tzLabel = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }catch(e){}
    const timeY = statsY + rowH*2 + 30;
    ctx.strokeStyle = COLOR.grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mapX, timeY-40); ctx.lineTo(mapX+mapW, timeY-40); ctx.stroke();
    ctx.fillStyle = COLOR.cyan;
    ctx.font = '500 30px "IBM Plex Mono", monospace';
    ctx.fillText(timeStr + (tzLabel ? '  ('+tzLabel+')' : ''), mapX, timeY);

    const footerY = CARD_H - 96;
    ctx.textAlign = 'center';
    ctx.fillStyle = COLOR.muted;
    ctx.font = '500 32px "Inter", sans-serif';
    ctx.fillText(I18N.t('share.tagline'), CARD_W/2, footerY);
    ctx.fillStyle = COLOR.emberDim;
    ctx.font = '600 24px "IBM Plex Mono", monospace';
    ctx.fillText('#ISTrack #ISSNow', CARD_W/2, footerY + 44);

    return { canvas, data };
  }

  function canvasToBlob(canvas){
    return new Promise((resolve)=> canvas.toBlob(resolve, 'image/png', 0.95));
  }

  function initUI(){
    const btn = document.getElementById('shareIssBtn');
    const backdrop = document.getElementById('shareModalBackdrop');
    const closeBtn = document.getElementById('shareModalClose');
    const imgEl = document.getElementById('shareModalImg');
    const noteEl = document.getElementById('shareModalNote');
    const shareBtn = document.getElementById('shareModalShareBtn');
    const downloadBtn = document.getElementById('shareModalDownloadBtn');
    if(!btn || !backdrop) return;

    let currentBlob = null;
    let currentData = null;
    let objectUrl = null;

    function closeModal(){
      backdrop.classList.add('hidden');
      if(objectUrl){ URL.revokeObjectURL(objectUrl); objectUrl = null; }
    }

    function showNote(text){
      if(!noteEl) return;
      noteEl.textContent = text;
      noteEl.classList.toggle('hidden', !text);
    }

    async function openCard(){
      btn.disabled = true;
      const originalHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> <span>' + I18N.t('share.generating') + '</span>';
      try{
        const { canvas, data } = await buildIssNowCard();
        currentData = data;
        currentBlob = await canvasToBlob(canvas);
        if(objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(currentBlob);
        imgEl.src = objectUrl;
        showNote('');
        backdrop.classList.remove('hidden');
      }catch(err){
        showNote(I18N.t('share.errorNote'));
        backdrop.classList.remove('hidden');
        imgEl.removeAttribute('src');
      }finally{
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    }

    async function doShare(){
      if(!currentBlob) return;
      const file = new File([currentBlob], 'iss-now.png', { type: 'image/png' });
      const shareText = I18N.t('share.shareText', {
        lat: currentData ? fmt(currentData.latitude) : '--',
        lon: currentData ? fmt(currentData.longitude) : '--'
      });
      if(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })){
        try{
          await navigator.share({ files: [file], title: 'ISS Now - ISTrack', text: shareText });
          return;
        }catch(err){
          if(err && err.name === 'AbortError') return;

        }
      }
      triggerDownload();
      showNote(I18N.t('share.fallbackNote'));
    }

    function triggerDownload(){
      if(!objectUrl) return;
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = 'iss-now.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    btn.addEventListener('click', openCard);
    closeBtn && closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e)=>{ if(e.target === backdrop) closeModal(); });
    document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeModal(); });
    shareBtn && shareBtn.addEventListener('click', doShare);
    downloadBtn && downloadBtn.addEventListener('click', triggerDownload);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }

  window.ISSShareCard = { build: buildIssNowCard };
})();
