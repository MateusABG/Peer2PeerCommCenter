// config.js already provides: name, code, isHost, params
if (!name || !/^[A-Z0-9]{6}$/.test(code)) {
  location.replace("index.html");
}

var list = $("userList");

$("meName").textContent = name;
$("meCode").textContent = code;
$("leaveBtn").addEventListener("click", leave);

function leave() {
  location.href = "index.html";   // network.js closes the connections on pagehide
}
 
var currentView="chat";
function show(v) { 
  currentView = v;
  ["chat", "stream", "cinema", "board", "notes"].forEach(function (k) { $("v-" + k).hidden = k !== v; });
  document.querySelectorAll("nav [data-view]").forEach(function (b) {
    if (b.dataset.view === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  if(window.onViewChange)window.onViewChange(v);
}

document.querySelectorAll("nav [data-view]").forEach(function (b) { b.onclick = function () { show(b.dataset.view) } });

// Adds one entry to the users list (network.js re-renders the whole list on every change).
// st = { mic, screen }: a lit dot means the microphone is on, a badge means they are streaming.
function add(n, you, st) {
  st = st || {};
  var li = document.createElement("li"); if (you) li.className = "you";
  var d = document.createElement("i"); d.className = "dot" + (st.mic ? " live" : "");
  d.title = st.mic ? "Microphone on" : "Microphone off";
  var s = document.createElement("span"); s.className = "uname"; s.textContent = n;
  li.appendChild(d); li.appendChild(s);
  if (st.screen) { var b = document.createElement("span"); b.className = "badge"; b.textContent = "streaming"; li.appendChild(b) }
  if (!you && st.mic && st.id && window.Voices) li.appendChild(Voices.controls(st.id));
  if (st.cam) { var c = document.createElement("span"); c.className = "badge cam"; c.textContent = "camera"; li.appendChild(c); }
  if (st.host) { var h = document.createElement("span"); h.className = "badge host"; h.textContent = "host"; li.appendChild(h); }
  if (isHost && !you && st.id) li.appendChild(hostTools(st.id, st.hmute));
  list.appendChild(li);
}


//Inviting link
function inviteLink() {
  var u = new URL("index.html", location.href);   // same folder as room.html, query dropped
  u.searchParams.set("join", code);               // "code" comes from config.js
  return u.href;                                  // e.g. https://mysite.com/chat/index.html?join=ABC123
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise(function (resolve, reject) {      // older-browser fallback
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { }
    ta.remove();
    if (ok) resolve(); else reject();
  });
}

var inviteBtn = $("inviteBtn");

function flash(msg) {                                   // brief feedback on the button
  var old = inviteBtn.textContent;
  inviteBtn.textContent = msg;
  setTimeout(function () { inviteBtn.textContent = old; }, 1800);
}

inviteBtn.addEventListener("click", function () {
  var url = inviteLink();
  copyText(url).then(
    function () { flash("Link copied!"); },
    function () { window.prompt("Copy this invite link:", url); }   // last resort
  );
});

function hostTools(id, silenced) {
  var wrap = document.createElement("div");
  wrap.className = "htools";

  var m = document.createElement("button");
  m.type = "button";
  m.textContent = silenced ? "Allow mic" : "Silence";
  m.title = silenced ? "Let them use their mic again" : "Mute them for everyone";
  m.onclick = function () { hostAction("mute", id, !silenced); };

  var k = document.createElement("button");
  k.type = "button";
  k.className = "danger";
  k.textContent = "Remove";
  k.onclick = function () { if (confirm("Remove this person from the room?")) hostAction("kick", id); };

  wrap.appendChild(m);
  wrap.appendChild(k);
  
  var t = document.createElement("button");
  t.type = "button";
  t.textContent = "Make host";
  t.onclick = function () {
    if (confirm("Make this person the host? You will stay in the room as a regular member."))
      hostAction("handover", id);
  };
  wrap.appendChild(t); 
  return wrap;
}
var sharedNotesBox = $("sharedNotes");

if (sharedNotesBox) {
  sharedNotesBox.addEventListener("input", function () {
    if (window.notesSend) {
      window.notesSend(this.value);
    }
  });
}


var createPollBtn = $("createPollBtn");
var pollDialog = $("pollDialog");
var addPollOptionBtn = $("addPollOption");
var cancelPollBtn = $("cancelPoll");
var sendPollBtn = $("sendPoll");

if (createPollBtn && pollDialog) {
  createPollBtn.addEventListener("click", function () {
    pollDialog.hidden = false;
    $("pollQuestion").focus();
  });
}

if (cancelPollBtn && pollDialog) {
  cancelPollBtn.addEventListener("click", function () {
    pollDialog.hidden = true;
  });
}

if (addPollOptionBtn) {
  addPollOptionBtn.addEventListener("click", function () {
    var options = document.querySelectorAll(".pollOption");

    if (options.length >= 10) {
      alert("A poll can have at most 10 options.");
      return;
    }

    var input = document.createElement("input");
    input.type = "text";
    input.className = "input pollOption";
    input.maxLength = 100;
    input.placeholder = "Option " + (options.length + 1);

    addPollOptionBtn.parentNode.insertBefore(input, addPollOptionBtn);
    input.focus();
  });
}
if (sendPollBtn) {
  sendPollBtn.addEventListener("click", function () {
    var question = $("pollQuestion").value.trim();

    var options = Array.from(
      document.querySelectorAll(".pollOption")
    ).map(function (input) {
      return input.value.trim();
    }).filter(Boolean);

    if (!question) {
      alert("Please enter a poll question.");
      $("pollQuestion").focus();
      return;
    }

    if (options.length < 2) {
      alert("Please enter at least 2 options.");
      return;
    }

    if (typeof window.createPoll !== "function") {
      alert("Poll networking is unavailable. Check that js/network.js loaded without a console error, then refresh the page.");
      return;
    }

    window.createPoll(question, options);
  });
}

