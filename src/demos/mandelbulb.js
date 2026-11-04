import { PALETTES, PALETTE_GLSL, paletteRgb } from '../shared/palettes.js';
import { startLoop, AdaptiveScale, dpr } from '../shared/loop.js';
import { attachKeys } from '../shared/panzoom.js';
import { createGL, createProgram, drawFullscreen, releaseGL, resizeCanvas, onContextLost } from '../shared/gl.js';
import {
  el, createPanel, createHud, slider, check, toggles, button, actions, note, about, swatches, showError,
} from '../shared/ui.js';

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform vec3 uCamPos;
uniform mat3 uCamRot;
uniform float uPower;
uniform int uIter;
uniform float uDetail;   // hit threshold in pixels
uniform float uOffset;
${PALETTE_GLSL}
out vec4 outColor;

const float BOUND = 1.6;

// Distance estimate to the Mandelbulb, plus an orbit trap used for colour.
float map(vec3 p, out vec4 trap) {
  vec3 w = p;
  float m = dot(w, w);
  trap = vec4(abs(w), m);
  float dz = 1.0;
  for (int i = 0; i < uIter; i++) {
    float r = sqrt(m);
    dz = uPower * pow(r, uPower - 1.0) * dz + 1.0;
    float b = uPower * acos(clamp(w.y / r, -1.0, 1.0));
    float a = uPower * atan(w.x, w.z);
    w = p + pow(r, uPower) * vec3(sin(b) * sin(a), cos(b), sin(b) * cos(a));
    trap = min(trap, vec4(abs(w), m));
    m = dot(w, w);
    if (m > 256.0) break;
  }
  return 0.25 * log(m) * sqrt(m) / dz;
}

float map(vec3 p) { vec4 t; return map(p, t); }

vec3 normalAt(vec3 p, float e) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) +
                   k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}

float softShadow(vec3 ro, vec3 rd, float k) {
  float res = 1.0;
  float t = 0.01;
  for (int i = 0; i < 48; i++) {
    float h = map(ro + rd * t);
    res = min(res, k * h / t);
    if (res < 0.01) break;
    t += clamp(h, 0.005, 0.1);
    if (t > 2.5) break;
  }
  return clamp(res, 0.0, 1.0);
}

