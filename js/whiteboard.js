/* Shared whiteboard (needs config.js loaded first for $ = getElementById) */
(function () {
  const $$ = s => document.querySelectorAll(s);

  const cv = $('cv');
  const ctx = cv.getContext('2d');

  const COLORS = ['#111111', '#ff3b4e', '#2563eb', '#16a34a', '#f59e0b',"#6f009b"];
  const HEX = /^#[0-9a-f]{6}$/i;
  const MAX_STROKES = 6000;
  const FLUSH_MS = 40;

  const hist = { strokes: [] };
  let pen = COLORS[0];
  let drawing = false;
  let last = null;
  let queue = [];
  let flushTimer = null;


  function send(m) {
    if (typeof window.wbSend === 'function') window.wbSend(m);
  }

  const num01 = v => (typeof v === 'number' && isFinite(v)) ? Math.min(1, Math.max(0, v)) : null;

  function clean(s) {
    if (!s || typeof s !== 'object') return null;
    const x0 = num01(s.x0), y0 = num01(s.y0), x1 = num01(s.x1), y1 = num01(s.y1);
    if (x0 === null || y0 === null || x1 === null || y1 === null) return null;
    const c = (typeof s.c === 'string' && HEX.test(s.c)) ? s.c : '#111111';
    const w = (typeof s.w === 'number' && isFinite(s.w)) ? Math.min(20, Math.max(1, s.w)) : 4;
    return { x0, y0, x1, y1, c, w };
  }

  function paint(s) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.c;
    ctx.lineWidth = s.w;
    ctx.beginPath();
    ctx.moveTo(s.x0 * cv.width, s.y0 * cv.height);
    ctx.lineTo(s.x1 * cv.width, s.y1 * cv.height);
    ctx.stroke();
  }

  function record(s) {
    hist.strokes.push(s);
    if (hist.strokes.length > MAX_STROKES) hist.strokes.shift();
  }

  function addStroke(raw) {
    const s = clean(raw);
    if (!s) return null;
    paint(s);
    record(s);
    return s;
  }

  function redraw() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    hist.strokes.forEach(paint);
  }

  /* ---- outgoing (batched so we don't send hundreds of messages/sec) --- */
  function flush() {
    flushTimer = null;
    if (!queue.length) return;
    send({ t: 'strokes', s: queue });
    queue = [];
  }

  function enqueue(s) {
    queue.push(s);
    if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
  }

  
  COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw' + (i ? '' : ' on');
    b.style.background = c;
    b.setAttribute('aria-label', 'Pen colour ' + c);
    b.onclick = () => {
      pen = c;
      $$('.sw').forEach(x => x.classList.toggle('on', x === b));
    };
    $('wbtools').appendChild(b);
  });

  function pos(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  function stroke(a, b) {
    const s = addStroke({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, c: pen, w: 4 });
    if (s) enqueue(s);
  }

  cv.onpointerdown = e => {
    drawing = true;
    last = pos(e);
    cv.setPointerCapture(e.pointerId);
    stroke(last, last); // a single tap leaves a dot
  };

  cv.onpointermove = e => {
    if (!drawing) return;
    const p = pos(e);
    stroke(last, p);
    last = p;
  };

  const stop = () => { drawing = false; flush(); };
  cv.onpointerup = cv.onpointercancel = stop;

  $('clr').onclick = () => {
    hist.strokes = [];
    queue = [];
    ctx.clearRect(0, 0, cv.width, cv.height);
    send({ t: 'clear' });
  };

  window.Whiteboard = {
     applyRemote(m) {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'clear') {
        hist.strokes = [];
        ctx.clearRect(0, 0, cv.width, cv.height);
      } else if (m.t === 'strokes' && Array.isArray(m.s)) {
        m.s.slice(0, 500).forEach(addStroke);
      }
    },
    getHistory() { return hist.strokes.slice(); },
    loadHistory(list) {
      if (!Array.isArray(list)) return;
      hist.strokes = list.slice(-MAX_STROKES).map(clean).filter(Boolean);
      redraw();
    }
  };
})();