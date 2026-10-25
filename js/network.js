/* ---------------------------------------------------------------------------
 * Peer-to-peer networking for the room (PeerJS / WebRTC)
 *
 * Topology
 *   - The room creator is the HOST. Its peer id is ROOM_PREFIX + room code,
 *     so anybody who knows the code can find it.
 *   - Guests connect to the host with a data connection (chat, whiteboard,
 *     user list). The host relays messages, so everyone sees everything.
 *   - Screen sharing and voice use direct media calls between peers
 *     (the host's roster tells everybody who is in the room).
 *   - If the host leaves, the room closes.
 *
 * Needs (loaded before): config.js, room.js, whiteboard.js, streaming.js
 * ------------------------------------------------------------------------- */
(function () {
  "use strict";

  var MAX_USERS = 10;          // media calls are a mesh, keep rooms small
  var MAX_TEXT = 500;
  var MAX_HISTORY = 100;       // chat lines the host replays to late joiners
  var CONNECT_TIMEOUT = 15000;
  var MAX_IMG_CHARS = 1500000; // ~1.1 MB of image data per chat image
  var MAX_IMG_HISTORY = 8;     // images the host replays to late joiners
  var IMG_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+\/=]+$/;

  var peer;
  var myId = null;
  var users = [{ id: null, name: name }];   // [{id, name}] - same list on every peer
  var joined = isHost;
  var leaving = false;
  var history = [];                         // host only
  var myStatus = { mic: false, screen: false };

  var outCalls = {};      // "kind:peerId" -> MediaConnection we started
  var voiceEls = {};      // peerId -> <audio>
  var screenStream = null;
  var micStream = null;

  /* ------------------------------ helpers ------------------------------ */
  function clip(s, n) { return String(s == null ? "" : s).slice(0, n); }
  function cleanName(s) { return clip(s, 20).replace(/\s+/g, " ").trim(); }

  function cleanImg(v) {
    return (typeof v === "string" && v.length <= MAX_IMG_CHARS && IMG_RE.test(v)) ? v : null;
  }

  function send(conn, msg) {
    try { if (conn && conn.open) conn.send(msg); } catch (e) { console.warn("send failed", e); }
  }
  function broadcast(msg, except) {
    conns.forEach(function (c) { if (c !== except) send(c, msg); });
  }

  function openLightbox(src) {
    var box = document.createElement("div");
    box.id = "lightbox";
    var img = document.createElement("img");
    img.src = src;
    box.appendChild(img);
    box.onclick = function () { box.remove(); };
    document.body.appendChild(box);
  }

  function addMessage(from, text, mine, isSys, img) {
    var box = $("msgs");
    var d = document.createElement("div");
    d.className = "msg" + (mine ? " mine" : "") + (isSys ? " sys" : "");
    if (!isSys) {
      var s = document.createElement("small");
      s.textContent = mine ? "You" : from;
      d.appendChild(s);
    }
    var nearBottom = mine || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (text) d.appendChild(document.createTextNode(text));
    if (img) {
      var im = document.createElement("img");
      im.alt = "Image from " + (mine ? "you" : from);
      im.src = img;
      im.onclick = function () { openLightbox(img); };
      im.onload = function () { if (nearBottom) box.scrollTop = box.scrollHeight; };
      d.appendChild(im);
    }
    box.appendChild(d);
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }

  function sysLocal(text) { addMessage("", text, false, true); }

  function remember(entry) {            // host keeps a short chat history
    history.push(entry);
    if (history.length > MAX_HISTORY) history.shift();
    var withImg = history.filter(function (e) { return e.img; });
    if (withImg.length > MAX_IMG_HISTORY) history.splice(history.indexOf(withImg[0]), 1);
  }

  function renderUsers() {
    list.innerHTML = "";
    users.forEach(function (u) {
      var me = u.id === myId;
      add(u.name, me, me ? myStatus : u);
    });
    $("userCount").textContent = users.length;
    if (window.refreshStreamLabels) window.refreshStreamLabels();
  }

  function goHome(msg, delay) {
    leaving = true;
    if (msg) sysLocal(msg);
    setTimeout(function () { location.href = "login.html"; }, delay || 0);
  }

  /* ------------------------- roster (all peers) ------------------------ */
  function setUsers(next) {
    if (!Array.isArray(next)) return;
    var prev = users.map(function (u) { return u.id; });
    users = next.filter(function (u) {
      return u && typeof u.id === "string" && typeof u.name === "string";
    }).map(function (u) {
      return { id: u.id, name: clip(u.name, 20), mic: !!u.mic, screen: !!u.screen };
    });
    renderUsers();

    var ids = users.map(function (u) { return u.id; });
    prev.forEach(function (id) { if (id && id !== myId && ids.indexOf(id) < 0) cleanupPeer(id); });
    ids.forEach(function (id) { if (id !== myId && prev.indexOf(id) < 0) startMediaTo(id); });
  }

  // mic / streaming status: shown next to every name in the user list
  function publishStatus() {
    var me = users.filter(function (u) { return u.id === myId; })[0];
    if (me) { me.mic = myStatus.mic; me.screen = myStatus.screen; }
    renderUsers();
    if (isHost) broadcast({ type: "roster", users: users });
    else send(hostConn, { type: "status", mic: myStatus.mic, screen: myStatus.screen });
  }

  // streaming.js asks who owns a stream ("s:<peerId>")
  window.nameOfStream = function (id) {
    var pid = String(id).replace(/^s:/, "");
    var u = users.filter(function (x) { return x.id === pid; })[0];
    return u ? u.name : "";
  };

  /* ------------------------------- chat -------------------------------- */
  function sendChat(text, img) {
    text = clip(text, MAX_TEXT).trim();
    img = cleanImg(img);
    if (!text && !img) return;
    addMessage(name, text, true, false, img);
    if (isHost) {
      var m = { type: "chat", id: myId, name: name, text: text, img: img };
      remember(m);
      broadcast(m);
    } else {
      send(hostConn, { type: "chat", text: text, img: img });
    }
  }
  window.sendChat = sendChat;

  /* ---- sending images: file button, paste, drag & drop ---- */
  function fileToDataUrl(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.readAsDataURL(file);
    });
  }

  // shrink big pictures so they travel fast: max 1280px, JPEG, retry smaller until it fits
  function compressImage(file) {
    return fileToDataUrl(file).then(function (raw) {
      if (file.type === "image/gif" && raw.length <= MAX_IMG_CHARS) return raw;   // keep animation
      return new Promise(function (res, rej) {
        var im = new Image();
        im.onerror = function () { rej(new Error("not an image")); };
        im.onload = function () {
          var maxDim = 1280, quality = 0.85, out = "";
          for (var i = 0; i < 6; i++) {
            var k = Math.min(1, maxDim / Math.max(im.width, im.height));
            var c = document.createElement("canvas");
            c.width = Math.max(1, Math.round(im.width * k));
            c.height = Math.max(1, Math.round(im.height * k));
            var g = c.getContext("2d");
            g.fillStyle = "#fff";            // JPEG has no transparency
            g.fillRect(0, 0, c.width, c.height);
            g.drawImage(im, 0, 0, c.width, c.height);
            out = c.toDataURL("image/jpeg", quality);
            if (out.length <= MAX_IMG_CHARS) return res(out);
            maxDim = Math.round(maxDim * 0.75);
            quality = Math.max(0.5, quality - 0.1);
          }
          rej(new Error("too large"));
        };
        im.src = raw;
      });
    });
  }

  function sendImageFile(file) {
    if (!file || !/^image\//.test(file.type)) return;
    if (file.size > 25 * 1024 * 1024) { alert("That image is too large (25 MB max)."); return; }
    compressImage(file)
      .then(function (data) { sendChat("", data); })
      .catch(function () { alert("Could not send that image."); });
  }

  $("attachBtn").addEventListener("click", function () { $("imgInput").click(); });
  $("imgInput").addEventListener("change", function () {
    Array.prototype.forEach.call(this.files, sendImageFile);
    this.value = "";
  });
  $("msgInput").addEventListener("paste", function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === "file" && /^image\//.test(items[i].type)) {
        e.preventDefault();
        sendImageFile(items[i].getAsFile());
      }
    }
  });
  var msgsBox = $("msgs");
  ["dragenter", "dragover"].forEach(function (ev) {
    msgsBox.addEventListener(ev, function (e) { e.preventDefault(); msgsBox.classList.add("drop"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    msgsBox.addEventListener(ev, function () { msgsBox.classList.remove("drop"); });
  });
  msgsBox.addEventListener("drop", function (e) {
    e.preventDefault();
    Array.prototype.forEach.call((e.dataTransfer && e.dataTransfer.files) || [], sendImageFile);
  });

  $("sendBtn").addEventListener("click", function () {
    sendChat($("msgInput").value);
    $("msgInput").value = "";
    $("msgInput").focus();
  });
  $("msgInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") $("sendBtn").click();
  });

  /* ----------------------------- whiteboard ---------------------------- */
  window.wbSend = function (m) {
    if (isHost) broadcast({ type: "wb", m: m });
    else send(hostConn, { type: "wb", m: m });
  };

  function sendBoardHistory(conn) {
    if (!window.Whiteboard) return;
    var h = Whiteboard.getHistory();
    for (var i = 0; i < h.length; i += 400) {
      send(conn, { type: "wb", m: { t: "strokes", s: h.slice(i, i + 400) } });
    }
  }

  /* ------------------- media: screen share and voice ------------------- */
  function callPeer(id, kind, stream) {
    var key = kind + ":" + id;
    if (outCalls[key] || !peer || peer.destroyed) return;
    var call = peer.call(id, stream, { metadata: { kind: kind } });
    if (!call) return;
    outCalls[key] = call;
    function forget() { if (outCalls[key] === call) delete outCalls[key]; }
    call.on("close", forget);
    call.on("error", forget);
  }

  function startMediaTo(id) {
    if (screenStream) callPeer(id, "screen", screenStream);
    if (micStream) callPeer(id, "voice", micStream);
  }

  function stopCalls(kind) {
    Object.keys(outCalls).forEach(function (key) {
      if (key.indexOf(kind + ":") === 0) {
        try { outCalls[key].close(); } catch (e) { }
        delete outCalls[key];
      }
    });
  }

  function announceMediaStop(kind) {
    if (isHost) broadcast({ type: "media-stop", kind: kind, from: myId });
    else send(hostConn, { type: "media-stop", kind: kind });
  }

  function removeVoice(id) {
    var el = voiceEls[id];
    if (!el) return;
    el.srcObject = null;
    el.remove();
    delete voiceEls[id];
  }

  function handleMediaStop(d) {
    if (d.kind === "screen") removeStream("s:" + d.from);
    else if (d.kind === "voice") removeVoice(d.from);
  }

  function cleanupPeer(id) {
    ["screen", "voice"].forEach(function (kind) {
      var key = kind + ":" + id;
      if (outCalls[key]) { try { outCalls[key].close(); } catch (e) { } delete outCalls[key]; }
    });
    removeStream("s:" + id);
    removeVoice(id);
  }

  function playVoice(id, stream) {
    var el = voiceEls[id];
    if (!el) {
      el = document.createElement("audio");
      el.autoplay = true;
      el.style.display = "none";
      document.body.appendChild(el);
      voiceEls[id] = el;
    }
    el.srcObject = stream;
    var p = el.play();
    if (p && p.catch) {
      p.catch(function () {   // autoplay blocked: start on the next click/tap
        var resume = function () { el.play().catch(function () { }); };
        document.addEventListener("click", resume, { once: true });
      });
    }
  }

  function onIncomingCall(call) {
    var kind = call.metadata && call.metadata.kind;
    if (kind !== "screen" && kind !== "voice") { call.close(); return; }
    call.answer();   // receive only
    call.on("stream", function (stream) {
      if (kind === "screen") addStream("s:" + call.peer, stream);
      else playVoice(call.peer, stream);
    });
    call.on("close", function () {
      if (kind === "screen") removeStream("s:" + call.peer);
      else removeVoice(call.peer);
    });
  }

  // called by streaming.js
  window.onLocalStreamStart = function (stream) {
    screenStream = stream;
    myStatus.screen = true;
    publishStatus();
    users.forEach(function (u) { if (u.id && u.id !== myId) callPeer(u.id, "screen", stream); });
  };
  window.onLocalStreamStop = function () {
    screenStream = null;
    myStatus.screen = false;
    stopCalls("screen");
    announceMediaStop("screen");
    publishStatus();
  };

  // microphone
  var micBtn = $("micBtn");
  function setMicUi(on) {
    micBtn.setAttribute("aria-pressed", on ? "true" : "false");
    micBtn.textContent = on ? "Mic on" : "Mic off";
  }
  function stopMic() {
    if (micStream) { micStream.getTracks().forEach(function (t) { t.stop(); }); micStream = null; }
    stopCalls("voice");
    announceMediaStop("voice");
    setMicUi(false);
    myStatus.mic = false;
    publishStatus();
  }
  micBtn.addEventListener("click", function () {
    if (micStream) { stopMic(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Microphone access needs HTTPS (or localhost) and a supported browser.");
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
      .then(function (stream) {
        micStream = stream;
        setMicUi(true);
        myStatus.mic = true;
        publishStatus();
        users.forEach(function (u) { if (u.id && u.id !== myId) callPeer(u.id, "voice", stream); });
      })
      .catch(function (err) {
        alert("Could not access the microphone: " + (err && err.message || err));
      });
  });

  /* ------------------------------- HOST -------------------------------- */
  function uniqueName(n) {
    var base = n || "Guest", out = base, i = 2;
    function taken(x) { return users.some(function (u) { return u.name === x; }); }
    while (taken(out)) out = clip(base, 16) + " (" + (i++) + ")";
    return out;
  }

  function acceptGuest(conn, d) {
    if (users.length >= MAX_USERS) {
      send(conn, { type: "full" });
      setTimeout(function () { conn.close(); }, 300);
      return;
    }
    conn.joined = true;
    conn.userName = uniqueName(cleanName(d.name));
    var snapshot = history.slice();

    conns.push(conn);
    users.push({ id: conn.peer, name: conn.userName });

    send(conn, { type: "welcome", users: users, history: snapshot });
    sendBoardHistory(conn);

    var note = { type: "sys", text: conn.userName + " joined" };
    sysLocal(note.text);
    remember(note);
    broadcast(note);
    broadcast({ type: "roster", users: users }, conn);
    renderUsers();
    startMediaTo(conn.peer);
  }

  function dropGuest(conn) {
    var i = conns.indexOf(conn);
    if (i < 0) return;
    conns.splice(i, 1);
    users = users.filter(function (u) { return u.id !== conn.peer; });
    cleanupPeer(conn.peer);

    var note = { type: "sys", text: conn.userName + " left" };
    sysLocal(note.text);
    remember(note);
    broadcast(note);
    broadcast({ type: "roster", users: users });
    renderUsers();
  }

  function onHostData(conn, d) {
    if (!d || typeof d !== "object") return;
    if (d.type === "hello") { if (!conn.joined) acceptGuest(conn, d); return; }
    if (!conn.joined) return;

    if (d.type === "chat") {
      var text = clip(d.text, MAX_TEXT).trim();
      var img = cleanImg(d.img);
      if (!text && !img) return;
      var m = { type: "chat", id: conn.peer, name: conn.userName, text: text, img: img };
      addMessage(m.name, m.text, false, false, img);
      remember(m);
      broadcast(m, conn);
    } else if (d.type === "status") {
      var u = users.filter(function (x) { return x.id === conn.peer; })[0];
      if (u) {
        u.mic = !!d.mic;
        u.screen = !!d.screen;
        renderUsers();
        broadcast({ type: "roster", users: users });
      }
    } else if (d.type === "wb") {
      if (window.Whiteboard) Whiteboard.applyRemote(d.m);
      broadcast({ type: "wb", m: d.m }, conn);
    } else if (d.type === "media-stop" && (d.kind === "screen" || d.kind === "voice")) {
      var s = { type: "media-stop", kind: d.kind, from: conn.peer };
      handleMediaStop(s);
      broadcast(s, conn);
    }
  }

  function initHost() {
    peer = new Peer(ROOM_PREFIX + code, PEER_OPTS);

    peer.on("open", function (id) {
      myId = id;
      users = [{ id: id, name: name }];
      renderUsers();
      sysLocal("Room " + code + " is open. Share the code to invite friends.");
    });

    peer.on("connection", function (conn) {
      conn.on("data", function (d) { onHostData(conn, d); });
      conn.on("close", function () { dropGuest(conn); });
      conn.on("error", function () { dropGuest(conn); });
    });

    peer.on("error", function (err) {
      if (err.type === "unavailable-id") {
        alert("That room code is already in use. Go back and create a new room.");
        goHome();
      } else if (err.type !== "peer-unavailable") {
        sysLocal("Connection problem: " + err.type);
      }
    });
  }

  /* ------------------------------- GUEST ------------------------------- */
  function onGuestData(d) {
    if (!d || typeof d !== "object") return;
    switch (d.type) {
      case "welcome":
        joined = true;
        setUsers(d.users);
        (Array.isArray(d.history) ? d.history : []).forEach(function (e) {
          if (e.type === "sys") sysLocal(clip(e.text, MAX_TEXT));
          else if (e.type === "chat") addMessage(clip(e.name, 20), clip(e.text, MAX_TEXT), false, false, cleanImg(e.img));
        });
        break;
      case "roster":
        setUsers(d.users);
        break;
      case "chat":
        addMessage(clip(d.name, 20), clip(d.text, MAX_TEXT), false, false, cleanImg(d.img));
        break;
      case "sys":
        sysLocal(clip(d.text, MAX_TEXT));
        break;
      case "wb":
        if (window.Whiteboard) Whiteboard.applyRemote(d.m);
        break;
      case "media-stop":
        if (typeof d.from === "string") handleMediaStop(d);
        break;
      case "full":
        alert("This room is full.");
        goHome();
        break;
    }
  }

  function initGuest() {
    peer = new Peer(undefined, PEER_OPTS);
    var timer;

    peer.on("open", function (id) {
      myId = id;
      users[0].id = id;
      renderUsers();
      sysLocal("Connecting to room " + code + "...");

      hostConn = peer.connect(ROOM_PREFIX + code, { reliable: true });
      timer = setTimeout(function () {
        if (!joined && !leaving) {
          alert("Could not connect to the room. Check the code and try again.");
          goHome();
        }
      }, CONNECT_TIMEOUT);

      hostConn.on("open", function () { send(hostConn, { type: "hello", name: name }); });
      hostConn.on("data", onGuestData);
      hostConn.on("close", function () {
        clearTimeout(timer);
        if (leaving) return;
        goHome("The host left. This room is closed.", 3000);
      });
      hostConn.on("error", function () { /* "close" follows */ });
    });

    peer.on("error", function (err) {
      if (err.type === "peer-unavailable") {
        if (!joined && !leaving) {   // before joining = the room does not exist
          clearTimeout(timer);
          alert("Room not found. Check the code and try again.");
          goHome();
        }                            // after joining = a guest we tried to call is gone
      } else {
        sysLocal("Connection problem: " + err.type);
      }
    });
  }

  /* -------------------------------- start ------------------------------ */
  renderUsers();

  if (typeof Peer === "undefined") {
    sysLocal("Could not load PeerJS. Check your internet connection and reload.");
    return;
  }

  if (isHost) initHost(); else initGuest();

  peer.on("call", onIncomingCall);

  // keep the signalling link alive so new people can still find the room
  peer.on("disconnected", function () {
    if (leaving) return;
    setTimeout(function () { if (peer && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 1500);
  });

  window.addEventListener("pagehide", function () {
    leaving = true;
    if (micStream) micStream.getTracks().forEach(function (t) { t.stop(); });
    if (peer && !peer.destroyed) peer.destroy();
  });
})();
