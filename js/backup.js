/* Save the room to one file, and load it back later.
 *
 * File format (JSON, version 1):
 *   { app: "peerly", version: 1, exportedAt, room, savedBy,
 *     chat:  [ { t, from, text, sys, img? } ],     what was said (images only when small)
 *     notes: "text",                                 the shared notes
 *     board: [ {id,k,c,w,p,...} ],                   the whiteboard objects (see whiteboard.js)
 *     media: "https://..." | null }                  the last link in the Cinema room
 *
 * Importing never trusts the file: every field is checked and clipped first.
 * Chat lines are only shown on YOUR screen (nobody else sees them, so nobody can be impersonated).
 * Notes and the drawing are shared with the room, but only after you confirm.
 */
(function () {
  "use strict";
  var saveBtn = $("backupSave"), loadBtn = $("backupLoad"), file = $("backupFile"), msgs = $("msgs");
  if (!saveBtn || !loadBtn || !file || !msgs) return;

  var MAX_FILE = 25 * 1024 * 1024, MAX_CHAT = 5000, MAX_IMG = 400 * 1024, MAX_IMG_TOTAL = 12 * 1024 * 1024;
  var IMG_OK = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+\/=]+$/;

  // chat lines have no clock on screen: stamp each one when it appears
  new MutationObserver(function (list) {
    list.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.dataset && !n.dataset.t) n.dataset.t = Date.now(); }); });
  }).observe(msgs, { childList: true });

  function download(filename, text) {
    var url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ------------------------------- save ------------------------------- */

  function collectChat() {
    var out = [], imgBytes = 0;
    Array.prototype.forEach.call(msgs.querySelectorAll(".msg"), function (el) {
      var sys = el.classList.contains("sys");
      var from = "", small = el.querySelector("small");
      if (small) from = el.classList.contains("mine") ? name : small.textContent;
      var text = Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3; })
        .map(function (n) { return n.textContent; }).join("").trim();
      var line = { t: +el.dataset.t || 0, from: from, text: text, sys: sys };
      var im = el.querySelector("img");
      if (im && IMG_OK.test(im.src) && im.src.length <= MAX_IMG && imgBytes + im.src.length <= MAX_IMG_TOTAL) {
        line.img = im.src; imgBytes += im.src.length;
      } else if (im || el.querySelector(".fileCard")) line.text = (line.text + " [attachment not saved]").trim();
      if (line.text || line.img) out.push(line);
    });
    return out;
  }

  saveBtn.addEventListener("click", function () {
    var notes = $("sharedNotes"), mediaUrl = $("mediaUrl");
    var data = {
      app: "peerly", version: 1, exportedAt: new Date().toISOString(), room: code, savedBy: name,
      chat: collectChat(),
      notes: notes ? notes.value : "",
      board: window.Whiteboard ? window.Whiteboard.getHistory() : [],
      media: mediaUrl && mediaUrl.value ? mediaUrl.value : null
    };
    download("peerly-room-" + code + "-" + data.exportedAt.slice(0, 10) + ".json", JSON.stringify(data));
  });

  /* ------------------------------- load ------------------------------- */

  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }

  function clean(data) {
    if (!data || typeof data !== "object" || data.app !== "peerly" || data.version !== 1) return null;
    var chat = (Array.isArray(data.chat) ? data.chat : []).slice(-MAX_CHAT).map(function (c) {
      if (!c || typeof c !== "object") return null;
      var line = { from: str(c.from, 20), text: str(c.text, 4000), sys: c.sys === true };
      if (typeof c.img === "string" && c.img.length <= MAX_IMG && IMG_OK.test(c.img)) line.img = c.img;
      return line.text || line.img ? line : null;
    }).filter(Boolean);
    var media = null;
    try { var u = new URL(data.media); if (/^https?:$/.test(u.protocol) && !u.username && !u.password) media = u.href.slice(0, 2000); } catch (e) { }
    return {
      when: str(data.exportedAt, 40), chat: chat,
      notes: str(data.notes, 100000),
      board: Array.isArray(data.board) ? data.board.slice(0, 1500) : [],
      media: media
    };
  }

  loadBtn.addEventListener("click", function () { file.value = ""; file.click(); });

  file.addEventListener("change", function () {
    var f = file.files && file.files[0];
    if (!f) return;
    if (f.size > MAX_FILE) { alert("That file is too big to be a room backup."); return; }
    f.text().then(function (text) {
      var d;
      try { d = clean(JSON.parse(text)); } catch (e) { d = null; }
      if (!d) { alert("This is not a valid Peerly backup file."); return; }
      importData(d);
    }, function () { alert("The file could not be read."); });
  });

  function importData(d) {
    var date = d.when ? new Date(d.when).toLocaleString() : "an earlier session";
    var hasShared = d.notes.trim() || d.board.length;
    var shareIt = hasShared && confirm(
      "Backup from " + date + ":\n" + d.chat.length + " chat lines, " + d.board.length + " drawing objects" +
      (d.notes.trim() ? ", notes" : "") + ".\n\n" +
      "OK = also REPLACE the shared notes and whiteboard for everyone in the room.\n" +
      "Cancel = only show the old chat on your own screen.");

    if (window.importChatLine) {
      if (d.chat.length) {
        window.importChatLine("", "— Imported history from " + date + " (only you can see this) —", true);
        d.chat.forEach(function (c) { window.importChatLine(c.from || "Unknown", c.text, c.sys, c.img); });
        window.importChatLine("", "— End of imported history —", true);
      }
    }
    if (shareIt) {
      var notes = $("sharedNotes");
      if (d.notes.trim() && notes) { notes.value = d.notes; if (window.notesSend) window.notesSend(d.notes); }
      if (d.board.length && window.Whiteboard) {
        window.Whiteboard.loadHistory(d.board);
        if (window.wbSend) { window.wbSend({ t: "clear" }); window.Whiteboard.snapshot().forEach(window.wbSend); }
      }
    }
    var mediaUrl = $("mediaUrl");
    if (d.media && mediaUrl) mediaUrl.value = d.media;       // ready to press "Load media" again
  }
})();
