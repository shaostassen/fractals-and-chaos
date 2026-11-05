import { PALETTES, PALETTE_GLSL, paletteRgb } from '../shared/palettes.js';
import { startLoop, dpr } from '../shared/loop.js';
import { attachKeys } from '../shared/panzoom.js';
import { createGL, createProgram, drawFullscreen, releaseGL, onContextLost } from '../shared/gl.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about, swatches, showError,
} from '../shared/ui.js';

// Ripple tank: the 2D wave equation u_tt = c²∇²u on a grid, stepped on the GPU
// with the leapfrog scheme
//   u⁺ = u + (1 − d)(u − u⁻) + (C·s)²·∇²u
// where C = c·Δt/Δx is the Courant number (stable below 1/√2), s is the local
// speed (0 in walls, 1/n in glass) and d is damping, used only in a sponge
// layer around the edges so waves leave instead of bouncing back.

const COURANT = 0.5;
const SPONGE = 26; // cells of absorbing layer on each edge
const CELL = 2;    // CSS pixels per grid cell
const N_GLASS = 1.5;

const STEP_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;   // r: u, g: previous u, b: time-averaged u²
uniform sampler2D uMedium;  // r: speed (0 = wall), g: damping, b: source (0.5 = A, 1 = B)
uniform float uC2;
uniform float uSourceA;
uniform float uSourceB;
uniform float uAlpha;       // averaging rate for intensity
uniform vec4 uPoke;         // x, y, radius, amplitude
out vec4 outState;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 hi = textureSize(uState, 0) - 1;
  vec4 s = texelFetch(uState, p, 0);
  vec4 m = texelFetch(uMedium, p, 0);
  if (m.r == 0.0) {             // wall: displacement held at zero, so waves reflect
    outState = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float l = texelFetch(uState, clamp(p + ivec2(-1, 0), ivec2(0), hi), 0).r;
  float r = texelFetch(uState, clamp(p + ivec2(1, 0), ivec2(0), hi), 0).r;
  float d = texelFetch(uState, clamp(p + ivec2(0, -1), ivec2(0), hi), 0).r;
  float u = texelFetch(uState, clamp(p + ivec2(0, 1), ivec2(0), hi), 0).r;
  float lap = l + r + d + u - 4.0 * s.r;
  float next = s.r + (1.0 - m.g) * (s.r - s.g) + uC2 * m.r * m.r * lap;
  // Soft sources add to the field, so returning waves pass straight through them.
  next += m.b > 0.75 ? uSourceB : (m.b > 0.25 ? uSourceA : 0.0);
  if (uPoke.w != 0.0) {
    vec2 q = vec2(p) - uPoke.xy;
    next += uPoke.w * exp(-dot(q, q) / (uPoke.z * uPoke.z));
  }
  float intensity = s.b + (next * next - s.b) * uAlpha;
  outState = vec4(next, s.r, intensity, 1.0);
}`;

const SHOW_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uMedium;
uniform vec2 uCanvas;       // drawing buffer size
uniform vec2 uGrid;         // grid size in cells
uniform int uMode;          // 0 waves, 1 brightness, 2 both
uniform float uGain;
uniform float uIGain;
${PALETTE_GLSL}
out vec4 outColor;

vec4 sampleState(vec2 g) {
  // Manual bilinear filtering (float textures may not support it in hardware).
  vec2 f = g - 0.5;
  ivec2 i = ivec2(floor(f));
  vec2 t = fract(f);
  ivec2 hi = ivec2(uGrid) - 1;
  vec4 a = texelFetch(uState, clamp(i, ivec2(0), hi), 0);
  vec4 b = texelFetch(uState, clamp(i + ivec2(1, 0), ivec2(0), hi), 0);
  vec4 c = texelFetch(uState, clamp(i + ivec2(0, 1), ivec2(0), hi), 0);
  vec4 d = texelFetch(uState, clamp(i + ivec2(1, 1), ivec2(0), hi), 0);
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

void main() {
  vec2 g = gl_FragCoord.xy / uCanvas * uGrid;
  vec4 m = texelFetch(uMedium, ivec2(g), 0);
  vec3 bg = vec3(0.02, 0.024, 0.04);
  if (m.r == 0.0) { outColor = vec4(0.62, 0.66, 0.76, 1.0); return; }
  vec4 s = sampleState(g);
  // Soft compression: strong waves near the source saturate gently instead of clipping.
  float v = tanh(s.r * uGain);
  vec3 warm = vec3(1.0, 0.67, 0.0);
  vec3 cool = vec3(0.3, 0.79, 0.94);
  vec3 waves = v > 0.0 ? mix(bg, warm, v) : mix(bg, cool, -v);
  float b = sqrt(1.0 - exp(-max(s.b, 0.0) * uIGain));
  vec3 bright = palette(0.05 + 0.75 * clamp(b, 0.0, 1.0)) * clamp(b * 1.6, 0.0, 1.0);
  vec3 col = uMode == 0 ? waves : uMode == 1 ? bright : max(waves * 0.75, bright);
  if (m.r < 0.99) col = mix(col, vec3(0.55, 0.75, 0.95), 0.16);   // glass
  if (m.b > 0.25) col = mix(col, vec3(1.0), 0.35);                // sources
  outColor = vec4(col, 1.0);
}`;

