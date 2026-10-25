// config.js already provides: name, code, isHost, params
if (!name || !/^[A-Z0-9]{6}$/.test(code)) {
  location.replace("login.html");
}

var list = $("userList");

$("meName").textContent = name;
$("meCode").textContent = code;
$("leaveBtn").addEventListener("click", leave);

function leave() {
  location.href = "index.html";   // network.js closes the connections on pagehide
}

function show(v) {
  ["chat", "stream", "board"].forEach(function (k) { $("v-" + k).hidden = k !== v; });
  document.querySelectorAll("nav [data-view]").forEach(function (b) {
    if (b.dataset.view === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
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
  if (you) { var t = document.createElement("span"); t.className = "tag"; t.textContent = "you"; li.appendChild(t) }
  list.appendChild(li);
}
