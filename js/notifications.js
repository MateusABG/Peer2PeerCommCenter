var Notifier = (function () {
    "use strict";

    var prefs = { sound: true, notify: false };

    try {
        var saved = JSON.parse(localStorage.getItem("chatPrefs") || "{}");
        if (typeof saved.sound === "boolean") prefs.sound = saved.sound;
        if (saved.notify === true) prefs.notify = true;
    } catch (e) {
        console.log("Houve um erro:", e);
    }

    function savePrefs() {
        try {
            localStorage.setItem("chatPrefs", JSON.stringify(prefs));
        } catch (e) {
            console.log(e);
        }
    }

    var audioCtx = null, lastPing = 0;
    function unlockAudio() {
        if (!audioCtx) {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            audioCtx = new AC();
        }
        if (audioCtx.state === "suspended") audioCtx.resume();
    }
    ["click", "keydown", "touchstart"].forEach(function (ev) {
        document.addEventListener(ev, unlockAudio, { passive: true });
    });

    function ping() {
        if (!prefs.sound || !audioCtx || audioCtx.state !== "running") return;
        var now = Date.now();
        if (now - lastPing < 1500) return;
        lastPing = now;

        var t = audioCtx.currentTime;
        var osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.setValueAtTime(1175, t + 0.09);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.3);
    }
    function canNotify() {
        return "Notification" in window && Notification.permission === "granted" && prefs.notify;
    }

    function preview(text, img, file) {
        var s = text || (img ? "📷 Photo" : file ? "📎 " + file.name : "");
        return String(s).slice(0, 100);
    }

    function notifyMessage(from, body) {
        if (!canNotify()) return;
        try {
            var n = new Notification(from, { body: body, tag: "chat-msg", renotify: true });
            n.onclick = function () {
                window.focus();
                if (window.show) show("chat");
                n.close();
            };
            setTimeout(function () { n.close(); }, 6000);
        } catch (e) { /* some mobile browsers refuse this constructor */ }
    }
    function messageArrived(from, text, img, file) {
        ping();                                                  // chat not visible: beep
        if (document.hidden) notifyMessage(from, preview(text, img, file));   // whole tab hidden: pop-up
    }
    var soundBtn = $("soundBtn"), notifBtn = $("notifBtn");

    function refreshUi() {
        if (soundBtn) {
            soundBtn.textContent = prefs.sound ? "🔊" : "🔇";
            soundBtn.setAttribute("aria-pressed", prefs.sound);
        }
        if (notifBtn) {
            var on = canNotify();
            notifBtn.textContent = on ? "🔔" : "🔕";
            notifBtn.setAttribute("aria-pressed", on);
        }
    }

    if (soundBtn) soundBtn.addEventListener("click", function () {
        prefs.sound = !prefs.sound;
        savePrefs();
        refreshUi();
        unlockAudio();
        if (prefs.sound) ping();                     // let them hear what they just turned on
    });

    if (notifBtn) notifBtn.addEventListener("click", function () {
        if (!("Notification" in window)) {
            alert("This browser doesn't support notifications here.");
            return;
        }
        if (prefs.notify) { prefs.notify = false; savePrefs(); refreshUi(); return; }
        if (Notification.permission === "denied") {
            alert("Notifications are blocked for this site. Allow them in the browser's site settings (the lock icon by the address bar).");
            return;
        }
        Notification.requestPermission().then(function (p) {
            prefs.notify = p === "granted";
            savePrefs();
            refreshUi();
        });
    });

    refreshUi();

    return { messageArrived: messageArrived };
}
 

)(); 