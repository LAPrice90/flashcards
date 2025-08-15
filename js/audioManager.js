(function(){
  let current=null;
  function stop(){
    if(current){
      try{ current.pause(); }catch(e){}
      current=null;
    }
  }
  function create(src, rate=1.0){
    if(!src) return null;
    stop();
    current=new Audio(src);
    current.playbackRate=rate;
    return current;
  }
  function play(src, rate=1.0){
    const a=create(src, rate);
    if(a) a.play().catch(()=>{});
    return a;
  }
  window.fcAudio={ play, stop, create };
})();
