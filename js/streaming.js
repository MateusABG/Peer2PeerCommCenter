const grid = $("streamGrid");
const strEmpty = $("strEmpty");
const startBtn = $("startStream");
var isStreaming = false;

const MAX_TILES = 6;                 // screens shown at once (every tile is a live video decode)
const OWN = ["local", "lcam"];       // my own streams: never play their sound back to me
const streams = new Map();           // id -> MediaStream   everything that is available
let focusId = null;                  // tile shown big (null = even grid)
const tiles = new Map();             // id -> { el, video, lbl, mute, close }   what is on screen

// Who owns a stream? ("local" = me, "s:<peerId>" = someone's screen, "c:<peerId>" = someone's camera)
function labelFor(id) {
    if (id === "local") return "You";
    if (id === "lcam") return "You (camera)";
    const n = (window.nameOfStream && window.nameOfStream(id)) || "Someone";
    const s = streams.get(id);
    return n + (id.startsWith("c:") ? " (camera)" : "") + (s && s.getAudioTracks().length ? " 🔊" : "");
}
if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) startBtn.hidden = true;

/* ------------------------------ the grid ------------------------------ */

// Re-draws everything that depends on "what is available / what is shown".
// network.js also calls it (as refreshStreamLabels) when names arrive.
function applyLayout() {
    if (focusId && !tiles.has(focusId)) focusId = null;           // the focused screen went away: back to the grid
    const n = tiles.size;
    grid.dataset.count = Math.min(n, 6);
    grid.classList.toggle("focus", !!focusId && n > 1);
    grid.style.setProperty("--others", Math.max(1, n - 1));
    tiles.forEach((t, id) => {
        const big = !!focusId && id === focusId && n > 1;
        t.el.classList.toggle("isFocus", big);
        t.focus.textContent = big ? "▦" : "⛶";
        t.focus.title = big ? "Back to the grid" : "Enlarge";
        t.focus.setAttribute("aria-label", (big ? "Back to the grid: " : "Enlarge ") + labelFor(id));
        t.focus.hidden = n < 2 && !big;                           // nothing to switch with a single screen
        // in focus mode the focused tile goes first, the rest keep their order below it
        t.el.style.order = big ? "-1" : "0";
    });
}

function toggleFocus(id) {
    focusId = (focusId === id) ? null : id;
    applyLayout();
}

function syncGrid() {
    applyLayout();
    strEmpty.hidden = tiles.size > 0;
    strEmpty.textContent = streams.size === 0
        ? "Nobody is streaming yet"
        : "No screens on display.";
    tiles.forEach((_, id) => syncTile(id));

}
window.refreshStreamLabels = syncGrid;

// Updates one tile's label and buttons
function syncTile(id) {
    const t = tiles.get(id);
    if (!t) return;
    const s = streams.get(id);
    const label = labelFor(id);
    const hasAudio = !!s && s.getAudioTracks().length > 0 && OWN.indexOf(id) < 0;
    const silent = t.video.muted || t.video.volume === 0;
    const inPip = document.pictureInPictureElement === t.video;
    const inFs = fsElement() === t.el;

    t.lbl.textContent = label;
    t.audio.hidden = !hasAudio;
    t.mute.textContent = silent ? "🔇" : "🔊";
    t.mute.setAttribute("aria-label", (silent ? "Unmute " : "Mute ") + label);
    t.pip.textContent = "⧉";
    t.pip.title = inPip ? "Exit picture-in-picture" : "Picture-in-picture";
    t.pip.setAttribute("aria-label", (inPip ? "Exit picture-in-picture for " : "Picture-in-picture for ") + label);
    t.pip.setAttribute("aria-pressed", inPip);
    t.full.textContent = inFs ? "⤡" : "⤢";
    t.full.title = inFs ? "Exit full screen" : "Full screen";
    t.full.setAttribute("aria-label", (inFs ? "Exit full screen for " : "Full screen for ") + label);
    t.close.title = "Remove from the grid";
    t.close.setAttribute("aria-label", "Remove " + label + " from the grid");
}

function tileButton(text) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tileBtn";
    b.textContent = text;
    return b;
}

function note(text) { $("streamNote").textContent = text; }
function playQuietly(video) { const p = video.play(); if (p && p.catch) p.catch(() => { }); }

