(function () {
  "use strict";
  var pwSalt = null, pwProof = null;
  var pwRecord = null;
  var failTimes = [];
  var MAX_USERS = 10;
  var MAX_TEXT = 500;
  var MAX_HISTORY = 100;       // chat lines the host replays to late joiners
  var CONNECT_TIMEOUT = 15000;
  var MAX_IMG_CHARS = 1500000; // ~1.1 MB of image data per chat image
  var MAX_IMG_HISTORY = 8;     // images the host replays to late joiners
  var MAX_FILE = 10 * 1024 * 1024;   // 10 MB per shared file (it is relayed to everyone)
  var IMG_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+\/=]+$/;
  var MEDIA_KINDS = ["screen", "camera", "voice"];
  var PREFIX = { screen: "s:", camera: "c:" };       // stream-id prefix per video kind
  var cameraStream = null;
  var myStatus = { mic: false, screen: false, cam: false };
  var peer;
  var myId = null;
  var users = [{ id: null, name: name }];   // [{id, name}] - same list on every peer
  var joined = isHost;
  var leaving = false;
  var history = [];                         // host only

  var outCalls = {};
  var voiceEls = {};
  var screenStream = null;
  var micStream = null;
  var replaying = false;
  var locked = false;

  var hub = null;
  var recovering = false;
  var welcomed = false;
  var nextHost = null;
  var giveUpAt = 0;
  var GRACE = 12000;

  var sharedNotesText = "";
  var polls = {};
  var syncedMediaState = null;

  

  function addPollMessage(poll, mine) {
    var box = $("msgs");
    var message = document.createElement("div");

    message.className = "msg poll-message" + (mine ? " mine" : "");
    message.dataset.pollId = poll.id;
    var author = document.createElement("small");
    author.textContent = mine ? "You" : (poll.name || "Poll");
    message.appendChild(author);

    var card = pollCardEl(poll, function (pollId, optionIndex) {
      if (window.voteInPoll) {
        window.voteInPoll(pollId, optionIndex);
      }
    });

    message.appendChild(card);
    box.appendChild(message);
    box.scrollTop = box.scrollHeight;
  }

  function refreshPollMessage(poll) {
    if (!poll || typeof poll.id !== "string") return;

    var oldMessage = Array.from(document.querySelectorAll(".poll-message"))
      .find(function (element) {
        return element.dataset.pollId === poll.id;
      });

    if (!oldMessage) {
      addPollMessage(poll, poll.creatorId === myId);
      return;
    }

    var message = document.createElement("div");
    var mine = poll.creatorId === myId;
    message.className = "msg poll-message" + (mine ? " mine" : "");
    message.dataset.pollId = poll.id;

    var author = document.createElement("small");
    author.textContent = mine ? "You" : (poll.name || "Poll");
    message.appendChild(author);
    message.appendChild(pollCardEl(poll, function (pollId, optionIndex) {
      if (typeof window.voteInPoll === "function") {
        window.voteInPoll(pollId, optionIndex);
      }
    }));

    oldMessage.replaceWith(message);
  }
  window.refreshPollMessage = refreshPollMessage;

  function setPwUi(on) { if ($("pwTag")) $("pwTag").hidden = !on; }

  function setupPassword() {
    var plain = null;
    try { plain = sessionStorage.getItem("roomPw"); sessionStorage.removeItem("roomPw"); } catch (e) { }
    if (!plain) return Promise.resolve();                        // no password: open room
    if (!(window.crypto && crypto.subtle)) return Promise.reject("Password rooms need HTTPS (or localhost).");
    var salt = newSalt();
    return deriveProof(plain, salt).then(function (proof) {
      pwSalt = salt; pwProof = proof;
      pwRecord = { salt: salt, proof: proof };
      setPwUi(true);
    });
  }

  function clip(s, n) { return String(s == null ? "" : s).slice(0, n); }
  function cleanName(s) { return clip(s, 20).replace(/\s+/g, " ").trim(); }
  function connOf(id) { return conns.filter(function (c) { return c.peer === id; })[0]; }
  function snippet(text, img, file) {
    return clip(text || (img ? "📷 Photo" : file ? "📎 " + file.name : ""), 80);
  }
  function cleanImg(v) {
    return (typeof v === "string" && v.length <= MAX_IMG_CHARS && IMG_RE.test(v)) ? v : null;
  }

  function safeFileName(n) {
    n = clip(n, 120).replace(/[\\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim();
    return n || "file";
  }
  function cleanFile(f) {
    if (!f || typeof f !== "object") return null;
    var buf = f.buf;
    if (ArrayBuffer.isView(buf)) buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    else if (Object.prototype.toString.call(buf) !== "[object ArrayBuffer]") return null;
    if (buf.byteLength === 0 || buf.byteLength > MAX_FILE) return null;
    return { name: safeFileName(f.name), buf: buf };
  }
  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
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

  function fileCard(file) {
    // always an opaque binary blob: the browser downloads it, it never runs or renders it
    var url = URL.createObjectURL(new Blob([file.buf], { type: "application/octet-stream" }));
    var card = document.createElement("div");
    card.className = "file";
    var info = document.createElement("div");
    info.className = "finfo";
    var nm = document.createElement("span");
    nm.className = "fname";
    nm.textContent = file.name;
    var sz = document.createElement("span");
    sz.className = "fsize";
    sz.textContent = fmtSize(file.buf.byteLength);
    info.appendChild(nm);
    info.appendChild(sz);
    var a = document.createElement("a");
    a.className = "fdl";
    a.href = url;
    a.download = file.name;
    a.textContent = "Download";
    card.appendChild(info);
    card.appendChild(a);
    return card;
  }

  function addMessage(from, text, mine, isSys, img, file, meta) {
    var box = $("msgs");
    var d = document.createElement("div");
    d.className = "msg" + (mine ? " mine" : "") + (isSys ? " sys" : "");
    if (!isSys) {
      var s = document.createElement("small");
      s.textContent = mine ? "You" : from;
      d.style.setProperty("--u", userColor(mine ? name : from));   // this person's own colour
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
    if (file) d.appendChild(fileCard(file));
    box.appendChild(d);
    if (nearBottom) box.scrollTop = box.scrollHeight;

    if (!mine && !isSys && !replaying && !chatVisible()) {
      unread++;
      renderUnread();
      if (window.Notifier) Notifier.messageArrived(from, text, img, file);
    }

    meta = meta || {};
    if (meta.mid) {
      d.dataset.mid = meta.mid;
      d.tabIndex = 0;
      seen[meta.mid] = { name: from, text: snippet(text, img, file) };
    }
    if (meta.reply) d.appendChild(quoteEl(meta.reply));
    if (meta.mid) {
      var row = document.createElement("div");
      row.className = "reacts";
      d.appendChild(row);
      d.appendChild(actionsEl(meta.mid));
    }
  }
  function pollCardEl(poll, onVote) {
    var myVote = poll.votes &&
      Object.prototype.hasOwnProperty.call(poll.votes, myId)
      ? poll.votes[myId]
      : null;

    var card = document.createElement("div");
    card.className = "poll-card";

    var title = document.createElement("h4");
    title.textContent = "📊 " + poll.question;
    card.appendChild(title);

    var counts = poll.counts || poll.options.map(function () {
      return 0;
    });

    var total = counts.reduce(function (sum, count) {
      return sum + count;
    }, 0);

    var options = document.createElement("div");
    options.className = "poll-options";

    poll.options.forEach(function (option, i) {
      var count = counts[i] || 0;
      var percent = total ? Math.round(count / total * 100) : 0;

      var item = document.createElement("div");
      item.className = "poll-result";

      var button = document.createElement("button");
      button.type = "button";
      button.className = "poll-option";
      button.textContent = option;

      if (myVote === i) button.classList.add("selected");

      button.disabled = !!poll.closed || myVote != null;

      button.addEventListener("click", function () {
        if (typeof onVote === "function") {
          onVote(poll.id, i);
        }
      });

      var result = document.createElement("div");
      result.className = "poll-result-bar";

      var fill = document.createElement("div");
      fill.className = "poll-result-fill";
      fill.style.width = percent + "%";
      result.appendChild(fill);

      var stats = document.createElement("div");
      stats.className = "poll-result-stats";
      stats.textContent = count + (count === 1 ? " vote" : " votes")
        + " · " + percent + "%";

      item.appendChild(button);
      item.appendChild(result);
      item.appendChild(stats);
      options.appendChild(item);
    });

    card.appendChild(options);

    var totalText = document.createElement("p");
    totalText.className = "poll-total";
    totalText.textContent = total + (total === 1 ? " vote" : " votes");
    card.appendChild(totalText);

    return card;
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
      add(u.name, me, me ? Object.assign({ host: u.host }, myStatus) : u);
      if (window.Speaking) Speaking.decorate(list.lastChild, u.id);
    });
    $("userCount").textContent = users.length;
    if (window.refreshStreamLabels) window.refreshStreamLabels();
  }

  function goHome(msg, delay) {
    leaving = true;
    if (msg) sysLocal(msg);
    setTimeout(function () { location.href = "index.html"; }, delay || 0);
  }

  /* ------------------------- roster (all peers) ------------------------ */
  function setUsers(next) {
    if (!Array.isArray(next)) return;
    var prev = users.map(function (u) { return u.id; });
    users = next.filter(function (u) {
      return u && typeof u.id === "string" && typeof u.name === "string";
    }).map(function (u) {
      return {
        id: u.id, name: clip(u.name, 20), mic: !!u.mic, screen: !!u.screen,
        cam: !!u.cam, host: !!u.host, hmute: !!u.hmute
      };
    });
    renderUsers();
    users.forEach(function (u) {
      if (window.Voices && u.id !== myId) Voices.hostMute(u.id, u.hmute);
    });

    var ids = users.map(function (u) { return u.id; });
    prev.forEach(function (id) { if (id && id !== myId && ids.indexOf(id) < 0) cleanupPeer(id); });
    ids.forEach(function (id) { if (id !== myId && prev.indexOf(id) < 0) startMediaTo(id); });
  }

  // mic / streaming status: shown next to every name in the user list
  function publishStatus() {
    var me = users.filter(function (u) { return u.id === myId; })[0];
    if (me) { me.mic = myStatus.mic; me.screen = myStatus.screen; me.cam = myStatus.cam; }
    renderUsers();
    if (isHost) broadcast({ type: "roster", users: users });
    else send(hostConn, { type: "status", mic: myStatus.mic, screen: myStatus.screen, cam: myStatus.cam });
  }

  window.nameOfPeer = function (id) {
    var u = users.filter(function (x) { return x.id === id; })[0];
    return u ? u.name : "";
  };

  // streaming.js asks who owns a stream ("s:<peerId>")
  window.nameOfStream = function (id) {
    var pid = String(id).replace(/^[sc]:/, "");   // strips "s:" (screen) or "c:" (camera)
    var u = users.filter(function (x) { return x.id === pid; })[0];
    return u ? u.name : "";
  };

  /* ------------------------------- chat -------------------------------- */
  // files are not kept in the host's history (too big): late joiners just see a note
  function rememberChat(m) {
    var h = { type: "chat", id: m.id, name: m.name, text: m.text, img: m.img, mid: m.mid, reply: m.reply };
    if (m.file) h.text = (m.text ? m.text + " " : "") + "[shared file: " + m.file.name + " - not available to late joiners]";
    remember(h);
  }

  function sendChat(text, img, file) {
    text = clip(text, MAX_TEXT).trim();
    img = cleanImg(img);
    file = cleanFile(file);
    if (!text && !img && !file) return;

    var mid = newMid();
    var target = replyingTo && seen[replyingTo] ? seen[replyingTo] : null;
    var q = target ? {
      mid: replyingTo,
      name: target.name,
      text: target.text
    } : null;

    addMessage(name, text, true, false, img, file, { mid: mid, reply: q });

    if (isHost) {
      var m = {
        type: "chat", id: myId, name: name, text: text,
        img: img, file: file, mid: mid, reply: q
      };
      indexMsg(mid, name, snippet(text, img, file));
      rememberChat(m);
      broadcast(m);
    } else {
      send(hostConn, {
        type: "chat", text: text, img: img, file: file,
        mid: mid, reply: q ? q.mid : null
      });
      rememberChat({ id: myId, name: name, text: text, img: img, file: file, mid: mid, reply: q });
    }
    cancelReply();
  }
  window.sendChat = sendChat;
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
      if (file.type === "image/gif" && raw.length <= MAX_IMG_CHARS) return raw;
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
            g.fillStyle = "#fff";
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

  function readBuffer(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.readAsArrayBuffer(file);
    });
  }

  function sendRawFile(file) {
    if (file.size === 0) { alert("\"" + file.name + "\" is empty."); return; }
    if (file.size > MAX_FILE) {
      alert("\"" + file.name + "\" is too large (" + fmtSize(MAX_FILE) + " max per file).");
      return;
    }
    readBuffer(file)
      .then(function (buf) { sendChat("", null, { name: file.name, buf: buf }); })
      .catch(function () { alert("Could not read \"" + file.name + "\"."); });
  }

  // pictures are shown inline (and shrunk); everything else becomes a download card
  function sendAnyFile(file) {
    if (!file) return;
    if (/^image\//.test(file.type) && file.size <= 25 * 1024 * 1024) {
      compressImage(file)
        .then(function (data) { sendChat("", data); })
        .catch(function () { sendRawFile(file); });
    } else {
      sendRawFile(file);
    }
  }
  window.sendAnyFile = sendAnyFile;

  // the attach button now accepts every kind of file
  $("imgInput").removeAttribute("accept");
  $("imgInput").multiple = true;
  $("attachBtn").textContent = "+ File";
  $("attachBtn").title = "Send a file";
  $("attachBtn").setAttribute("aria-label", "Send a file");
  $("msgInput").placeholder = "Write a message (or paste / drop a file)";

  $("attachBtn").addEventListener("click", function () { $("imgInput").click(); });
  $("imgInput").addEventListener("change", function () {
    Array.prototype.forEach.call(this.files, sendAnyFile);
    this.value = "";
  });
  $("msgInput").addEventListener("paste", function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === "file") {
        e.preventDefault();
        sendAnyFile(items[i].getAsFile());
      }
    }
  });
  var msgsBox = $("msgs");
  ["dragenter", "dragover"].forEach(function (ev) {
    msgsBox.addEventListener(ev, function (e) {
      e.preventDefault();
      msgsBox.classList.add("drop");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    msgsBox.addEventListener(ev, function () { msgsBox.classList.remove("drop"); });
  });
  msgsBox.addEventListener("drop", function (e) {
    e.preventDefault();
    Array.prototype.forEach.call((e.dataTransfer && e.dataTransfer.files) || [], sendAnyFile);
  });

  $("sendBtn").addEventListener("click", function () {
    sendChat($("msgInput").value);
    $("msgInput").value = "";
    $("msgInput").focus();
  });
  $("msgInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") $("sendBtn").click();
  });

  $("msgInput").addEventListener("input", function () {
    var now = Date.now();
    if (!this.value || now - lastTypingSent < 2000) return;
    lastTypingSent = now;
    if (isHost) broadcast({ type: "typing", id: myId, name: name });
    else send(hostConn, { type: "typing" });
  });

  window.wbSend = function (m) {
    if (isHost) broadcast({ type: "wb", m: m });
    else send(hostConn, { type: "wb", m: m });
  };

  // A laser message names the stream it points at. "local" / "lcam" only mean something on MY screen,
  // so they travel as my "s:<id>" / "c:<id>" and are turned back into local names on arrival.
  function canonStream(id) { return id === "local" ? "s:" + myId : id === "lcam" ? "c:" + myId : id; }
  function localStreamId(id) { return id === "s:" + myId ? "local" : id === "c:" + myId ? "lcam" : id; }
  function validStreamId(id) { return typeof id === "string" && id.length > 2 && id.length <= 100; }

  window.laserSend = function (spot, streamId) {
      if (!spot || !validStreamId(streamId)) return;

      var message = {
          type: "laser",
          sid: canonStream(streamId),
          spot: {
              x: spot.x,
              y: spot.y
          }
      };

      if (isHost) {
          broadcast({
              type: "laser",
              id: myId,
              sid: message.sid,
              spot: message.spot
          });
      } else {
          send(hostConn, message);
      }
  };

  function sendBoardHistory(conn) {
    if (!window.Whiteboard) return;
    Whiteboard.snapshot().forEach(function (m) { send(conn, { type: "wb", m: m }); });
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
    if (cameraStream) callPeer(id, "camera", cameraStream);
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
    if (window.Voices) Voices.detach(id);
    if (!el) return;
    el.srcObject = null;
    el.remove();
    delete voiceEls[id];
  }

  function handleMediaStop(d) {
    if (d.kind === "voice") removeVoice(d.from);
    else if (PREFIX[d.kind]) removeStream(PREFIX[d.kind] + d.from);
  }

  function cleanupPeer(id) {
    MEDIA_KINDS.forEach(function (kind) {
      var key = kind + ":" + id;
      if (outCalls[key]) { try { outCalls[key].close(); } catch (e) { } delete outCalls[key]; }
    });
    removeStream("s:" + id);
    removeStream("c:" + id);
    removeVoice(id);
    stopTyping(id);
    if (window.Voices) Voices.forget(id);
  }

  function playVoice(id, stream) {
    var el = voiceEls[id];
    if (!el) {
      el = document.createElement("audio");
      el.autoplay = true;
      el.style.display = "none";
      document.body.appendChild(el);
      voiceEls[id] = el;
      if (window.Voices) Voices.attach(id, el);
    }
    el.srcObject = stream;
    if (window.Speaking) Speaking.watch(id, stream);
    var p = el.play();
    if (p && p.catch) {
      p.catch(function () {
        var resume = function () { el.play().catch(function () { }); };
        document.addEventListener("click", resume, { once: true });
      });
    }
  }

  function onIncomingCall(call) {
    var kind = call.metadata && call.metadata.kind;
    if (MEDIA_KINDS.indexOf(kind) < 0) { call.close(); return; }
    function inRoom() { return users.some(function (u) { return u.id === call.peer; }); }
    var incoming = null, closed = false;
    // Only people on the roster may show or play anything. The roster can lag a moment behind
    // the call, so wait for it (up to ~3 s) while already listening, so the stream is never missed.
    function deliver(triesLeft) {
      if (closed || !incoming) return;
      if (inRoom()) {
        if (kind === "voice") playVoice(call.peer, incoming);
        else addStream(PREFIX[kind] + call.peer, incoming);
      } else if (triesLeft > 0) {
        setTimeout(function () { deliver(triesLeft - 1); }, 500);
      } else {
        call.close();
      }
    }
    call.answer();                                              // receive only
    call.on("stream", function (stream) { incoming = stream; deliver(6); });
    call.on("close", function () {
      closed = true;
      if (kind === "voice") removeVoice(call.peer);
      else removeStream(PREFIX[kind] + call.peer);
    });
  }

  // called by streaming.js
  window.onLocalStreamStart = function (stream) {
    screenStream = stream;
    myStatus.screen = true;
    publishStatus();
    users.forEach(function (u) {
      if (u.id && u.id !== myId) callPeer(u.id, "screen", stream);
    });
  };
  window.onLocalStreamStop = function () {
    screenStream = null;
    myStatus.screen = false;
    stopCalls("screen");
    announceMediaStop("screen");
    publishStatus();
  };
  window.onLocalCameraStart = function (stream) {
    cameraStream = stream;
    myStatus.cam = true;
    publishStatus();
    users.forEach(function (u) {
      if (u.id && u.id !== myId) callPeer(u.id, "camera", stream);
    });
  };
  window.onLocalCameraStop = function () {
    cameraStream = null;
    myStatus.cam = false;
    stopCalls("camera");
    announceMediaStop("camera");
    publishStatus();
  };

  // microphone
  var micBtn = $("micBtn");
  function setMicUi(on) {
    micBtn.setAttribute("aria-pressed", on ? "true" : "false");
    micBtn.textContent = on ? "Mic on" : "Mic off";
  }
  function stopMic() {
    if (micStream) {
      micStream.getTracks().forEach(function (t) { t.stop(); });
      micStream = null;
    }
    stopCalls("voice");
    announceMediaStop("voice");
    setMicUi(false);
    myStatus.mic = false;
    publishStatus();
    if (window.Speaking) Speaking.stop(myId);
  }
  micBtn.addEventListener("click", function () {
    if (micStream) { stopMic(); return; }
    var me = users.filter(function (u) { return u.id === myId; })[0];
    if (me && me.hmute) { alert("The host has muted you."); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Microphone access needs HTTPS (or localhost) and a supported browser.");
      return;
    }
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false
    })
      .then(function (stream) {
        micStream = stream;
        if (window.Speaking) Speaking.watch(myId, stream);
        setMicUi(true);
        myStatus.mic = true;
        publishStatus();
        users.forEach(function (u) {
          if (u.id && u.id !== myId) callPeer(u.id, "voice", stream);
        });
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

  function announce(text) {                               // a system line for everybody, kept in the history
    sysLocal(text);
    remember({ type: "sys", text: text });
    broadcast({ type: "sys", text: text });
  }

  function tooManyFails() {                                      // across the whole room: ids are free, so can't ban by id
    var cut = Date.now() - 60000;
    failTimes = failTimes.filter(function (t) { return t > cut; });
    return failTimes.length >= 10;
  }

  function challenge(conn, d) {
    conn.pending = d;                                            // keep the hello until the password is proven
    conn.fails = 0;
    send(conn, { type: "need-password", salt: pwRecord.salt });
    conn.authTimer = setTimeout(function () {                    // don't let silent connections pile up
      if (!conn.joined) {
        send(conn, { type: "auth-fail", final: true, reason: "Timed out." });
        setTimeout(function () { conn.close(); }, 300);
      }
    }, 60000);
  }

  function checkAuth(conn, d) {
    if (tooManyFails()) {
      send(conn, { type: "auth-fail", final: true, reason: "Too many wrong attempts. Try again in a minute." });
      setTimeout(function () { conn.close(); }, 300);
      return;
    }
    if (sameString(d.proof, pwRecord.proof)) {
      clearTimeout(conn.authTimer);
      var hello = conn.pending;
      conn.pending = null;
      acceptGuest(conn, hello, true);
      return;
    }
    failTimes.push(Date.now());
    conn.fails++;
    if (conn.fails >= 5) {
      send(conn, { type: "auth-fail", final: true, reason: "Wrong password." });
      setTimeout(function () { conn.close(); }, 300);
    } else {
      send(conn, { type: "auth-fail", left: 5 - conn.fails });
    }
  }

  function acceptGuest(conn, d, authed) {
    var existing = users.filter(function (u) { return u.id === conn.peer; })[0];

    if (!existing) {
      if (locked) { send(conn, { type: "room-locked" }); setTimeout(function () { conn.close(); }, 300); return; }
      if (users.length >= MAX_USERS) { send(conn, { type: "full" }); setTimeout(function () { conn.close(); }, 300); return; }
      if (pwRecord && !authed) { challenge(conn, d); return; }
    }

    conn.joined = true;
    conn.userName = existing ? existing.name : uniqueName(cleanName(d.name));
    conns.push(conn);
    if (!existing) users.push({ id: conn.peer, name: conn.userName });

    send(conn, {
      type: "welcome", users: users, locked: locked, reacts: reacts, notes: sharedNotesText, mediaState: syncedMediaState,
      pwSalt: pwRecord ? pwRecord.salt : null,
      history: d.rejoin ? [] : history.slice()
    });
    if (!d.rejoin) sendBoardHistory(conn);                // a returning member already has the board

    if (!existing) announce(conn.userName + " joined");
    broadcast({ type: "roster", users: users }, conn);
    renderUsers();
    startMediaTo(conn.peer);
  }
  function setLockUi(on) {                              // runs on everyone
    if ($("lockTag")) $("lockTag").hidden = !on;
    var b = $("lockBtn");
    if (b) {
      b.hidden = !isHost;                               // only the host sees the button
      b.textContent = on ? "🔒 Unlock room" : "🔓 Lock room";
      b.setAttribute("aria-pressed", on);
    }
  }
  function dropGuest(conn) {
    if (!isHost) return;
    var i = conns.indexOf(conn);
    if (i < 0) return;
    conns.splice(i, 1);
    users = users.filter(function (u) { return u.id !== conn.peer; });
    cleanupPeer(conn.peer);

    var note = { type: "sys", text: conn.userName + (conn.kicked ? " was removed by the host" : " left") };
    sysLocal(note.text);
    remember(note);
    broadcast(note);
    broadcast({ type: "roster", users: users });
    renderUsers();
  }

  function onHostData(conn, d) {
    if (!d || typeof d !== "object") return;
    if (d.type === "hello") {
      if (!conn.joined) acceptGuest(conn, d, false);
      return;
    }
    if (d.type === "auth") { if (!conn.joined && conn.pending) checkAuth(conn, d); return; }
    if (!conn.joined) return;
    if (d.type === "chat") {
      var text = clip(d.text, MAX_TEXT).trim();
      var img = cleanImg(d.img);
      var file = cleanFile(d.file);
      var mid = cleanMid(d.mid);
      if (!mid || msgIndex[mid]) return;
      if (!text && !img && !file) return;

      stopTyping(conn.peer);
      var src = cleanMid(d.reply) && msgIndex[d.reply];
      var reply = src ? { mid: d.reply, name: src.name, text: src.text } : null;
      var m = {
        type: "chat", id: conn.peer, name: conn.userName,
        text: text, img: img, file: file, mid: mid, reply: reply
      };
      addMessage(m.name, m.text, false, false, img, file, { mid: mid, reply: reply });
      indexMsg(mid, m.name, snippet(text, img, file));
      rememberChat(m);
      broadcast(m, conn);
    } else if (d.type === "status") {
      var u = users.filter(function (x) { return x.id === conn.peer; })[0];
      if (u) {
        u.mic = !!d.mic;
        u.screen = !!d.screen;
        u.cam = !!d.cam;
        renderUsers();
        broadcast({ type: "roster", users: users });
      }
    } else if (d.type === "wb") {
      var wbMsg = window.Whiteboard && Whiteboard.applyRemote(d.m);   // a cleaned copy, or null if it was invalid
      if (wbMsg) broadcast({ type: "wb", m: wbMsg }, conn);
    } else if (d.type === "notes-update") {
      if (typeof d.text !== "string") return;

      sharedNotesText = d.text.slice(0, 100000);

      // Update the host's own notes box.
      var notesBox = $("sharedNotes");
      if (notesBox) {
        notesBox.value = sharedNotesText;
      }

      // Send the update to everyone except the guest who sent it.
      broadcast({
        type: "notes-update",
        text: sharedNotesText
      }, conn);
    }else if (d.type === "poll-create") {
        var request = d.poll;

        if (
          !request ||
          typeof request.question !== "string" ||
          !Array.isArray(request.options)
        ) {
          return;
        }

        var question = request.question.trim().slice(0, 200);
        var options = request.options
          .filter(function (option) {
            return typeof option === "string";
          })
          .map(function (option) {
            return option.trim().slice(0, 100);
          })
          .filter(Boolean);

        if (!question || options.length < 2 || options.length > 10) {
          return;
        }

        var poll = {
          id: "poll-" + Date.now() + "-" +
            Math.random().toString(36).slice(2, 8),
          creatorId: conn.peer,
          name: conn.userName || "Guest",
          question: question,
          options: options,
          counts: options.map(function () { return 0; }),
          votes: {},
          closed: false
        };

        polls[poll.id] = poll;

        addPollMessage(poll, false);
        remember({ type: "poll", poll: poll });
        broadcast({ type: "poll-create", poll: poll });
      }else if (d.type === "laser") {
      var spot = d.spot;

      if (
          !spot ||
          !Number.isFinite(spot.x) ||
          !Number.isFinite(spot.y) ||
          spot.x < 0 || spot.x > 1 ||
          spot.y < 0 || spot.y > 1
      ) {
          return;
      }

      if (!validStreamId(d.sid)) return;

      if (window.laserReceive) {
          window.laserReceive(conn.peer, spot, localStreamId(d.sid));
      }

      broadcast({
          type: "laser",
          id: conn.peer,
          sid: d.sid,
          spot: {
              x: spot.x,
              y: spot.y
          }
      }, conn);
    } else if (d.type === "media-stop" && MEDIA_KINDS.indexOf(d.kind) >= 0) {
      var s = { type: "media-stop", kind: d.kind, from: conn.peer };
      handleMediaStop(s);
      broadcast(s, conn);
    } else if (d.type === "media-sync") {
      var incoming = d.state;
      if (!incoming || typeof incoming !== "object") return;
      var action = incoming.action;
      if (["load", "play", "pause", "seek", "clear"].indexOf(action) < 0) return;
      var cleanState = { action: action, at: Date.now() };
      if (action === "load") {
        if (typeof incoming.url !== "string" || incoming.url.length > 2000) return;
        try {
          var mediaUrl = new URL(incoming.url);
          if (!["https:", "http:"].includes(mediaUrl.protocol) || mediaUrl.username || mediaUrl.password) return;
          cleanState.url = mediaUrl.href;
        } catch (e) { return; }
      } else if (action === "play" || action === "pause" || action === "seek") {
        if (!Number.isFinite(incoming.time) || incoming.time < 0 || incoming.time > 86400) return;
        cleanState.time = incoming.time;
        if (syncedMediaState && typeof syncedMediaState.url === "string") cleanState.url = syncedMediaState.url;
      }
      syncedMediaState = cleanState;
      if (window.applySyncedMedia) window.applySyncedMedia(cleanState, true);
      broadcast({ type: "media-sync", state: cleanState });
    } else if (d.type === "typing") {
      var t = { type: "typing", id: conn.peer, name: conn.userName };
      someoneTyping(t.id, t.name);
      broadcast(t, conn);
    } else if (d.type === "react") {
      applyReaction(cleanMid(d.mid), conn.peer, d.emoji);
    }else if (d.type === "poll-vote") {
      var poll = polls[d.pollId];

      if (
        !poll ||
        poll.closed ||
        !Number.isInteger(d.optionIndex) ||
        d.optionIndex < 0 ||
        d.optionIndex >= poll.options.length
      ) {
        return;
      }

      poll.votes = poll.votes || {};

      // Each connected participant gets one vote per poll.
      if (
        Object.prototype.hasOwnProperty.call(
          poll.votes,
          conn.peer
        )
      ) {
        return;
      }

      // Use the sender's connection ID, not an ID supplied by them.
      poll.votes[conn.peer] = d.optionIndex;

      recountPoll(poll);

      if (typeof window.refreshPollMessage === "function") {
        window.refreshPollMessage(poll);
      }

      remember({ type: "poll", poll: poll });

      broadcast({
        type: "poll-update",
        poll: poll
      });
    }
  }

  function acceptConnection(conn) {                       // same logic as before, now on the hub
    conn.on("data", function (d) { onHostData(conn, d); });
    conn.on("close", function () { dropGuest(conn); });
    conn.on("error", function () { dropGuest(conn); });
  }

  // Try to take the room address. Used when creating a room AND when taking over one.
  function openHub(onOpen, onTaken) {
    var h = new Peer(ROOM_PREFIX + code, PEER_OPTS);
    h.on("open", function () { hub = h; onOpen(); });
    h.on("connection", acceptConnection);
    h.on("error", function (err) {
      if (err.type === "unavailable-id") { try { h.destroy(); } catch (e) { } onTaken(); }
      else if (err.type !== "peer-unavailable") sysLocal("Connection problem: " + err.type);
    });
    h.on("disconnected", function () {                    // keep the address alive on the server
      setTimeout(function () { if (!h.destroyed && h.disconnected) h.reconnect(); }, 1500);
    });
  }

  function initHost() {
    peer = new Peer(undefined, PEER_OPTS);                // my identity: random id

    peer.on("open", function (id) {
      myId = id;
      users = [{ id: id, name: name, host: true }];
      renderUsers();
      setupPassword().then(function () {
        openHub(
          function () { sysLocal("Room " + code + " is open. Share the code to invite friends."); },
          function () { alert("That room code is already in use. Go back and create a new room."); goHome(); }
        );
      }, function (msg) {
        alert(typeof msg === "string" ? msg : "Could not set the room password.");
        goHome();
      });
    });

    peer.on("error", function (err) {
      if (err.type !== "peer-unavailable") sysLocal("Connection problem: " + err.type);
    });
  }

  function userNameOf(id) {
    var u = users.filter(function (x) { return x.id === id; })[0];
    return u ? u.name : "someone";
  }

  // Who should take over, in order. Same answer on every client, because the roster is the same.
  function successionOrder() {
    var lost = users.filter(function (u) { return u.host; })[0];
    var ids = users.filter(function (u) { return !u.host; }).map(function (u) { return u.id; });
    if (nextHost && ids.indexOf(nextHost) >= 0) {         // a handover chose someone: they go first
      ids = [nextHost].concat(ids.filter(function (i) { return i !== nextHost; }));
    }
    if (lost) ids.push(lost.id);                          // a host that stepped down may still claim, last
    return ids;
  }

  function hostLost(msg) {
    if (leaving || isHost || recovering) return;
    recovering = true;
    giveUpAt = Date.now() + 120000;
    sysLocal(msg || (nextHost ? "Switching to the new host…" : "The host is gone. Choosing a new host…"));

    var rank = Math.max(0, successionOrder().indexOf(myId));
    setTimeout(claimLoop, 1500 + rank * 4000);            // first in line goes first
    if (hostConn) hostConn.failed = true;                 // that connection is dead: replace it at once
    rejoinLoop();
  }

  function rejoinLoop() {                                 // try to reach whoever holds the address
    if (!recovering || leaving) return;
    if (Date.now() > giveUpAt) { alert("Lost the connection to the room."); goHome(); return; }
    if (!hostConn || hostConn.failed || (!hostConn.open && Date.now() - hostConn.startedAt > 6000)) connectToHost();
    setTimeout(rejoinLoop, 2000);
  }

  function claimLoop() {                                  // try to become the holder of the address
    if (!recovering || isHost || leaving || Date.now() > giveUpAt) return;
    openHub(becomeHost, function () { setTimeout(claimLoop, 5000); });   // taken (or still reserved): try again
  }

  /* ------------------------------- GUEST ------------------------------- */
  function onGuestData(d) {
    if (!d || typeof d !== "object") return;
    switch (d.type) {
      case "welcome":
        $("pwDialog").hidden = true;
        if (d.pwSalt) { pwSalt = d.pwSalt; if (pendingProof) pwProof = pendingProof; }
        pendingProof = null;
        setPwUi(!!d.pwSalt);
        joined = true;
        recovering = false;
        locked = !!d.locked;
        setLockUi(locked);
        setUsers(d.users);
        if (!welcomed) {                                  // first welcome: show the replayed chat
          history = Array.isArray(d.history) ? d.history.slice() : [];
          replaying = true;                               // old messages are not "unread"
          history.forEach(function (e) {
            if (e.type === "sys") sysLocal(clip(e.text, MAX_TEXT));
            else if (e.type === "chat") addMessage(
              clip(e.name, 20), clip(e.text, MAX_TEXT), false, false,
              cleanImg(e.img), null, { mid: cleanMid(e.mid), reply: cleanReply(e.reply) }
            );
            else if (e.type === "poll" && e.poll) {
              var poll = e.poll;

              if (typeof poll.id !== "string") {
                return;
              }

              var alreadyDisplayed = Array.from(
                document.querySelectorAll(".poll-message")
              ).some(function (element) {
                return element.dataset.pollId === poll.id;
              });

              polls[poll.id] = poll;

              if (alreadyDisplayed) {
                if (typeof window.refreshPollMessage === "function") {
                  window.refreshPollMessage(poll);
                }
              } else {
                addPollMessage(poll, poll.creatorId === myId);
              }
            }
          });
          replaying = false;
        }
        reacts = d.reacts || {};
        if (!welcomed) Object.keys(reacts).forEach(function (mid) { renderReacts(mid, reacts[mid]); });
        var wasBack = welcomed;
        welcomed = true;
        if (wasBack) publishStatus();      
        var notesBox = $("sharedNotes");
        if (notesBox && typeof d.notes === "string") {
          notesBox.value = d.notes;
        }
        if (d.mediaState && window.applySyncedMedia) window.applySyncedMedia(d.mediaState, false);
        break;
      case "media-sync":
        if (d.state && window.applySyncedMedia) window.applySyncedMedia(d.state, false);
        break;
      case "roster":
        setUsers(d.users);
        break;
      case "chat": {
        stopTyping(String(d.id));
        var cm = {
          id: String(d.id), name: clip(d.name, 20), text: clip(d.text, MAX_TEXT),
          img: cleanImg(d.img), file: cleanFile(d.file),
          mid: cleanMid(d.mid), reply: cleanReply(d.reply)
        };            // reactions
        addMessage(cm.name, cm.text, false, false, cm.img, cm.file, { mid: cm.mid, reply: cm.reply });
        rememberChat(cm);
        break;
      }
      case "sys": {
        var t = clip(d.text, MAX_TEXT);
        sysLocal(t);
        remember({ type: "sys", text: t });
        break;
      }
      case "reacts":                                          // reactions
        renderReacts(d.mid, d.reacts);
        if (cleanMid(d.mid)) reacts[d.mid] = d.reacts || {};
        break;
      case "wb":
        if (window.Whiteboard) Whiteboard.applyRemote(d.m);
        break;
      case "laser":
        if (window.laserReceive && validStreamId(d.sid)) {
          window.laserReceive(d.id, d.spot, localStreamId(d.sid));
        }
        return;
      case "media-stop":
        if (typeof d.from === "string") handleMediaStop(d);
        break;
      case "full":
        alert("This room is full.");
        goHome();
        break;
      case "typing":
        someoneTyping(String(d.id), clip(d.name, 20));
        break;
      case "kicked":
        alert("The host removed you from the room.");
        goHome();                                           // sets leaving = true, so the close that follows is ignored
        break;
      case "force-mute":
        if (micStream) stopMic();
        sysLocal("The host muted your microphone.");
        break;
      case "lock":
        locked = !!d.locked;
        setLockUi(locked);
        sysLocal(locked ? "The host locked the room." : "The host unlocked the room.");
        break;
      case "room-locked":                                   // turned away at the door
        alert("This room is locked by the host.");
        goHome();
        break;
      case "handover":
        if (typeof d.to === "string") {
          nextHost = d.to;
          sysLocal(d.to === myId ? "The host is passing the room to you."
            : "The host is passing the room to " + userNameOf(d.to) + ".");
        }
        break;
      case "need-password":
        clearTimeout(joinTimer);                                      // the host answered; the user may take a while to type
        askSalt = d.salt;
        if (pwProof && pwSalt === d.salt) {                           // a returning member already knows it
          send(hostConn, { type: "auth", proof: pwProof });
        } else {
          askPassword(0);
        }
        break;
      case "auth-fail":
        if (d.final) { alert(d.reason || "Wrong password."); goHome(); }
        else askPassword(d.left);
        break;
      case "notes-update": {
        var notesBox = $("sharedNotes");

        if (notesBox && typeof d.text === "string") {
          notesBox.value = d.text.slice(0, 100000);

          var status = $("notesStatus");
          if (status) status.textContent = "Notes synchronized";
        }
        break;
      }
      case "poll-create": {
        var poll = d.poll;

        if (
          !poll ||
          typeof poll.id !== "string" ||
          typeof poll.question !== "string" ||
          !Array.isArray(poll.options) ||
          poll.options.length < 2
        ) {
          break;
        }

        if (polls[poll.id]) {
          break;
        }

        polls[poll.id] = poll;
        addPollMessage(poll, poll.creatorId === myId);
        break;
      }
      case "poll-update": {
        var updatedPoll = d.poll;
        if (
          !updatedPoll ||
          typeof updatedPoll.id !== "string" ||
          typeof updatedPoll.question !== "string" ||
          !Array.isArray(updatedPoll.options) ||
          !Array.isArray(updatedPoll.counts) ||
          !updatedPoll.votes ||
          typeof updatedPoll.votes !== "object"
        ) {
          break;
        }
        polls[updatedPoll.id] = updatedPoll;
        refreshPollMessage(updatedPoll);
        break;
      }
    }
  }

  function connectToHost() {
    var c = peer.connect(ROOM_PREFIX + code, { reliable: true });
    c.startedAt = Date.now();
    hostConn = c;
    c.on("open", function () { send(c, { type: "hello", name: name, rejoin: welcomed }); });
    c.on("data", function (d) { if (c === hostConn) onGuestData(d); });
    c.on("close", function () { if (c === hostConn && !leaving) hostLost(); });   // ignore abandoned attempts
    c.on("error", function () { /* "close" follows */ });
  }

  function initGuest() {
    peer = new Peer(undefined, PEER_OPTS);
    var timer;

    peer.on("open", function (id) {
      myId = id;
      users[0].id = id;
      renderUsers();
      sysLocal("Connecting to room " + code + "...");

      connectToHost();
      joinTimer = setTimeout(function () {
        if (!joined && !leaving) {
          alert("Could not connect to the room. Check the code and try again.");
          goHome();
        }
      }, CONNECT_TIMEOUT);
    });

    peer.on("error", function (err) {
      if (err.type === "peer-unavailable") {
        if (!joined && !leaving) {                        // before joining = the room does not exist
          clearTimeout(timer);
          alert("Room not found. Check the code and try again.");
          goHome();
        }                                                 // after joining = a peer we tried to call is gone
      } else {
        sysLocal("Connection problem: " + err.type);
      }
    });
  }

  /* ----------------------- typing indicator + unread ----------------------- */
  var typers = {};
  var lastTypingSent = 0;
  var unread = 0, baseTitle = document.title;

  function typingEl() {
    var el = $("typing");
    if (!el) {
      el = document.createElement("div");
      el.id = "typing";
      el.className = "typing";
      var c = document.querySelector(".compose");
      c.parentNode.insertBefore(el, c);
    }
    return el;
  }

  function renderTyping() {
    var names = Object.keys(typers).map(function (id) {
      return typers[id].name;
    });
    var t = "";
    if (names.length === 1) t = names[0] + " is typing\u2026";
    else if (names.length === 2) t = names[0] + " and " + names[1] + " are typing\u2026";
    else if (names.length > 2) t = "Several people are typing\u2026";
    typingEl().textContent = t;
  }

  function someoneTyping(id, nm) {
    if (id === myId) return;
    if (typers[id]) clearTimeout(typers[id].timer);
    typers[id] = {
      name: nm,
      timer: setTimeout(function () { stopTyping(id); }, 3000)
    };
    renderTyping();
  }

  function stopTyping(id) {
    if (!typers[id]) return;
    clearTimeout(typers[id].timer);
    delete typers[id];
    renderTyping();
  }

  // the chat counts as "seen" only when its tab is open AND the browser tab is in front
  function chatVisible() {
    return !document.hidden && !$("v-chat").hidden;
  }

  function badgeEl() {
    var b = $("chatBadge");
    if (!b) {
      b = document.createElement("span");
      b.id = "chatBadge";
      b.className = "unread";
      b.hidden = true;
      var btn = document.querySelector('nav [data-view="chat"]');
      if (btn) btn.appendChild(b);
    }
    return b;
  }

  function renderUnread() {
    var b = badgeEl();
    b.textContent = unread;
    b.hidden = !unread;
    document.title = (unread ? "(" + unread + ") " : "") + baseTitle;
  }
  function clearUnread() {
    unread = 0;
    renderUnread();
  }

  // no hook in room.js needed: watch the chat panel being shown / hidden
  new MutationObserver(function () {
    if (chatVisible()) clearUnread();
  }).observe($("v-chat"), {
    attributes: true,
    attributeFilter: ["hidden"]
  });

  document.addEventListener("visibilitychange", function () {
    if (chatVisible()) clearUnread();
  });
  typingEl();
  badgeEl();

  // create emojis
  var REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"];
  var MID_RE = /^[a-z0-9]{8,24}$/;

  var seen = {};       // every peer: mid -> { name, text } (messages it has shown)
  var msgIndex = {};   // host only: mid -> { name, text } (what a reply may quote)
  var msgOrder = [];   // host only: mids in order, so the index can be capped
  var reacts = {};     // host only: mid -> { "👍": [peerId, ...] }
  var replyingTo = null;

  function newMid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function cleanMid(v) {
    return (typeof v === "string" && MID_RE.test(v)) ? v : null;
  }

  function cleanReply(r) {
    if (!r || typeof r !== "object") return null;
    return {
      mid: cleanMid(r.mid),
      name: clip(r.name, 20),
      text: clip(r.text, 80)
    };
  }

  function indexMsg(mid, nm, text) { // host: remember a message, capped at 500
    msgIndex[mid] = { name: nm, text: text };
    msgOrder.push(mid);
    if (msgOrder.length > 500) {
      var old = msgOrder.shift();
      delete msgIndex[old];
      delete reacts[old];
    }
  }

  function quoteEl(r) {
    var q = document.createElement("div");
    q.className = "quote";

    var b = document.createElement("b");
    b.textContent = r.name;
    q.appendChild(b);
    q.appendChild(document.createTextNode(" " + r.text));

    q.onclick = function () {
      if (!r.mid) return;
      var t = document.querySelector('[data-mid="' + r.mid + '"]');
      if (!t) return;
      t.scrollIntoView({ block: "center", behavior: "smooth" });
      t.classList.add("flash");
      setTimeout(function () {
        t.classList.remove("flash");
      }, 1200);
    };

    return q;
  }

  function actionsEl(mid) {
    var bar = document.createElement("div");
    bar.className = "acts";

    REACTIONS.forEach(function (e) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = e;
      b.setAttribute("aria-label", "React " + e);
      b.onclick = function () { react(mid, e); };
      bar.appendChild(b);
    });

    var r = document.createElement("button");
    r.type = "button";
    r.textContent = "↩ Reply";
    r.onclick = function () { startReply(mid); };
    bar.appendChild(r);

    return bar;
  }

  function renderReacts(mid, map) {
    mid = cleanMid(mid);
    var msg = mid && document.querySelector('[data-mid="' + mid + '"]');
    if (!msg) return;

    var row = msg.querySelector(".reacts");
    row.innerHTML = "";

    REACTIONS.forEach(function (e) {
      var ids = (map && Array.isArray(map[e])) ? map[e] : [];
      if (!ids.length) return;

      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (ids.indexOf(myId) >= 0 ? " mine" : "");
      chip.textContent = e + " " + ids.length;
      chip.title = ids.map(function (id) {
        var u = users.filter(function (x) { return x.id === id; })[0];
        return u ? u.name : "someone";
      }).join(", ");

      chip.onclick = function () { react(mid, e); };
      row.appendChild(chip);
    });
  }

  function react(mid, emoji) {
    // Clicking the same emoji again removes it.
    if (isHost) applyReaction(mid, myId, emoji);
    else send(hostConn, { type: "react", mid: mid, emoji: emoji });
  }

  function startReply(mid) {
    var s = seen[mid];
    if (!s) return;

    replyingTo = mid;
    $("replyText").textContent = "Replying to " + s.name + ": " + s.text;
    $("replyBar").hidden = false;
    $("msgInput").focus();
  }

  function cancelReply() {
    replyingTo = null;
    $("replyBar").hidden = true;
  }

  $("replyCancel").addEventListener("click", cancelReply);

  $("msgInput").addEventListener("keydown", function (e) {
    if (e.key === "Escape") cancelReply();
  });

  function applyReaction(mid, userId, emoji) {
    if (!mid || !msgIndex[mid] || REACTIONS.indexOf(emoji) < 0) return;

    var r = reacts[mid] = reacts[mid] || {};
    var arr = r[emoji] = r[emoji] || [];
    var i = arr.indexOf(userId);

    if (i < 0) arr.push(userId);
    else arr.splice(i, 1);

    if (!arr.length) delete r[emoji];

    renderReacts(mid, r);
    broadcast({ type: "reacts", mid: mid, reacts: r });

  }

  function kick(id) {                                   // host only
    var conn = connOf(id);
    if (!conn) return;
    conn.kicked = true;                                 // so the "left" message says why
    send(conn, { type: "kicked" });
    setTimeout(function () { conn.close(); }, 300);
  }

  function hostMute(id, on) {                           // host only
    var u = users.filter(function (x) { return x.id === id; })[0];
    if (!u) return;
    u.hmute = on;
    if (on) send(connOf(id), { type: "force-mute" });   // asks their client to stop the mic
    if (window.Voices) Voices.hostMute(id, on);         // the host stops hearing them too
    renderUsers();
    broadcast({ type: "roster", users: users });
  }
  $("lockBtn").addEventListener("click", function () {
    if (!isHost) return;
    locked = !locked;
    broadcast({ type: "lock", locked: locked });
    setLockUi(locked);
    sysLocal(locked ? "You locked the room." : "You unlocked the room.");
  });
  setLockUi(false);

  function becomeHost() {
    if (isHost) return;
    isHost = true;
    joined = true;
    recovering = false;
    nextHost = null;
    pwRecord = pwProof ? { salt: pwSalt, proof: pwProof } : null;

    if (hostConn) { var old = hostConn; hostConn = null; try { old.close(); } catch (e) { } }
    conns = [];
    users.forEach(function (u) { u.host = (u.id === myId); });   // the roster is inherited, only the badge moves

    msgIndex = {}; msgOrder = [];                         // reactions: rebuild what replies can quote
    history.forEach(function (e) { if (e.mid) indexMsg(e.mid, e.name, snippet(e.text, e.img, null)); });

    setLockUi(locked);                                    // shows the Lock button, host tools appear on re-render
    renderUsers();
    sysLocal("You are now the host.");
    setTimeout(pruneAbsent, GRACE);
  }

  // After the grace period, anyone from the old roster who never reconnected is gone.
  function pruneAbsent() {
    if (!isHost) return;
    var gone = users.filter(function (u) { return u.id !== myId && !connOf(u.id); });
    gone.forEach(function (u) { cleanupPeer(u.id); });
    users = users.filter(function (u) { return gone.indexOf(u) < 0; });
    gone.forEach(function (u) { announce(u.name + " left"); });
    renderUsers();
    broadcast({ type: "roster", users: users });
    announce(name + " is now the host.");
  }

  function handOver(toId) {                               // host only
    if (!connOf(toId)) return;
    broadcast({ type: "handover", to: toId });            // everyone learns who is next
    nextHost = toId;
    setTimeout(stepDown, 600);                            // let that message leave first
  }

  function stepDown() {
    if (!isHost) return;
    isHost = false;                                       // dropGuest() now ignores the closes below
    welcomed = true;                                      // I already have the chat and board: no replay on rejoin
    var h = hub; hub = null;
    conns = [];
    try { h.destroy(); } catch (e) { }                    // frees the address, closes every guest connection
    setLockUi(locked);                                    // hides the host-only button
    renderUsers();
    hostLost("You handed over the room. Reconnecting…");  // from here on we are a regular member
  }

  window.hostAction = function (kind, id, arg) {
    if (!isHost) return;
    if (kind === "kick") kick(id);
    else if (kind === "mute") hostMute(id, arg);
    else if (kind === "handover") handOver(id);
  };

  window.addEventListener("pagehide", function () {
    leaving = true;
    if (micStream) micStream.getTracks().forEach(function (t) { t.stop(); });
    if (cameraStream) cameraStream.getTracks().forEach(function (t) { t.stop(); });
    if (hub && !hub.destroyed) hub.destroy();             // release the room address first
    if (peer && !peer.destroyed) peer.destroy();
  });

  /* -------------------------------- start ------------------------------ */
  renderUsers();

  if (typeof Peer === "undefined") {
    sysLocal("Could not load PeerJS. Check your internet connection and reload.");
    return;
  }

  if (isHost) initHost();
  else initGuest();

  peer.on("call", onIncomingCall);

  // recovery: "nobody holds the room address yet" -> mark the attempt failed so the loop retries at once
  peer.on("error", function (err) {
    if (err.type !== "peer-unavailable" || !recovering || !hostConn) return;
    var msg = String(err.message || "");
    var aboutSomeoneElse = users.some(function (u) { return u.id !== myId && msg.indexOf(u.id) >= 0; });
    if (!aboutSomeoneElse) hostConn.failed = true;   // (a failed media call to a departed member is ignored)
  });

  peer.on("disconnected", function () {
    if (leaving) return;
    setTimeout(function () {
      if (peer && !peer.destroyed && peer.disconnected) peer.reconnect();
    }, 1500);
  });

  var PBKDF2_ITER = 200000;   // slow on purpose: makes guessing a weak password expensive

  function toB64(buf) {
    var s = "";
    new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); });
    return btoa(s);
  }

  function newSalt() { return toB64(crypto.getRandomValues(new Uint8Array(16))); }

  function deriveProof(password, salt) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"])
      .then(function (key) {
        return crypto.subtle.deriveBits(
          { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt + "|auth"), iterations: PBKDF2_ITER },
          key, 256);
      })
      .then(toB64);
  }

  function sameString(a, b) {                       // compare without stopping at the first difference
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    var r = 0;
    for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }
  var pendingProof = null, askSalt = null, joinTimer = null;

  function askPassword(triesLeft) {
    $("pwErr").textContent = triesLeft ? "Wrong password. " + triesLeft + " tries left." : "";
    $("pwInput").value = "";
    $("pwDialog").hidden = false;
    $("pwInput").focus();
  }

  $("pwForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var pass = $("pwInput").value;
    if (!pass) return;
    $("pwErr").textContent = "Checking…";
    deriveProof(pass, askSalt).then(function (proof) {
      pendingProof = proof;                                       // kept only if the host accepts it
      send(hostConn, { type: "auth", proof: proof });
    }, function () {
      $("pwErr").textContent = "This browser can't check passwords here (HTTPS needed).";
    });
  });
  $("pwCancel").addEventListener("click", function () { $("pwDialog").hidden = true; goHome(); });

  window.notesSend = function (text) {
    if (typeof text !== "string") return;

    // Keep notes to a reasonable size.
    text = text.slice(0, 100000);

    if (isHost) {
      sharedNotesText = text;
      broadcast({ type: "notes-update", text: text });
    } else {
      send(hostConn, { type: "notes-update", text: text });
    }

    var status = $("notesStatus");
    if (status) status.textContent = "Notes synchronized";
  };

  //Poll
    window.sendSyncedMediaState = function (state) {
    if (!state || typeof state !== "object") return;
    if (isHost) {
      var action = state.action;
      if (["load", "play", "pause", "seek", "clear"].indexOf(action) < 0) return;
      var cleanState = { action: action, at: Date.now() };
      if (action === "load") {
        try {
          var u = new URL(state.url);
          if (!["https:", "http:"].includes(u.protocol) || u.username || u.password || u.href.length > 2000) return;
          cleanState.url = u.href;
        } catch (e) { return; }
      } else if (["play", "pause", "seek"].indexOf(action) >= 0) {
        if (!Number.isFinite(state.time) || state.time < 0 || state.time > 86400) return;
        cleanState.time = state.time;
        if (syncedMediaState && typeof syncedMediaState.url === "string") cleanState.url = syncedMediaState.url;
      }
      syncedMediaState = cleanState;
      broadcast({ type: "media-sync", state: cleanState });
    } else {
      send(hostConn, { type: "media-sync", state: state });
    }
  };

  window.createPoll = function (question, options) {
    question = String(question || "").trim().slice(0, 200);

    options = options
      .map(function (option) {
        return String(option || "").trim().slice(0, 100);
      })
      .filter(Boolean);

    if (!question || options.length < 2 || options.length > 10) {
      alert("Please provide a question and 2–10 options.");
      return;
    }

    var poll = {
      id: "poll-" + Date.now() + "-" +
        Math.random().toString(36).slice(2, 8),
      creatorId: myId,
      name: name,
      question: question,
      options: options,
      counts: options.map(function () { return 0; }),
      votes: {},
      closed: false
    };

    if (isHost) {
      polls[poll.id] = poll;
      addPollMessage(poll, true);
      remember({ type: "poll", poll: poll });
      broadcast({ type: "poll-create", poll: poll });
    } else {
      send(hostConn, {
        type: "poll-create",
        poll: poll
      });
    }

    var dialog = $("pollDialog");
    if (dialog) dialog.hidden = true;

    var questionInput = $("pollQuestion");
    if (questionInput) questionInput.value = "";

    document.querySelectorAll(".pollOption").forEach(function (input, index) {
      if (index < 2) {
        input.value = "";
      } else {
        input.remove();
      }
    });
  };

  function recountPoll(poll) {
    poll.counts = poll.options.map(function () {
      return 0;
    });

    Object.keys(poll.votes || {}).forEach(function (voterId) {
      var optionIndex = poll.votes[voterId];

      if (
        Number.isInteger(optionIndex) &&
        optionIndex >= 0 &&
        optionIndex < poll.options.length
      ) {
        poll.counts[optionIndex]++;
      }
    });
  }
  window.voteInPoll = function (pollId, optionIndex) {
      var poll = polls[pollId];

      if (
        !poll ||
        poll.closed ||
        !Number.isInteger(optionIndex) ||
        optionIndex < 0 ||
        optionIndex >= poll.options.length
      ) {
        return;
      }

      poll.votes = poll.votes || {};

      // Don't let this participant vote twice.
      if (
        Object.prototype.hasOwnProperty.call(poll.votes, myId)
      ) {
        return;
      }

      if (isHost) {
        poll.votes[myId] = optionIndex;

        recountPoll(poll);

        if (typeof window.refreshPollMessage === "function") {
          window.refreshPollMessage(poll);
        }

        remember({ type: "poll", poll: poll });

        broadcast({
          type: "poll-update",
          poll: poll
        });
      } else {
        send(hostConn, {
          type: "poll-vote",
          pollId: pollId,
          optionIndex: optionIndex
        });
      }
    };
})();
