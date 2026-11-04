import { PALETTES, PALETTE_GLSL, paletteRgb, samplePalette } from '../shared/palettes.js';
import { createView, attachPanZoom } from '../shared/panzoom.js';
import { startLoop, AdaptiveScale, dpr } from '../shared/loop.js';
import { createGL, createProgram, drawFullscreen, releaseGL, resizeCanvas, onContextLost } from '../shared/gl.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about, swatches,
  showError, fmtZoom, fmtSigned,
} from '../shared/ui.js';

const PRESETS = [
  { name: 'Douady rabbit', c: [-0.123, 0.745] },
  { name: 'Dragon', c: [-0.8, 0.156] },
  { name: 'Spiral galaxy', c: [-0.7269, 0.1889] },
  { name: 'Siegel disk', c: [-0.390541, -0.586788] },
  { name: 'Dendrite', c: [0, 1] },
  { name: 'San Marco', c: [-0.75, 0] },
  { name: 'Seahorse', c: [-0.745, 0.113] },
  { name: 'Fatou dust', c: [0.3, 0.5] },
];

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uPixelSize;
uniform vec2 uC;
uniform int uMaxIter;
uniform float uDensity;
uniform float uOffset;
uniform float uShading;
${PALETTE_GLSL}
out vec4 outColor;

