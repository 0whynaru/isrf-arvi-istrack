(function(){
  var STORAGE_KEY = 'istrack_menu_color';
  var VAR_NAME = '--nav-accent';

  function isValidHex(v){
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  }

  function getMenuColor(){
    var saved = null;
    try{ saved = localStorage.getItem(STORAGE_KEY); }catch(e){}
    return isValidHex(saved) ? saved.toLowerCase() : null;
  }

  function applyMenuColor(color){
    if(isValidHex(color)){
      document.documentElement.style.setProperty(VAR_NAME, color);
    } else {
      document.documentElement.style.removeProperty(VAR_NAME);
    }
  }

  function setMenuColor(color){
    if(isValidHex(color)){
      try{ localStorage.setItem(STORAGE_KEY, color.toLowerCase()); }catch(e){}
    } else {
      try{ localStorage.removeItem(STORAGE_KEY); }catch(e){}
    }
    applyMenuColor(getMenuColor());
  }

  function resetMenuColor(){
    try{ localStorage.removeItem(STORAGE_KEY); }catch(e){}
    applyMenuColor(null);
  }

  applyMenuColor(getMenuColor());

  window.ISTrackMenuColor = {
    getMenuColor: getMenuColor,
    setMenuColor: setMenuColor,
    resetMenuColor: resetMenuColor
  };
})();