function createTile(id) {
    const el = document.createElement("figure");
    el.className = "tile";
    el.dataset.id = id;
    el.addEventListener("click", (event) => {
        if (event.target.closest("button, .audioCtl")) return;
        toggleFocus(id);
    });

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = OWN.indexOf(id) >= 0;
    video.classList.toggle("mirror", id === "lcam");
    video.srcObject = streams.get(id);
    video.addEventListener("enterpictureinpicture", () => syncTile(id));
    video.addEventListener("leavepictureinpicture", () => syncTile(id));

    const lbl = document.createElement("span");
    lbl.className = "lbl";

    // top-right: picture-in-picture, full screen, remove
    const bar = document.createElement("div");
    bar.className = "tileBar";
    const pip = tileButton("⧉");
    pip.hidden = !(document.pictureInPictureEnabled && video.requestPictureInPicture);
    pip.addEventListener("click", () => togglePip(id));
    const full = tileButton("⤢");
    full.hidden = !(el.requestFullscreen || el.webkitRequestFullscreen || video.webkitEnterFullscreen);
    full.addEventListener("click", () => toggleFullscreen(id));
    const focus = tileButton("⛶");
    focus.addEventListener("click", () => toggleFocus(id));
    const close = tileButton("✕");
    close.addEventListener("click", () => hideTile(id));
    bar.append(focus, pip, full, close);

    // bottom-right: speaker + volume (only shown for streams that carry sound)
    const audio = document.createElement("div");
    audio.className = "audioCtl";
    audio.hidden = true;
    const mute = document.createElement("button");
    mute.type = "button";
    const vol = document.createElement("input");
    vol.type = "range";
    vol.min = 0; vol.max = 100; vol.value = 100;
    mute.addEventListener("click", () => {
        // act on what the icon shows: silent (muted OR volume 0) -> make it audible, otherwise mute
        if (video.muted || video.volume === 0) {
            video.muted = false;
            if (video.volume === 0) { video.volume = 0.5; vol.value = 50; }
        } else {
            video.muted = true;
        }
        playQuietly(video);
        syncTile(id);
        note("");
    });
    vol.addEventListener("input", () => {
        video.volume = vol.value / 100;
        if (video.volume > 0) video.muted = false;
        playQuietly(video);
        syncTile(id);
        note("");
    });
    audio.append(mute, vol);

    el.append(video, lbl, bar, audio);
    // a click on the window enlarges it; clicking it again goes back to the previous layout
    el.addEventListener("click", e => {
        if (e.target.closest("button, input, .laserLayer.on")) return;   // (not while the laser pointer is aiming)
        toggleFocus(id);
    });
    el.addEventListener("dblclick", e => { if (!e.target.closest("button, input")) toggleFullscreen(id); });
    grid.appendChild(el);
    tiles.set(id, { el, video, lbl, pip, full, focus, close, audio, mute, vol });
    if (window.laserAttach) window.laserAttach(id, el, video);

    // Until the person has interacted with the page, browsers may refuse to play sound.
    const p = video.play();
    if (p && p.catch) p.catch(() => {
        if (!video.muted) {
            video.muted = true;
            syncTile(id);
            note("The browser blocked sound. Click the speaker button on a screen to listen.");
        }
        playQuietly(video);          // muted playback is always allowed: restart it, or the tile stays black
    });

    // Remote pictures can arrive while the Livestream tab is hidden, or before the first frame:
    // keep nudging the video until it is really playing.
    video.addEventListener("loadedmetadata", () => playQuietly(video));
    video.addEventListener("pause", () => { if (tiles.has(id) && !video.ended) setTimeout(() => playQuietly(video), 250); });
}

// Wake every video up (called when the Livestream tab is opened or the user clicks anywhere)
function resumeAll() { tiles.forEach(t => { if (t.video.paused) playQuietly(t.video); }); }
document.addEventListener("click", resumeAll);
document.addEventListener("visibilitychange", resumeAll);
const streamView = $("v-stream");
if (window.MutationObserver) new MutationObserver(resumeAll).observe(streamView, { attributes: true, attributeFilter: ["hidden"] });

function showTile(id) {
    if (!streams.has(id) || tiles.has(id)) return;
    if (tiles.size >= MAX_TILES) {
        note("Up to " + MAX_TILES + " screens can be shown at once. Remove one to add another.");
        return;
    }
    createTile(id);
    syncGrid();
}

// Closing a tile only hides it on THIS device. The stream itself keeps going and
// stays in the Add screen menu.
function hideTile(id) {
    const t = tiles.get(id);
    if (!t) return;
    if (document.pictureInPictureElement === t.video) document.exitPictureInPicture().catch(() => { });
    if (window.laserDetach) window.laserDetach(id);
    t.video.srcObject = null;      // lets the browser release the decoder
    t.el.remove();                 // (also leaves full screen if this tile was in it)
    tiles.delete(id);
    if (focusId === id) focusId = null;
    syncGrid();
}

/* ------------------------ full screen and PiP ------------------------ */

const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

