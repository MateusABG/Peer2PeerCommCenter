const grid = $("streamGrid");
const strEmpty = $("strEmpty");
const addBtn = $("addScreenBtn");
const addMenu = $("addScreenMenu");
const startBtn = $("startStream");
var isStreaming = false;

const MAX_TILES = 6;                 // screens shown at once (every tile is a live video decode)
const OWN = ["local", "lcam"];       // my own streams: never play their sound back to me
const streams = new Map();           // id -> MediaStream   everything that is available
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
function syncGrid() {
    strEmpty.hidden = tiles.size > 0;
    strEmpty.textContent = streams.size === 0
        ? "Nobody is streaming yet"
        : "No screens on display. Use Add screen to show one.";
    tiles.forEach((_, id) => syncTile(id));

    // the "Add screen" menu lists every available stream that has no tile
    const hidden = [...streams.keys()].filter(id => !tiles.has(id));
    addMenu.textContent = "";
    hidden.forEach(id => {
        const li = document.createElement("li");
        li.setAttribute("role", "none");
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "menuitem");
        b.textContent = labelFor(id);
        b.addEventListener("click", () => { closeMenu(); showTile(id); });
        li.appendChild(b);
        addMenu.appendChild(li);
    });
    addBtn.disabled = hidden.length === 0;
    if (hidden.length === 0) closeMenu();
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
    const close = tileButton("✕");
    close.addEventListener("click", () => hideTile(id));
    bar.append(pip, full, close);

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
    el.addEventListener("dblclick", e => { if (!e.target.closest("button, input")) toggleFullscreen(id); });
    grid.appendChild(el);
    tiles.set(id, { el, video, lbl, pip, full, close, audio, mute, vol });
    if (window.laserAttach) window.laserAttach(id, el, video);

    // Until the person has interacted with the page, browsers may refuse to play sound.
    const p = video.play();
    if (p && p.catch) p.catch(() => {
        if (!video.muted) {
            video.muted = true;
            syncTile(id);
            note("The browser blocked sound. Click the speaker button on a screen to listen.");
        }
    });
}

function showTile(id) {
    if (!streams.has(id) || tiles.has(id)) return;
    if (tiles.size >= MAX_TILES) {
        note("Up to " + MAX_TILES + " screens can be shown at once. Remove one, then use Add screen.");
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

/* ---------------------------- the Add menu ---------------------------- */

function openMenu() { addMenu.hidden = false; addBtn.setAttribute("aria-expanded", "true"); }
function closeMenu() { addMenu.hidden = true; addBtn.setAttribute("aria-expanded", "false"); }
addBtn.addEventListener("click", () => { addMenu.hidden ? openMenu() : closeMenu(); });
document.addEventListener("click", e => { if (!e.target.closest(".addScreen")) closeMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });

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
