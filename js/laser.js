// Laser pointer, one layer per stream tile.
// streaming.js calls laserAttach() when a tile appears and laserDetach() when it goes away.
(function () {
  const btn = $("laserBtn");

  let laserOn = false;
  const views = new Map();   // stream id -> { layer, video, dot, spot, remote: Map(peerId -> { dot, spot }), ro }

  /* ---------------------------- the maths ---------------------------- */
  // Positions travel as fractions (0..1) of the PICTURE, so they stay correct on every screen size.

  function pictureRect(v) {
    const boxW = v.layer.clientWidth, boxH = v.layer.clientHeight;
    const vidW = v.video.videoWidth, vidH = v.video.videoHeight;   // 0 until the video has loaded
    if (!boxW || !boxH || !vidW || !vidH) return null;

    const k = Math.min(boxW / vidW, boxH / vidH);   // "contain": the tighter side decides the scale
    const w = vidW * k, h = vidH * k;
    return { left: (boxW - w) / 2, top: (boxH - h) / 2, w: w, h: h };
  }

  // my own camera preview is shown mirrored, but everyone else sees the real picture
  function flipped(v) { return v.video.classList.contains("mirror"); }

  // pixels on the screen -> fractions of the picture (null if over the black bars)
  function toNorm(v, e) {
    const pic = pictureRect(v);
    if (!pic) return null;
    const box = v.layer.getBoundingClientRect();
    let x = (e.clientX - box.left - pic.left) / pic.w;
    const y = (e.clientY - box.top - pic.top) / pic.h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    if (flipped(v)) x = 1 - x;
    return { x: x, y: y };
  }

  // fractions of the picture -> pixels inside the layer (the exact opposite of toNorm)
  function fromNorm(v, x, y) {
    const pic = pictureRect(v);
    if (!pic) return null;
    if (flipped(v)) x = 1 - x;
    return { px: pic.left + x * pic.w, py: pic.top + y * pic.h };
  }

  /* --------------------------- showing dots --------------------------- */

  function placeDot(v, dot, spot) {
    const p = spot && fromNorm(v, spot.x, spot.y);
    dot.hidden = !p;
    if (!p) return;
    dot.style.left = p.px + "px";
    dot.style.top = p.py + "px";
  }

  function placeAll(v) {
    placeDot(v, v.dot, v.spot);
    v.remote.forEach(function (r) { placeDot(v, r.dot, r.spot); });
  }

  /* ------------------------- tiles come and go ------------------------- */

  window.laserAttach = function (streamId, tileEl, video) {
    if (views.has(streamId)) return;

    const layer = document.createElement("div");
    layer.className = "laserLayer" + (laserOn ? " on" : "");
    const dot = document.createElement("div");
    dot.className = "laserDot";
    dot.style.setProperty("--c", userColor(name));   // my pointer wears my colour
    dot.hidden = true;
    layer.appendChild(dot);
    tileEl.appendChild(layer);

    const v = { layer: layer, video: video, dot: dot, spot: null, remote: new Map(), ro: null };
    views.set(streamId, v);

    layer.addEventListener("pointermove", function (e) {
      if (!laserOn) return;
      v.spot = toNorm(v, e);
      placeDot(v, v.dot, v.spot);
      if (v.spot && window.laserSend) window.laserSend(v.spot, streamId);
    });
    layer.addEventListener("pointerleave", function () {
      v.spot = null;
      placeDot(v, v.dot, null);
    });

    v.ro = new ResizeObserver(function () { placeAll(v); });
    v.ro.observe(layer);
    video.addEventListener("loadedmetadata", function () { placeAll(v); });
    video.addEventListener("resize", function () { placeAll(v); });
  };

  // the stream window may have moved (floating PiP window) or changed size: put every dot back
  window.laserRefresh = function () { views.forEach(placeAll); };

  window.laserDetach = function (streamId) {
    const v = views.get(streamId);
    if (!v) return;
    v.ro.disconnect();
    v.layer.remove();
    views.delete(streamId);
  };

  /* ------------------------ pointers from others ------------------------ */
  // id = who is pointing, streamId = which stream (already translated to this screen's names)

  const DOT_LINGER = 3000;               // ms a remote dot stays after its owner stops moving

  window.laserReceive = function (id, remoteSpot, streamId) {
    if (typeof id !== "string" || !remoteSpot) return;
    if (
      !Number.isFinite(remoteSpot.x) || !Number.isFinite(remoteSpot.y) ||
      remoteSpot.x < 0 || remoteSpot.x > 1 || remoteSpot.y < 0 || remoteSpot.y > 1
    ) return;

    // a person points at one stream at a time: clear their dot everywhere else
    views.forEach(function (other, sid) {
      if (sid === streamId) return;
      const stale = other.remote.get(id);
      if (stale) { stale.spot = null; stale.dot.hidden = true; }
    });

    const v = views.get(streamId);
    if (!v) return;                      // that stream is not on this screen

    let r = v.remote.get(id);
    if (!r) {
      const d = document.createElement("div");
      d.className = "laserDot";
      const who = (window.nameOfPeer && window.nameOfPeer(id)) || "";
      d.style.setProperty("--c", userColor(who || id));   // their pointer wears their colour
      if (who) d.dataset.name = who;
      d.hidden = true;
      v.layer.appendChild(d);
      r = { dot: d, spot: null, timer: 0 };
      v.remote.set(id, r);
    }
    r.spot = { x: remoteSpot.x, y: remoteSpot.y };
    placeDot(v, r.dot, r.spot);
    clearTimeout(r.timer);
    r.timer = setTimeout(function () { r.spot = null; r.dot.hidden = true; }, DOT_LINGER);
  };

  /* ------------------------------- the toggle ------------------------------ */

  btn.addEventListener("click", function () {
    laserOn = !laserOn;
    views.forEach(function (v) {
      v.layer.classList.toggle("on", laserOn);
      if (!laserOn) { v.spot = null; placeDot(v, v.dot, null); }
    });
    btn.setAttribute("aria-pressed", laserOn);
    btn.textContent = "Laser pointer: " + (laserOn ? "on" : "off");
  });
})();
