/* Cinema room: one shared player for the whole room.
 * Direct video files and YouTube links play in sync (play, pause, seeking). Twitch is shared but not time-synced.
 * Network authority/validation lives in network.js; this file only sends { action, time, url } and applies what arrives. */
(function () {
  "use strict";

  var form = document.getElementById("mediaLoadForm");
  var input = document.getElementById("mediaUrl");
  var player = document.getElementById("sharedMediaPlayer");
  var status = document.getElementById("mediaSyncStatus");
  var embed = document.getElementById("sharedMediaEmbed");
  var clearBtn = document.getElementById("mediaClear");
  if (!form || !input || !player || !status || !embed) return;

  player.disablePictureInPicture = true;

  var cur = null;            // what is loaded now: { kind: "direct" | "youtube" | "twitch", url, id }
  var yt = null;             // the YouTube player object
  var quietUntil = 0;        // while a remote command is being applied, ignore the events it causes
  var ytTimer = 0, ytLast = 0;
  var loadToken = 0;         // a newer load cancels an older one that is still starting

  function say(text) { status.textContent = text; }
  function quiet(ms) { quietUntil = Date.now() + (ms || 900); }
  function isQuiet() { return Date.now() < quietUntil; }

  function validUrl(raw) {
    try {
      var u = new URL(raw);
      return ["http:", "https:"].indexOf(u.protocol) >= 0 && !u.username && !u.password && raw.length <= 2000;
    } catch (e) { return false; }
  }

  function detect(raw) {
    try {
      var url = new URL(raw);
      var host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (["youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com"].indexOf(host) >= 0) {
        var id = host === "youtu.be" ? url.pathname.slice(1).split("/")[0] : (url.searchParams.get("v") || "");
        if (!id && /^\/(embed|shorts|live)\//.test(url.pathname)) id = url.pathname.split("/")[2] || "";
        if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return { kind: "youtube", id: id, url: url.href };
      }
      if (host === "twitch.tv" || host === "m.twitch.tv") {
        var p = url.pathname.split("/").filter(Boolean);
        if (p[0] === "videos" && /^\d+$/.test(p[1] || "")) return { kind: "twitch", video: p[1], url: url.href };
        if (p[0] && /^[a-zA-Z0-9_]{1,25}$/.test(p[0])) return { kind: "twitch", channel: p[0], url: url.href };
      }
      return { kind: "direct", url: url.href };
    } catch (e) { return null; }
  }

  /* ------------------------------ sending ------------------------------ */

  function send(action) {
    if (!window.sendSyncedMediaState || !cur || isQuiet()) return;
    var s = { action: action, time: getTime() };
    if (action === "load") s.url = cur.url;
    window.sendSyncedMediaState(s);
  }

  /* --------------------- one set of controls, two players --------------------- */

  function getTime() {
    if (cur && cur.kind === "youtube") return yt && yt.getCurrentTime ? yt.getCurrentTime() || 0 : 0;
    return Number.isFinite(player.currentTime) ? player.currentTime : 0;
  }
  function seekTo(t) {
    if (cur && cur.kind === "youtube") { if (yt && yt.seekTo) yt.seekTo(t, true); }
    else { try { player.currentTime = t; } catch (e) { } }
  }
  function doPlay() {
    if (cur && cur.kind === "youtube") { if (yt && yt.playVideo) yt.playVideo(); return; }
    var p = player.play();
    if (p && p.catch) p.catch(function () { say("Playback is synchronized, but your browser needs you to press play."); });
  }
  function doPause() {
    if (cur && cur.kind === "youtube") { if (yt && yt.pauseVideo) yt.pauseVideo(); } else player.pause();
  }

  /* ------------------------------ loading ------------------------------ */

  function clearPlayers() {
    clearInterval(ytTimer);
    if (yt && yt.destroy) { try { yt.destroy(); } catch (e) { } }
    yt = null;
    embed.replaceChildren();
    embed.hidden = true;
    player.pause();
    player.removeAttribute("src");
    player.load();
    player.hidden = true;
    cur = null;
  }

  var ytApi = null;
  function loadYtApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(true);
    if (ytApi) return ytApi;
    ytApi = new Promise(function (resolve) {
      var previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (previous) previous(); resolve(true); };
      var s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = function () { ytApi = null; resolve(false); };
      document.head.appendChild(s);
    });
    return ytApi;
  }

  // Shows the media on this screen. Resolves when it is ready to receive play / pause / seek.
  function show(media) {
    var token = ++loadToken;
    clearPlayers();
    cur = media;
    input.value = media.url;
    quiet(1500);

    if (media.kind === "youtube") {
      say("Loading YouTube video…");
      return loadYtApi().then(function (ok) {
        if (token !== loadToken) return false;
        if (!ok) { say("YouTube could not be loaded. Check your connection or ad blocker."); return false; }
        return new Promise(function (resolve) {
          var holder = document.createElement("div");
          embed.replaceChildren(holder);
          embed.hidden = false;
          yt = new YT.Player(holder, {
            videoId: media.id,
            playerVars: { playsinline: 1, rel: 0, origin: location.origin },
            events: {
              onReady: function () { ytLast = 0; startYtWatch(); say("YouTube ready. Play, pause and seeking are shared with the room."); resolve(true); },
              onStateChange: function (e) {
                if (isQuiet()) return;
                if (e.data === 1) send("play");        // playing
                else if (e.data === 2) send("pause");  // paused
              },
              onError: function () { say("YouTube refused to play this video (it may block embedding)."); resolve(false); }
            }
          });
        });
      });
    }

    if (media.kind === "twitch") {
      var f = document.createElement("iframe");
      var q = media.video ? "video=" + encodeURIComponent(media.video) : "channel=" + encodeURIComponent(media.channel);
      f.src = "https://player.twitch.tv/?" + q + "&parent=" + encodeURIComponent(location.hostname || "localhost") + "&autoplay=false";
      f.title = "Shared Twitch stream";
      f.allow = "autoplay; fullscreen";
      f.allowFullscreen = true;
      embed.replaceChildren(f);
      embed.hidden = false;
      say("Twitch is shared with everyone, but its playback is not time-synced.");
      return Promise.resolve(true);
    }

    // direct file
    player.src = media.url;
    player.hidden = false;
    player.load();
    say("Media loaded. Press play to synchronize playback.");
    return Promise.resolve(true);
  }

  // YouTube has no "seeked" event, so watch for the clock jumping
  function startYtWatch() {
    clearInterval(ytTimer);
    ytTimer = setInterval(function () {
      if (!yt || !yt.getCurrentTime) return;
      var t = yt.getCurrentTime(), playing = yt.getPlayerState && yt.getPlayerState() === 1;
      if (!isQuiet() && Math.abs(t - (ytLast + (playing ? 0.5 : 0))) > 1.5) send("seek");
      ytLast = t;
    }, 500);
  }

  /* --------------------------- the load button --------------------------- */

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var raw = input.value.trim();
    if (!validUrl(raw)) { say("Enter a valid HTTP(S) media URL without credentials."); return; }
    var media = detect(raw);
    if (!media) { say("That media link could not be recognized."); return; }
    show(media).then(function (ok) {
      if (!ok) return;
      quietUntil = 0;
      send("load");          // everyone in the room now loads the same link
    });
  });

  if (clearBtn) clearBtn.addEventListener("click", function () {
    clearPlayers();
    say("Shared media cleared.");
    if (window.sendSyncedMediaState) window.sendSyncedMediaState({ action: "clear" });
  });

  player.addEventListener("play", function () { send("play"); });
  player.addEventListener("pause", function () { if (!player.ended) send("pause"); });
  player.addEventListener("seeked", function () { send("seek"); });
  player.addEventListener("loadedmetadata", function () { if (!player.hidden) say("Media ready. Playback controls synchronize across the room."); });
  player.addEventListener("error", function () {
    if (!player.hidden) say("This URL could not be played. Use a direct, browser-supported media file URL.");
  });

  /* ----------------------- what arrives from the room ----------------------- */

  window.applySyncedMedia = function (state) {
    if (!state || typeof state !== "object") return;

    if (state.action === "clear") {
      if (cur) { clearPlayers(); say("Shared media cleared."); }
      return;
    }

    // a different link than mine: load it first, then apply the rest of this message
    if (state.url && validUrl(state.url) && (!cur || cur.url !== new URL(state.url).href)) {
      var media = detect(state.url);
      if (!media) return;
      var rest = Object.assign({}, state, { url: undefined });
      show(media).then(function (ok) {
        if (ok && state.action !== "load") window.applySyncedMedia(rest);
        else if (ok) say("Shared media loaded by someone in the room.");
      });
      return;
    }

    if (!cur || cur.kind === "twitch") return;
    if (["play", "pause", "seek"].indexOf(state.action) < 0 || !Number.isFinite(state.time) || state.time < 0) return;

    var target = state.time;
    if (state.action === "play" && Number.isFinite(state.at)) target += Math.min(2, Math.max(0, (Date.now() - state.at) / 1000));
    if (cur.kind === "direct" && Number.isFinite(player.duration) && player.duration > 0) target = Math.min(target, player.duration);

    quiet(2500);                                             // the events this causes are not new commands
    if (Math.abs(getTime() - target) > 0.8) seekTo(target);
    if (state.action === "play") doPlay();
    else if (state.action === "pause") doPause();
  };

  window.addEventListener("pagehide", function () { clearInterval(ytTimer); });
})();
