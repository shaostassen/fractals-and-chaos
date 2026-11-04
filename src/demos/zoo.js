import { PALETTES, PALETTE_GLSL, paletteRgb } from '../shared/palettes.js';
import { createView, attachPanZoom } from '../shared/panzoom.js';
import { startLoop, AdaptiveScale, dpr } from '../shared/loop.js';
import { createGL, createProgram, drawFullscreen, releaseGL, resizeCanvas, onContextLost } from '../shared/gl.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about, swatches,
  showError, fmtZoom, fmtSigned,
} from '../shared/ui.js';

const KINDS = [
  {
    id: 'ship', name: 'Burning Ship', formula: 'z → (|Re z| + i|Im z|)² + c',
    views: [
      { name: 'Whole set', cx: -0.45, cy: 0.5, radius: 1.45 },
      { name: 'The ship', cx: -1.762, cy: 0.028, radius: 0.045 },
      { name: 'Ghost fleet', cx: -1.5803, cy: 0.0, radius: 0.012 },
    ],
    about: 'Taking absolute values of the real and imaginary parts before squaring breaks the symmetry of the Mandelbrot rule. The result looks like a burning ship, with a fleet of smaller ships along the antenna to its left.',
  },
  {
    id: 'tricorn', name: 'Tricorn', formula: 'z → z̄² + c',
    views: [
      { name: 'Whole set', cx: -0.3, cy: 0, radius: 1.5 },
      { name: 'Tricorn copy', cx: -1.7615, cy: 0.0, radius: 0.04 },
    ],
    about: 'Also called the Mandelbar set. Conjugating z before squaring gives three-fold symmetry. Its boundary has straight-looking "hairs" and copies of itself, but unlike the Mandelbrot set it is not connected along real curves.',
  },
  {
    id: 'multi', name: 'Multibrot', formula: 'z → z<sup>p</sup> + c',
    views: [{ name: 'Whole set', cx: 0, cy: 0, radius: 1.5 }],
    about: 'The Mandelbrot rule with any power p. The set has p − 1 fold symmetry. Fractional powers create a seam along the negative real axis, where the angle of z jumps. Turn on "Morph power" to sweep p continuously.',
  },
  {
    id: 'newton', name: 'Newton fractal', formula: 'z → z − a·(zⁿ − 1)/(n·zⁿ⁻¹)',
    views: [{ name: 'Whole plane', cx: 0, cy: 0, radius: 1.6 }],
    about: "Newton's method finds roots of zⁿ − 1 by repeatedly following the tangent line. Each point is colored by which of the n roots it reaches, and darker where it takes longer. The boundaries between basins are fractal: wherever two colors meet, all n meet.",
  },
];

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uPixelSize;
uniform int uKind;      // 0 ship, 1 tricorn, 2 multibrot, 3 newton
uniform int uMaxIter;
uniform float uPower;   // multibrot exponent
uniform int uDegree;    // newton degree
uniform float uRelax;   // newton relaxation
uniform float uDensity;
uniform float uOffset;
${PALETTE_GLSL}
out vec4 outColor;

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 cdiv(vec2 a, vec2 b) { return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / dot(b, b); }

vec3 escapeTime(vec2 c) {
  vec2 z = vec2(0.0);
  float p = uKind == 2 ? uPower : 2.0;
  int i;
  for (i = 0; i < uMaxIter; i++) {
    if (uKind == 0) {
      z = abs(z);
      z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    } else if (uKind == 1) {
      z = vec2(z.x * z.x - z.y * z.y, -2.0 * z.x * z.y) + c;
    } else {
      float r = length(z);
      float th = atan(z.y, z.x) * p;
      z = (r > 0.0 ? pow(r, p) : 0.0) * vec2(cos(th), sin(th)) + c;
    }
    if (dot(z, z) > 1.0e6) break;
  }
  if (i == uMaxIter) return vec3(0.012, 0.012, 0.02);
  float mu = max(float(i) + 1.0 - log(0.5 * log(dot(z, z))) / log(p), 0.0);
  return palette(sqrt(mu) * uDensity + uOffset);
}

