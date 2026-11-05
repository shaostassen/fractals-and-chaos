import { PALETTES, PALETTE_GLSL, paletteRgb } from '../shared/palettes.js';
import { startLoop, dpr } from '../shared/loop.js';
import { attachKeys } from '../shared/panzoom.js';
import { createGL, createProgram, drawFullscreen, releaseGL, onContextLost } from '../shared/gl.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about, swatches, showError,
} from '../shared/ui.js';

// Time-dependent Schrödinger equation i ∂ψ/∂t = −½∇²ψ (units ħ = m = 1, grid
// spacing 1), solved with Visscher's staggered scheme: with ψ = R + iI,
//   R ← R + Δt·H I,   then   I ← I − Δt·H R,   H = −½∇²
// which is stable for Δt < 0.5 and keeps total probability almost exactly
// constant. Walls force ψ = 0 (an infinite potential barrier).

const DT = 0.4;
const SPONGE = 24;
// CSS pixels per grid cell; finer on narrow screens so the setup still fits.
const cellSize = (cssWidth) => (cssWidth < 700 ? 1.25 : 2);

const STEP_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;   // r: R, g: I, b: ∫|ψ|² dt
uniform sampler2D uWall;    // r > 0.5: wall
uniform int uPart;          // 0: update R, 1: update I
uniform float uDt;
uniform vec2 uGrid;
uniform float uSponge;
out vec4 outState;

float lapAt(ivec2 p, int ch, vec4 s) {
  ivec2 hi = ivec2(uGrid) - 1;
  vec4 l = texelFetch(uState, clamp(p + ivec2(-1, 0), ivec2(0), hi), 0);
  vec4 r = texelFetch(uState, clamp(p + ivec2(1, 0), ivec2(0), hi), 0);
  vec4 d = texelFetch(uState, clamp(p + ivec2(0, -1), ivec2(0), hi), 0);
  vec4 u = texelFetch(uState, clamp(p + ivec2(0, 1), ivec2(0), hi), 0);
  return ch == 0 ? l.r + r.r + d.r + u.r - 4.0 * s.r : l.g + r.g + d.g + u.g - 4.0 * s.g;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, p, 0);
  if (texelFetch(uWall, p, 0).r > 0.5) { outState = vec4(0.0, 0.0, s.b, 1.0); return; }
  if (uPart == 0) {
    float R = s.r + uDt * (-0.5 * lapAt(p, 1, s));
    outState = vec4(R, s.g, s.b, 1.0);
  } else {
    float I = s.g - uDt * (-0.5 * lapAt(p, 0, s));
    // Absorbing layer at the edges so the packet leaves instead of reflecting.
    float edge = min(min(float(p.x), float(p.y)), min(uGrid.x - 1.0 - float(p.x), uGrid.y - 1.0 - float(p.y)));
    float f = edge < uSponge ? 1.0 - 0.06 * pow((uSponge - edge) / uSponge, 2.0) : 1.0;
    float R = s.r * f;
    I *= f;
    outState = vec4(R, I, s.b + (R * R + I * I) * uDt, 1.0);
  }
}`;

// Gaussian wave packet moving right: ψ = A·exp(−x²/4σx² − y²/4σy²)·e^{ik₀x}.
const INIT_FS = `#version 300 es
precision highp float;
uniform vec2 uCentre;
uniform vec2 uSigma;
uniform float uK;
uniform float uAmp;
uniform sampler2D uWall;
out vec4 outState;
void main() {
  vec2 q = gl_FragCoord.xy - 0.5 - uCentre;
  float g = uAmp * exp(-q.x * q.x / (4.0 * uSigma.x * uSigma.x) - q.y * q.y / (4.0 * uSigma.y * uSigma.y));
  if (texelFetch(uWall, ivec2(gl_FragCoord.xy), 0).r > 0.5) g = 0.0;
  // I is set half a step later (staggered grid): phase advances by E·Δt/2 with E = 1 − cos k₀.
  float ph = uK * q.x;
  float lag = (1.0 - cos(uK)) * ${DT / 2};
  outState = vec4(g * cos(ph), g * sin(ph - lag), 0.0, 1.0);
}`;

const SHOW_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uWall;
uniform vec2 uCanvas;
uniform vec2 uGrid;
uniform int uMode;      // 0 probability, 1 phase
uniform float uGain;
${PALETTE_GLSL}
out vec4 outColor;

vec3 hue(float a) {
  return 0.5 + 0.5 * cos(a + vec3(0.0, 2.094, 4.189));
}

void main() {
  vec2 g = gl_FragCoord.xy / uCanvas * uGrid;
  ivec2 c = ivec2(g);
  if (texelFetch(uWall, c, 0).r > 0.5) { outColor = vec4(0.62, 0.66, 0.76, 1.0); return; }
  // Bilinear sample of R and I.
  vec2 f = g - 0.5;
  ivec2 i = ivec2(floor(f));
  vec2 t = fract(f);
  ivec2 hi = ivec2(uGrid) - 1;
  vec4 a = texelFetch(uState, clamp(i, ivec2(0), hi), 0);
  vec4 b = texelFetch(uState, clamp(i + ivec2(1, 0), ivec2(0), hi), 0);
  vec4 cc = texelFetch(uState, clamp(i + ivec2(0, 1), ivec2(0), hi), 0);
  vec4 d = texelFetch(uState, clamp(i + ivec2(1, 1), ivec2(0), hi), 0);
  vec4 s = mix(mix(a, b, t.x), mix(cc, d, t.x), t.y);
  float p = s.r * s.r + s.g * s.g;
  // Compressed so the faint waves past the slits stay visible next to the packet.
  float v = tanh(sqrt(p * uGain));
  vec3 bg = vec3(0.02, 0.024, 0.04);
  vec3 col = uMode == 0 ? mix(bg, palette(0.08 + 0.72 * v), v) : mix(bg, hue(atan(s.g, s.r)), v);
  outColor = vec4(col, 1.0);
}`;

