(function () {
  const layer = $("laserLayer");
  const dot = $("laserDot");
  const btn = $("laserBtn");

  let laserOn = false;
  let spot = null;        // where the dot is, as { x, y } fractions (0..1) of the picture
  const remoteDots = new Map();
  /* ---------------------------- the maths ---------------------------- */

  function pictureRect() {
    const boxW = layer.clientWidth, boxH = layer.clientHeight;
    const vidW = mainVideo.videoWidth, vidH = mainVideo.videoHeight;   // 0 until the video has loaded
    if (!boxW || !boxH || !vidW || !vidH) return null;

    const k = Math.min(boxW / vidW, boxH / vidH);   // "contain": the tighter side decides the scale
    const w = vidW * k, h = vidH * k;
    return { left: (boxW - w) / 2, top: (boxH - h) / 2, w: w, h: h };
  }

  // pixels on the screen  ->  fractions of the picture (null if over the black bars)
  function toNorm(e) {
    const pic = pictureRect();
    if (!pic) return null;
    const box = layer.getBoundingClientRect();
    const x = (e.clientX - box.left - pic.left) / pic.w;
    const y = (e.clientY - box.top - pic.top) / pic.h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x: x, y: y };
  }

  // fractions of the picture  ->  pixels inside the layer (the exact opposite of toNorm)
  function fromNorm(x, y) {
    const pic = pictureRect();
    if (!pic) return null;
    return { px: pic.left + x * pic.w, py: pic.top + y * pic.h };
  }

  /* --------------------------- showing the dot -------------------------- */

   function placeRemoteDots() {
    for (const participant of remoteDots.values()) {
      const p = participant.spot
        ? fromNorm(participant.spot.x, participant.spot.y)
        : null;

      participant.dot.hidden = !p;

      if (p) {
        participant.dot.style.left = p.px + "px";
        participant.dot.style.top = p.py + "px";
      }
    }
  }

  window.laserReceive = function (id, remoteSpot) {
    // Ignore invalid messages.
    if (typeof id !== "string" || !remoteSpot) return;

    if (
      !Number.isFinite(remoteSpot.x) ||
      !Number.isFinite(remoteSpot.y) ||
      remoteSpot.x < 0 || remoteSpot.x > 1 ||
      remoteSpot.y < 0 || remoteSpot.y > 1
    ) {
      return;
    }

    let participant = remoteDots.get(id);

    // Create one dot the first time we hear from this participant.
    if (!participant) {
      const remoteDot = document.createElement("div");
      remoteDot.className = "laserDot";
      remoteDot.hidden = true;
      layer.appendChild(remoteDot);

      participant = {
        dot: remoteDot,
        spot: null
      };

      remoteDots.set(id, participant);
    }

    participant.spot = {
      x: remoteSpot.x,
      y: remoteSpot.y
    };

    placeRemoteDots();
  };

  function place() {                      // put the dot where "spot" says, for the current window size
    const p = spot && fromNorm(spot.x, spot.y);
    dot.hidden = !p;
    if (!p) return;
    dot.style.left = p.px + "px";
    dot.style.top = p.py + "px";
  }

  layer.addEventListener("pointermove", function (e) {
    if (!laserOn) return;

    spot = toNorm(e);
    place();
 
    if (spot && window.laserSend) {
      window.laserSend(spot);
    }
  });

  layer.addEventListener("pointerleave", function () {
    spot = null;
    place();
  });

  
  function placeAllDots() {
    place();
    placeRemoteDots();
  }

  new ResizeObserver(placeAllDots).observe(layer);
  mainVideo.addEventListener("loadedmetadata", placeAllDots);
  mainVideo.addEventListener("resize", placeAllDots);
  /* ------------------------------- the toggle ------------------------------ */

  btn.addEventListener("click", function () {
    laserOn = !laserOn;
    layer.classList.toggle("on", laserOn);
    btn.setAttribute("aria-pressed", laserOn);
    btn.textContent = "Laser pointer: " + (laserOn ? "on" : "off");
    if (!laserOn) { spot = null; place(); }
  });
})();
