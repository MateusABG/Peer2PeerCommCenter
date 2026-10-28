/* Shared whiteboard (needs config.js loaded first for $ = getElementById)
 *
 * The board is a list of objects (pen strokes, shapes, text), each with an id.
 * Peers exchange small operations on that list:
 *   { t:'add',  o:{...} }             one new object
 *   { t:'objs', o:[{...}, ...] }      many objects (what a late joiner receives)
 *   { t:'pts',  id, p:[[x,y], ...] }  more points for a pen stroke still being drawn
 *   { t:'del',  id }                  remove one object (this is what undo sends)
 *   { t:'clear' }
 * Coordinates are fractions (0..1) of the canvas, so every screen agrees.
 * Object: { id, k, c, w, p:[[x,y], ...], e?, s? }
 *   k = pen | line | arrow | rect | ellipse | text
 *   pen: p = every point, e = 1 means "eraser"; shapes: p = [start, end]; text: p = [corner], s = the text
 *   w = line width in canvas px (for text: font size in px)
 */
(function () {
  const $$ = s => document.querySelectorAll(s);

  const cv = $('cv');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;

  const COLORS = ['#111111', '#ff3b4e', '#2563eb', '#16a34a', '#f59e0b', '#6f009b'];
  const SIZES = {                       // pen / eraser / text size for each size button
    s: { line: 3, erase: 14, text: 22 },
    m: { line: 6, erase: 28, text: 34 },
    l: { line: 12, erase: 56, text: 56 }
  };
  const HEX = /^#[0-9a-f]{6}$/i;
  const ID_RE = /^[a-z0-9]{6,24}$/;
  const KINDS = ['pen', 'line', 'arrow', 'rect', 'ellipse', 'text'];
  const MAX_OBJECTS = 1500;
  const MAX_POINTS = 3000;              // per pen stroke
  const MAX_TEXT = 200;
  const MAX_BATCH = 100;                // objects per 'objs' message
  const MAX_PTS_MSG = 200;              // points per 'pts' message
  const FLUSH_MS = 40;
  const MIN_STEP_PX = 1.5;              // ignore pen moves smaller than this
  const MIN_SHAPE_PX = 4;               // a shape dragged less than this is treated as a tap
  const FONT = '"Chakra Petch", system-ui, sans-serif';

  let objs = [];                        // draw order
  let byId = new Map();
  let undoStack = [];                   // ids of MY objects, newest last
  let redoStack = [];                   // MY objects that were undone
  let tool = 'pen', color = COLORS[0], size = 'm';
  let draw = null;                      // the gesture in progress
  let queue = [], flushTimer = null;    // pen points waiting to be sent
  let rafId = 0;
  let textBox = null;                   // the open text field, if any

  function send(m) {
    if (typeof window.wbSend === 'function') window.wbSend(m);
  }

  /* ---------------------------- validation ----------------------------- */
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const isNum = v => typeof v === 'number' && isFinite(v);
  const r4 = v => Math.round(v * 10000) / 10000;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const copy = o => Object.assign({}, o, { p: o.p.map(q => q.slice()) });

  function cleanPt(q) {
    if (!Array.isArray(q) || !isNum(q[0]) || !isNum(q[1])) return null;
    return [r4(clamp(q[0], 0, 1)), r4(clamp(q[1], 0, 1))];
  }

  function cleanPts(a, max) {
    const out = [];
    if (!Array.isArray(a)) return out;
    for (let i = 0; i < a.length && out.length < max; i++) {
      const p = cleanPt(a[i]);
      if (p) out.push(p);
    }
    return out;
  }

  // Everything that comes from the network goes through here.
  function cleanObj(o) {
    if (!o || typeof o !== 'object') return null;
    if (typeof o.id !== 'string' || !ID_RE.test(o.id)) return null;
    if (KINDS.indexOf(o.k) < 0) return null;

    const need = (o.k === 'pen' || o.k === 'text') ? 1 : 2;
    const max = o.k === 'pen' ? MAX_POINTS : need;
    const p = cleanPts(o.p, max);
    if (p.length < need) return null;

    const isText = o.k === 'text';
    const out = {
      id: o.id,
      k: o.k,
      c: (typeof o.c === 'string' && HEX.test(o.c)) ? o.c : '#111111',
      w: isNum(o.w) ? (isText ? clamp(o.w, 8, 120) : clamp(o.w, 1, 60)) : (isText ? 24 : 4),
      p: p
    };
    if (o.k === 'pen' && o.e) out.e = 1;
    if (isText) {
      out.s = typeof o.s === 'string' ? o.s.slice(0, MAX_TEXT) : '';
      if (!out.s.trim()) return null;
    }
    return out;
  }

  /* ------------------------------ painting ------------------------------ */
  function style(o) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = o.c;
    ctx.fillStyle = o.c;
    ctx.lineWidth = o.w;
    ctx.globalCompositeOperation = o.e ? 'destination-out' : 'source-over';
  }

  function paint(o) {
    ctx.save();
    style(o);
    const a = o.p[0], b = o.p[1];
    const x0 = a[0] * W, y0 = a[1] * H;
    ctx.beginPath();

    if (o.k === 'pen') {
      ctx.moveTo(x0, y0);
      if (o.p.length === 1) ctx.lineTo(x0, y0);       // a single tap leaves a dot
      for (let i = 1; i < o.p.length; i++) ctx.lineTo(o.p[i][0] * W, o.p[i][1] * H);
      ctx.stroke();
    } else if (o.k === 'text') {
      ctx.textBaseline = 'top';
      ctx.font = o.w + 'px ' + FONT;
      ctx.fillText(o.s, x0, y0);
    } else {
      const x1 = b[0] * W, y1 = b[1] * H;
      if (o.k === 'line' || o.k === 'arrow') {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        if (o.k === 'arrow') {
          const ang = Math.atan2(y1 - y0, x1 - x0), len = Math.max(14, o.w * 4);
          [-0.5, 0.5].forEach(d => {
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 - len * Math.cos(ang + d), y1 - len * Math.sin(ang + d));
          });
        }
      } else if (o.k === 'rect') {
        ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      } else if (o.k === 'ellipse') {
        ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function paintSeg(o, i) {               // just the newest piece of a pen stroke
    ctx.save();
    style(o);
    ctx.beginPath();
    ctx.moveTo(o.p[i - 1][0] * W, o.p[i - 1][1] * H);
    ctx.lineTo(o.p[i][0] * W, o.p[i][1] * H);
    ctx.stroke();
    ctx.restore();
  }

  function redraw() {
    ctx.clearRect(0, 0, W, H);
    objs.forEach(paint);
  }

  /* ------------------------------- model -------------------------------- */
  function addObj(o) {                    // true if the oldest object had to go (caller must redraw)
    objs.push(o);
    byId.set(o.id, o);
    if (objs.length > MAX_OBJECTS) {
      byId.delete(objs.shift().id);
      return true;
    }
    return false;
  }

  function removeObj(id) {
    const o = byId.get(id);
    if (!o) return false;
    byId.delete(id);
    objs.splice(objs.lastIndexOf(o), 1);
    return true;
  }

  function reset() {
    objs = [];
    byId = new Map();
    undoStack = [];
    redoStack = [];
    updateButtons();
  }

  function ingest(list) {                 // add objects that arrived from the network
    const accepted = [];
    let full = false;
    list.forEach(o => {
      if (byId.has(o.id)) return;
      accepted.push(o);
      if (addObj(o)) full = true;
    });
    if (full) redraw(); else accepted.forEach(paint);
    updateButtons();
    return accepted;
  }

  // Applies a message from the network. Returns the cleaned message (so the host can relay
  // exactly that and nothing else), or null if it was invalid / changed nothing.
  function applyRemote(m) {
    if (!m || typeof m !== 'object') return null;

    if (m.t === 'add') {
      const o = cleanObj(m.o);
      if (!o) return null;
      return ingest([o]).length ? { t: 'add', o: o } : null;
    }
    if (m.t === 'objs') {
      if (!Array.isArray(m.o)) return null;
      const list = m.o.slice(0, MAX_BATCH).map(cleanObj).filter(Boolean);
      const got = ingest(list);
      return got.length ? { t: 'objs', o: got } : null;
    }
    if (m.t === 'pts') {
      const o = typeof m.id === 'string' ? byId.get(m.id) : null;
      if (!o || o.k !== 'pen') return null;
      const p = cleanPts(m.p, Math.min(MAX_PTS_MSG, MAX_POINTS - o.p.length));
      if (!p.length) return null;
      const from = o.p.length;
      p.forEach(q => o.p.push(q));
      for (let i = from; i < o.p.length; i++) paintSeg(o, i);
      return { t: 'pts', id: o.id, p: p };
    }
    if (m.t === 'del') {
      if (typeof m.id !== 'string' || !removeObj(m.id)) return null;
      redraw();
      updateButtons();
      return { t: 'del', id: m.id };
    }
    if (m.t === 'clear') {
      reset();
      redraw();
      return { t: 'clear' };
    }
    return null;
  }

  // The board as a list of messages, for a peer that just joined.
  function snapshot() {
    const out = [];
    let batch = [], pts = 0;
    const flushBatch = () => { if (batch.length) out.push({ t: 'objs', o: batch }); batch = []; pts = 0; };
    objs.forEach(o => {
      if (batch.length && (batch.length >= MAX_BATCH || pts + o.p.length > 4000)) flushBatch();
      batch.push(copy(o));
      pts += o.p.length;
    });
    flushBatch();
    return out;
  }

  /* --------------------------- my own drawing --------------------------- */
  function lineWidth() { return SIZES[size].line; }

  function flush() {
    flushTimer = null;
    if (!draw || !draw.o) { queue = []; return; }
    while (queue.length) send({ t: 'pts', id: draw.o.id, p: queue.splice(0, MAX_PTS_MSG) });
  }

  function mine(o) {                      // remember a finished object of mine for undo
    undoStack.push(o.id);
    redoStack = [];
    updateButtons();
  }

  function addMine(o) {                   // a shape or text: add, show, send
    if (addObj(o)) redraw(); else paint(o);
    send({ t: 'add', o: copy(o) });
    mine(o);
  }

  function undo() {
    if (draw) return;
    while (undoStack.length) {
      const id = undoStack.pop();
      const o = byId.get(id);
      if (!o) continue;                   // already gone (cleared, or pushed out by the size limit)
      removeObj(id);
      redoStack.push(o);
      redraw();
      send({ t: 'del', id: id });
      break;
    }
    updateButtons();
  }

  function redo() {
    if (draw) return;
    const o = redoStack.pop();
    if (!o) return;
    if (addObj(o)) redraw(); else paint(o);
    send({ t: 'add', o: copy(o) });
    undoStack.push(o.id);
    updateButtons();
  }

  function updateButtons() {
    undoStack = undoStack.filter(id => byId.has(id));
    const u = $('wbUndo'), r = $('wbRedo');
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
  }

  function pos(e) {
    const r = cv.getBoundingClientRect();
    return [r4(clamp((e.clientX - r.left) / r.width, 0, 1)), r4(clamp((e.clientY - r.top) / r.height, 0, 1))];
  }

  const dist = (a, b) => Math.hypot((a[0] - b[0]) * W, (a[1] - b[1]) * H);

  function schedulePreview() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (!draw || !draw.preview) return;
      redraw();
      paint(draw.preview);
    });
  }

  cv.addEventListener('pointerdown', e => {
    if (draw || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    if (textBox) closeText(true);
    const p = pos(e);
    cv.setPointerCapture(e.pointerId);
    draw = { pid: e.pointerId, tool: tool, start: p, last: p, o: null, preview: null };

    if (tool === 'pen' || tool === 'eraser') {
      const o = { id: newId(), k: 'pen', c: color, w: tool === 'eraser' ? SIZES[size].erase : lineWidth(), p: [p] };
      if (tool === 'eraser') o.e = 1;
      draw.o = o;
      if (addObj(o)) redraw(); else paint(o);
      send({ t: 'add', o: copy(o) });
    }
  });

  cv.addEventListener('pointermove', e => {
    if (!draw || e.pointerId !== draw.pid) return;
    const p = pos(e);
    draw.last = p;

    if (draw.o) {
      const o = draw.o;
      if (o.p.length >= MAX_POINTS || dist(p, o.p[o.p.length - 1]) < MIN_STEP_PX) return;
      o.p.push(p);
      paintSeg(o, o.p.length - 1);
      queue.push(p);
      if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
    } else if (draw.tool !== 'text') {
      draw.preview = { id: 'preview', k: draw.tool, c: color, w: lineWidth(), p: [draw.start, p] };
      schedulePreview();
    }
  });

  function finish(e) {
    if (!draw || e.pointerId !== draw.pid) return;
    const d = draw;
    clearTimeout(flushTimer);
    flush();                              // 'draw' is still set, so the last points go out
    draw = null;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }

    if (d.o) {
      mine(d.o);
    } else if (d.tool === 'text') {
      if (e.type === 'pointerup') openText(d.start);
    } else {
      if (e.type === 'pointerup' && dist(d.start, d.last) >= MIN_SHAPE_PX) {
        addMine({ id: newId(), k: d.tool, c: color, w: lineWidth(), p: [d.start, d.last] });
      }
      redraw();                           // wipes the preview
    }
  }
  cv.addEventListener('pointerup', finish);
  cv.addEventListener('pointercancel', finish);

  /* --------------------------------- text -------------------------------- */
  function openText(p) {
    const r = cv.getBoundingClientRect(), box = cv.parentNode.getBoundingClientRect();
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'wbtext';
    inp.maxLength = MAX_TEXT;
    inp.setAttribute('aria-label', 'Text to put on the board');
    inp.style.left = (r.left - box.left + p[0] * r.width) + 'px';
    inp.style.top = (r.top - box.top + p[1] * r.height) + 'px';
    inp.style.fontSize = (SIZES[size].text * r.width / W) + 'px';
    inp.style.color = color;
    textBox = { el: inp, p: p, color: color, size: size, opened: Date.now() };

    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); closeText(true); }
      else if (ev.key === 'Escape') closeText(false);
    });
    inp.addEventListener('blur', () => {
      if (!textBox || textBox.el !== inp) return;
      // touch browsers can steal focus right after the tap: take it back instead of closing
      if (Date.now() - textBox.opened < 300) setTimeout(() => inp.focus(), 0);
      else closeText(true);
    });
    cv.parentNode.appendChild(inp);
    setTimeout(() => inp.focus(), 0);
  }

  function closeText(save) {
    const t = textBox;
    if (!t) return;
    textBox = null;                       // first, so the blur caused by remove() is ignored
    const v = t.el.value.trim();
    t.el.remove();
    if (!save || !v) return;
    addMine({ id: newId(), k: 'text', c: t.color, w: SIZES[t.size].text, s: v.slice(0, MAX_TEXT), p: [t.p] });
  }

  /* -------------------------------- toolbar ------------------------------- */
  const CURSORS = { pen: 'crosshair', eraser: 'cell', text: 'text' };

  function setPressed(sel, attr, value) {
    $$(sel).forEach(b => b.setAttribute('aria-pressed', b.dataset[attr] === value ? 'true' : 'false'));
  }

  function setTool(t) {
    if (textBox) closeText(true);
    tool = t;
    setPressed('#wbtools [data-tool]', 'tool', t);
    cv.style.cursor = CURSORS[t] || 'crosshair';
  }

  COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw' + (i ? '' : ' on');
    b.style.background = c;
    b.setAttribute('aria-label', 'Colour ' + c);
    b.onclick = () => {
      color = c;
      $$('.sw').forEach(x => x.classList.toggle('on', x === b));
      if (tool === 'eraser') setTool('pen');
    };
    $('wbColors').appendChild(b);
  });

  $$('#wbtools [data-tool]').forEach(b => { b.onclick = () => setTool(b.dataset.tool); });
  $$('#wbtools [data-size]').forEach(b => {
    b.onclick = () => { size = b.dataset.size; setPressed('#wbtools [data-size]', 'size', size); };
  });

  $('wbUndo').onclick = undo;
  $('wbRedo').onclick = redo;

  $('clr').onclick = () => {
    if (!objs.length) return;
    if (!confirm('Clear the board for everyone? This cannot be undone.')) return;
    if (textBox) closeText(false);
    reset();
    redraw();
    send({ t: 'clear' });
  };

  // Save as PNG. The canvas itself is transparent (white comes from CSS), so paint it onto white first.
  $('wbSave').onclick = () => {
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const g = out.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    g.drawImage(cv, 0, 0);
    out.toBlob(blob => {
      if (!blob) return;
      const d = new Date(), z = n => String(n).padStart(2, '0');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'whiteboard-' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes()) + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  };

  // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl+Y = redo (only while the board is showing, never while typing)
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || $('v-board').hidden) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
  });

  setTool('pen');
  updateButtons();

  window.Whiteboard = {
    applyRemote: applyRemote,
    snapshot: snapshot,
    getHistory() { return objs.map(copy); },
    loadHistory(list) {
      if (!Array.isArray(list)) return;
      reset();
      ingest(list.slice(-MAX_OBJECTS).map(cleanObj).filter(Boolean));
      redraw();
    }
  };
})();
