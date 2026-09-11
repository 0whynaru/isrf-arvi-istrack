(function(){

  const mapcard = document.querySelector('.mapcard');
  const layersPanel = document.getElementById('mapLayersPanel');
  const filterPanel = document.getElementById('mapFilterPanel');
  const layersBtn = document.getElementById('mapLayersBtn');
  const filterBtn = document.getElementById('mapFilterBtn');
  if(!mapcard || !layersPanel || !filterPanel) return;

  function closeAllPanels(){
    layersPanel.classList.add('hidden');
    filterPanel.classList.add('hidden');
    layersBtn.classList.remove('active');
    filterBtn.classList.remove('active');
  }

  function togglePanel(panel, btn){
    const willOpen = panel.classList.contains('hidden');
    closeAllPanels();
    if(willOpen){
      panel.classList.remove('hidden');
      btn.classList.add('active');
    }
  }

  layersBtn.addEventListener('click', ()=> togglePanel(layersPanel, layersBtn));
  filterBtn.addEventListener('click', ()=> togglePanel(filterPanel, filterBtn));
  document.querySelectorAll('[data-close-panel]').forEach(btn=>{
    btn.addEventListener('click', closeAllPanels);
  });
  document.addEventListener('click', (e)=>{
    if(!mapcard.contains(e.target)) closeAllPanels();
  });

  const zoomInBtn = document.getElementById('mapZoomInBtn');
  const zoomOutBtn = document.getElementById('mapZoomOutBtn');
  const followBtn = document.getElementById('mapFollowBtn');
  const fullscreenBtn = document.getElementById('mapFullscreenBtn');

  if(zoomInBtn) zoomInBtn.addEventListener('click', ()=>{ try{ ISSGlobe.zoomBy(-0.4); }catch(e){} });
  if(zoomOutBtn) zoomOutBtn.addEventListener('click', ()=>{ try{ ISSGlobe.zoomBy(0.4); }catch(e){} });

  function syncFollowBtnUI(){
    if(!followBtn) return;
    let on = true;
    try{ on = ISSGlobe.isAutoRotate(); }catch(e){}
    followBtn.classList.toggle('active', on);
    const label = window.I18N ? I18N.t(on ? 'map.followOn' : 'map.followOff') : (on ? 'Putar otomatis: aktif' : 'Putar otomatis: nonaktif');
    followBtn.title = label;
    followBtn.setAttribute('aria-label', label);
  }
  if(followBtn){
    followBtn.addEventListener('click', ()=>{
      try{ ISSGlobe.setAutoRotate(!ISSGlobe.isAutoRotate()); }catch(e){}
      syncFollowBtnUI();
    });

    setInterval(syncFollowBtnUI, 800);
    syncFollowBtnUI();
  }

  if(fullscreenBtn){
    fullscreenBtn.addEventListener('click', ()=>{
      if(!document.fullscreenElement){
        mapcard.requestFullscreen().catch(()=>{});
      } else {
        document.exitFullscreen().catch(()=>{});
      }
    });
    document.addEventListener('fullscreenchange', ()=>{
      fullscreenBtn.classList.toggle('active', !!document.fullscreenElement);
    });
  }

  const gridToggle = document.getElementById('layerGridToggle');
  const dayNightToggle = document.getElementById('layerDayNightToggle');
  const trailToggle = document.getElementById('layerTrailToggle');
  const futureToggle = document.getElementById('layerFutureToggle');
  const glowSlider = document.getElementById('layerGlowSlider');

  if(gridToggle) gridToggle.addEventListener('change', ()=>{ try{ ISSGlobe.setGridVisible(gridToggle.checked); }catch(e){} });
  if(trailToggle) trailToggle.addEventListener('change', ()=>{ try{ ISSGlobe.setTrailVisible(trailToggle.checked); }catch(e){} });
  if(futureToggle) futureToggle.addEventListener('change', ()=>{ try{ ISSGlobe.setFutureVisible(futureToggle.checked); }catch(e){} });
  if(glowSlider) glowSlider.addEventListener('input', ()=>{ try{ ISSGlobe.setGlowOpacity(Number(glowSlider.value)); }catch(e){} });

  function refreshDayNight(){
    const enabled = dayNightToggle ? dayNightToggle.checked : true;
    try{
      const sub = (window.ISSAstro && ISSAstro.getSubsolarPoint) ? ISSAstro.getSubsolarPoint(new Date()) : null;
      ISSGlobe.setDayNight(enabled, sub ? sub.lat : undefined, sub ? sub.lon : undefined);
    }catch(e){}
  }
  if(dayNightToggle) dayNightToggle.addEventListener('change', refreshDayNight);

  function applyInitialLayerState(){
    if(typeof ISSGlobe === 'undefined' || !ISSGlobe.setGlowOpacity){
      return setTimeout(applyInitialLayerState, 200);
    }
    if(glowSlider) ISSGlobe.setGlowOpacity(Number(glowSlider.value));
    refreshDayNight();
    setInterval(refreshDayNight, 60000);
  }
  applyInitialLayerState();

  const filterBody = document.getElementById('mapFilterBody');

  function renderFilterPanel(){
    if(!filterBody || typeof OTHER_SATS === 'undefined') return setTimeout(renderFilterPanel, 200);

    const filterBar = `
      <div class="sat-filter-bar" id="mapSatFilterBar">
        ${SAT_CATEGORIES.map(c => `<button class="sat-filter-btn${c.key===activeSatFilter?' active':''}" data-filter="${c.key}">${c.label}</button>`).join('')}
      </div>
    `;

    const issRow = `
      <div class="sat-row sat-primary">
        <span class="sat-dot" style="background:var(--ember)"></span>
        <span class="sat-flag"><i class="fa-solid fa-satellite"></i></span>
        <span class="sat-name">ISS (ZARYA)</span>
        <span class="sat-badge">LIVE</span>
      </div>
    `;

    const otherRows = Object.keys(OTHER_SATS).map(key=>{
      const cfg = OTHER_SATS[key];
      const removeBtn = cfg.custom
        ? `<button class="sat-remove-btn" data-remove-key="${key}" title="${window.I18N ? I18N.t('js.satRemoveBtnTitle') : 'Hapus dari daftar'}" aria-label="${window.I18N ? I18N.t('js.satRemoveBtnTitle') : 'Hapus dari daftar'}"><i class="fa-solid fa-xmark"></i></button>`
        : '';
      return `
        <div class="sat-row" data-category="${cfg.category}">
          <span class="sat-dot" style="background:${cfg.colorCss}"></span>
          <span class="sat-flag">${cfg.flag||'<i class="fa-solid fa-satellite"></i>'}</span>
          <span class="sat-name">${cfg.label}</span>
          <input type="checkbox" class="sat-toggle" id="compareToggle-${key}" checked title="${window.I18N ? I18N.t('js.satShowOnGlobe') : 'Tampilkan di globe'}">
          ${removeBtn}
        </div>
      `;
    }).join('');

    filterBody.innerHTML = `${filterBar}<div class="sat-list">${issRow}${otherRows}</div>`;

    applyMapFilterRows();

    filterBody.querySelectorAll('.sat-filter-btn').forEach(btn=>{
      btn.addEventListener('click', ()=> setActiveSatFilter(btn.dataset.filter));
    });
    filterBody.querySelectorAll('.sat-toggle').forEach(cb=>{
      cb.addEventListener('change', ()=>{ try{ updateCompareCharts(); }catch(e){} });
    });
    filterBody.querySelectorAll('[data-remove-key]').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        if(window.removeCustomSatellite) window.removeCustomSatellite(btn.dataset.removeKey);
      });
    });
  }
  window.renderMapFilterPanel = renderFilterPanel;

  function applyMapFilterRows(){
    filterBody.querySelectorAll('#mapFilterBody .sat-row:not(.sat-primary)').forEach(row=>{
      const show = activeSatFilter === 'all' || row.dataset.category === activeSatFilter;
      row.style.display = show ? '' : 'none';
    });
  }

  window.setActiveSatFilter = function(key){
    activeSatFilter = key;
    document.querySelectorAll('#satFilterBar .sat-filter-btn, #mapSatFilterBar .sat-filter-btn').forEach(b=>{
      b.classList.toggle('active', b.dataset.filter === key);
    });
    try{ applyCompareFilter(); }catch(e){}
    applyMapFilterRows();
    try{ updateCompareCharts(); }catch(e){}
  };

  renderFilterPanel();

})();
