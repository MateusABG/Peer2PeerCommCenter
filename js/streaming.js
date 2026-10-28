const streamWindow = $("streamWindow");
const thumbs = $("thumbs");
const startBtn = $("startStream");
const mainLabel = $("mainLabel");
const strEmpty = $("strEmpty");
var isStreaming = false;

const mainVideo = document.createElement("video");
mainVideo.id = "livestreamMainVideo";
mainVideo.autoplay = true;
mainVideo.muted = true;
mainVideo.playsInline = true;
streamWindow.insertBefore(mainVideo, streamWindow.firstChild);
mainVideo.hidden = true;

const streams = new Map(); // id -> MediaStream
let mainId = null;
let streamMuted = false;
let streamVol = 1;
const OWN = ["local", "lcam"];

function applyAudio() {
    const s = mainId === null ? null : streams.get(mainId);
    const hasAudio = !!s && s.getAudioTracks().length > 0 && OWN.indexOf(mainId) < 0;
    mainVideo.muted = !hasAudio || streamMuted;
    mainVideo.volume = streamVol;
    $("audioCtl").hidden = !hasAudio;
    $("strMute").textContent = (streamMuted || streamVol === 0) ? "🔇" : "🔊";
}

function playMain() {
    const p = mainVideo.play();
    if (p && p.catch) p.catch(function () {
        if (!mainVideo.muted) {
            streamMuted = true;
            applyAudio();
            $("streamNote").textContent = "The browser blocked sound.Click the speaker button to listen.";
        }
    });
}

$("strMute").onclick = function () {
    streamMuted = !streamMuted;
    if (!streamMuted && streamVol === 0) { streamVol = 0.5; $("strVol").value = 50; }
    applyAudio();
    playMain();
    $("streamNote").textContent = "";
};

$("strVol").oninput = function () {
    streamVol = this.value / 100;
    if (streamVol > 0) streamMuted = false;
    applyAudio();
    playMain();
};

// Who owns a stream? ("local" = me, "s:<peerId>" = someone else; network.js knows the names)
function labelFor(id) {
    if (id === "local") return "You";
    if (id === "lcam") return "You (camera)";
    const n = (window.nameOfStream && window.nameOfStream(id)) || "Someone";
    const s = streams.get(id);
    return n + (s && s.getAudioTracks().length ? " 🔊" : "");
}
if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) startBtn.hidden = true;

function updateMain() {
    const has = mainId !== null;
    mainVideo.hidden = !has;
    strEmpty.hidden = has;
    mainLabel.hidden = !has;
    mainLabel.textContent = has ? labelFor(mainId) : "";
}

// network.js calls this when the user list changes (names may have arrived)
window.refreshStreamLabels = function () {
    updateMain();
    thumbs.querySelectorAll(".thumb").forEach(t => {
        t.querySelector(".lbl").textContent = labelFor(t.dataset.id);
    });
};

function createThumb(id, stream) {
    const box = document.createElement("div");
    box.className = "thumb";
    box.dataset.id = id;
    box.tabIndex = 0;
    box.setAttribute("role", "button");

    const v = document.createElement("video");
    v.classList.toggle("mirror", id === "lcam");
    v.srcObject = stream;
    v.autoplay = true;
    v.muted = true;
    v.playsInline = true;

    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = labelFor(id);
    box.setAttribute("aria-label", "Show " + lbl.textContent + "'s stream");

    box.appendChild(v);
    box.appendChild(lbl);
    box.addEventListener("click", () => swapToMain(id));
    box.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); swapToMain(id); }
    });
    thumbs.appendChild(box);
}

function removeThumb(id) {
    thumbs.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
}

function setMain(id) {
    mainId = id;
    mainVideo.srcObject = id === null ? null : streams.get(id);
    mainVideo.classList.toggle("mirror", id === "lcam");   // keep this line if you added camera sharing
    applyAudio();
    if (id !== null) playMain();
    updateMain();
    if (typeof updateStreamPipAvailability === "function") updateStreamPipAvailability();
}

function addStream(id, stream) {
    if (streams.has(id)) return;
    streams.set(id, stream);
    stream.addEventListener("addtrack", function () {
        applyAudio();
        window.refreshStreamLabels();
    });

    if (mainId === null) setMain(id);   // main is free
    else createThumb(id, stream);       // main is taken
}

function swapToMain(id) {
    if (id === mainId || !streams.has(id)) return;
    const oldMain = mainId;
    removeThumb(id);
    setMain(id);
    if (oldMain !== null) createThumb(oldMain, streams.get(oldMain));
}

function removeStream(id) {
    if (!streams.has(id)) return;
    streams.delete(id);

    if (id === mainId) {
        setMain(null);
        // Promote the first thumbnail, if any
        const next = thumbs.querySelector(".thumb");
        if (next) {
            const nextId = next.dataset.id;
            removeThumb(nextId);
            setMain(nextId);
        }
    } else {
        removeThumb(id);
    }
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

updateMain();

// PiP is only for the main livestream video, never the cinema-room player or thumbnails.
const streamPipBtn = $("streamPipBtn");
function updateStreamPipAvailability() {
    const supported = !!(document.pictureInPictureEnabled && mainVideo.requestPictureInPicture);
    streamPipBtn.hidden = !supported;
    streamPipBtn.disabled = !supported || mainVideo.hidden || !mainVideo.srcObject;
    streamPipBtn.textContent = document.pictureInPictureElement === mainVideo ? "Exit Livestream PiP" : "Livestream PiP";
}
if (streamPipBtn) {
    streamPipBtn.addEventListener("click", async function () {
        try {
            if (document.pictureInPictureElement === mainVideo) await document.exitPictureInPicture();
            else if (!mainVideo.hidden && mainVideo.srcObject) await mainVideo.requestPictureInPicture();
        } catch (error) {
            $("streamNote").textContent = "Livestream PiP could not start. Try selecting a live stream first.";
        }
    });
    mainVideo.addEventListener("enterpictureinpicture", updateStreamPipAvailability);
    mainVideo.addEventListener("leavepictureinpicture", updateStreamPipAvailability);
    mainVideo.addEventListener("loadedmetadata", updateStreamPipAvailability);
    document.addEventListener("visibilitychange", updateStreamPipAvailability);
}
const originalUpdateMain = updateMain;
updateMain = function () { originalUpdateMain(); updateStreamPipAvailability(); };
updateStreamPipAvailability();

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
window.onLocalCameraStart = function (stream) {
    cameraStream = stream;
    myStatus.cam = true;
    publishStatus();
    users.forEach(function (u) { if (u.id && u.id !== myId) callPeer(u.id, "camera", stream); });
};
window.onLocalCameraStop = function () {
    cameraStream = null;
    myStatus.cam = false;
    stopCalls("camera");
    announceMediaStop("camera");
    publishStatus();
};