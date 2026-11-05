import { PALETTES, PALETTE_GLSL, paletteRgb } from '../shared/palettes.js';
import { startLoop, AdaptiveScale, dpr } from '../shared/loop.js';
import { attachKeys } from '../shared/panzoom.js';
import { createGL, createProgram, drawFullscreen, releaseGL, resizeCanvas, onContextLost } from '../shared/gl.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about, swatches, showError,
} from '../shared/ui.js';

// A {p, q} tiling uses regular p-gons, q meeting at every corner. Each p-gon
// splits into 2p right triangles with angles π/p, π/q and π/2. In the Poincaré
// disk the triangle at the centre is bounded by the real axis, the line at
// angle π/p, and a circle orthogonal to the unit circle. Reflecting a point
// across those three mirrors until it lands in that triangle tells us which
// tile it is in; the number of reflections gives the colouring.

// Mirror circle: centre (d, 0), radius r, meeting the line at angle π/q and
// the unit circle at right angles (d² = 1 + r²).
export function mirrorCircle(p, q) {
  const s = Math.sin(Math.PI / p);
  const c = Math.cos(Math.PI / q);
  const d = 1 / Math.sqrt(1 - (s * s) / (c * c));
  return { d, r: (d * s) / c };
}

export const isHyperbolic = (p, q) => 1 / p + 1 / q < 0.5;

const PRESETS = [
  { p: 7, q: 3, name: 'heptagons' },
  { p: 3, q: 7, name: 'triangles' },
  { p: 5, q: 4, name: 'pentagons' },
  { p: 4, q: 5, name: 'squares' },
  { p: 6, q: 4, name: 'hexagons' },
  { p: 8, q: 3, name: 'octagons' },
  { p: 4, q: 8, name: 'squares' },
  { p: 12, q: 12, name: '12-gons' },
];

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec2 uCentre;     // disk centre in pixels
uniform float uRadius;    // disk radius in pixels
uniform vec2 uMA, uMB, uMC, uMD; // view Möbius map w = (A z + B) / (C z + D)
uniform float uAngle;     // π/p
uniform vec2 uMirror;     // (d, r)
uniform int uMode;        // 0 triangles, 1 polygons, 2 lines
uniform float uOffset;
${PALETTE_GLSL}
out vec4 outColor;

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b) { return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / dot(b, b); }
vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

