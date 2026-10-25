
  var $ = function(id){return document.getElementById(id)};
  var ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; 
 

  function genCode(){
    var out="", buf=new Uint32Array(6);
    window.crypto.getRandomValues(buf);
    for(var i=0;i<6;i++) out+=ALPHABET[buf[i]%ALPHABET.length];
    return out;
  }

  // The code is generated as soon as the page loads, no click needed.
  var newCode = genCode();
  $("newCode").textContent = newCode;

  $("copyBtn").onclick = function(){
    var b=this;
    try{ navigator.clipboard.writeText(newCode).then(function(){b.textContent="Copied"}, function(){b.textContent="Select and copy the code"}); }
    catch(e){ b.textContent="Select and copy the code"; }
    setTimeout(function(){b.textContent="Copy code"},1800);
  };

  function cleanName(v){return v.replace(/\s+/g," ").trim()}

  function go(name,code,host){
    location.href = "room.html?name="+encodeURIComponent(name)+"&code="+code+"&host="+(host?1:0);
  }

  $("createBtn").onclick = function(){
    var n = cleanName($("cName").value);
    if(!n){ $("cErr").textContent="Enter your name to create a room."; $("cName").focus(); return; }
    go(n,newCode,true);
  };
  
  $("joinBtn").onclick = function(){
    var n = cleanName($("jName").value), c = $("jCode").value.trim().toUpperCase();
    if(!n){ $("jErr").textContent="Enter your name to join."; $("jName").focus(); return; }
    if(!/^[A-Z0-9]{6}$/.test(c)){ $("jErr").textContent="Room codes have 6 letters or numbers."; $("jCode").focus(); return; }
  
    go(n,c,false);
  };

  ["cName","jName","jCode"].forEach(function(id){
    $(id).addEventListener("input",function(){$("cErr").textContent="";$("jErr").textContent=""});
    $(id).addEventListener("keydown",function(e){ if(e.key==="Enter") (id==="cName"?$("createBtn"):$("joinBtn")).click(); });
  });