float ambientOcclusion(vec3 p, vec3 n) {
  float occ = 0.0;
  float w = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = 0.012 + 0.06 * float(i);
    occ += (h - map(p + n * h)) * w;
    w *= 0.8;
  }
  return clamp(1.0 - 2.5 * occ, 0.0, 1.0);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uResolution) / uResolution.y;
  float pixel = 2.0 / uResolution.y / 1.8;           // ray spread per pixel (focal length 1.8)
  vec3 ro = uCamPos;
  vec3 rd = normalize(uCamRot * vec3(uv, 1.8));

  vec3 bg = mix(vec3(0.015, 0.017, 0.03), vec3(0.06, 0.07, 0.11), 0.5 + 0.5 * rd.y);

  // Clip the ray to the bounding sphere.
  float b = dot(ro, rd);
  float h = b * b - dot(ro, ro) + BOUND * BOUND;
  if (h < 0.0) { outColor = vec4(bg, 1.0); return; }
  h = sqrt(h);
  float t = max(0.0, -b - h);
  float tmax = -b + h;

  vec4 trap;
  float d = 0.0;
  int steps = 0;
  bool hit = false;
  float closest = 1e9;
  for (int i = 0; i < 220; i++) {
    steps = i;
    vec3 p = ro + rd * t;
    d = map(p, trap);
    closest = min(closest, d / t);
    if (d < uDetail * pixel * t) { hit = true; break; }
    t += d;
    if (t > tmax) break;
  }

  if (!hit) {
    // Faint glow where rays passed close to the surface.
    float glow = exp(-closest * 40.0);
    outColor = vec4(bg + palette(uOffset + 0.6) * glow * 0.25, 1.0);
    return;
  }

  vec3 p = ro + rd * t;
  vec3 n = normalAt(p, max(1e-4, pixel * t * 0.5));
  vec3 light = normalize(vec3(0.577, 0.7, -0.42));
  float dif = clamp(dot(n, light), 0.0, 1.0);
  if (dif > 0.0) dif *= softShadow(p + n * 0.002, light, 24.0);
  float occ = ambientOcclusion(p, n) * (1.0 - 0.6 * float(steps) / 220.0);
  float rim = pow(clamp(1.0 + dot(n, rd), 0.0, 1.0), 3.0);
  float spec = pow(clamp(dot(reflect(rd, n), light), 0.0, 1.0), 32.0) * dif;

  // Orbit-trap colouring: blend three palette colours by how close the
  // orbit came to each coordinate plane and to the origin.
  vec3 albedo = palette(uOffset) * 0.25;
  albedo = mix(albedo, palette(uOffset + 0.22), clamp(trap.y * 1.4, 0.0, 1.0));
  albedo = mix(albedo, palette(uOffset + 0.45), clamp(pow(trap.z, 4.0) * 3.0, 0.0, 1.0));
  albedo = mix(albedo, palette(uOffset + 0.7), clamp(pow(trap.w, 8.0), 0.0, 1.0));
  albedo *= 0.75;

  vec3 col = albedo * 0.12 * occ;                                  // ambient
  col += albedo * vec3(1.35, 1.2, 1.0) * dif * 1.6;                // key light
  col += albedo * vec3(0.35, 0.45, 0.6) * (0.5 + 0.5 * n.y) * 0.6 * occ; // sky fill
  col += albedo * vec3(0.5, 0.35, 0.25) * clamp(-n.y, 0.0, 1.0) * 0.25 * occ; // bounce
  col += palette(uOffset + 0.6) * rim * 0.25 * occ;                // rim
  col += vec3(1.0) * spec * 0.35;
  col = mix(col, bg, 1.0 - exp(-0.02 * t * t));         // a touch of depth fog
  col = pow(col, vec3(0.4545));                         // gamma
  outColor = vec4(col, 1.0);
}`;

export default {
  id: 'mandelbulb',
  title: 'Mandelbulb',
  area: 'Fractals',
  formula: 'v → v<sup>p</sup> + c in spherical coordinates',
  blurb: 'A 3D cousin of the Mandelbrot set, ray-marched in real time. Orbit around it and change the power.',

  mount(root, { signal }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Mandelbulb in 3D. Drag to orbit, scroll or pinch to move closer.' });
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

    const HOME = { yaw: 0.6, pitch: 0.35, dist: 2.6 };
    const state = {
      ...HOME, power: 8, iter: 8, detail: 1, palette: 0, offset: 0.55, quality: 0.75,
      spin: true, breathe: false, breatheT: 0,
    };

    const scaler = new AdaptiveScale({ min: 0.25 });
    let dirty = true;
    let lastInput = -Infinity;
    const markDirty = () => { dirty = true; lastInput = performance.now(); };

    const hud = createHud(root, [['power', 'Power'], ['dist', 'Distance'], ['speed', 'Speed']]);
    const panel = createPanel(root, { title: 'Mandelbulb', formula: 'v → v<sup>p</sup> + c', signal });
    const powerSlider = slider({
      label: 'Power p', min: 2, max: 16, step: 0.01, value: state.power, format: (v) => v.toFixed(2),
      onInput: (v) => { state.power = v; setBreathe(false); markDirty(); },
    });
    const spinCheck = check({ label: 'Auto-rotate', checked: true, onChange: (on) => { state.spin = on; markDirty(); } });
    const breatheCheck = check({ label: 'Morph power', checked: false, onChange: (on) => setBreathe(on) });
    function setBreathe(on) { state.breathe = on; breatheCheck.input.checked = on; markDirty(); }

    panel.add(
      powerSlider,
      slider({ label: 'Iterations', min: 2, max: 20, value: state.iter, onInput: (v) => { state.iter = v; markDirty(); } }),
      slider({ label: 'Surface detail', min: 0.25, max: 4, step: 0.05, value: 4.25 - state.detail, format: (v) => `${v.toFixed(2)}×`, onInput: (v) => { state.detail = 4.25 - v; markDirty(); } }),
      slider({ label: 'Max resolution', min: 0.3, max: 1, step: 0.05, value: state.quality, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { state.quality = v; markDirty(); } }),
      swatches({ palettes: PALETTES, value: state.palette, onChange: (i) => { state.palette = i; markDirty(); } }),
      slider({ label: 'Color shift', min: 0, max: 1000, value: state.offset * 1000, format: () => '', onInput: (v) => { state.offset = v / 1000; markDirty(); } }),
      toggles(spinCheck, breatheCheck),
      actions(button({ label: 'Reset camera', onClick: () => { Object.assign(state, HOME); markDirty(); } })),
      note('Drag to orbit. Scroll or pinch to move closer. Keys: <kbd>Space</kbd> auto-rotate, <kbd>R</kbd> reset, <kbd>H</kbd> panel. This one is heavy; lower "Max resolution" if it stutters.'),
      about(`<p>There is no true 3D version of complex multiplication, so in 2009 Daniel White and Paul Nylander borrowed one from spherical coordinates: to raise a point to the power <i>p</i>, raise its distance from the origin to <i>p</i> and multiply both of its angles by <i>p</i>. Points whose orbit stays bounded form the Mandelbulb.</p>
        <p>The surface is drawn by ray marching. A distance estimate tells each ray how far it can safely jump without passing through the surface. Color comes from an orbit trap: the closest each point's orbit came to the coordinate planes.</p>`),
    );

    // ---- orbit camera input
    const pointers = new Map();
    let pinch = 0;
    const opts = { signal };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
      canvas.classList.add('dragging');
    }, opts);
    canvas.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 1) {
        state.yaw -= (e.clientX - prev[0]) * 0.006;
        state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch + (e.clientY - prev[1]) * 0.006));
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        zoom(pinch / d);
        pinch = d;
      }
      markDirty();
    }, opts);
    const release = (e) => { pointers.delete(e.pointerId); if (!pointers.size) canvas.classList.remove('dragging'); };
    canvas.addEventListener('pointerup', release, opts);
    canvas.addEventListener('pointercancel', release, opts);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * (e.deltaMode ? 30 : 1) * 0.001)); markDirty(); }, { passive: false, signal });
    function zoom(f) {
      // Move toward the surface: scale the gap rather than the distance.
      const gap = Math.max(0.0005, state.dist - 1.05) * f;
      state.dist = Math.min(6, 1.05 + gap);
    }
    attachKeys({
      ' ': () => { state.spin = !state.spin; spinCheck.input.checked = state.spin; markDirty(); },
      r: () => { Object.assign(state, HOME); markDirty(); },
      h: () => panel.toggle(),
    }, signal);
    window.addEventListener('resize', markDirty, { signal });

    startLoop(signal, (now, dt) => {
      if (state.spin && !pointers.size) { state.yaw += dt * 0.00012; dirty = true; }
      if (state.breathe) {
        state.breatheT += dt / 1000;
        state.power = 6 - 4 * Math.cos(state.breatheT * 0.35);
        powerSlider.set(state.power);
        dirty = true;
      }
      const moving = state.spin || state.breathe || now - lastInput < 220;
      const target = scaler.update(dt, moving) * state.quality;
      const full = Math.round(canvas.clientWidth * dpr() * state.quality);
      const sharpPending = !moving && canvas.width !== full;
      if (!dirty && !sharpPending) { scaler.renderedLast = false; return; }
      resizeCanvas(canvas, dpr() * target);

      const cp = Math.cos(state.pitch);
      const pos = [state.dist * cp * Math.sin(state.yaw), state.dist * Math.sin(state.pitch), -state.dist * cp * Math.cos(state.yaw)];
      // Camera basis looking at the origin (columns: right, up, forward).
      const f = pos.map((v) => -v / state.dist);
      const r = [f[2], 0, -f[0]];
      const rl = Math.hypot(r[0], r[2]);
      r[0] /= rl; r[2] /= rl;
      const up = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
      // Flip right so screen x maps to the viewer's right.
      const right = r.map((v) => -v);

      const { u, program } = prog;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.uniform2f(u.uResolution, canvas.width, canvas.height);
      gl.uniform3fv(u.uCamPos, pos);
      gl.uniformMatrix3fv(u.uCamRot, false, [...right, ...up.map((v) => -v), ...f]);
      gl.uniform1f(u.uPower, state.power);
      gl.uniform1i(u.uIter, state.iter);
      gl.uniform1f(u.uDetail, state.detail);
      gl.uniform3fv(u.uStops, paletteRgb(state.palette));
      gl.uniform1f(u.uOffset, state.offset);
      drawFullscreen(gl);
      dirty = false;
      scaler.renderedLast = true;

      hud.set('power', state.power.toFixed(2));
      hud.set('dist', (state.dist - 1.05 < 0.01 ? (state.dist - 1.05).toExponential(1) : state.dist.toFixed(2)));
      hud.set('speed', scaler.describe(moving, target));
    });

    return () => releaseGL(gl);
  },
};
