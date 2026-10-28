var Speaking = (function(){
    "use strict";

  var THRESHOLD = 0.03;   
  var HOLD_MS = 400;     
  var TICK_MS = 100;      

  var ctx = null;
  var watchers = {};      
  var speaking = {};    
  
  function getContext(){
    if(!ctx){
        var AC = window.AudioContext || window.webkitAudioContext;
        if(!AC)return null;
        ctx = new AC();
    }
    return ctx;
  }

  ["click","keydown","touchstart"].forEach(function(ev){
    document.addEventListener(ev,function(){
        if(ctx && ctx.state === "suspended")ctx.resume();
    },{passive:true});
  });
  
  function paint(id){
    var items = $("userList").children;
    for(var i = 0; i<items.length;i++){
        if(items[i].dataset.id === id) items[i].classList.toggle("speaking",!!speaking[id]);
    }
  }

  function setSpeaking(id, on) {
    if (on) speaking[id] = true; else delete speaking[id];
    paint(id);
  }

  function watch(id,stream){
    var old = watchers[id];
    if(old && old.stream === stream)return;
    stop(id);

    var c = getContext();
    if(!c || !stream.getAudioTracks().length)return;
    var p = c.resume();
    if(p && p.catch) p.catch(function(){});
    
    var src = c.createMediaStreamSource(stream);
    var analyser = c.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);

    var buf = new Uint8Array(analyser.fftSize);
    var lastLoud = 0, on = false;

    var timer = setInterval(function(){
        analyser.getByteTimeDomainData(buf);
        var sum = 0;
        for(var i =0 ;i<buf.length;i++){
            var v = (buf[i]-128)/128;
            sum += v*v;
        }
        var rms = Math.sqrt(sum/buf.length);
        var now = Date.now();
        if(rms>THRESHOLD)lastLoud = now;
        var talking = now - lastLoud < HOLD_MS;
        //Verifying, from time to time, when there is a speaking person
        if(talking !== on){on=talking;setSpeaking(id,on);}
    },TICK_MS);
    watchers[id] = {stream:stream,stop:function(){
        clearInterval(timer);
        try{
            src.disconnect();
        }catch(e){
            console.log(e);
        }
    }};
  }

  function decorate(li,id){
    li.dataset.id = id || "";
    li.classList.toggle("speaking",!!speaking[id]);
  }

  return {watch:watch,stop:stop,decorate:decorate};
})();