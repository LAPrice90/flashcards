(function(){
  function load(){
    try{ return JSON.parse(localStorage.getItem('metrics') || '[]'); }
    catch{ return []; }
  }
  window.recordEvent = function(name, payload){
    const arr = load();
    arr.push({ ts: Date.now(), name, payload });
    if(arr.length > 500) arr.splice(0, arr.length - 500);
    localStorage.setItem('metrics', JSON.stringify(arr));
  };
  window.getMetrics = load;
  window.clearMetrics = function(){ localStorage.removeItem('metrics'); };
})();