const SCENES = [
  { id: 'double', name: 'Double slit', controls: ['lambda', 'sep', 'width'], screen: true },
  { id: 'single', name: 'Single slit', controls: ['lambda', 'width'], screen: true },
  { id: 'grating', name: 'Diffraction grating', controls: ['lambda', 'sep', 'width', 'count'], screen: true },
  { id: 'two', name: 'Two sources', controls: ['lambda', 'sep', 'phase'], screen: true },
  { id: 'lens', name: 'Glass lens', controls: ['lambda'], screen: false },
  { id: 'mirror', name: 'Parabolic mirror', controls: ['lambda'], screen: false },
  { id: 'free', name: 'Empty tank (draw walls)', controls: ['lambda'], screen: false },
];

export default {
  id: 'ripple',
  title: 'Ripple Tank',
  area: 'Waves & physics',
  formula: '∂²u/∂t² = c²∇²u',
  blurb: 'Young’s double slit in a simulated water tank: watch bright and dark bands form, and check them against theory.',

  mount(root, { signal }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Ripple tank simulation. Drag to draw walls.' });
    const overlay = el('canvas', { class: 'stage', style: { pointerEvents: 'none', background: 'transparent' } });
    root.append(canvas, overlay);
    const octx = overlay.getContext('2d');
    let gl;
    let step;
    let show;
    try {
      gl = createGL(canvas);
      if (!gl.getExtension('EXT_color_buffer_float')) {
        throw new Error('This demo needs floating-point render targets (EXT_color_buffer_float), which this browser or GPU does not offer.');
      }
      step = createProgram(gl, STEP_FS);
      show = createProgram(gl, SHOW_FS);
    } catch (err) {
      showError(root, err.message);
      return;
    }
    onContextLost(canvas, root, signal, showError);

    const state = {
      scene: 0, lambda: 14, sep: 56, width: 8, count: 5, phase: 0, speed: 4,
      mode: 2, palette: 2, gain: 1, paused: false, tool: 'wall', screenGraph: true,
    };

    // ---- grid, textures, framebuffers
    let W = 0, H = 0;
    let medium = null;      // Uint8Array RGBA, row 0 at the bottom
    let mediumTex = null;
    let states = [];        // two { tex, fbo }
    let cur = 0;
    let t = 0;              // simulation steps since reset
    let geo = {};           // scene geometry: wallX, screenX, emitters, focus...
    let measured = null;    // intensity along the screen
    let exposure = 0;       // auto exposure from the screen brightness (0 = not yet known)
    let theory = null;

    function makeState() {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fbo };
    }

    function visibleCells() {
      const rect = panel.panel.hidden ? null : panel.panel.getBoundingClientRect();
      const cw = canvas.clientWidth;
      const visibleW = rect && rect.left > cw * 0.4 ? rect.left - 12 : cw;
      return Math.max(80, Math.min(W, Math.round(visibleW / CELL)));
    }

    function allocate() {
      const w = Math.max(80, Math.min(1000, Math.round(canvas.clientWidth / CELL)));
      const h = Math.max(80, Math.min(1000, Math.round(canvas.clientHeight / CELL)));
      if (w === W && h === H && states.length) return;
      W = w; H = h;
      for (const s of states) { gl.deleteTexture(s.tex); gl.deleteFramebuffer(s.fbo); }
      states = [makeState(), makeState()];
      if (mediumTex) gl.deleteTexture(mediumTex);
      mediumTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, mediumTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      medium = new Uint8Array(W * H * 4);
      buildScene();
    }

    const setCell = (x, y, speed, source = 0) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = 4 * (y * W + x);
      medium[i] = Math.round(speed * 255);
      if (source) medium[i + 2] = source;
    };
    const uploadMedium = () => {
      gl.bindTexture(gl.TEXTURE_2D, mediumTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, medium);
    };

    // Build walls, glass, sources and damping for the current scene, and the
    // list of emitters used for the theoretical prediction.
    function buildScene() {
      const sc = SCENES[state.scene];
      const vis = visibleCells();
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = 4 * (y * W + x);
          const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
          const damp = edge < SPONGE ? 0.25 * ((SPONGE - edge) / SPONGE) ** 2 : 0;
          medium[i] = 255; medium[i + 1] = Math.round(damp * 255); medium[i + 2] = 0; medium[i + 3] = 255;
        }
      }
      const yc = Math.round(H / 2);
      const sourceX = SPONGE + 4;
      const wallX = Math.max(sourceX + 30, Math.round(vis * 0.3));
      const screenX = Math.min(W - SPONGE - 6, Math.round(vis * 0.86));
      geo = { wallX, screenX, emitters: [], focus: null, yc, vis };
      const planeSource = () => { for (let y = 0; y < H; y++) setCell(sourceX, y, 1, 128); };
      const wallWithOpenings = (openings) => {
        for (let y = 0; y < H; y++) {
          const open = openings.some(([lo, hi]) => y >= lo && y < hi);
          if (!open) for (let x = wallX; x < wallX + 3; x++) setCell(x, y, 0);
        }
      };
      const slits = (centres, a) => {
        const openings = centres.map((c) => [Math.round(c - a / 2), Math.round(c - a / 2) + a]);
        wallWithOpenings(openings);
        // Huygens: each opening is a row of in-phase emitters at the wall's far side.
        for (const [lo, hi] of openings) for (let k = 0; k < 6; k++) geo.emitters.push({ x: wallX + 3, y: lo + ((k + 0.5) / 6) * (hi - lo), phase: 0 });
      };

      if (sc.id === 'double') { planeSource(); slits([yc - state.sep / 2, yc + state.sep / 2], state.width); }
      if (sc.id === 'single') { planeSource(); slits([yc], state.width); }
      if (sc.id === 'grating') {
        planeSource();
        slits(Array.from({ length: state.count }, (_, k) => yc + (k - (state.count - 1) / 2) * state.sep), state.width);
      }
      if (sc.id === 'two') {
        const x = wallX;
        for (const [dy, src] of [[-state.sep / 2, 128], [state.sep / 2, 255]]) {
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) setCell(x + ox, Math.round(yc + dy) + oy, 1, src);
        }
        geo.emitters = [{ x, y: yc - state.sep / 2, phase: 0 }, { x, y: yc + state.sep / 2, phase: state.phase }];
      }
      if (sc.id === 'lens') {
        planeSource();
        // Biconvex lens: overlap of two discs. Focal length f = R / (2(n − 1)).
        const R = Math.round(Math.min(H * 0.55, vis * 0.45));
        const thick = Math.round(R * 0.25);
        const cx = wallX + thick;
        const half = Math.sqrt(R * R - (R - thick / 2) ** 2);
        for (let y = 0; y < H; y++) {
          for (let x = cx - thick; x <= cx + thick; x++) {
            const inA = (x - (cx - R + thick / 2)) ** 2 + (y - yc) ** 2 < R * R;
            const inB = (x - (cx + R - thick / 2)) ** 2 + (y - yc) ** 2 < R * R;
            if (inA && inB) setCell(x, y, 1 / N_GLASS);
          }
          if (Math.abs(y - yc) > half + 2) for (let x = cx - 1; x <= cx + 1; x++) setCell(x, y, 0);
        }
        // Thick-lens focal length (lensmaker's equation), measured from the lens centre.
        const inv = (N_GLASS - 1) * (2 / R - ((N_GLASS - 1) * thick) / (N_GLASS * R * R));
        geo.focus = { x: cx + 1 / inv, y: yc, label: 'ray-optics focus' };
      }
      if (sc.id === 'mirror') {
        planeSource();
        // Parabola x = xv − (y − yc)² / 4f opening toward the waves; parallel rays meet at its focus.
        const xv = Math.min(W - SPONGE - 8, Math.round(vis * 0.9));
        const f = Math.round(vis * 0.22);
        const half = Math.min(H / 2 - SPONGE - 4, Math.sqrt(4 * f * (xv - wallX - 10)));
        for (let y = Math.round(yc - half); y <= Math.round(yc + half); y++) {
          const xm = xv - (y - yc) ** 2 / (4 * f);
          for (let x = Math.floor(xm - 1.5); x <= Math.ceil(xm + 1.5); x++) setCell(x, y, 0);
        }
        geo.focus = { x: xv - f, y: yc, label: 'focus' };
      }
      if (sc.id === 'free') {
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) setCell(wallX + ox, yc + oy, 1, 128);
      }
      uploadMedium();
      resetField();
      computeTheory();
    }

    function resetField() {
      for (const s of states) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      t = 0;
      measured = null;
      exposure = 0;
    }

    // Huygens–Fresnel prediction along the screen: sum of cylindrical
    // wavelets e^{ikr}/√r from every emitter, with an obliquity factor.
    function computeTheory() {
      theory = null;
      if (!SCENES[state.scene].screen || !geo.emitters.length) return;
      const k = (2 * Math.PI) / state.lambda;
      const vals = new Float64Array(H);
      for (let y = 0; y < H; y++) {
        let re = 0, im = 0;
        for (const e of geo.emitters) {
          const dx = geo.screenX - e.x, dy = y - e.y;
          const r = Math.hypot(dx, dy);
          const amp = (0.5 * (1 + dx / r)) / Math.sqrt(r);
          re += amp * Math.cos(k * r + e.phase);
          im += amp * Math.sin(k * r + e.phase);
        }
        vals[y] = re * re + im * im;
      }
      theory = vals;
    }

    // Read the time-averaged intensity along the screen column.
    const readBuf = new Float32Array(4 * 1000);
    function readScreen() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, states[cur].fbo);
      gl.readPixels(geo.screenX, 0, 1, H, gl.RGBA, gl.FLOAT, readBuf);
      measured = new Float64Array(H);
      for (let y = 0; y < H; y++) measured[y] = readBuf[4 * y + 2];
    }

    // Spacing between bright fringes near the centre of a curve, in cells.
    function fringeSpacing(curve) {
      if (!curve) return null;
      const lo = SPONGE + 4, hi = H - SPONGE - 4;
      let max = 0;
      for (let y = lo; y < hi; y++) max = Math.max(max, curve[y]);
      const peaks = [];
      for (let y = lo + 2; y < hi - 2; y++) {
        const v = curve[y];
        if (v > 0.15 * max && v >= curve[y - 1] && v >= curve[y + 1] && v >= curve[y - 2] && v >= curve[y + 2]) peaks.push(y);
      }
      if (peaks.length < 2) return null;
      // Use the peaks closest to the middle.
      peaks.sort((a, b) => Math.abs(a - geo.yc) - Math.abs(b - geo.yc));
      const near = peaks.slice(0, Math.min(5, peaks.length)).sort((a, b) => a - b);
      return (near.at(-1) - near[0]) / (near.length - 1);
    }

    // ---- UI
    const hud = createHud(root, [['scene', 'Scene'], ['lambda', 'Wavelength'], ['predict', 'Predicted'], ['measure', 'Measured']]);
    const panel = createPanel(root, { title: 'Ripple Tank', formula: '∂²u/∂t² = c²∇²u', signal });
    const rebuild = () => { buildScene(); };
    const controls = {
      lambda: slider({ label: 'Wavelength λ', min: 8, max: 40, value: state.lambda, format: (v) => `${v} cells`, onInput: (v) => { state.lambda = v; resetField(); computeTheory(); } }),
      sep: slider({ label: 'Slit separation d', min: 16, max: 140, step: 2, value: state.sep, format: (v) => `${v} cells`, onInput: (v) => { state.sep = v; rebuild(); } }),
      width: slider({ label: 'Slit width a', min: 2, max: 60, value: state.width, format: (v) => `${v} cells`, onInput: (v) => { state.width = v; rebuild(); } }),
      count: slider({ label: 'Number of slits', min: 2, max: 12, value: state.count, onInput: (v) => { state.count = v; rebuild(); } }),
      phase: slider({ label: 'Phase difference', min: 0, max: 360, step: 5, value: 0, format: (v) => `${v}°`, onInput: (v) => { state.phase = (v * Math.PI) / 180; rebuild(); } }),
    };
    const pauseBtn = button({ label: 'Pause', onClick: () => setPaused(!state.paused) });
    function setPaused(p) { state.paused = p; pauseBtn.textContent = p ? 'Resume' : 'Pause'; }
    function setScene(i) {
      state.scene = i;
      const sc = SCENES[i];
      for (const [key, node] of Object.entries(controls)) node.hidden = !sc.controls.includes(key);
      if (sc.id === 'single' && state.width < 16) { state.width = 24; controls.width.set(24); }
      if (sc.id !== 'single' && state.width > 20) { state.width = 8; controls.width.set(8); }
      if (sc.id === 'grating' && state.sep > 60) { state.sep = 28; controls.sep.set(28); }
      if (sc.id === 'double' && state.sep < 40) { state.sep = 56; controls.sep.set(56); }
      buildScene();
    }

    panel.add(
      select({ label: 'Scene', options: SCENES.map((s, i) => ({ value: String(i), label: s.name })), value: '0', onChange: (v) => setScene(+v) }),
      ...Object.values(controls),
      select({
        label: 'Show',
        options: [{ value: '2', label: 'Waves and brightness' }, { value: '0', label: 'Waves (height of the surface)' }, { value: '1', label: 'Brightness (average of height²)' }],
        value: String(state.mode),
        onChange: (v) => { state.mode = +v; },
      }),
      select({
        label: 'Dragging',
        options: [{ value: 'wall', label: 'Draws walls' }, { value: 'erase', label: 'Erases walls' }, { value: 'poke', label: 'Makes a splash' }],
        value: state.tool,
        onChange: (v) => { state.tool = v; },
      }),
      slider({ label: 'Speed', min: 1, max: 12, value: state.speed, format: (v) => `${v} steps/frame`, onInput: (v) => { state.speed = v; } }),
      slider({ label: 'Contrast', min: 0.2, max: 5, step: 0.05, value: state.gain, format: (v) => `${v.toFixed(2)}×`, onInput: (v) => { state.gain = v; } }),
      swatches({ palettes: PALETTES, value: state.palette, onChange: (i) => { state.palette = i; } }),
      toggles(check({ label: 'Screen graph', checked: true, onChange: (on) => { state.screenGraph = on; } })),
      actions(button({ label: 'Restart waves', primary: true, onClick: () => resetField() }), pauseBtn, button({ label: 'Rebuild scene', onClick: () => buildScene() })),
      note('Drag in the tank to draw walls (right-drag or Shift-drag erases). Keys: <kbd>Space</kbd> pause, <kbd>R</kbd> restart, <kbd>H</kbd> panel.'),
      about(`<p>In 1801 Thomas Young shone light through two narrow slits and saw a row of bright and dark bands instead of two bright lines. Light is a wave: where crests from the two slits arrive together they add up (bright), and where a crest meets a trough they cancel (dark). Bright bands appear where the two path lengths differ by a whole number of wavelengths, so for a far screen their spacing is about λL/d, where L is the distance to the screen and d the slit separation.</p>
        <p>This tank solves the wave equation ∂²u/∂t² = c²∇²u on a grid, one small time step at a time on the GPU. Walls hold the surface still and reflect waves. Glass slows them to c/n, which bends them (the lens). With waves the brightest spot sits a little nearer the lens than the ray-optics focus, because a small lens cannot squeeze light into a single point (diffraction again). The edges are a sponge that absorbs waves, so the tank acts as if it went on forever.</p>
        <p>The graph on the right is the screen. The orange curve is the brightness the simulation measures there; the white curve is the prediction from Huygens' principle, which treats every point of each opening as a new source of circular waves. The same pattern appears for water, sound, light, and even single electrons, which is the starting point of quantum mechanics.</p>`),
    );

    // ---- pointer: draw or erase walls, or splash
    const toCell = (e) => {
      const r = canvas.getBoundingClientRect();
      return [Math.floor(((e.clientX - r.left) / r.width) * W), Math.floor((1 - (e.clientY - r.top) / r.height) * H)];
    };
    let drawing = null;
    let pendingPoke = null;
    const paint = (from, to, erase) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1])));
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(from[0] + ((to[0] - from[0]) * s) / steps);
        const y = Math.round(from[1] + ((to[1] - from[1]) * s) / steps);
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const cx = x + ox, cy = y + oy;
          if (cx < SPONGE || cy < 0 || cx >= W || cy >= H) continue;
          const i = 4 * (cy * W + cx);
          if (medium[i + 2]) continue; // keep sources
          medium[i] = erase ? 255 : 0;
        }
      }
      uploadMedium();
    };
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const c = toCell(e);
      if (state.tool === 'poke') { pendingPoke = c; return; }
      drawing = { last: c, erase: state.tool === 'erase' || e.button === 2 || e.shiftKey };
      paint(c, c, drawing.erase);
    }, { signal });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const c = toCell(e);
      paint(drawing.last, c, drawing.erase);
      drawing.last = c;
    }, { signal });
    const end = () => { drawing = null; };
    canvas.addEventListener('pointerup', end, { signal });
    canvas.addEventListener('pointercancel', end, { signal });
    attachKeys({
      ' ': () => setPaused(!state.paused),
      r: () => resetField(),
      h: () => { panel.toggle(); buildScene(); },
    }, signal);
    let resizeTimer = 0;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { allocate(); buildScene(); }, 150); }, { signal });

    allocate();
    setScene(0);
    let frame = 0;

    startLoop(signal, () => {
      const s = dpr();
      const cw = Math.round(canvas.clientWidth * s), ch = Math.round(canvas.clientHeight * s);
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = overlay.width = cw; canvas.height = overlay.height = ch; }

      // ---- simulate
      if (!state.paused) {
        const omega = (2 * Math.PI * COURANT) / state.lambda; // radians per step: λ = c·T
        gl.useProgram(step.program);
        gl.viewport(0, 0, W, H);
        gl.uniform1i(step.u.uState, 0);
        gl.uniform1i(step.u.uMedium, 1);
        gl.uniform1f(step.u.uC2, COURANT * COURANT);
        gl.uniform1f(step.u.uAlpha, Math.min(0.05, COURANT / (2 * state.lambda)));
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, mediumTex);
        for (let k = 0; k < state.speed; k++) {
          // Ramp the source up over a few periods to avoid a sharp initial pulse.
          const ramp = Math.min(1, t / (4 * state.lambda / COURANT));
          const amp = 0.04 * ramp;
          gl.uniform1f(step.u.uSourceA, amp * Math.sin(omega * t));
          gl.uniform1f(step.u.uSourceB, amp * Math.sin(omega * t + state.phase));
          if (pendingPoke && k === 0) {
            gl.uniform4f(step.u.uPoke, pendingPoke[0], pendingPoke[1], 5, 1.2);
            pendingPoke = null;
          } else gl.uniform4f(step.u.uPoke, 0, 0, 1, 0);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, states[cur].tex);
          gl.bindFramebuffer(gl.FRAMEBUFFER, states[1 - cur].fbo);
          drawFullscreen(gl);
          cur = 1 - cur;
          t++;
        }
      }

      // ---- draw
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cw, ch);
      gl.useProgram(show.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, states[cur].tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, mediumTex);
      gl.uniform1i(show.u.uState, 0);
      gl.uniform1i(show.u.uMedium, 1);
      gl.uniform2f(show.u.uCanvas, cw, ch);
      gl.uniform2f(show.u.uGrid, W, H);
      gl.uniform1i(show.u.uMode, state.mode);
      // Wave amplitude is about √(2·intensity), so both gains follow the exposure.
      // Scenes without a screen use a fixed exposure; a lone point source is faint.
      const iGain = (exposure || (SCENES[state.scene].id === 'free' ? 60 : 9)) * state.gain * 0.8;
      gl.uniform1f(show.u.uGain, Math.sqrt(iGain / 2) * 0.9);
      gl.uniform1f(show.u.uIGain, iGain);
      gl.uniform3fv(show.u.uStops, paletteRgb(state.palette));
      drawFullscreen(gl);

      frame++;
      const sc = SCENES[state.scene];
      const warm = t > (geo.screenX - geo.wallX + 60) / COURANT + 6 * state.lambda / COURANT;
      if (sc.screen && frame % 12 === 0) {
        readScreen();
        if (warm) {
          // Expose for the screen region, where the interesting (faint) waves are.
          let max = 0;
          for (let y = SPONGE; y < H - SPONGE; y++) max = Math.max(max, measured[y]);
          if (max > 0) exposure = exposure ? exposure * 0.8 + (1 / max) * 0.2 : 1 / max;
        }
      }

      // ---- overlay: screen, graph, focus
      octx.clearRect(0, 0, cw, ch);
      const px = cw / W, py = ch / H;
      const X = (gx) => gx * px, Y = (gy) => ch - gy * py;
      if (sc.screen && state.screenGraph) {
        octx.strokeStyle = 'rgba(232, 235, 243, 0.5)';
        octx.setLineDash([4 * s, 4 * s]);
        octx.lineWidth = s;
        octx.beginPath(); octx.moveTo(X(geo.screenX), Y(SPONGE)); octx.lineTo(X(geo.screenX), Y(H - SPONGE)); octx.stroke();
        octx.setLineDash([]);
        const gw = Math.max(40 * s, (geo.vis - geo.screenX - 4) * px);
        const plot = (curve, color, width) => {
          if (!curve) return;
          let max = 0;
          for (let y = SPONGE; y < H - SPONGE; y++) max = Math.max(max, curve[y]);
          if (!max) return;
          octx.strokeStyle = color;
          octx.lineWidth = width;
          octx.beginPath();
          for (let y = SPONGE; y < H - SPONGE; y++) {
            const x = X(geo.screenX) + 4 * s + (curve[y] / max) * gw;
            if (y === SPONGE) octx.moveTo(x, Y(y)); else octx.lineTo(x, Y(y));
          }
          octx.stroke();
        };
        octx.fillStyle = 'rgba(5, 6, 10, 0.78)';
        octx.fillRect(X(geo.screenX) + 2 * s, Y(H - SPONGE), gw + 6 * s, (H - 2 * SPONGE) * py);
        if (warm) plot(measured, '#ffaa00', 2.2 * s);
        plot(theory, 'rgba(255, 255, 255, 0.85)', 1.2 * s);
        octx.font = `${11 * s}px "Chivo Mono", ui-monospace, monospace`;
        octx.fillStyle = 'rgba(232, 235, 243, 0.75)';
        octx.fillText('screen', X(geo.screenX) - 50 * s, Y(H - SPONGE) + 14 * s);
      }
      if (geo.focus) {
        // Tick marks above and below the beam, so the bright focal spot stays visible.
        const fx = X(geo.focus.x), fy = Y(geo.focus.y);
        octx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        octx.lineWidth = 1.5 * s;
        octx.beginPath();
        octx.moveTo(fx, fy - 46 * s); octx.lineTo(fx, fy - 28 * s);
        octx.moveTo(fx, fy + 28 * s); octx.lineTo(fx, fy + 46 * s);
        octx.stroke();
        octx.font = `${11 * s}px "Chivo Mono", ui-monospace, monospace`;
        octx.fillStyle = 'rgba(232, 235, 243, 0.85)';
        octx.textAlign = 'center';
        octx.fillText(geo.focus.label, fx, fy + 60 * s);
        octx.textAlign = 'start';
      }

      // ---- readout
      hud.set('scene', sc.name);
      hud.set('lambda', `${state.lambda} cells`);
      const L = geo.screenX - geo.wallX - 3;
      if (sc.id === 'double' || sc.id === 'grating' || sc.id === 'two') {
        const far = (state.lambda * L) / state.sep;
        const exact = fringeSpacing(theory);
        hud.set('predict', `fringe spacing ${exact ? exact.toFixed(1) : '—'} cells (λL/d ≈ ${far.toFixed(1)})`);
        const m = warm ? fringeSpacing(measured) : null;
        hud.set('measure', m ? `fringe spacing ${m.toFixed(1)} cells` : 'waiting for waves to reach the screen');
      } else if (sc.id === 'single') {
        const s1 = state.lambda / state.width;
        hud.set('predict', s1 < 1 ? `first dark band at ${(Math.asin(s1) * 180 / Math.PI).toFixed(1)}° (sin θ = λ/a)` : 'no dark bands: slit narrower than λ');
        hud.set('measure', warm ? 'see the screen graph' : 'waiting for waves to reach the screen');
      } else {
        hud.set('predict', sc.id === 'lens' ? `glass n = ${N_GLASS}: waves slow to c/n` : sc.id === 'mirror' ? 'parallel waves meet at the focus' : 'drag to build walls');
        hud.set('measure', '—');
      }
    });

    return () => releaseGL(gl);
  },
};
