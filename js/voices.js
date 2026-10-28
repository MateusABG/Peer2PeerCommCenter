var Voices = (function () {
    "use strict";
    var settings = {};
    var els = {};

    function get(id) {
        return settings[id] || (settings[id] = { vol: 1, muted: false });
    }

    function push(id) {
        var el = els[id], s = get(id);
        if (!el) return;
        el.volume = s.vol;
        el.muted = s.muted;
    }

    function attach(id, el) { els[id] = el; push(id); }
    function detach(id) { delete els[id] }
    function forget(id) { delete els[id]; delete settings[id]; }

    function controls(id) {
        var s = get(id);

        var wrap = document.createElement("div");
        wrap.className = "vctl";

        var mute = document.createElement("button");
        mute.type = "button";
        mute.className = "vmute";

        var range = document.createElement("input");
        range.type = "range";
        range.className = "vrange";
        range.min = 0;
        range.max = 100;
        range.value = Math.round(s.vol * 100);
        range.setAttribute("aria-label", "Volume");

        function paint() {
            var off = s.muted || s.vol === 0;
            mute.textContent = off ? "🔇" : "🔊";
            mute.title = s.muted ? "Unmute" : "Mute";
            mute.setAttribute("aria-pressed", String(s.muted));
            wrap.classList.toggle("off", off);
        }

        mute.onclick = function () {
            s.muted = !s.muted;
            push(id);
            paint();
        };
        range.oninput = function () {
            s.vol = range.value / 100;
            if (s.vol > 0) s.muted = false;            // moving the slider un-mutes
            push(id);
            paint();
        };

        wrap.appendChild(mute);
        wrap.appendChild(range);
        paint();
        return wrap;
    }
    function get(id) {
        return settings[id] || (settings[id] = { vol: 1, muted: false, host: false });
    }
    function push(id) {
        var el = els[id], s = get(id);
        if (!el) return;
        el.volume = s.vol;
        el.muted = s.muted || s.host;                       // host silence always wins over your own setting
    }
    function hostMute(id, on) { get(id).host = !!on; push(id); }

    return { attach: attach, detach: detach, forget: forget, controls: controls, hostMute: hostMute };

})();