void main() {
  vec2 z = (gl_FragCoord.xy - uCentre) / uRadius;
  float rr = dot(z, z);
  float px = 1.0 / uRadius;
  vec3 bg = vec3(0.02, 0.024, 0.04);
  if (rr >= 1.0) {
    float rim = smoothstep(2.5 * px, 0.0, sqrt(rr) - 1.0);
    outColor = vec4(mix(bg, vec3(0.55, 0.58, 0.68), rim * 0.6), 1.0);
    return;
  }

  vec2 w = cdiv(cmul(uMA, z) + uMB, cmul(uMC, z) + uMD);
  vec2 c = vec2(uMirror.x, 0.0);
  float r2 = uMirror.y * uMirror.y;
  int flips = 0;      // all reflections: parity colours triangles
  int crossings = 0;  // circle reflections: crossing polygon edges
  for (int i = 0; i < 200; i++) {
    // Rotate into the wedge 0 ≤ angle < 2π/p (rotations are pairs of reflections).
    float a = atan(w.y, w.x);
    float k = floor(a / (2.0 * uAngle));
    w = rot(w, -k * 2.0 * uAngle);
    if (atan(w.y, w.x) > uAngle) {
      // Reflect across the line at angle π/p.
      w = rot(vec2(w.x, -w.y), 2.0 * uAngle);
      flips++;
    }
    vec2 v = w - c;
    float dv = dot(v, v);
    if (dv >= r2) break;
    w = c + v * (r2 / dv); // inversion in the mirror circle
    flips++;
    crossings++;
  }

  // Convert distances in the folded picture to screen pixels: the maps are
  // hyperbolic isometries, so lengths scale by (1 − |z|²) / (1 − |w|²).
  float toPx = (1.0 - rr) / max(1.0 - dot(w, w), 1e-6) * uRadius;
  float edge = abs(length(w - c) - uMirror.y) * toPx;   // polygon edges
  vec2 n = vec2(-sin(uAngle), cos(uAngle));
  float spoke = min(abs(w.y), abs(dot(w, n))) * toPx;     // triangle lines
  float shade = 0.55 + 0.45 * sqrt(1.0 - rr);             // dim towards the rim

  vec3 col;
  if (uMode == 0) {
    col = (flips % 2 == 0) ? palette(uOffset + 0.3) : palette(uOffset + 0.75);
    col = mix(vec3(0.03), col, smoothstep(0.0, 1.2, edge));
    col *= shade;
  } else if (uMode == 1) {
    col = palette(uOffset + 0.137 * float(crossings));
    col *= 0.75 + 0.25 * smoothstep(0.0, 40.0, edge);    // soft bevel inside each tile
    col = mix(vec3(0.03), col, smoothstep(0.0, 1.6, edge));
    col *= shade;
  } else {
    col = bg;
    col = mix(col, palette(uOffset + 0.4) * 0.45, 1.0 - smoothstep(0.0, 1.0, spoke));
    col = mix(col, palette(uOffset + 0.65) * shade + 0.15, 1.0 - smoothstep(0.4, 1.6, edge));
  }
  outColor = vec4(col, 1.0);
}`;

// ---- complex numbers and Möbius maps of the disk, as 2×2 complex matrices
const cm = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const csqrt = ([x, y]) => {
  const r = Math.hypot(x, y);
  const re = Math.sqrt((r + x) / 2);
  const im = Math.sign(y || 1) * Math.sqrt(Math.max(0, (r - x) / 2));
  return [re, im];
};
const cdivide = (a, b) => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const identity = () => [[1, 0], [0, 0], [0, 0], [1, 0]];
// Translation of the disk sending 0 to a: z → (z + a) / (ā z + 1).
const translation = (a) => [[1, 0], [a[0], a[1]], [a[0], -a[1]], [1, 0]];
function compose(m, n) {
  const [a, b, c, d] = m;
  const [e, f, g, h] = n;
  return [cadd(cm(a, e), cm(b, g)), cadd(cm(a, f), cm(b, h)), cadd(cm(c, e), cm(d, g)), cadd(cm(c, f), cm(d, h))];
}
// Keep determinant 1 so repeated composition does not drift.
function normalizeMap(m) {
  const det = cadd(cm(m[0], m[3]), cm([-m[1][0], -m[1][1]], m[2]));
  const s = csqrt(det);
  return m.map((v) => cdivide(v, s));
}

export default {
  id: 'hyperbolic',
  title: 'Hyperbolic Tilings',
  area: 'Geometry',
  formula: '1/p + 1/q < 1/2',
  blurb: 'Seven heptagons can’t meet at a corner on a flat floor. In hyperbolic space they can, forever. Drag to travel.',

  mount(root, { signal }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Hyperbolic tiling in the Poincaré disk. Drag to move through the plane.' });
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

    const state = { p: 7, q: 3, mode: 1, palette: 4, offset: 0.1, glide: true, glideAngle: 0.3 };
    let view = identity();
    const scaler = new AdaptiveScale();
    let dirty = true;
    let lastInput = -Infinity;
    const markDirty = () => { dirty = true; lastInput = performance.now(); };

    // ---- UI
    const hud = createHud(root, [['tiling', 'Tiling'], ['corner', 'Corner'], ['area', 'Tile area'], ['speed', 'Speed']]);
    const panel = createPanel(root, { title: 'Hyperbolic Tilings', formula: '{p, q} with 1/p + 1/q < 1/2', signal });
    const presetSelect = select({
      label: 'Tiling',
      options: [{ value: '', label: 'Custom', hidden: true }, ...PRESETS.map((t, i) => ({ value: String(i), label: `{${t.p}, ${t.q}} ${t.name}` }))],
      value: '0',
      onChange: (v) => { if (v !== '') setTiling(PRESETS[+v].p, PRESETS[+v].q); },
    });
    const pSlider = slider({ label: 'Sides of each tile, p', min: 3, max: 12, value: state.p, onInput: (v) => setTiling(v, state.q, true) });
    const qSlider = slider({ label: 'Tiles at each corner, q', min: 3, max: 12, value: state.q, onInput: (v) => setTiling(state.p, v, true) });
    const glideCheck = check({ label: 'Glide', checked: true, onChange: (on) => { state.glide = on; markDirty(); } });

    panel.add(
      presetSelect, pSlider, qSlider,
      select({
        label: 'Color by',
        options: [{ value: '1', label: 'Tile' }, { value: '0', label: 'Triangle (checkerboard)' }, { value: '2', label: 'Lines only' }],
        value: String(state.mode),
        onChange: (v) => { state.mode = +v; markDirty(); },
      }),
      swatches({ palettes: PALETTES, value: state.palette, onChange: (i) => { state.palette = i; markDirty(); } }),
      slider({ label: 'Color shift', min: 0, max: 1000, value: state.offset * 1000, format: () => '', onInput: (v) => { state.offset = v / 1000; markDirty(); } }),
      toggles(glideCheck),
      actions(button({ label: 'Back to the center', primary: true, onClick: () => { view = identity(); markDirty(); } })),
      note('Drag inside the disk to travel. Keys: <kbd>Space</kbd> glide, <kbd>R</kbd> back to the center, <kbd>H</kbd> panel.'),
      about(`<p>On a flat floor, the corners of tiles meeting at a point must add up to 360°. That allows only three regular tilings: triangles, squares and hexagons. In the hyperbolic plane the angles of a polygon add up to less than on a flat surface, so seven triangles or three heptagons fit around a point. A {<i>p</i>, <i>q</i>} tiling, with <i>q</i> regular <i>p</i>-gons at each corner, is hyperbolic exactly when 1/<i>p</i> + 1/<i>q</i> < 1/2.</p>
        <p>This is the Poincaré disk model of the whole infinite hyperbolic plane. Every tile is the same size; they only look smaller toward the rim, which is infinitely far away. Straight lines appear as circular arcs that meet the rim at right angles. Dragging applies a hyperbolic translation, which moves tiles from the rim to the center without changing them.</p>
        <p>Each tile's area is fixed by its angles (Gauss–Bonnet): (<i>p</i> − 2)π − 2π<i>p</i>/<i>q</i>. M. C. Escher's <i>Circle Limit</i> prints, made with help from the geometer H. S. M. Coxeter, use these tilings.</p>`),
    );

    function setTiling(p, q, fromSlider = false) {
      state.p = p; state.q = q;
      pSlider.set(p); qSlider.set(q);
      if (fromSlider) {
        const i = PRESETS.findIndex((t) => t.p === p && t.q === q);
        presetSelect.input.value = i >= 0 ? String(i) : '';
      }
      markDirty();
    }

    // ---- dragging = hyperbolic translation
    const geometry = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const rect = panel.panel.hidden ? null : panel.panel.getBoundingClientRect();
      const visibleW = rect && rect.left > w * 0.4 ? rect.left - 12 : w;
      return { cx: visibleW / 2, cy: h / 2, radius: Math.min(visibleW, h) * 0.46 };
    };
    const toDisk = (e) => {
      const r = canvas.getBoundingClientRect();
      const g = geometry();
      const x = (e.clientX - r.left - g.cx) / g.radius;
      const y = -(e.clientY - r.top - g.cy) / g.radius;
      const len = Math.hypot(x, y);
      return len > 0.97 ? [(x / len) * 0.97, (y / len) * 0.97] : [x, y];
    };
    let dragFrom = null;
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); dragFrom = toDisk(e); canvas.classList.add('dragging'); }, { signal });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragFrom) return;
      const to = toDisk(e);
      // The tile under dragFrom should now sit under `to`: V ← V ∘ T(from) ∘ T(−to).
      view = normalizeMap(compose(compose(view, translation(dragFrom)), translation([-to[0], -to[1]])));
      dragFrom = to;
      markDirty();
    }, { signal });
    const release = () => { dragFrom = null; canvas.classList.remove('dragging'); };
    canvas.addEventListener('pointerup', release, { signal });
    canvas.addEventListener('pointercancel', release, { signal });
    attachKeys({
      ' ': () => { state.glide = !state.glide; glideCheck.input.checked = state.glide; markDirty(); },
      r: () => { view = identity(); markDirty(); },
      h: () => { panel.toggle(); markDirty(); },
    }, signal);
    window.addEventListener('resize', markDirty, { signal });

    let last = { p: state.p, q: state.q };

    startLoop(signal, (now, dt) => {
      if (state.glide && !dragFrom) {
        // Drift along a slowly turning direction.
        state.glideAngle += dt * 0.00007;
        const v = dt * 0.00012;
        view = normalizeMap(compose(view, translation([v * Math.cos(state.glideAngle), v * Math.sin(state.glideAngle)])));
        dirty = true;
      }
      const moving = state.glide || dragFrom || now - lastInput < 180;
      const target = scaler.update(dt, moving);
      const sharpPending = !moving && canvas.width !== Math.round(canvas.clientWidth * dpr());
      if (!dirty && !sharpPending) { scaler.renderedLast = false; return; }
      resizeCanvas(canvas, dpr() * target);

      // Draw the last valid tiling if the sliders describe a flat or spherical one.
      const valid = isHyperbolic(state.p, state.q);
      if (valid) last = { p: state.p, q: state.q };
      const { p, q } = last;
      const mirror = mirrorCircle(p, q);
      const g = geometry();
      const k = canvas.width / canvas.clientWidth;

      const { u, program } = prog;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.uniform2f(u.uResolution, canvas.width, canvas.height);
      gl.uniform2f(u.uCentre, g.cx * k, canvas.height - g.cy * k);
      gl.uniform1f(u.uRadius, g.radius * k);
      gl.uniform2fv(u.uMA, view[0]);
      gl.uniform2fv(u.uMB, view[1]);
      gl.uniform2fv(u.uMC, view[2]);
      gl.uniform2fv(u.uMD, view[3]);
      gl.uniform1f(u.uAngle, Math.PI / p);
      gl.uniform2f(u.uMirror, mirror.d, mirror.r);
      gl.uniform1i(u.uMode, state.mode);
      gl.uniform1f(u.uOffset, state.offset);
      gl.uniform3fv(u.uStops, paletteRgb(state.palette));
      drawFullscreen(gl);
      dirty = false;
      scaler.renderedLast = true;

      const area = (p - 2) * Math.PI - (2 * Math.PI * p) / q;
      hud.set('tiling', `{${p}, ${q}}`);
      hud.set('corner', `${(360 / q).toFixed(1)}°, flat ${p}-gon: ${(((p - 2) * 180) / p).toFixed(1)}°`);
      hud.set('area', area.toFixed(3));
      hud.set('speed', scaler.describe(moving, target));
      hud.note(valid ? '' : `{${state.p}, ${state.q}} is not hyperbolic: 1/p + 1/q must be less than 1/2. ${
        1 / state.p + 1 / state.q === 0.5 ? 'It tiles the flat plane.' : 'It wraps around a sphere.'} Showing {${p}, ${q}}.`);
    });

    return () => releaseGL(gl);
  },
};
