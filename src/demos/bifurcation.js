import { PALETTES, samplePalette } from '../shared/palettes.js';
import { startLoop, dpr } from '../shared/loop.js';
import { attachKeys } from '../shared/panzoom.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about, swatches,
} from '../shared/ui.js';

const MAPS = [
  {
    id: 'logistic', name: 'Logistic map', formula: 'x → r·x(1 − x)',
    f: (r, x) => r * x * (1 - x), df: (r, x) => r * (1 - 2 * x),
    start: 0.5, domain: [0, 1], view: { r0: 2.8, r1: 4, x0: 0, x1: 1 }, hover: 3.83,
    marks: [
      { r: 3, label: 'period 2' }, { r: 3.44949, label: '4' }, { r: 3.54409, label: '8' },
      { r: 3.569946, label: 'chaos' }, { r: 3.828427, label: 'period 3' },
    ],
    about: "Robert May made this map famous in 1976 as a model of population growth: x is the population as a fraction of the maximum, and r is the growth rate. Below r = 3 the population settles to one value. At 3 it starts alternating between two, then four, then eight, with each doubling coming sooner. The gaps shrink by Feigenbaum's constant, δ ≈ 4.669, and the doublings pile up at r ≈ 3.5699, where chaos begins. Inside the chaos are windows of order, such as the period-3 window at 1 + √8 ≈ 3.8284.",
  },
  {
    id: 'sine', name: 'Sine map', formula: 'x → r·sin(πx)',
    f: (r, x) => r * Math.sin(Math.PI * x), df: (r, x) => r * Math.PI * Math.cos(Math.PI * x),
    start: 0.5, domain: [0, 1], view: { r0: 0.6, r1: 1, x0: 0, x1: 1 }, hover: 0.92,
    marks: [{ r: 0.7199, label: 'period 2' }, { r: 0.8332, label: '4' }, { r: 0.8586, label: '8' }, { r: 0.8655, label: 'chaos' }],
    about: "A completely different formula with the same picture. Any smooth map with a single hump goes through the same period-doubling cascade, and the ratio of gaps between doublings converges to the same Feigenbaum constant, δ ≈ 4.669. This universality, proved by Mitchell Feigenbaum in the 1970s, is why the constant appears in real fluids, circuits and lasers.",
  },
  {
    id: 'gauss', name: 'Gauss map', formula: 'x → e<sup>−6.2x²</sup> + r',
    f: (r, x) => Math.exp(-6.2 * x * x) + r, df: (r, x) => -12.4 * x * Math.exp(-6.2 * x * x),
    start: 0, domain: [-1, 1.3], view: { r0: -1, r1: 0.6, x0: -1, x1: 1.3 }, hover: -0.55,
    marks: [],
    about: "Also called the mouse map, for the shape of its diagram. Here the period-doubling cascade runs forward and then backward: as r increases, chaos appears and then un-doubles back into a single stable value. The closed loops are sometimes called bubbles.",
  },
];