// The whole tile goes full screen (not just the <video>), so its name, volume and laser pointer come along.
async function toggleFullscreen(id) {
    const t = tiles.get(id);
    if (!t) return;
    try {
        if (fsElement() === t.el) {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } else if (t.el.requestFullscreen) await t.el.requestFullscreen();
        else if (t.el.webkitRequestFullscreen) t.el.webkitRequestFullscreen();
        else if (t.video.webkitEnterFullscreen) t.video.webkitEnterFullscreen();   // iPhone: only the bare video can
    } catch (err) {
        note("Full screen could not start.");
    }
}
function refreshAllTiles() { tiles.forEach((_, id) => syncTile(id)); }
document.addEventListener("fullscreenchange", refreshAllTiles);
document.addEventListener("webkitfullscreenchange", refreshAllTiles);

// The browser allows ONE picture-in-picture window: starting another tile's PiP replaces the first.
async function togglePip(id) {
    const t = tiles.get(id);
    if (!t) return;
    try {
        if (document.pictureInPictureElement === t.video) {
            await document.exitPictureInPicture();
        } else if (t.video.readyState === 0) {
            note("This stream has no picture yet. Try again in a moment.");
        } else {
            await t.video.requestPictureInPicture();
            note("");
        }
    } catch (err) {
        note("Picture-in-picture could not start for this stream.");
    }
}

/* ------------------- called by network.js and below ------------------- */

function addStream(id, stream) {
    if (streams.has(id)) return;
    streams.set(id, stream);
    stream.addEventListener("addtrack", syncGrid);   // audio can arrive after the video
    showTile(id);                                    // new streams appear on their own (until the grid is full)
    syncGrid();
}

function removeStream(id) {
    if (!streams.has(id)) return;
    streams.delete(id);
    hideTile(id);
    syncGrid();
}

let localStream = null;

async function startStreaming() {
    if (isStreaming) return;
    const wantAudio = $("optAudio").checked;

    const opts = { video: true, selfBrowserSurface: "exclude" };   // don't offer this app's own tab
    if (wantAudio) {
        opts.audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        opts.systemAudio = $("optSystem").checked ? "include" : "exclude";
    } else {
        opts.audio = false;
    }

    try {
        let stream;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia(opts);
        } catch (err) {
            if (err.name !== "TypeError" && err.name !== "OverconstrainedError") throw err;
            stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: wantAudio });
        }

        localStream = stream;
        const hasAudio = stream.getAudioTracks().length > 0;
        addStream("local", stream);

        if (window.onLocalStreamStart) window.onLocalStreamStart(stream);

        stream.getVideoTracks()[0].addEventListener("ended", stopStreaming);
        $("streamNote").textContent = !wantAudio ? "" :
            hasAudio ? "Sharing with audio" : "No audio was shared. In the picker, choose a browser tab and tick its audio box. Firefox and Safari can't share audio.";
        startBtn.textContent = "Stop Streaming";
        isStreaming = true;
    } catch (error) {
        console.log("Could not share screen:", error);
    }
}

function stopStreaming() {
    if (!isStreaming) return;
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop()); // releases the capture
        localStream = null;
    }
    removeStream("local");
    // network.js closes the calls and tells everyone the stream stopped
    if (window.onLocalStreamStop) window.onLocalStreamStop();
    $("streamNote").textContent = "";
    isStreaming = false;
    startBtn.textContent = "Start Streaming";
}

startBtn.addEventListener("click", () => {
    if (isStreaming) stopStreaming();
    else startStreaming();
});

syncGrid();

const camBtn = $("startCamera");
let cameraStream = null;
let isCamera = false;

async function startCamera() {
    if (isCamera) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Camera access needs HTTPS (or localhost) and a supported browser.");
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } },
            audio: false                       // voice is the Mic button's job
        });
        cameraStream = stream;
        isCamera = true;
        addStream("lcam", stream);             // "lcam" = my own camera
        if (window.onLocalCameraStart) window.onLocalCameraStart(stream);

        // fires if the camera is unplugged or the permission is revoked
        stream.getVideoTracks()[0].addEventListener("ended", stopCamera);
        camBtn.textContent = "Stop Camera";
    } catch (err) {
        alert(err.name === "NotAllowedError" ? "Camera permission was denied."
            : err.name === "NotFoundError" ? "No camera was found on this device."
                : "Could not start the camera.");
    }
}

function stopCamera() {
    if (!isCamera) return;
    cameraStream.getTracks().forEach(t => t.stop());   // turns the camera light off
    cameraStream = null;
    isCamera = false;
    removeStream("lcam");
    if (window.onLocalCameraStop) window.onLocalCameraStop();
    camBtn.textContent = "Start Camera";
}

camBtn.addEventListener("click", () => isCamera ? stopCamera() : startCamera());
