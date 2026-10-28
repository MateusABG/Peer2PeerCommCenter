/* Synchronized direct-media player. Network authority/validation lives in network.js. */
(function () {
  "use strict";
  var form = document.getElementById("mediaLoadForm");
  var input = document.getElementById("mediaUrl");
  var player = document.getElementById("sharedMediaPlayer");
  var status = document.getElementById("mediaSyncStatus");
  if (!form || !input || !player || !status) return;
  // PiP is reserved for the livestream player. Keep this cinema-room player in-page.
  player.disablePictureInPicture = true;

  var applyingRemote = false;
  var lastActionAt = 0;
  var driftTimer = null;

  function validUrl(raw) {
    try {
      var url = new URL(raw);
      return ["http:", "https:"].indexOf(url.protocol) >= 0 && !url.username && !url.password && raw.length <= 2000;
    } catch (e) { return false; }
  }
  function send(action) {
    if (applyingRemote || !window.sendSyncedMediaState) return;
    var state = { action: action, time: Number.isFinite(player.currentTime) ? player.currentTime : 0 };
    if (action === "load") state.url = player.currentSrc || player.src;
    window.sendSyncedMediaState(state);
  }
  function statusText(text) { status.textContent = text; }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var url = input.value.trim();
    if (!validUrl(url)) { statusText("Enter a valid HTTP(S) media URL without credentials."); return; }
    applyingRemote = true;
    player.src = url;
    player.hidden = false;
    player.load();
    applyingRemote = false;
    statusText("Media loaded. Press play to synchronize playback.");
    send("load");
  });

  player.addEventListener("play", function () { send("play"); });
  player.addEventListener("pause", function () { if (!player.ended) send("pause"); });
  player.addEventListener("seeked", function () { send("seek"); });
  player.addEventListener("loadedmetadata", function () {
    if (player.hidden) return;
    statusText("Media ready. Playback controls synchronize across the room.");
  });
  player.addEventListener("error", function () {
    if (!player.hidden) statusText("This URL could not be played. Use a direct, browser-supported media file URL.");
  });

  window.applySyncedMedia = function (state, fromHost) {
    if (!state || typeof state !== "object") return;
    if (state.action === "clear") {
      applyingRemote = true;
      player.pause(); player.removeAttribute("src"); player.load(); player.hidden = true;
      applyingRemote = false; statusText("Shared media cleared."); return;
    }
    if (state.url && validUrl(state.url) && player.src !== state.url) {
      applyingRemote = true;
      player.src = state.url; input.value = state.url; player.hidden = false; player.load();
      applyingRemote = false;
      if (state.action !== "load") {
        player.addEventListener("loadedmetadata", function onMetadata() {
          player.removeEventListener("loadedmetadata", onMetadata);
          window.applySyncedMedia(Object.assign({}, state, { url: undefined }), fromHost);
        });
      }
      return;
    }
    applyingRemote = true;
    try {
      if (state.action === "load") {
        statusText("Synchronized media loaded. Press play to start playback.");
      } else if (["play", "pause", "seek"].indexOf(state.action) >= 0 && !player.hidden && Number.isFinite(state.time) && state.time >= 0) {
        var target = state.time;
        if (state.action === "play" && Number.isFinite(state.at)) target += Math.min(2, Math.max(0, (Date.now() - state.at) / 1000));
        if (Number.isFinite(player.duration) && player.duration > 0) target = Math.min(target, player.duration);
        if (Math.abs(player.currentTime - target) > 0.8) { try { player.currentTime = target; } catch (e) {} }
        if (state.action === "play") player.play().catch(function () { statusText("Playback is synchronized, but your browser needs you to press play."); });
        if (state.action === "pause") player.pause();
      }
    } finally { applyingRemote = false; }
  };

  // Small periodic drift correction while playing; never fights the user's seeking gesture.
  window.addEventListener("pagehide", function () { if (driftTimer) clearInterval(driftTimer); });

})();