export default {
  id: 'bifurcation',
  title: 'Bifurcation Diagram',
  area: 'Chaos',
  formula: 'x<sub>n+1</sub> = r·x<sub>n</sub>(1 − x<sub>n</sub>)',
  blurb: 'The road from order to chaos in one picture. Zoom in to find period doubling and copies of the whole diagram.',

  mount(root, { signal }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Bifurcation diagram. Drag to pan, scroll or pinch to zoom, hover to inspect a value of r.' });
    const overlay = el('canvas', { class: 'stage', style: { pointerEvents: 'none', background: 'transparent' } });
    root.append(canvas, overlay);
    const ctx = canvas.getContext('2d');
    const octx = overlay.getContext('2d');

    const state = { map: 0, palette: 2, lyapunov: true, marks: true, hoverR: MAPS[0].hover, target: 3000 };
    let view = { ...MAPS[0].view };

    // ---- accumulation buffers
    let W = 0, H = 0;
    let counts = new Float32Array(0);
    let xs = new Float64Array(0);
    let lyapSum = new Float64Array(0);
    let samples = 0;
    let image = null;
    let lut = null;
    let needsRestart = true;
    let overlayDirty = true;

    function buildLut() {
      lut = new Uint8ClampedArray(256 * 3);
      for (let i = 0; i < 256; i++) {
        const v = i / 255;
        const [r, g, b] = samplePalette(state.palette, 0.12 + 0.62 * v);
        const k = Math.min(1, v * 1.8);
        lut[3 * i] = 5 + (r * 255 - 5) * k;
        lut[3 * i + 1] = 6 + (g * 255 - 6) * k;
        lut[3 * i + 2] = 10 + (b * 255 - 10) * k;
      }
    }

    const rAt = (c) => view.r0 + ((c + 0.5) / W) * (view.r1 - view.r0);

    function restart() {
      const m = MAPS[state.map];
      const s = dpr();
      W = canvas.width = overlay.width = Math.round(canvas.clientWidth * s);
      H = canvas.height = overlay.height = Math.round(canvas.clientHeight * s);
      counts = new Float32Array(W * H);
      xs = new Float64Array(W);
      lyapSum = new Float64Array(W);
      image = ctx.createImageData(W, H);
      samples = 0;
      for (let c = 0; c < W; c++) {
        const r = rAt(c);
        let x = m.start;
        for (let k = 0; k < 500; k++) x = m.f(r, x);
        xs[c] = Number.isFinite(x) ? x : m.start;
      }
      needsRestart = false;
      overlayDirty = true;
    }

    function accumulate(batch) {
      const m = MAPS[state.map];
      const scale = H / (view.x1 - view.x0);
      for (let c = 0; c < W; c++) {
        const r = rAt(c);
        let x = xs[c];
        let ls = 0;
        for (let k = 0; k < batch; k++) {
          x = m.f(r, x);
          if (!(Math.abs(x) < 1e6)) x = m.start; // escaped: restart the orbit
          ls += Math.log(Math.abs(m.df(r, x)) + 1e-12);
          const row = ((view.x1 - x) * scale) | 0;
          if (row >= 0 && row < H) counts[row * W + c]++;
        }
        xs[c] = x;
        lyapSum[c] += ls;
      }
      samples += batch;
    }

    function paint() {
      const data = image.data;
      // Density relative to a uniform spread; log-scaled so that both the
      // sharp periodic branches and the faint chaotic bands show.
      const k = H / samples;
      const norm = 1 / Math.log1p(H / 6);
      for (let i = 0, p = 0; i < counts.length; i++, p += 4) {
        const cnt = counts[i];
        let li = 0;
        if (cnt > 0) li = Math.min(255, (Math.sqrt(Math.log1p(cnt * k) * norm) * 255) | 0);
        data[p] = lut[3 * li]; data[p + 1] = lut[3 * li + 1]; data[p + 2] = lut[3 * li + 2]; data[p + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
    }

    function niceStep(range) {
      const raw = range / 6;
      const p = 10 ** Math.floor(Math.log10(raw));
      const f = raw / p;
      return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
    }

    function drawOverlay() {
      const s = dpr();
      const m = MAPS[state.map];
      octx.clearRect(0, 0, W, H);
      octx.font = `${11 * s}px "Chivo Mono", ui-monospace, monospace`;
      octx.textBaseline = 'alphabetic';
      const xOfR = (r) => ((r - view.r0) / (view.r1 - view.r0)) * W;
      const yOfX = (x) => ((view.x1 - x) / (view.x1 - view.x0)) * H;

      // Lyapunov exponent strip along the bottom.
      const band = state.lyapunov ? Math.round(H * 0.13) : 0;
      if (state.lyapunov && samples > 0) {
        const top = H - band;
        const zero = top + band * 0.55;
        const scale = band * 0.3;
        octx.fillStyle = 'rgba(5, 6, 10, 0.82)';
        octx.fillRect(0, top, W, band);
        for (let c = 0; c < W; c++) {
          const lam = Math.max(-1.6, Math.min(1.2, lyapSum[c] / samples));
          octx.fillStyle = lam > 0 ? 'rgba(255, 170, 0, 0.9)' : 'rgba(127, 214, 164, 0.75)';
          const y = zero - lam * scale;
          octx.fillRect(c, Math.min(y, zero), 1, Math.abs(y - zero) + 0.5);
        }
        octx.fillStyle = 'rgba(232, 235, 243, 0.4)';
        octx.fillRect(0, zero, W, s);
        octx.fillStyle = '#8d95aa';
        octx.fillText('Lyapunov exponent λ   orange: chaotic (λ > 0)   green: stable (λ < 0)', 10 * s, top + 16 * s);
      }

      // Axis ticks.
      octx.fillStyle = 'rgba(232, 235, 243, 0.75)';
      octx.strokeStyle = 'rgba(232, 235, 243, 0.35)';
      octx.lineWidth = s;
      const rs = niceStep(view.r1 - view.r0);
      const rDigits = Math.max(0, -Math.floor(Math.log10(rs)));
      for (let r = Math.ceil(view.r0 / rs) * rs; r <= view.r1; r += rs) {
        const x = xOfR(r);
        octx.beginPath(); octx.moveTo(x, H - band); octx.lineTo(x, H - band - 6 * s); octx.stroke();
        octx.fillText(r.toFixed(rDigits), x + 3 * s, H - band - 8 * s);
      }
      const xsStep = niceStep(view.x1 - view.x0);
      const xDigits = Math.max(0, -Math.floor(Math.log10(xsStep)));
      for (let v = Math.ceil(view.x0 / xsStep) * xsStep; v <= view.x1; v += xsStep) {
        const y = yOfX(v);
        if (y > H - band - 24 * s || y < 120 * s) continue;
        octx.beginPath(); octx.moveTo(0, y); octx.lineTo(6 * s, y); octx.stroke();
        octx.fillText(v.toFixed(xDigits), 9 * s, y + 4 * s);
      }
      octx.fillStyle = '#8d95aa';
      octx.fillText('r →', W - 40 * s, H - band - 8 * s);

      // Landmarks of the period-doubling cascade.
      if (state.marks) {
        octx.setLineDash([3 * s, 4 * s]);
        for (const mk of m.marks) {
          if (mk.r < view.r0 || mk.r > view.r1) continue;
          const x = xOfR(mk.r);
          octx.strokeStyle = 'rgba(232, 235, 243, 0.25)';
          octx.beginPath(); octx.moveTo(x, 130 * s); octx.lineTo(x, H - band - 22 * s); octx.stroke();
          octx.save();
          octx.translate(x - 4 * s, 134 * s);
          octx.rotate(-Math.PI / 2);
          octx.textAlign = 'right';
          octx.fillStyle = 'rgba(232, 235, 243, 0.6)';
          octx.fillText(mk.label, 0, 0);
          octx.restore();
        }
        octx.setLineDash([]);
      }

      // Selected r.
      const hx = xOfR(state.hoverR);
      if (hx >= 0 && hx <= W) {
        octx.strokeStyle = 'rgba(255, 170, 0, 0.8)';
        octx.lineWidth = s;
        octx.beginPath(); octx.moveTo(hx, 0); octx.lineTo(hx, H - band); octx.stroke();
      }
      overlayDirty = false;
    }

    // ---- cobweb inset
    const web = el('canvas', { class: 'inset', 'aria-label': 'Cobweb plot for the selected r' });
    const webInfo = el('p', { class: 'hint' });
    function drawWeb() {
      const m = MAPS[state.map];
      const s = dpr();
      const w = (web.width = Math.round(web.clientWidth * s));
      const h = (web.height = Math.round(w * 0.78));
      const c = web.getContext('2d');
      const [d0, d1] = m.domain;
      const r = state.hoverR;
      // Vertical range: domain, widened to fit the curve.
      let lo = d0, hi = d1;
      for (let i = 0; i <= 100; i++) { const y = m.f(r, d0 + (i / 100) * (d1 - d0)); if (Number.isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); } }
      lo = Math.max(lo, d0 - (d1 - d0)); hi = Math.min(hi, d1 + (d1 - d0));
      const pad = 8 * s;
      const X = (x) => pad + ((x - d0) / (d1 - d0)) * (w - 2 * pad);
      const Y = (y) => h - pad - ((y - lo) / (hi - lo)) * (h - 2 * pad);
      c.fillStyle = '#05060a';
      c.fillRect(0, 0, w, h);
      c.lineWidth = s;
      c.strokeStyle = 'rgba(232, 235, 243, 0.25)';
      c.beginPath(); c.moveTo(X(Math.max(d0, lo)), Y(Math.max(d0, lo))); c.lineTo(X(Math.min(d1, hi)), Y(Math.min(d1, hi))); c.stroke();
      c.strokeStyle = 'rgba(232, 235, 243, 0.8)';
      c.beginPath();
      for (let i = 0; i <= 200; i++) {
        const x = d0 + (i / 200) * (d1 - d0);
        const y = m.f(r, x);
        if (i === 0) c.moveTo(X(x), Y(y)); else c.lineTo(X(x), Y(y));
      }
      c.stroke();
      // Orbit: from the start value, older steps fade.
      let x = m.start === 0.5 ? 0.21 : m.start + 0.05;
      const steps = 120;
      c.lineWidth = 1.2 * s;
      for (let i = 0; i < steps; i++) {
        const y = m.f(r, x);
        if (!Number.isFinite(y)) break;
        c.strokeStyle = `rgba(255, 170, 0, ${0.12 + 0.88 * (i / steps) ** 2})`;
        c.beginPath(); c.moveTo(X(x), Y(i === 0 ? lo : x)); c.lineTo(X(x), Y(y)); c.lineTo(X(y), Y(y)); c.stroke();
        x = y;
      }
      // Lyapunov exponent for this r.
      let z = m.start, lam = 0;
      for (let i = 0; i < 300; i++) z = m.f(r, z);
      for (let i = 0; i < 2000; i++) { z = m.f(r, z); lam += Math.log(Math.abs(m.df(r, z)) + 1e-12); }
      lam /= 2000;
      const chaotic = lam > 0.001;
      webInfo.innerHTML = `r = ${r.toFixed(5)} · λ = ${lam.toFixed(3)} <span class="chip ${chaotic ? 'chaotic' : 'stable'}">${chaotic ? 'chaotic' : 'stable'}</span>`;
    }

    // ---- UI
    const hud = createHud(root, [['map', 'Map'], ['r', 'r range'], ['x', 'x range'], ['samples', 'Samples']]);
    const panel = createPanel(root, { title: 'Bifurcation Diagram', formula: MAPS[0].formula, signal });
    const formulaEl = panel.panel.querySelector('.formula');
    const aboutBox = about('');
    panel.add(
      select({ label: 'Map', options: MAPS.map((m, i) => ({ value: String(i), label: m.name })), value: '0', onChange: (v) => setMap(+v) }),
      el('div', { class: 'field' },
        el('div', { class: 'label-row' }, el('span', { class: 'label' }, 'Cobweb plot at the selected r'))),
      web,
      webInfo,
      slider({ label: 'Samples per column', min: 500, max: 20000, step: 500, value: state.target, format: (v) => v.toLocaleString('en-US'), onInput: (v) => { state.target = v; } }),
      swatches({ palettes: PALETTES, value: state.palette, onChange: (i) => { state.palette = i; buildLut(); paint(); } }),
      toggles(
        check({ label: 'Lyapunov strip', checked: true, onChange: (on) => { state.lyapunov = on; overlayDirty = true; } }),
        check({ label: 'Landmarks', checked: true, onChange: (on) => { state.marks = on; overlayDirty = true; } }),
      ),
      actions(button({ label: 'Reset view', onClick: () => resetView() })),
      note('Hover (or tap) to pick r. Drag to pan, scroll or pinch to zoom. Shift+scroll zooms only along r. Keys: <kbd>R</kbd> reset, <kbd>H</kbd> panel.'),
      aboutBox,
    );

    function setMap(i) {
      state.map = i;
      const m = MAPS[i];
      formulaEl.innerHTML = m.formula;
      aboutBox.querySelector('div').innerHTML = `<p>${m.about}</p><p>For each r along the horizontal axis, the map is iterated thousands of times and every value it visits is plotted. The cobweb plot shows those iterations for one r: bounce between the curve and the diagonal line.</p>`;
      state.hoverR = m.hover;
      resetView();
    }
    function resetView() {
      view = { ...MAPS[state.map].view };
      needsRestart = true;
      drawWeb();
    }

    // ---- input
    const pointers = new Map();
    let pinch = null;
    let moved = 0;
    const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const toPlane = ([x, y]) => [
      view.r0 + (x / canvas.clientWidth) * (view.r1 - view.r0),
      view.x1 - (y / canvas.clientHeight) * (view.x1 - view.x0),
    ];
    function zoomAt(p, fr, fx) {
      const [r, x] = toPlane(p);
      view.r0 = r + (view.r0 - r) * fr; view.r1 = r + (view.r1 - r) * fr;
      view.x0 = x + (view.x0 - x) * fx; view.x1 = x + (view.x1 - x) * fx;
      if (view.r1 - view.r0 < 1e-12 || view.x1 - view.x0 < 1e-12) Object.assign(view, prevView);
      needsRestart = true;
    }
    let prevView = { ...view };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      moved = 0;
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
      canvas.classList.add('dragging');
    }, { signal });
    canvas.addEventListener('pointermove', (e) => {
      const p = local(e);
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === 'mouse') { state.hoverR = toPlane(p)[0]; overlayDirty = true; drawWeb(); }
        return;
      }
      pointers.set(e.pointerId, p);
      prevView = { ...view };
      if (pointers.size === 1) {
        moved += Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]);
        const dr = ((p[0] - prev[0]) / canvas.clientWidth) * (view.r1 - view.r0);
        const dx = ((p[1] - prev[1]) / canvas.clientHeight) * (view.x1 - view.x0);
        view.r0 -= dr; view.r1 -= dr; view.x0 += dx; view.x1 += dx;
        needsRestart = true;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const f = pinch / d;
        zoomAt([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], f, f);
        pinch = d;
        moved = 99;
      }
    }, { signal });
    const release = (e) => {
      if (pointers.has(e.pointerId) && moved < 4) { state.hoverR = toPlane(local(e))[0]; overlayDirty = true; drawWeb(); }
      pointers.delete(e.pointerId);
      if (!pointers.size) canvas.classList.remove('dragging');
    };
    canvas.addEventListener('pointerup', release, { signal });
    canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); }, { signal });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      prevView = { ...view };
      const f = Math.exp(e.deltaY * (e.deltaMode ? 30 : 1) * 0.0015);
      zoomAt(local(e), f, e.shiftKey ? 1 : f);
    }, { passive: false, signal });
    attachKeys({ r: () => resetView(), h: () => panel.toggle() }, signal);
    window.addEventListener('resize', () => { needsRestart = true; drawWeb(); }, { signal });

    buildLut();
    setMap(0);
    requestAnimationFrame(() => drawWeb());

    startLoop(signal, () => {
      if (needsRestart) restart();
      if (samples < state.target) {
        // Fewer samples per frame right after a change keeps panning smooth.
        accumulate(samples < 400 ? 100 : 300);
        paint();
        overlayDirty = true;
      }
      if (overlayDirty) drawOverlay();
      const fmt = (a, b) => {
        const d = Math.max(2, Math.ceil(-Math.log10(b - a)) + 2);
        return `${a.toFixed(d)} … ${b.toFixed(d)}`;
      };
      hud.set('map', MAPS[state.map].name);
      hud.set('r', fmt(view.r0, view.r1));
      hud.set('x', fmt(view.x0, view.x1));
      hud.set('samples', `${samples.toLocaleString('en-US')} per column`);
    });
  },
};
