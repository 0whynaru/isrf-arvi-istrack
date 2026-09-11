(function(){

  function prefersReducedMotion(){
    try{ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch(e){ return false; }
  }

  function spawnRipple(btn, x, y){
    if(prefersReducedMotion()) return;
    const rect = btn.getBoundingClientRect();
    if(rect.width === 0 || rect.height === 0) return;
    const size = Math.max(rect.width, rect.height) * 1.15;
    const span = document.createElement('span');
    span.className = 'ui-ripple';
    span.style.width = span.style.height = size + 'px';
    span.style.left = (x - rect.left - size/2) + 'px';
    span.style.top = (y - rect.top - size/2) + 'px';
    btn.appendChild(span);
    span.addEventListener('animationend', ()=>{ span.remove(); }, {once:true});

    setTimeout(()=>{ if(span.parentNode) span.remove(); }, 700);
  }

  function onPointerDown(e){
    const btn = e.target.closest && e.target.closest('button');
    if(!btn || btn.disabled) return;

    const cs = getComputedStyle(btn);
    if(cs.position === 'static') btn.style.position = 'relative';
    if(cs.overflow === 'visible') btn.style.overflow = 'hidden';
    spawnRipple(btn, e.clientX, e.clientY);
  }

  document.addEventListener('pointerdown', onPointerDown, {passive:true});

  function staggerCards(){
    if(prefersReducedMotion()) return;
    const cards = document.querySelectorAll('.cards > .card');
    cards.forEach((card, i)=>{
      card.style.setProperty('--entrance-delay', Math.min(i * 45, 400) + 'ms');
      card.classList.add('ui-rise-in');
    });
  }

  function revealPanelsOnScroll(){
    if(prefersReducedMotion()) return;
    const panels = document.querySelectorAll('.panel, .livepanel');
    if(!panels.length) return;
    // Bug fix: IntersectionObserver callbacks fire async (next frame), so
    // panels already visible on load (e.g. above the fold) would briefly
    // flash invisible after we add ui-reveal-pending. Reveal those instantly
    // and only defer the ones that truly start off-screen.
    const viewportH = window.innerHeight || document.documentElement.clientHeight;
    if(typeof IntersectionObserver === 'undefined'){
      panels.forEach(p=>{ p.classList.add('ui-rise-in'); });
      return;
    }
    const io = new IntersectionObserver((entries)=>{
      entries.forEach(entry=>{
        if(!entry.isIntersecting) return;
        entry.target.classList.remove('ui-reveal-pending');
        entry.target.classList.add('ui-rise-in');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    panels.forEach(p=>{
      const rect = p.getBoundingClientRect();
      const alreadyVisible = rect.top < viewportH * 0.88 && rect.bottom > 0;
      if(alreadyVisible){
        p.classList.add('ui-rise-in');
        return;
      }
      p.style.setProperty('--entrance-delay','0ms');
      p.classList.add('ui-reveal-pending');
      io.observe(p);
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>{ staggerCards(); revealPanelsOnScroll(); });
  } else {
    staggerCards();
    revealPanelsOnScroll();
  }

})();
