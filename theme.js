(function(){
  var STORAGE_KEY = 'istrack_theme';
  var VALID = ['dark', 'true-black', 'high-contrast'];

  function getTheme(){
    var saved = null;
    try{ saved = localStorage.getItem(STORAGE_KEY); }catch(e){}
    return VALID.indexOf(saved) !== -1 ? saved : 'dark';
  }

  function applyTheme(theme){
    if(VALID.indexOf(theme) === -1) theme = 'dark';
    if(theme === 'dark'){
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  function setTheme(theme){
    try{ localStorage.setItem(STORAGE_KEY, theme); }catch(e){}
    applyTheme(theme);
  }

  applyTheme(getTheme());

  window.ISTrackTheme = { getTheme: getTheme, setTheme: setTheme, THEMES: VALID.slice() };
})();
