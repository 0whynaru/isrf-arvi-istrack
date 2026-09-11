(() => {
  const API_BASE = 'https://newsdata.io/api/1/latest';
  const STORAGE_KEY = 'warta_newsdata_apikey';

  const categoryMeta = {
    top:           { get label(){ return I18N.t('news.cat.top'); },           icon: 'fa-fire' },
    world:         { get label(){ return I18N.t('news.cat.world'); },         icon: 'fa-earth-asia' },
    politics:      { get label(){ return I18N.t('news.cat.politics'); },      icon: 'fa-landmark' },
    business:      { get label(){ return I18N.t('news.cat.business'); },      icon: 'fa-briefcase' },
    technology:    { get label(){ return I18N.t('news.cat.technology'); },    icon: 'fa-microchip' },
    sports:        { get label(){ return I18N.t('news.cat.sports'); },        icon: 'fa-futbol' },
    entertainment: { get label(){ return I18N.t('news.cat.entertainment'); }, icon: 'fa-clapperboard' },
    health:        { get label(){ return I18N.t('news.cat.health'); },        icon: 'fa-heart-pulse' },
    science:       { get label(){ return I18N.t('news.cat.science'); },       icon: 'fa-flask' }
  };

  const state = {
    category: 'top',
    query: '',
    nextPage: null,
    loading: false,
    articles: []
  };

  const els = {
    tickerTrack: document.getElementById('tickerTrack'),
    clockText: document.getElementById('clockText'),
    chipBar: document.getElementById('chipBar'),
    heroSlot: document.getElementById('heroSlot'),
    newsGrid: document.getElementById('newsGrid'),
    stateRow: document.getElementById('stateRow'),
    loadMoreRow: document.getElementById('loadMoreRow'),
    loadMoreBtn: document.getElementById('loadMoreBtn'),
    searchForm: document.getElementById('searchForm'),
    searchInput: document.getElementById('searchInput'),
    apiModal: document.getElementById('apiModal'),
    apiKeyInput: document.getElementById('apiKeyInput'),
    saveKeyBtn: document.getElementById('saveKeyBtn'),
    modalError: document.getElementById('modalError'),
    changeKeyBtn: document.getElementById('changeKeyBtn')
  };

  function tickClock() {
    els.clockText.textContent = new Date().toLocaleTimeString(I18N.locale(), { hour12: false });
  }
  tickClock();
  setInterval(tickClock, 1000);

  function relativeTime(dateStr) {
    const then = new Date(dateStr.replace(' ', 'T') + 'Z');
    const diffMin = Math.round((Date.now() - then.getTime()) / 60000);
    if (diffMin < 1) return I18N.t('news.justNow');
    if (diffMin < 60) return I18N.t('news.minutesAgo', {n: diffMin});
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return I18N.t('news.hoursAgo', {n: diffHr});
    const diffDay = Math.round(diffHr / 24);
    return I18N.t('news.daysAgo', {n: diffDay});
  }

  function getKey() {
    return localStorage.getItem(STORAGE_KEY) || '';
  }

  function showModal(message) {
    els.apiModal.classList.remove('hidden');
    if (message) {
      els.modalError.textContent = message;
      els.modalError.classList.remove('hidden');
    } else {
      els.modalError.classList.add('hidden');
    }
  }

  function hideModal() {
    els.apiModal.classList.add('hidden');
  }

  els.saveKeyBtn.addEventListener('click', () => {
    const key = els.apiKeyInput.value.trim();
    if (!key) {
      els.modalError.textContent = I18N.t('news.pasteKeyFirst');
      els.modalError.classList.remove('hidden');
      return;
    }
    localStorage.setItem(STORAGE_KEY, key);
    hideModal();
    fetchNews({ reset: true });
  });

  els.changeKeyBtn.addEventListener('click', () => {
    els.apiKeyInput.value = getKey();
    showModal();
  });

  els.chipBar.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.category = chip.dataset.cat;
    els.searchInput.value = '';
    state.query = '';
    fetchNews({ reset: true });
  });

  els.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    state.query = els.searchInput.value.trim();
    fetchNews({ reset: true });
  });

  function renderTicker(articles) {
    const headlines = articles.slice(0, 8).map(a => a.title).filter(Boolean);
    if (!headlines.length) return;
    const html = headlines.map(h => `<span class="ticker-item">${escapeHtml(h)}</span>`).join('<span class="ticker-item">•</span>');
    els.tickerTrack.innerHTML = html + html;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function categoryTagOf(article) {
    const cat = (article.category && article.category[0]) || state.category;
    const meta = categoryMeta[cat] || categoryMeta.top;
    return meta;
  }

  function renderHero(article) {
    if (!article) {
      els.heroSlot.innerHTML = '';
      return;
    }
    const meta = categoryTagOf(article);
    const img = article.image_url ? `style="background-image:url('${article.image_url}')"` : '';
    els.heroSlot.innerHTML = `
      <a class="hero-card" href="${article.link}" target="_blank" rel="noopener" ${img}>
        <div class="hero-inner">
          <span class="hero-tag"><i class="fa-solid ${meta.icon}"></i>${meta.label}</span>
          <h2 class="hero-title">${escapeHtml(article.title || '')}</h2>
          <p class="hero-excerpt">${escapeHtml((article.description || '').slice(0, 160))}</p>
          <div class="hero-meta">
            <span>${escapeHtml(article.source_name || article.source_id || I18N.t('news.defaultSource'))}</span>
            <span class="sep">•</span>
            <span>${relativeTime(article.pubDate)}</span>
          </div>
        </div>
      </a>`;
  }

  function cardHtml(article, index) {
    const meta = categoryTagOf(article);
    const media = article.image_url
      ? `<img src="${article.image_url}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<i class=\\'fa-solid fa-image\\'></i>'">`
      : `<i class="fa-solid fa-image"></i>`;
    return `
      <a class="card" href="${article.link}" target="_blank" rel="noopener" style="animation-delay:${Math.min(index, 8) * 45}ms">
        <div class="card-media">${media}</div>
        <div class="card-body">
          <span class="card-tag"><i class="fa-solid ${meta.icon}"></i>${meta.label}</span>
          <h3 class="card-title">${escapeHtml(article.title || '')}</h3>
          <p class="card-excerpt">${escapeHtml(article.description || '')}</p>
          <div class="card-meta">
            <span>${escapeHtml(article.source_name || article.source_id || I18N.t('news.defaultSource'))}</span>
            <span class="sep">•</span>
            <span>${relativeTime(article.pubDate)}</span>
          </div>
        </div>
      </a>`;
  }

  function renderGrid(articles, { append } = {}) {
    const html = articles.map((a, i) => cardHtml(a, i)).join('');
    if (append) {
      els.newsGrid.insertAdjacentHTML('beforeend', html);
    } else {
      els.newsGrid.innerHTML = html;
    }
  }

  function renderSkeletons(count) {
    const skel = Array.from({ length: count }).map(() => `
      <div class="skel-card">
        <div class="skel-media"></div>
        <div class="skel-body">
          <div class="skel-line w40"></div>
          <div class="skel-line w90"></div>
          <div class="skel-line w60"></div>
        </div>
      </div>`).join('');
    els.newsGrid.innerHTML = skel;
    els.heroSlot.innerHTML = `<div class="skel-card" style="min-height:340px;"><div class="skel-media" style="aspect-ratio:auto;height:100%;"></div></div>`;
  }

  function renderState({ icon, text, showRetry }) {
    els.stateRow.classList.remove('hidden');
    els.stateRow.innerHTML = `
      <i class="fa-solid ${icon}"></i>
      <p>${text}</p>
      ${showRetry ? `<button class="loadmore-btn" id="retryBtn"><i class="fa-solid fa-arrows-rotate"></i>${I18N.t('news.retry')}</button>` : ''}`;
    if (showRetry) {
      document.getElementById('retryBtn').addEventListener('click', () => fetchNews({ reset: true }));
    }
  }

  function clearState() {
    els.stateRow.classList.add('hidden');
    els.stateRow.innerHTML = '';
  }

  async function fetchNews({ reset }) {
    if (state.loading) return;
    const key = getKey();
    if (!key) {
      showModal();
      return;
    }

    state.loading = true;
    clearState();
    els.loadMoreRow.classList.add('hidden');

    if (reset) {
      state.nextPage = null;
      state.articles = [];
      renderSkeletons(6);
    } else {
      els.loadMoreBtn.disabled = true;
      els.loadMoreBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i>'+I18N.t('news.loading');
    }

    const params = new URLSearchParams({ apikey: key, language: I18N.getLang() });
    if (state.category !== 'top') params.set('category', state.category);
    if (state.query) params.set('q', state.query);
    if (!reset && state.nextPage) params.set('page', state.nextPage);

    try {
      const res = await fetch(`${API_BASE}?${params.toString()}`);
      const data = await res.json();

      if (data.status !== 'success') {
        const msg = (data.results && data.results.message) || data.message || I18N.t('news.invalidKey');
        localStorage.removeItem(STORAGE_KEY);
        renderGrid([]);
        renderHero(null);
        showModal(msg);
        state.loading = false;
        return;
      }

      const articles = data.results || [];
      state.nextPage = data.nextPage || null;
      state.articles = reset ? articles : state.articles.concat(articles);

      if (!state.articles.length) {
        renderHero(null);
        renderGrid([]);
        renderState({ icon: 'fa-circle-info', text: I18N.t('news.noResults') });
      } else if (reset) {
        renderTicker(articles);
        renderHero(articles[0]);
        renderGrid(articles.slice(1));
      } else {
        renderGrid(articles, { append: true });
      }

      els.loadMoreRow.classList.toggle('hidden', !state.nextPage);
    } catch (err) {
      renderGrid([]);
      renderHero(null);
      renderState({ icon: 'fa-triangle-exclamation', text: I18N.t('news.loadFailed'), showRetry: true });
    } finally {
      state.loading = false;
      els.loadMoreBtn.disabled = false;
      els.loadMoreBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i>'+I18N.t('news.loadMore');
    }
  }

  els.loadMoreBtn.addEventListener('click', () => fetchNews({ reset: false }));

  if (getKey()) {
    fetchNews({ reset: true });
  } else {
    renderSkeletons(6);
    showModal();
  }
})();