export default {
  id: 'quantum-slit',
  title: 'Quantum Double Slit',
  area: 'Waves & physics',
  formula: 'iħ ∂ψ/∂t = −(ħ²/2m)∇²ψ',
  blurb: 'Electrons fired one at a time through two slits land as single dots, yet build up an interference pattern.',

  mount(root, { signal }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Quantum double slit simulation of an electron wave packet.' });
    const overlay = el('canvas', { class: 'stage', style: { pointerEvents: 'none', background: 'transparent' } });
    root.append(canvas, overlay);
    const octx = overlay.getContext('2d');
    let gl, step, init, show;
    try {
      gl = createGL(canvas);
      if (!gl.getExtension('EXT_color_buffer_float')) {
        throw new Error('This demo needs floating-point render targets (EXT_color_buffer_float), which this browser or GPU does not offer.');
      }
      step = createProgram(gl, STEP_FS);
      init = createProgram(gl, INIT_FS);
      show = createProgram(gl, SHOW_FS);
    } catch (err) {
      showError(root, err.message);
      return;
    }
    onContextLost(canvas, root, signal, showError);

    const state = {
      lambda: 14, sep: 50, width: 8, detector: false, firing: true, rate: 80,
      speed: 24, mode: 1, palette: 2, gain: 1, paused: false,
    };

    let W = 0, H = 0;
    let wall = null, wallTex = null;
    let states = [];
    let cur = 0;
    let geo = {};
    let run = null;         // current electron: { t, closed: -1 | 0 | 1 }
    // Screen distributions from completed runs: 'both', or one slit closed (0, 1).
    let patterns = {};
    let hits = [];          // detected positions (grid y), one per electron
    let hitAcc = 0;
    let norm = { start: 0, now: 0 };

    function makeState() {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo };
    }

    function visibleCells() {
      const rect = panel.panel.hidden ? null : panel.panel.getBoundingClientRect();
      const cw = canvas.clientWidth;
      const visibleW = rect && rect.left > cw * 0.4 ? rect.left - 12 : cw;
      return Math.max(120, Math.min(W, Math.round(visibleW / cellSize(cw))));
    }

    function allocate() {
      const cell = cellSize(canvas.clientWidth);
      const w = Math.max(160, Math.min(1000, Math.round(canvas.clientWidth / cell)));
      const h = Math.max(160, Math.min(1000, Math.round(canvas.clientHeight / cell)));
      if (w === W && h === H && states.length) return;
      W = w; H = h;
      for (const s of states) { gl.deleteTexture(s.tex); gl.deleteFramebuffer(s.fbo); }
      states = [makeState(), makeState()];
      if (wallTex) gl.deleteTexture(wallTex);
      wallTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, wallTex);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      wall = new Uint8Array(W * H * 4);
      setup();
    }

    // Wall with two slits; `closed` (0 or 1) blocks one slit for this electron.
    function buildWall(closed) {
      wall.fill(0);
      const { wallX, slits } = geo;
      for (let y = 0; y < H; y++) {
        const open = slits.some(([lo, hi], i) => i !== closed && y >= lo && y < hi);
        if (open) continue;
        for (let x = wallX; x < wallX + 3; x++) wall[4 * (y * W + x)] = 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, wallTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, wall);
    }

    // Geometry for the current settings; clears everything measured so far.
    function setup() {
      const vis = visibleCells();
      const yc = Math.round(H / 2);
      // Packet length: shorter on small screens so the packet (±3σ), the slits
      // and the screen all fit, with the screen well past the wall.
      const sigmaX = Math.max(8, Math.min(18, Math.round((vis * 0.4 - SPONGE - 12) / 7)));
      const wallX = Math.max(SPONGE + 7 * sigmaX + 12, Math.round(vis * 0.32));
      const screenX = Math.max(wallX + 60, Math.min(W - SPONGE - 8, Math.round(vis * 0.82)));
      const slits = [yc - state.sep / 2, yc + state.sep / 2].map((c) => [Math.round(c - state.width / 2), Math.round(c - state.width / 2) + state.width]);
      geo = {
        vis, yc, wallX, screenX, slits,
        // Tall enough to light both slits, short enough to stay clear of the edges.
        sigma: [sigmaX, Math.min(Math.max(state.sep * 1.1, 40), (H / 2 - SPONGE) / 3.5)],
        x0: wallX - 4 * sigmaX - 6,
      };
      patterns = {};
      hits = [];
      hitAcc = 0;
      launch();
    }

    const k0 = () => (2 * Math.PI) / state.lambda;
    // Group velocity on the grid: dE/dk with E = 1 − cos k.
    const groupVelocity = () => Math.sin(k0());

    // Start a new electron. With the detector on it is found at one slit
    // (50/50 for identical slits) and from then on only that slit is open.
    function launch() {
      const closed = state.detector ? (Math.random() < 0.5 ? 0 : 1) : -1;
      buildWall(closed);
      const [sx, sy] = geo.sigma;
      gl.useProgram(init.program);
      gl.viewport(0, 0, W, H);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, wallTex);
      gl.uniform1i(init.u.uWall, 1);
      gl.uniform2f(init.u.uCentre, geo.x0, geo.yc);
      gl.uniform2f(init.u.uSigma, sx, sy);
      gl.uniform1f(init.u.uK, k0());
      gl.uniform1f(init.u.uAmp, 1 / Math.sqrt(2 * Math.PI * sx * sy)); // total probability 1
      for (const s of states) { gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo); drawFullscreen(gl); }
      cur = 0;
      run = { t: 0, closed, done: false };
      norm = { start: totalProbability(), now: 1 };
    }

    // Read a whole state texture back (used only occasionally).
    let readBuf = new Float32Array(0);
    let prevBuf = new Float32Array(0);
    function readAll(which = cur, into = null) {
      if (readBuf.length !== W * H * 4) { readBuf = new Float32Array(W * H * 4); prevBuf = new Float32Array(W * H * 4); }
      const buf = into || readBuf;
      gl.bindFramebuffer(gl.FRAMEBUFFER, states[which].fbo);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, buf);
      return buf;
    }
    // Total probability. Visscher's scheme conserves Σ R² + I(t + Δt/2)·I(t − Δt/2),
    // and the other texture still holds I from half a step earlier.
    function totalProbability() {
      const d = readAll(cur);
      const e = readAll(1 - cur, prevBuf);
      let sum = 0;
      for (let i = 0; i < W * H; i++) sum += d[4 * i] ** 2 + d[4 * i + 1] * e[4 * i + 1];
      return sum;
    }

    // When the packet has crossed the screen, keep the time-integrated
    // probability along the screen as this setup's detection pattern.
    function finishRun() {
      const d = readAll();
      const col = new Float64Array(H);
      for (let y = 0; y < H; y++) col[y] = d[4 * (y * W + geo.screenX) + 2];
      const key = run.closed === -1 ? 'both' : String(run.closed);
      patterns[key] = col;
      run.done = true;
    }

    // Draw one detection position from a pattern (the Born rule).
    function sample(pattern) {
      let total = 0;
      for (let y = SPONGE; y < H - SPONGE; y++) total += pattern[y];
      let r = Math.random() * total;
      for (let y = SPONGE; y < H - SPONGE; y++) { r -= pattern[y]; if (r <= 0) return y + Math.random() - 0.5; }
      return H / 2;
    }
    function detectionPattern() {
      if (!state.detector) return patterns.both ? [patterns.both] : null;
      return patterns['0'] && patterns['1'] ? [patterns['0'], patterns['1']] : null;
    }

    // Huygens prediction along the screen for a monochromatic wave of number k₀:
    // cylindrical wavelets e^{ikr}/√r from points across each open slit.
    function huygens() {
      const k = k0();
      const out = new Float64Array(H);
      const pts = [];
      for (const [lo, hi] of geo.slits) for (let j = 0; j < 6; j++) pts.push(lo + ((j + 0.5) / 6) * (hi - lo));
      for (let y = 0; y < H; y++) {
        let re = 0, im = 0;
        for (const py of pts) {
          const dx = geo.screenX - (geo.wallX + 3), dy = y - py;
          const r = Math.hypot(dx, dy);
          const amp = (0.5 * (1 + dx / r)) / Math.sqrt(r);
          re += amp * Math.cos(k * r); im += amp * Math.sin(k * r);
        }
        out[y] = re * re + im * im;
      }
      return out;
    }

    function fringeSpacing(curve) {
      const lo = SPONGE + 4, hi = H - SPONGE - 4;
      let max = 0;
      for (let y = lo; y < hi; y++) max = Math.max(max, curve[y]);
      const peaks = [];
      for (let y = lo + 2; y < hi - 2; y++) {
        const v = curve[y];
        if (v > 0.2 * max && v >= curve[y - 1] && v >= curve[y + 1] && v >= curve[y - 2] && v >= curve[y + 2]) peaks.push(y);
      }
      if (peaks.length < 2) return null;
      peaks.sort((a, b) => Math.abs(a - geo.yc) - Math.abs(b - geo.yc));
      const near = peaks.slice(0, Math.min(5, peaks.length)).sort((a, b) => a - b);
      return (near.at(-1) - near[0]) / (near.length - 1);
    }

    // ---- UI
    const hud = createHud(root, [['lambda', 'λ (de Broglie)'], ['electrons', 'Electrons'], ['fringes', 'Fringes'], ['norm', 'Total prob.']]);
    const panel = createPanel(root, { title: 'Quantum Double Slit', formula: 'i∂ψ/∂t = −½∇²ψ', signal });
    const detectorCheck = check({ label: 'Which-slit detector', checked: false, onChange: (on) => { state.detector = on; hits = []; launch(); } });
    const fireBtn = button({ label: 'Stop firing', primary: true, onClick: () => setFiring(!state.firing) });
    function setFiring(on) { state.firing = on; fireBtn.textContent = on ? 'Stop firing' : 'Fire electrons'; fireBtn.setAttribute('aria-pressed', String(on)); }
    const pauseBtn = button({ label: 'Pause', onClick: () => setPaused(!state.paused) });
    function setPaused(p) { state.paused = p; pauseBtn.textContent = p ? 'Resume' : 'Pause'; }

    panel.add(
      toggles(detectorCheck),
      slider({ label: 'Wavelength λ', min: 12, max: 28, value: state.lambda, format: (v) => `${v} cells`, onInput: (v) => { state.lambda = v; setup(); } }),
      slider({ label: 'Slit separation d', min: 20, max: 110, step: 2, value: state.sep, format: (v) => `${v} cells`, onInput: (v) => { state.sep = v; setup(); } }),
      slider({ label: 'Slit width a', min: 3, max: 20, value: state.width, format: (v) => `${v} cells`, onInput: (v) => { state.width = v; setup(); } }),
      slider({ label: 'Electrons per second', min: 1, max: 400, value: state.rate, onInput: (v) => { state.rate = v; } }),
      select({
        label: 'Show the wavefunction as',
        options: [{ value: '1', label: 'Phase (color) and size (brightness)' }, { value: '0', label: 'Probability |ψ|²' }],
        value: String(state.mode),
        onChange: (v) => { state.mode = +v; },
      }),
      slider({ label: 'Speed', min: 4, max: 60, step: 2, value: state.speed, format: (v) => `${v} steps/frame`, onInput: (v) => { state.speed = v; } }),
      slider({ label: 'Contrast', min: 0.2, max: 5, step: 0.05, value: state.gain, format: (v) => `${v.toFixed(2)}×`, onInput: (v) => { state.gain = v; } }),
      swatches({ palettes: PALETTES, value: state.palette, onChange: (i) => { state.palette = i; } }),
      actions(fireBtn, pauseBtn, button({ label: 'Clear screen', onClick: () => { hits = []; } })),
      note('Keys: <kbd>D</kbd> detector, <kbd>F</kbd> fire, <kbd>C</kbd> clear screen, <kbd>Space</kbd> pause, <kbd>H</kbd> panel.'),
      about(`<p>Fire electrons at a wall with two slits, one at a time, and each one lands on the screen as a single dot, like a particle. Yet after thousands of electrons the dots form bright and dark bands: an interference pattern, which only waves make. Akira Tonomura's team filmed exactly this in 1989. Richard Feynman called it the phenomenon that "has in it the heart of quantum mechanics".</p>
        <p>Each electron is described by a wavefunction ψ, which obeys the Schrödinger equation. The animation shows ψ: it goes through both slits and interferes with itself. Brightness is the size of ψ; in phase view, color is its complex phase, which turns once per wavelength. The chance of the electron landing at a spot is |ψ|² there (the Born rule), so each dot is drawn at random from the screen's |ψ|². Its wavelength is de Broglie's λ = h/p: faster electrons have shorter wavelengths and closer bands.</p>
        <p>Turn on the which-slit detector and every electron is found at one slit or the other. From then on it behaves as if only that slit were open, and the bands vanish: the screen shows the sum of two single-slit patterns. Knowing the path and seeing interference exclude each other.</p>
        <p>The simulation uses Visscher's method on a grid (ħ = m = 1). The "Total prob." readout checks that the probability of the electron being somewhere stays 1 until it reaches the absorbing edges. The measured fringe spacing agrees with a Huygens calculation to within a few percent. Below about 12 cells per wavelength the grid itself starts to distort the waves, so the slider stops there.</p>`),
    );

    attachKeys({
      d: () => { state.detector = !state.detector; detectorCheck.input.checked = state.detector; hits = []; launch(); },
      f: () => setFiring(!state.firing),
      c: () => { hits = []; },
      ' ': () => setPaused(!state.paused),
      h: () => { panel.toggle(); setup(); },
    }, signal);
    let resizeTimer = 0;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { allocate(); setup(); }, 150); }, { signal });

    allocate();
    setFiring(true);
    let frame = 0;

    startLoop(signal, (now, dt) => {
      const s = dpr();
      const cw = Math.round(canvas.clientWidth * s), ch = Math.round(canvas.clientHeight * s);
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = overlay.width = cw; canvas.height = overlay.height = ch; }
      frame++;

      // ---- simulate the current electron's wavefunction
      if (!state.paused) {
        gl.useProgram(step.program);
        gl.viewport(0, 0, W, H);
        gl.uniform1i(step.u.uState, 0);
        gl.uniform1i(step.u.uWall, 1);
        gl.uniform1f(step.u.uDt, DT);
        gl.uniform2f(step.u.uGrid, W, H);
        gl.uniform1f(step.u.uSponge, SPONGE);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, wallTex);
        for (let k = 0; k < state.speed; k++) {
          for (const part of [0, 1]) {
            gl.uniform1i(step.u.uPart, part);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, states[cur].tex);
            gl.bindFramebuffer(gl.FRAMEBUFFER, states[1 - cur].fbo);
            drawFullscreen(gl);
            cur = 1 - cur;
          }
          run.t += DT;
        }
        // Packet tail has passed the screen: record the pattern, start the next electron.
        const travel = (geo.screenX - geo.x0 + 5 * geo.sigma[0]) / groupVelocity();
        if (run.t > travel) {
          if (!run.done) finishRun();
          launch();
        } else if (frame % 30 === 0 && run.t < (geo.sigma[0] + 6 + 0.8 * (geo.wallX - SPONGE)) / groupVelocity()) {
          // Until the reflected wave reaches the absorbing edge, total probability should stay 1.
          norm.now = totalProbability() / norm.start;
        }
      }

      // ---- detections: dots drawn from the recorded pattern
      const pat = detectionPattern();
      if (pat && state.firing && !state.paused) {
        hitAcc += (dt / 1000) * state.rate;
        while (hitAcc >= 1 && hits.length < 60000) {
          hits.push(sample(pat[Math.floor(Math.random() * pat.length)]));
          hitAcc -= 1;
        }
      }

      // ---- draw the wavefunction
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cw, ch);
      gl.useProgram(show.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, states[cur].tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, wallTex);
      gl.uniform1i(show.u.uState, 0);
      gl.uniform1i(show.u.uWall, 1);
      gl.uniform2f(show.u.uCanvas, cw, ch);
      gl.uniform2f(show.u.uGrid, W, H);
      gl.uniform1i(show.u.uMode, state.mode);
      // Gain relative to the packet's starting peak density.
      gl.uniform1f(show.u.uGain, 2 * Math.PI * geo.sigma[0] * geo.sigma[1] * 6 * state.gain);
      gl.uniform3fv(show.u.uStops, paletteRgb(state.palette));
      drawFullscreen(gl);

      // ---- overlay: detector screen with dots, histogram and |ψ|² curve
      octx.clearRect(0, 0, cw, ch);
      const px = cw / W, py = ch / H;
      const X = (gx) => gx * px, Y = (gy) => ch - gy * py;
      const plateW = Math.max(30, geo.vis - geo.screenX - 6) * px;
      octx.fillStyle = 'rgba(5, 6, 10, 0.9)';
      octx.fillRect(X(geo.screenX), Y(H - SPONGE), plateW, (H - 2 * SPONGE) * py);
      octx.strokeStyle = 'rgba(232, 235, 243, 0.45)';
      octx.lineWidth = s;
      octx.strokeRect(X(geo.screenX), Y(H - SPONGE), plateW, (H - 2 * SPONGE) * py);
      // Dots: each is one electron; x within the plate is only for display.
      octx.fillStyle = 'rgba(255, 214, 140, 0.8)';
      const dot = Math.max(1, 1.3 * s);
      let seed = 12345;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const dotW = plateW * 0.45;
      for (const y of hits) octx.fillRect(X(geo.screenX) + 3 * s + rand() * (dotW - 6 * s), Y(y), dot, dot);
      // Histogram of hits and the |ψ|² prediction, in the right half of the plate.
      const bins = Math.max(20, Math.round((H - 2 * SPONGE) / 3));
      if (hits.length > 20) {
        const hist = new Float64Array(bins);
        for (const y of hits) { const b = Math.floor(((y - SPONGE) / (H - 2 * SPONGE)) * bins); if (b >= 0 && b < bins) hist[b]++; }
        const hmax = Math.max(...hist);
        octx.fillStyle = 'rgba(255, 170, 0, 0.55)';
        const bh = ((H - 2 * SPONGE) / bins) * py;
        for (let b = 0; b < bins; b++) {
          const wBar = (hist[b] / hmax) * (plateW * 0.5);
          octx.fillRect(X(geo.screenX) + plateW * 0.48, Y(SPONGE + ((b + 1) * (H - 2 * SPONGE)) / bins), wBar, bh - 0.5);
        }
      }
      if (pat) {
        const curve = new Float64Array(H);
        for (const p of pat) for (let y = 0; y < H; y++) curve[y] += p[y];
        let max = 0;
        for (let y = SPONGE; y < H - SPONGE; y++) max = Math.max(max, curve[y]);
        octx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        octx.lineWidth = 1.3 * s;
        octx.beginPath();
        for (let y = SPONGE; y < H - SPONGE; y++) {
          const x = X(geo.screenX) + plateW * 0.48 + (curve[y] / max) * plateW * 0.5;
          if (y === SPONGE) octx.moveTo(x, Y(y)); else octx.lineTo(x, Y(y));
        }
        octx.stroke();
      }
      octx.font = `${11 * s}px "Chivo Mono", ui-monospace, monospace`;
      octx.fillStyle = 'rgba(232, 235, 243, 0.75)';
      octx.fillText('detector screen', X(geo.screenX), Y(H - SPONGE) - 6 * s);

      // ---- readout
      hud.set('lambda', `${state.lambda} cells (k = ${k0().toFixed(3)})`);
      hud.set('electrons', `${hits.length.toLocaleString('en-US')} detected`);
      if (pat) {
        const curve = new Float64Array(H);
        for (const p of pat) for (let y = 0; y < H; y++) curve[y] += p[y];
        const m = fringeSpacing(curve);
        if (!geo.predicted) geo.predicted = fringeSpacing(huygens());
        hud.set('fringes', state.detector ? 'none expected (detector on)' : m ? `spacing ${m.toFixed(1)} cells (Huygens: ${geo.predicted ? geo.predicted.toFixed(1) : '—'})` : '—');
      } else {
        hud.set('fringes', state.detector ? 'measuring both slits…' : 'first electron in flight…');
      }
      hud.set('norm', norm.now.toFixed(6));
      hud.note(state.detector ? `Detector on: this electron went through the ${run.closed === 0 ? 'upper' : 'lower'} slit.` : '');
    });

    return () => releaseGL(gl);
  },
};