void main() {
  vec2 z = uCenter + (gl_FragCoord.xy - 0.5 * uResolution) * uPixelSize;
  vec2 der = vec2(uPixelSize, 0.0); // dz/dz0 in pixel units
  int i;
  bool escaped = false;
  for (i = 0; i < uMaxIter; i++) {
    der = 2.0 * vec2(z.x * der.x - z.y * der.y, z.x * der.y + z.y * der.x);
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + uC;
    if (dot(z, z) > 1.0e6) { escaped = true; break; }
  }
  if (!escaped) {
    // Interior: faint tint from where the orbit ended up.
    outColor = vec4(palette(uOffset + 0.5 + 0.08 * length(z)) * 0.07, 1.0);
    return;
  }
  float logZ = 0.5 * log(dot(z, z));
  float mu = max(float(i) + 1.0 - log2(logZ), 0.0);
  vec3 col = palette(sqrt(mu) * uDensity + uOffset);
  float dePx = length(z) * logZ / max(length(der), 1e-30);
  col *= mix(1.0, 0.15 + 0.85 * clamp(pow(dePx * 0.75, 0.4), 0.0, 1.0), uShading);
  outColor = vec4(col, 1.0);
}`;

// Is c in the Mandelbrot set? Then its Julia set is connected.
function inMandelbrot(cr, ci, maxIter = 1000) {
  let x = 0;
  let y = 0;
  for (let i = 0; i < maxIter; i++) {
    const nx = x * x - y * y + cr;
    y = 2 * x * y + ci;
    x = nx;
    if (x * x + y * y > 4) return false;
  }
  return true;
}

// Map shown in the panel: the Mandelbrot set, where you pick c.
const MAP = { re0: -2.2, re1: 0.8, im0: -1.25, im1: 1.25 };

export default {
  id: 'julia',
  title: 'Julia Sets',
  area: 'Fractals',
  formula: 'z<sub>n+1</sub> = z<sub>n</sub>² + c, fixed c',
  blurb: 'Pick c on a live Mandelbrot map and watch the Julia set reshape. Animate c to morph through them.',

  mount(root, { signal, params }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Julia set. Drag to pan, scroll or pinch to zoom.' });
    root.append(canvas);
    let gl;
    let prog;
    try {
      gl = createGL(canvas);
      prog = createProgram(gl, FRAG);
    } catch (err) {
      showError(root, err.message);
      return;
    }
    onContextLost(canvas, root, signal, showError);

    const HOME = { cx: 0, cy: 0, radius: 1.6 };
    const view = createView(canvas, { ...HOME, minRadius: 1e-4, maxRadius: 4 });
    const state = {
      c: params.c ? [...params.c] : [...PRESETS[0].c],
      maxIter: 400, palette: 2, density: 0.3, offset: 0.1, shading: true, animate: false, t: 0,
    };

    const scaler = new AdaptiveScale();
    let dirty = true;
    let lastInput = -Infinity;
    const markDirty = () => { dirty = true; lastInput = performance.now(); };

    const hud = createHud(root, [['c', 'c'], ['set', 'Shape'], ['zoom', 'Zoom'], ['speed', 'Speed']]);

    // ---- c picker map
    const map = el('canvas', { class: 'inset pick', 'aria-label': 'Mandelbrot map. Click or drag to choose c.' });
    let mapImage = null;
    function renderMap() {
      const w = (map.width = Math.round(map.clientWidth * dpr()));
      const h = (map.height = Math.round(w * (MAP.im1 - MAP.im0) / (MAP.re1 - MAP.re0)));
      const ctx = map.getContext('2d');
      const img = ctx.createImageData(w, h);
      for (let py = 0; py < h; py++) {
        const ci = MAP.im1 - (py / h) * (MAP.im1 - MAP.im0);
        for (let px = 0; px < w; px++) {
          const cr = MAP.re0 + (px / w) * (MAP.re1 - MAP.re0);
          let x = 0, y = 0, i = 0;
          for (; i < 80 && x * x + y * y < 16; i++) { const nx = x * x - y * y + cr; y = 2 * x * y + ci; x = nx; }
          const k = 4 * (py * w + px);
          if (i === 80) { img.data[k] = 20; img.data[k + 1] = 22; img.data[k + 2] = 30; } else {
            const [r, g, b] = samplePalette(state.palette, Math.sqrt(i) * 0.3);
            const fade = 0.25 + 0.5 * Math.min(1, i / 30);
            img.data[k] = r * 255 * fade; img.data[k + 1] = g * 255 * fade; img.data[k + 2] = b * 255 * fade;
          }
          img.data[k + 3] = 255;
        }
      }
      mapImage = img;
    }
    function drawMap() {
      if (!mapImage) renderMap();
      const ctx = map.getContext('2d');
      ctx.putImageData(mapImage, 0, 0);
      const x = ((state.c[0] - MAP.re0) / (MAP.re1 - MAP.re0)) * map.width;
      const y = ((MAP.im1 - state.c[1]) / (MAP.im1 - MAP.im0)) * map.height;
      const s = dpr();
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath(); ctx.arc(x, y, 6 * s, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 11 * s, y); ctx.lineTo(x - 7 * s, y); ctx.moveTo(x + 7 * s, y); ctx.lineTo(x + 11 * s, y);
      ctx.moveTo(x, y - 11 * s); ctx.lineTo(x, y - 7 * s); ctx.moveTo(x, y + 7 * s); ctx.lineTo(x, y + 11 * s);
      ctx.stroke();
    }
    let picking = false;
    const pick = (e) => {
      const r = map.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      setC([MAP.re0 + fx * (MAP.re1 - MAP.re0), MAP.im1 - fy * (MAP.im1 - MAP.im0)]);
    };
    map.addEventListener('pointerdown', (e) => { picking = true; map.setPointerCapture(e.pointerId); pick(e); }, { signal });
    map.addEventListener('pointermove', (e) => { if (picking) pick(e); }, { signal });
    map.addEventListener('pointerup', () => { picking = false; }, { signal });

    function setC(c, fromPreset = false) {
      state.c = c;
      if (!fromPreset) preset.input.value = '';
      if (state.animate && !fromPreset) setAnimate(false);
      drawMap();
      markDirty();
    }

    // ---- panel
    const panel = createPanel(root, { title: 'Julia Sets', formula: 'z → z² + c', signal });
    const preset = select({
      label: 'Preset',
      options: [{ value: '', label: 'Custom', hidden: true }, ...PRESETS.map((p, i) => ({ value: String(i), label: p.name }))],
      value: params.c ? '' : '0',
      onChange: (v) => { if (v !== '') { setAnimate(false); setC([...PRESETS[+v].c], true); } },
    });
    const animBtn = button({ label: 'Animate c', primary: true, onClick: () => setAnimate(!state.animate) });
    function setAnimate(on) {
      state.animate = on;
      animBtn.textContent = on ? 'Stop animation' : 'Animate c';
      animBtn.setAttribute('aria-pressed', String(on));
      if (on) preset.input.value = '';
      markDirty();
    }

    panel.add(
      el('div', { class: 'field' },
        el('div', { class: 'label-row' }, el('span', { class: 'label' }, 'Choose c on the Mandelbrot set'))),
      map,
      preset,
      slider({ label: 'Max iterations', min: 50, max: 3000, step: 10, value: state.maxIter, onInput: (v) => { state.maxIter = v; markDirty(); } }),
      swatches({ palettes: PALETTES, value: state.palette, onChange: (i) => { state.palette = i; mapImage = null; drawMap(); markDirty(); } }),
      slider({ label: 'Color bands', min: 5, max: 150, value: 30, format: () => '', onInput: (v) => { state.density = v / 100; markDirty(); } }),
      toggles(check({ label: 'Edge shading', checked: true, onChange: (on) => { state.shading = on; markDirty(); } })),
      actions(
        animBtn,
        button({ label: 'Reset view', onClick: () => { view.set(HOME); markDirty(); } }),
        button({ label: 'Random c', onClick: () => {
          // A random point just around the main cardioid or the period-2 bulb,
          // near the boundary where Julia sets are most intricate.
          const t = Math.random() * Math.PI * 2;
          const s = 0.92 + Math.random() * 0.16;
          setC(Math.random() < 0.65
            ? [s * (Math.cos(t) / 2 - Math.cos(2 * t) / 4), s * (Math.sin(t) / 2 - Math.sin(2 * t) / 4)]
            : [-1 + 0.25 * s * Math.cos(t), 0.25 * s * Math.sin(t)]);
        } }),
      ),
      note('Drag on the map to move c. Drag the main view to pan, scroll or pinch to zoom. Keys: <kbd>Space</kbd> animate, <kbd>R</kbd> reset, <kbd>H</kbd> panel.'),
      about(`<p>The Mandelbrot set and Julia sets use the same rule, <i>z</i> → <i>z</i>² + <i>c</i>. The Mandelbrot set varies <i>c</i> and always starts at <i>z</i> = 0. A Julia set fixes one <i>c</i> and varies the starting point <i>z</i>.</p>
        <p>The Mandelbrot set is a map of all Julia sets. When <i>c</i> is inside it (black on the map), the Julia set is one connected piece. Outside, it shatters into infinitely many separate points, called Fatou dust. The most intricate shapes come from points near the boundary.</p>`),
    );

    attachPanZoom(canvas, view, markDirty, {
      signal,
      keys: {
        r: () => { view.set(HOME); markDirty(); },
        h: () => panel.toggle(),
        ' ': () => setAnimate(!state.animate),
      },
    });
    window.addEventListener('resize', () => { mapImage = null; drawMap(); markDirty(); }, { signal });
    requestAnimationFrame(() => drawMap());

    startLoop(signal, (now, dt) => {
      if (state.animate) {
        // Trace a path just outside the main cardioid, where shapes change fastest.
        state.t += dt * 0.00012;
        const t = state.t * Math.PI * 2;
        const s = 1.02 + 0.05 * Math.sin(3 * t);
        state.c = [s * (Math.cos(t) / 2 - Math.cos(2 * t) / 4), s * (Math.sin(t) / 2 - Math.sin(2 * t) / 4)];
        drawMap();
        dirty = true;
      }
      const moving = state.animate || picking || now - lastInput < 180;
      const target = scaler.update(dt, moving);
      const sharpPending = !moving && canvas.width !== Math.round(canvas.clientWidth * dpr());
      if (!dirty && !sharpPending) { scaler.renderedLast = false; return; }
      resizeCanvas(canvas, dpr() * target);

      const { u, program } = prog;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.uniform2f(u.uResolution, canvas.width, canvas.height);
      gl.uniform2f(u.uCenter, view.cx, view.cy);
      gl.uniform1f(u.uPixelSize, (2 * view.radius) / Math.min(canvas.width, canvas.height));
      gl.uniform2f(u.uC, state.c[0], state.c[1]);
      gl.uniform1i(u.uMaxIter, state.maxIter);
      gl.uniform3fv(u.uStops, paletteRgb(state.palette));
      gl.uniform1f(u.uDensity, state.density);
      gl.uniform1f(u.uOffset, state.offset);
      gl.uniform1f(u.uShading, state.shading ? 1 : 0);
      drawFullscreen(gl);
      dirty = false;
      scaler.renderedLast = true;

      hud.set('c', `${fmtSigned(state.c[0], 5)} ${state.c[1] < 0 ? '−' : '+'} ${Math.abs(state.c[1]).toFixed(5)}i`);
      hud.set('set', inMandelbrot(state.c[0], state.c[1]) ? 'connected (c in M)' : 'dust (c outside M)');
      hud.set('zoom', fmtZoom(1.6 / view.radius));
      hud.set('speed', scaler.describe(moving, target));
      hud.note(view.radius <= 1.01e-4 ? 'Deepest zoom reached: 32-bit GPU precision' : '');
    });

    return () => releaseGL(gl);
  },
};
