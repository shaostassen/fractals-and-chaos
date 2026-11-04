import { PALETTES, PALETTE_GLSL, paletteRgb } from '../shared/palettes.js';
import { startLoop, dpr } from '../shared/loop.js';
import { attachKeys } from '../shared/panzoom.js';
import { createGL, createProgram, drawFullscreen, releaseGL, resizeCanvas, onContextLost } from '../shared/gl.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about, swatches, showError, sci,
} from '../shared/ui.js';

// Each system: derivative f(x, y, z, params) -> [dx, dy, dz], a time step, and
// a centre and scale that frame it nicely (z is drawn as "up").
const SYSTEMS = [
  {
    id: 'lorenz', name: 'Lorenz', formula: 'ẋ = σ(y − x), ẏ = x(ρ − z) − y, ż = xy − βz',
    params: [
      { key: 's', label: 'σ (sigma)', min: 1, max: 20, step: 0.1, value: 10 },
      { key: 'r', label: 'ρ (rho)', min: 0.5, max: 60, step: 0.1, value: 28 },
      { key: 'b', label: 'β (beta)', min: 0.5, max: 5, step: 0.01, value: 8 / 3 },
    ],
    f: (x, y, z, p, o) => { o[0] = p.s * (y - x); o[1] = x * (p.r - z) - y; o[2] = x * y - p.b * z; },
    dt: 0.004, center: [0, 0, 25], scale: 1 / 24, seed: [1, 1, 20], lyapunov: 0.906,
    about: 'Edward Lorenz found this in 1963 while simplifying a model of convection in the atmosphere. Rounding one number from 0.506127 to 0.506 sent his weather simulation somewhere completely different, the observation that became the "butterfly effect". Orbits circle one lobe, then the other, in a sequence that never repeats. Drop ρ below about 24.74 and the chaos stops: orbits settle onto a fixed point.',
  },
  {
    id: 'rossler', name: 'Rössler', formula: 'ẋ = −y − z, ẏ = x + ay, ż = b + z(x − c)',
    params: [
      { key: 'a', label: 'a', min: 0, max: 0.4, step: 0.001, value: 0.2 },
      { key: 'b', label: 'b', min: 0.05, max: 2, step: 0.01, value: 0.2 },
      { key: 'c', label: 'c', min: 1, max: 14, step: 0.01, value: 5.7 },
    ],
    f: (x, y, z, p, o) => { o[0] = -y - z; o[1] = x + p.a * y; o[2] = p.b + z * (x - p.c); },
    dt: 0.012, center: [0, 0, 6], scale: 1 / 13, seed: [1, 1, 0], lyapunov: 0.071,
    about: 'Otto Rössler designed this in 1976 as the simplest possible chaotic flow, with a single nonlinear term (zx). Orbits spiral outward in the flat x–y plane, then get flung upward and folded back to the centre. Stretching and folding, repeated forever, is the basic recipe of chaos. Lower c to about 4 to watch the period-doubling route into chaos.',
  },
  {
    id: 'aizawa', name: 'Aizawa', formula: 'ż = c + az − z³/3 − (x² + y²)(1 + ez) + fzx³',
    params: [
      { key: 'a', label: 'a', min: 0.5, max: 1.2, step: 0.005, value: 0.95 },
      { key: 'd', label: 'd', min: 2, max: 5, step: 0.01, value: 3.5 },
      { key: 'f', label: 'f', min: 0, max: 0.3, step: 0.002, value: 0.1 },
    ],
    f: (x, y, z, p, o) => {
      const b = 0.7, c = 0.6, e = 0.25;
      o[0] = (z - b) * x - p.d * y;
      o[1] = p.d * x + (z - b) * y;
      o[2] = c + p.a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + p.f * z * x * x * x;
    },
    dt: 0.008, center: [0, 0, 0.55], scale: 1 / 1.35, seed: [0.1, 0, 0], lyapunov: null,
    about: 'Orbits wind around a sphere-like surface and escape through a tube along its axis, then fall back around the outside. The x and y equations are ẋ = (z − b)x − dy and ẏ = dx + (z − b)y: a rotation whose radius depends on height.',
  },
  {
    id: 'thomas', name: 'Thomas', formula: 'ẋ = sin y − bx, ẏ = sin z − by, ż = sin x − bz',
    params: [{ key: 'b', label: 'b (friction)', min: 0.05, max: 0.33, step: 0.0005, value: 0.208186 }],
    f: (x, y, z, p, o) => { o[0] = Math.sin(y) - p.b * x; o[1] = Math.sin(z) - p.b * y; o[2] = Math.sin(x) - p.b * z; },
    dt: 0.05, center: [0, 0, 0], scale: 1 / 4.2, seed: [0.1, 0, -0.1], lyapunov: null,
    about: "René Thomas's cyclically symmetric attractor: swap x→y→z and the rules stay the same. b is a friction term. Near 0.21 the motion is chaotic; as b falls toward 0 the orbits become a 3D random walk through an infinite lattice, and above about 0.33 they collapse to a point.",
  },
  {
    id: 'halvorsen', name: 'Halvorsen', formula: 'ẋ = −ax − 4y − 4z − y² (and cyclic)',
    params: [{ key: 'a', label: 'a', min: 1.2, max: 2.2, step: 0.005, value: 1.89 }],
    f: (x, y, z, p, o) => {
      o[0] = -p.a * x - 4 * y - 4 * z - y * y;
      o[1] = -p.a * y - 4 * z - 4 * x - z * z;
      o[2] = -p.a * z - 4 * x - 4 * y - x * x;
    },
    dt: 0.004, center: [-3.5, -3.5, -3.5], scale: 1 / 8.5, seed: [-1.48, -1.51, 2.04], lyapunov: 0.8,
    about: 'Another cyclically symmetric system, with three interlocking wings at 120° to each other. The equations for y and z are the x equation with the variables rotated.',
  },
];

