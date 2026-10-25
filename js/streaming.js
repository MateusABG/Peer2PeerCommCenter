const streamWindow = $("streamWindow");
const thumbs = $("thumbs");
const startBtn = $("startStream");
const mainLabel = $("mainLabel");
const strEmpty = $("strEmpty");
var isStreaming = false;

const mainVideo = document.createElement("video");
mainVideo.autoplay = true;
mainVideo.muted = true;
mainVideo.playsInline = true;
streamWindow.insertBefore(mainVideo, streamWindow.firstChild);
mainVideo.hidden = true;

const streams = new Map(); // id -> MediaStream
let mainId = null;

// Who owns a stream? ("local" = me, "s:<peerId>" = someone else; network.js knows the names)
function labelFor(id) {
    if (id === "local") return "You";
    return (window.nameOfStream && window.nameOfStream(id)) || "Someone";
}

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
    if (id !== null) {
        const p = mainVideo.play();
        if (p && p.catch) p.catch(() => {});
    }
    updateMain();
}

function addStream(id, stream) {
    if (streams.has(id)) return;
    streams.set(id, stream);

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
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false
        });

        localStream = stream;
        addStream("local", stream);

        // network.js calls every user in the room with this stream
        if (window.onLocalStreamStart) window.onLocalStreamStart(stream);

        // Fires when the user clicks the browser's own "Stop sharing" button
        stream.getVideoTracks()[0].addEventListener("ended", stopStreaming);

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

    isStreaming = false;
    startBtn.textContent = "Start Streaming";
}

startBtn.addEventListener("click", () => {
    if (isStreaming) stopStreaming();
    else startStreaming();
});

updateMain();