vec3 newton(vec2 z) {
  float n = float(uDegree);
  int i;
  float step = 1.0;
  for (i = 0; i < uMaxIter; i++) {
    vec2 zn1 = vec2(1.0, 0.0);
    for (int k = 1; k < uDegree; k++) zn1 = cmul(zn1, z);
    vec2 f = cmul(zn1, z) - vec2(1.0, 0.0);
    vec2 d = uRelax * cdiv(f, n * zn1);
    z -= d;
    step = length(d);
    if (step < 1e-5) break;
  }
  if (i == uMaxIter) return vec3(0.02);
  float root = mod(floor(atan(z.y, z.x) / 6.2831853 * n + 0.5), n);
  // Fractional iteration count from how fast the last step shrank.
  float t = float(i) - log2(max(-log(step) / log(1e5), 1e-3));
  float shade = 0.18 + 0.82 * exp(-t * uDensity * 0.35);
  return palette(root / n + uOffset) * shade;
}

void main() {
  vec2 p = uCenter + (gl_FragCoord.xy - 0.5 * uResolution) * uPixelSize;
  vec3 col;
  if (uKind == 3) col = newton(p);
  else if (uKind == 0) col = escapeTime(vec2(p.x, -p.y)); // flipped so the ship sails upright
  else col = escapeTime(p);
  outColor = vec4(col, 1.0);
}`;

export default {
  id: 'zoo',
  title: 'Fractal Zoo',
  area: 'Fractals',
  formula: 'Burning Ship · Tricorn · Multibrot · Newton',
  blurb: 'Four relatives of the Mandelbrot set. Change one detail of the rule and a new world appears.',

  mount(root, { signal }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Escape-time fractal. Drag to pan, scroll or pinch to zoom.' });
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

    const state = {
      kind: 0, maxIter: 300, power: 3, morph: false, morphT: 0, degree: 3, relax: 1,
      palette: 1, density: 0.3, offset: 0,
    };
    const view = createView(canvas, { ...KINDS[0].views[0], minRadius: 1e-4, maxRadius: 4 });

    const scaler = new AdaptiveScale();
    let dirty = true;
    let lastInput = -Infinity;
    const markDirty = () => { dirty = true; lastInput = performance.now(); };

    const hud = createHud(root, [['set', 'Set'], ['center', 'Center'], ['zoom', 'Zoom'], ['speed', 'Speed']]);
    const panel = createPanel(root, { title: 'Fractal Zoo', formula: KINDS[0].formula, signal });
    const formulaEl = panel.panel.querySelector('.formula');

    const kindSelect = select({
      label: 'Fractal',
      options: KINDS.map((k, i) => ({ value: String(i), label: k.name })),
      value: '0',
      onChange: (v) => setKind(+v),
    });
    const viewSelect = select({ label: 'Location', options: [], value: '', onChange: (v) => { if (v !== '') { view.set(KINDS[state.kind].views[+v]); markDirty(); } } });
    const powerSlider = slider({
      label: 'Power p', min: 1.5, max: 8, step: 0.01, value: state.power, format: (v) => v.toFixed(2),
      onInput: (v) => { state.power = v; setMorph(false); markDirty(); },
    });
    const morphCheck = check({ label: 'Morph power', checked: false, onChange: (on) => setMorph(on) });
    powerSlider.append(morphCheck);
    const degreeSlider = slider({ label: 'Degree n', min: 3, max: 8, value: state.degree, onInput: (v) => { state.degree = v; markDirty(); } });
    const relaxSlider = slider({
      label: 'Relaxation a', min: 0.3, max: 2, step: 0.01, value: state.relax, format: (v) => v.toFixed(2),
      onInput: (v) => { state.relax = v; markDirty(); },
    });
    const aboutBox = about('');

    panel.add(
      kindSelect, viewSelect, powerSlider, degreeSlider, relaxSlider,
      slider({ label: 'Max iterations', min: 20, max: 2000, step: 10, value: state.maxIter, onInput: (v) => { state.maxIter = v; markDirty(); } }),
      swatches({ palettes: PALETTES, value: state.palette, onChange: (i) => { state.palette = i; markDirty(); } }),
      slider({ label: 'Color bands', min: 5, max: 150, value: 30, format: () => '', onInput: (v) => { state.density = v / 100; markDirty(); } }),
      slider({ label: 'Color shift', min: 0, max: 1000, value: 0, format: () => '', onInput: (v) => { state.offset = v / 1000; markDirty(); } }),
      actions(button({ label: 'Reset view', onClick: () => { view.set(KINDS[state.kind].views[0]); viewSelect.input.value = '0'; markDirty(); } })),
      note('Drag to pan, scroll or pinch to zoom, double-click to zoom in. Keys: <kbd>1</kbd>–<kbd>4</kbd> switch fractal, <kbd>R</kbd> reset, <kbd>H</kbd> panel.'),
      aboutBox,
    );

    function setMorph(on) {
      state.morph = on;
      morphCheck.input.checked = on;
      markDirty();
    }

    function setKind(i) {
      state.kind = i;
      const k = KINDS[i];
      kindSelect.input.value = String(i);
      formulaEl.innerHTML = k.formula;
      viewSelect.input.replaceChildren(
        el('option', { value: '', hidden: true }, 'Custom'),
        ...k.views.map((v, j) => el('option', { value: String(j) }, v.name)));
      viewSelect.input.value = '0';
      viewSelect.hidden = k.views.length < 2;
      powerSlider.hidden = k.id !== 'multi';
      degreeSlider.hidden = relaxSlider.hidden = k.id !== 'newton';
      if (k.id !== 'multi') setMorph(false);
      aboutBox.querySelector('div').innerHTML = `<p>${k.about}</p>`;
      view.set(k.views[0]);
      markDirty();
    }
    setKind(0);

    const keys = { r: () => { view.set(KINDS[state.kind].views[0]); markDirty(); }, h: () => panel.toggle() };
    KINDS.forEach((_, i) => { keys[String(i + 1)] = () => setKind(i); });
    attachPanZoom(canvas, view, () => { viewSelect.input.value = ''; markDirty(); }, { signal, keys });
    window.addEventListener('resize', markDirty, { signal });

    startLoop(signal, (now, dt) => {
      if (state.morph) {
        state.morphT += dt / 1000;
        state.power = 4.75 - 2.75 * Math.cos(state.morphT * 0.4);
        powerSlider.set(state.power);
        dirty = true;
      }
      const moving = state.morph || now - lastInput < 180;
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
      gl.uniform1i(u.uKind, state.kind);
      gl.uniform1i(u.uMaxIter, KINDS[state.kind].id === 'newton' ? Math.min(state.maxIter, 200) : state.maxIter);
      gl.uniform1f(u.uPower, state.power);
      gl.uniform1i(u.uDegree, state.degree);
      gl.uniform1f(u.uRelax, state.relax);
      gl.uniform3fv(u.uStops, paletteRgb(state.palette));
      gl.uniform1f(u.uDensity, state.density);
      gl.uniform1f(u.uOffset, state.offset);
      drawFullscreen(gl);
      dirty = false;
      scaler.renderedLast = true;

      const k = KINDS[state.kind];
      hud.set('set', k.id === 'multi' ? `${k.name}, p = ${state.power.toFixed(2)}` : k.id === 'newton' ? `${k.name}, n = ${state.degree}` : k.name);
      hud.set('center', `${fmtSigned(view.cx, 5)} ${fmtSigned(view.cy, 5)}i`);
      hud.set('zoom', fmtZoom(1.5 / view.radius));
      hud.set('speed', scaler.describe(moving, target));
      hud.note(view.radius <= 1.01e-4 ? 'Deepest zoom reached: 32-bit GPU precision' : '');
    });

    return () => releaseGL(gl);
  },
};