const POINT_VS = `#version 300 es
in vec3 aPos;
in float aTone;
uniform mat3 uRot;
uniform float uZoom;
uniform vec2 uAspect;
uniform float uPointSize;
${PALETTE_GLSL}
out vec3 vColor;
void main() {
  vec3 p = uRot * aPos;
  float persp = 2.6 / (2.6 + p.z);
  gl_Position = vec4(p.xy * uZoom * persp * uAspect, 0.0, 1.0);
  gl_PointSize = uPointSize * persp;
  vColor = palette(aTone);
}`;

const POINT_FS = `#version 300 es
precision highp float;
in vec3 vColor;
uniform float uIntensity;
out vec4 outColor;
void main() {
  float a = smoothstep(0.5, 0.15, length(gl_PointCoord - 0.5));
  outColor = vec4(vColor * a * uIntensity, 1.0);
}`;

const FADE_FS = `#version 300 es
precision highp float;
out vec4 outColor;
void main() { outColor = vec4(0.0); }`;

const PRESENT_FS = `#version 300 es
precision highp float;
uniform sampler2D uAcc;
uniform vec3 uBg;
uniform float uExposure;
out vec4 outColor;
void main() {
  vec3 acc = texelFetch(uAcc, ivec2(gl_FragCoord.xy), 0).rgb;
  outColor = vec4(uBg + (1.0 - exp(-acc * uExposure)), 1.0);
}`;

const COUNTS = [2000, 10000, 30000, 60000];

export default {
  id: 'attractors',
  title: 'Strange Attractors',
  area: 'Chaos',
  formula: 'Lorenz · Rössler · Aizawa · Thomas · Halvorsen',
  blurb: 'Tens of thousands of particles flowing through chaotic systems. Start them a millionth apart and watch them split.',

  mount(root, { signal }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Strange attractor particles. Drag to rotate, scroll or pinch to zoom.' });
    root.append(canvas);
    let gl;
    let points;
    let fade;
    let present;
    try {
      gl = createGL(canvas);
      points = createProgram(gl, POINT_FS, POINT_VS);
      fade = createProgram(gl, FADE_FS);
      present = createProgram(gl, PRESENT_FS);
    } catch (err) {
      showError(root, err.message);
      return;
    }
    onContextLost(canvas, root, signal, showError);
    const floatTargets = !!gl.getExtension('EXT_color_buffer_float');

    const state = {
      sys: 0, params: {}, count: 30000, speed: 1, trail: 0.88, brightness: 1, palette: 4,
      colorBy: 'speed', mode: 'cloud', yaw: 0.5, pitch: 0.25, zoom: 1, spin: true, paused: false, t: 0,
    };

    // ---- particle buffers
    let n = 0;
    let pos = new Float64Array(0);   // simulation state
    let world = new Float32Array(0); // positions for the GPU
    let tone = new Float32Array(0);  // palette coordinate per particle
    let speedMax = 1;

    const vao = gl.createVertexArray();
    const posBuf = gl.createBuffer();
    const toneBuf = gl.createBuffer();
    gl.bindVertexArray(vao);
    const aPos = gl.getAttribLocation(points.program, 'aPos');
    const aTone = gl.getAttribLocation(points.program, 'aTone');
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, toneBuf);
    gl.enableVertexAttribArray(aTone);
    gl.vertexAttribPointer(aTone, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const k1 = new Float64Array(3), k2 = new Float64Array(3), k3 = new Float64Array(3), k4 = new Float64Array(3);
    function rk4(sys, p, i, dt) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      sys.f(x, y, z, p, k1);
      sys.f(x + k1[0] * dt / 2, y + k1[1] * dt / 2, z + k1[2] * dt / 2, p, k2);
      sys.f(x + k2[0] * dt / 2, y + k2[1] * dt / 2, z + k2[2] * dt / 2, p, k3);
      sys.f(x + k3[0] * dt, y + k3[1] * dt, z + k3[2] * dt, p, k4);
      pos[i] = x + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      pos[i + 1] = y + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      pos[i + 2] = z + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    }

    // Place particles. 'cloud': spread along one long trajectory, so the
    // attractor is filled at once. 'butterfly': all within 1e-6 of one point.
    function reset() {
      const sys = SYSTEMS[state.sys];
      n = state.count;
      pos = new Float64Array(n * 3);
      world = new Float32Array(n * 3);
      tone = new Float32Array(n);
      // Settle one particle onto the attractor first.
      pos.set(sys.seed);
      for (let s = 0; s < 3000; s++) rk4(sys, state.params, 0, sys.dt);
      const start = [pos[0], pos[1], pos[2]];
      if (state.mode === 'cloud') {
        for (let i = 1; i < n; i++) {
          pos[3 * i] = pos[3 * i - 3]; pos[3 * i + 1] = pos[3 * i - 2]; pos[3 * i + 2] = pos[3 * i - 1];
          for (let s = 0; s < 3; s++) rk4(sys, state.params, 3 * i, sys.dt);
        }
      } else {
        for (let i = 0; i < n; i++) {
          // Points on a tiny line segment, so colour order matches starting order.
          const off = ((i / Math.max(1, n - 1)) - 0.5) * 2e-6;
          pos[3 * i] = start[0] + off; pos[3 * i + 1] = start[1] + off * 0.5; pos[3 * i + 2] = start[2];
        }
      }
      for (let i = 0; i < n; i++) tone[i] = i / n;
      speedMax = 1;
      state.t = 0;
      clearTrails = true;
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, world.byteLength, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, toneBuf);
      gl.bufferData(gl.ARRAY_BUFFER, tone, gl.DYNAMIC_DRAW);
    }

    function step(dtReal) {
      const sys = SYSTEMS[state.sys];
      const p = state.params;
      // Fixed simulation step; how many per frame sets the playback speed.
      const steps = Math.max(1, Math.round(state.speed * 4 * Math.min(dtReal, 50) / 16.7));
      for (let s = 0; s < steps; s++) {
        for (let i = 0; i < n * 3; i += 3) rk4(sys, p, i, sys.dt);
      }
      state.t += steps * sys.dt;
    }

    function upload() {
      const sys = SYSTEMS[state.sys];
      const [cx, cy, cz] = sys.center;
      const s = sys.scale;
      const byIndex = state.colorBy === 'index';
      let max = 0;
      for (let i = 0, j = 0; i < n; i++, j += 3) {
        const x = pos[j], y = pos[j + 1], z = pos[j + 2];
        // Guard against runaway parameters.
        if (!Number.isFinite(x + y + z) || Math.abs(x) + Math.abs(y) + Math.abs(z) > 1e6) {
          pos[j] = sys.seed[0] + Math.random() * 1e-3; pos[j + 1] = sys.seed[1]; pos[j + 2] = sys.seed[2];
          continue;
        }
        world[j] = (x - cx) * s;
        world[j + 1] = (z - cz) * s;
        world[j + 2] = (y - cy) * s;
        if (!byIndex) {
          sys.f(x, y, z, state.params, k1);
          const v = Math.hypot(k1[0], k1[1], k1[2]) * s;
          if (v > max) max = v;
          tone[i] = Math.min(0.999, v / speedMax) * 0.85;
        }
      }
      if (!byIndex) speedMax = speedMax * 0.95 + Math.max(max, 1e-6) * 0.05;
      else for (let i = 0; i < n; i++) tone[i] = i / n;
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, world);
      gl.bindBuffer(gl.ARRAY_BUFFER, toneBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, tone);
    }

    // Root-mean-square distance from the centroid, in system units.
    function spread() {
      let mx = 0, my = 0, mz = 0;
      for (let j = 0; j < n * 3; j += 3) { mx += pos[j]; my += pos[j + 1]; mz += pos[j + 2]; }
      mx /= n; my /= n; mz /= n;
      let s = 0;
      for (let j = 0; j < n * 3; j += 3) s += (pos[j] - mx) ** 2 + (pos[j + 1] - my) ** 2 + (pos[j + 2] - mz) ** 2;
      return Math.sqrt(s / n);
    }

    // ---- accumulation target (float if possible, so trails fade cleanly)
    let fbo = null;
    let accTex = null;
    let clearTrails = true;
    function ensureTarget() {
      if (accTex && accTex.w === canvas.width && accTex.h === canvas.height) return;
      if (accTex) gl.deleteTexture(accTex);
      if (fbo) gl.deleteFramebuffer(fbo);
      accTex = gl.createTexture();
      accTex.w = canvas.width;
      accTex.h = canvas.height;
      gl.bindTexture(gl.TEXTURE_2D, accTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texStorage2D(gl.TEXTURE_2D, 1, floatTargets ? gl.RGBA16F : gl.RGBA8, canvas.width, canvas.height);
      fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accTex, 0);
      clearTrails = true;
    }

    // ---- UI
    const hud = createHud(root, [['sys', 'System'], ['n', 'Particles'], ['t', 'Time'], ['spread', 'Spread']]);
    const panel = createPanel(root, { title: 'Strange Attractors', formula: SYSTEMS[0].formula, signal });
    const formulaEl = panel.panel.querySelector('.formula');
    const paramBox = el('div', { class: 'panel-body' });
    const aboutBox = about('');
    const modeBtn = button({ label: 'Butterfly effect', primary: true, onClick: () => setMode(state.mode === 'cloud' ? 'butterfly' : 'cloud') });
    const pauseBtn = button({ label: 'Pause', onClick: () => setPaused(!state.paused) });
    const colorSelect = select({
      label: 'Color by',
      options: [{ value: 'speed', label: 'Speed' }, { value: 'index', label: 'Starting position' }],
      value: state.colorBy,
      onChange: (v) => { state.colorBy = v; },
    });

    panel.add(
      select({
        label: 'System', options: SYSTEMS.map((s, i) => ({ value: String(i), label: s.name })), value: '0',
        onChange: (v) => setSystem(+v),
      }),
      paramBox,
      select({
        label: 'Particles', options: COUNTS.map((c) => ({ value: String(c), label: c.toLocaleString('en-US') })), value: String(state.count),
        onChange: (v) => { state.count = +v; reset(); },
      }),
      colorSelect,
      slider({ label: 'Speed', min: 0.1, max: 4, step: 0.05, value: state.speed, format: (v) => `${v.toFixed(2)}×`, onInput: (v) => { state.speed = v; } }),
      slider({ label: 'Trails', min: 0, max: 0.98, step: 0.01, value: state.trail, format: (v) => (v ? `${Math.round(v * 100)}%` : 'off'), onInput: (v) => { state.trail = v; } }),
      slider({ label: 'Brightness', min: 0.2, max: 3, step: 0.05, value: state.brightness, format: (v) => `${v.toFixed(2)}×`, onInput: (v) => { state.brightness = v; } }),
      swatches({ palettes: PALETTES, value: state.palette, onChange: (i) => { state.palette = i; } }),
      toggles(check({ label: 'Auto-rotate', checked: true, onChange: (on) => { state.spin = on; } })),
      actions(modeBtn, pauseBtn, button({ label: 'Restart', onClick: () => reset() })),
      note('Drag to rotate, scroll or pinch to zoom. Keys: <kbd>B</kbd> butterfly effect, <kbd>Space</kbd> pause, <kbd>R</kbd> restart, <kbd>H</kbd> panel.'),
      aboutBox,
    );

    function setSystem(i) {
      state.sys = i;
      const sys = SYSTEMS[i];
      formulaEl.textContent = sys.formula;
      state.params = Object.fromEntries(sys.params.map((p) => [p.key, p.value]));
      paramBox.replaceChildren(...sys.params.map((p) => slider({
        label: p.label, min: p.min, max: p.max, step: p.step, value: p.value,
        format: (v) => v.toFixed(p.step < 0.01 ? 3 : 2),
        onInput: (v) => { state.params[p.key] = v; },
      })));
      aboutBox.querySelector('div').innerHTML = `<p>${sys.about}</p>
        <p><b>Butterfly effect:</b> all particles start within a millionth of a unit of each other. They separate at an exponential rate${sys.lyapunov ? ` (the largest Lyapunov exponent, about ${sys.lyapunov} per time unit)` : ''} until they are spread across the whole attractor. Watch the Spread readout climb.</p>`;
      reset();
    }

    function setMode(mode) {
      state.mode = mode;
      modeBtn.textContent = mode === 'butterfly' ? 'Fill attractor' : 'Butterfly effect';
      // Rainbow by starting order makes the split visible.
      state.colorBy = mode === 'butterfly' ? 'index' : 'speed';
      colorSelect.input.value = state.colorBy;
      reset();
    }

    function setPaused(p) {
      state.paused = p;
      pauseBtn.textContent = p ? 'Resume' : 'Pause';
    }

    // ---- camera input
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
        state.yaw += (e.clientX - prev[0]) * 0.006;
        state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch + (e.clientY - prev[1]) * 0.006));
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        state.zoom = Math.max(0.3, Math.min(6, state.zoom * (d / pinch)));
        pinch = d;
      }
    }, opts);
    const release = (e) => { pointers.delete(e.pointerId); if (!pointers.size) canvas.classList.remove('dragging'); };
    canvas.addEventListener('pointerup', release, opts);
    canvas.addEventListener('pointercancel', release, opts);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      state.zoom = Math.max(0.3, Math.min(6, state.zoom * Math.exp(-e.deltaY * (e.deltaMode ? 30 : 1) * 0.0012)));
    }, { passive: false, signal });
    attachKeys({
      b: () => setMode(state.mode === 'cloud' ? 'butterfly' : 'cloud'),
      ' ': () => setPaused(!state.paused),
      r: () => reset(),
      h: () => panel.toggle(),
    }, signal);

    setSystem(0);

    startLoop(signal, (now, dt) => {
      if (!state.paused) step(dt);
      if (state.spin && !pointers.size) state.yaw += dt * 0.00008;
      upload();

      resizeCanvas(canvas, dpr());
      ensureTarget();
      const w = canvas.width;
      const h = canvas.height;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, w, h);
      gl.enable(gl.BLEND);
      if (clearTrails || state.trail === 0) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        clearTrails = false;
      } else {
        // Multiply what is there by the trail factor (frame-rate independent).
        const keep = state.trail ** (dt / 16.7);
        gl.blendColor(0, 0, 0, keep);
        gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
        gl.useProgram(fade.program);
        drawFullscreen(gl);
      }

      // Rotation: yaw around the vertical axis, then pitch.
      const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
      const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
      const rot = [cy, sy * sp, sy * cp, 0, cp, -sp, -sy, cy * sp, cy * cp]; // column-major
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(points.program);
      const u = points.u;
      gl.uniformMatrix3fv(u.uRot, false, rot);
      gl.uniform1f(u.uZoom, state.zoom);
      gl.uniform2f(u.uAspect, Math.min(w, h) / w, Math.min(w, h) / h);
      gl.uniform1f(u.uPointSize, 2.2 * dpr());
      // Keep overall brightness similar across particle counts and trail lengths.
      gl.uniform1f(u.uIntensity, state.brightness * 0.9 * Math.sqrt(10000 / n) * (1 - state.trail * 0.85));
      gl.uniform3fv(u.uStops, paletteRgb(state.palette));
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, n);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(present.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, accTex);
      gl.uniform1i(present.u.uAcc, 0);
      gl.uniform3f(present.u.uBg, 0.016, 0.018, 0.03);
      gl.uniform1f(present.u.uExposure, 1.6);
      drawFullscreen(gl);

      const sys = SYSTEMS[state.sys];
      hud.set('sys', sys.name);
      hud.set('n', n.toLocaleString('en-US'));
      hud.set('t', state.t.toFixed(1));
      hud.set('spread', sci(spread() , 2));
      hud.note(state.mode === 'butterfly' ? 'Butterfly effect: particles started 10⁻⁶ apart' : '');
    });

    return () => releaseGL(gl);
  },
};
