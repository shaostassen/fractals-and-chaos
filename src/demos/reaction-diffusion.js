import { PALETTES, PALETTE_GLSL, paletteRgb } from '../shared/palettes.js';
import { startLoop, AdaptiveScale, dpr } from '../shared/loop.js';
import { attachKeys } from '../shared/panzoom.js';
import { createGL, createProgram, drawFullscreen, releaseGL, resizeCanvas, onContextLost } from '../shared/gl.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about, swatches, showError,
} from '../shared/ui.js';

// Karl Sims's units: grid spacing 1, time step 1, Du = 1, Dv = 0.5 with a
// 9-point Laplacian. Pearson's (F, k) values carry over unchanged; only the
// pattern size in cells differs between formulations.
const DU = 1.0;
const DV = 0.5;

// Each preset checked by running it from random blobs for several thousand steps.
const PRESETS = [
  { name: 'Coral growth', F: 0.0545, k: 0.062 },
  { name: 'Mitosis', F: 0.0367, k: 0.0649 },
  { name: 'Spots', F: 0.03, k: 0.062 },
  { name: 'Worms', F: 0.058, k: 0.065 },
  { name: 'Labyrinth', F: 0.029, k: 0.057 },
  { name: 'Holes', F: 0.039, k: 0.058 },
  { name: 'Chaos', F: 0.018, k: 0.051 },
  { name: 'Crescent waves', F: 0.01, k: 0.047 },
];

// Parameter map: k grows to the right, F grows upward on a square-root scale,
// which gives the low-F waves and chaos room next to the spots and worms.
const MAP = { k0: 0.042, k1: 0.07, F0: 0, F1: 0.09 };
const mapK = (fx) => MAP.k0 + fx * (MAP.k1 - MAP.k0);
const mapF = (fy) => MAP.F0 + fy * fy * (MAP.F1 - MAP.F0);
const mapX = (k) => (k - MAP.k0) / (MAP.k1 - MAP.k0);
const mapY = (F) => Math.sqrt(Math.max(0, (F - MAP.F0) / (MAP.F1 - MAP.F0)));

const MAX_CELLS = 1024; // longest side of the grid

// Two storage formats: float (needs EXT_color_buffer_float) or, as a fallback,
// u and v as 16-bit fixed point packed into the four bytes of RGBA8.
const CODEC = `
#ifdef PACKED
vec2 decode(vec4 t) { return vec2(dot(t.rg, vec2(65280.0, 255.0)), dot(t.ba, vec2(65280.0, 255.0))) / 65535.0; }
vec4 encode(vec2 s) {
  vec2 n = floor(clamp(s, 0.0, 1.0) * 65535.0 + 0.5);
  vec2 hi = floor(n / 256.0);
  vec2 lo = n - hi * 256.0;
  return vec4(hi.x, lo.x, hi.y, lo.y) / 255.0;
}
#else
vec2 decode(vec4 t) { return t.rg; }
vec4 encode(vec2 s) { return vec4(s, 0.0, 1.0); }
#endif`;

const header = (fmt) => `#version 300 es
${fmt.packed ? '#define PACKED 1' : ''}
${fmt.linear ? '#define LINEAR 1' : ''}
precision highp float;
precision highp int;
precision highp sampler2D;
${CODEC}`;

// One explicit Euler step of the Gray–Scott equations, plus the paint brush.
const SIM_FS = (fmt) => `${header(fmt)}
uniform sampler2D uState;
uniform ivec2 uSize;
uniform vec2 uFk;
uniform bool uMap;
uniform vec4 uMapRange; // k0, k1, F0, F1
uniform float uDt;
uniform vec4 uSeg;      // brush stroke from xy to zw, in cells
uniform float uBrushR;  // 0 = no brush this step
uniform vec2 uInk;      // (u, v) the brush paints
uniform float uSeed;
out vec4 outColor;

// Periodic edges normally; zero-flux edges on the map, whose sides differ.
vec2 at(ivec2 p) {
  p = uMap ? clamp(p, ivec2(0), uSize - 1) : (p + uSize) % uSize;
  return decode(texelFetch(uState, p, 0));
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 c = at(p);
  // Weights: -1 centre, 0.2 edges, 0.05 corners (they sum to zero).
  vec2 lap = -c
    + 0.2 * (at(p + ivec2(1, 0)) + at(p - ivec2(1, 0)) + at(p + ivec2(0, 1)) + at(p - ivec2(0, 1)))
    + 0.05 * (at(p + ivec2(1, 1)) + at(p + ivec2(-1, 1)) + at(p + ivec2(1, -1)) + at(p - ivec2(1, 1)));
  vec2 fk = uFk;
  if (uMap) {
    vec2 f = (vec2(p) + 0.5) / vec2(uSize);
    fk = vec2(mix(uMapRange.z, uMapRange.w, f.y * f.y), mix(uMapRange.x, uMapRange.y, f.x));
  }
  float u = c.x;
  float v = c.y;
  float uvv = u * v * v;
  vec2 next = c + uDt * vec2(${DU.toFixed(4)} * lap.x - uvv + fk.x * (1.0 - u), ${DV.toFixed(4)} * lap.y + uvv - (fk.x + fk.y) * v);

  if (uBrushR > 0.0) {
    // Distance to the stroke segment, using the nearest periodic copy of this cell.
    vec2 size = vec2(uSize);
    vec2 q = vec2(p) + 0.5 - uSeg.xy;
    q -= size * round(q / size);
    vec2 ab = uSeg.zw - uSeg.xy;
    float t = clamp(dot(q, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float w = 1.0 - smoothstep(uBrushR * 0.6, uBrushR, length(q - ab * t));
    // A little noise breaks the symmetry of a perfectly round dab.
    next = mix(next, uInk + vec2(0.0, uInk.y * 0.08 * (hash(vec2(p)) - 0.5)), w);
  }
  outColor = encode(clamp(next, 0.0, 1.0));
}`;

// Raw copy that tiles the source, used to resize the grid without losing the pattern.
const COPY_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uSrc;
uniform ivec2 uSrcSize;
out vec4 outColor;
void main() { outColor = texelFetch(uSrc, ivec2(gl_FragCoord.xy) % uSrcSize, 0); }`;

// Colour by V, with light from the upper left as if V were height.
const DISPLAY_FS = (fmt) => `${header(fmt)}
uniform sampler2D uState;
uniform ivec2 uSize;
uniform vec2 uView;
uniform bool uMap;
uniform float uRelief;
${PALETTE_GLSL}
out vec4 outColor;

#ifdef LINEAR
// Hardware bilinear filtering; the texture's wrap mode handles the edges.
float sampleV(vec2 g) { return texture(uState, g / vec2(uSize)).g; }
#else
float vAt(ivec2 p) {
  p = uMap ? clamp(p, ivec2(0), uSize - 1) : (p + uSize) % uSize;
  return decode(texelFetch(uState, p, 0)).y;
}

// Bilinear by hand, for packed values or float textures that can't be filtered.
float sampleV(vec2 g) {
  g -= 0.5;
  ivec2 i = ivec2(floor(g));
  vec2 f = g - floor(g);
  return mix(mix(vAt(i), vAt(i + ivec2(1, 0)), f.x), mix(vAt(i + ivec2(0, 1)), vAt(i + ivec2(1, 1)), f.x), f.y);
}
#endif

void main() {
  vec2 g = gl_FragCoord.xy / uView * vec2(uSize);
  float v = sampleV(g);
  vec2 grad = vec2(sampleV(g + vec2(1.0, 0.0)) - sampleV(g - vec2(1.0, 0.0)),
                   sampleV(g + vec2(0.0, 1.0)) - sampleV(g - vec2(0.0, 1.0)));
  vec3 n = normalize(vec3(-grad * 5.0, 1.0));
  vec3 light = normalize(vec3(-0.55, 0.65, 0.75));
  float diffuse = max(dot(n, light), 0.0);
  float spec = pow(max(dot(reflect(-light, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
  vec3 col = palette(0.6 * smoothstep(0.0, 0.42, v));
  vec3 lit = col * (0.42 + 0.75 * diffuse) + spec * 0.3 * smoothstep(0.05, 0.25, v);
  outColor = vec4(mix(col, lit, uRelief), 1.0);
}`;

export default {
  id: 'reaction-diffusion',
  title: 'Reaction–Diffusion',
  area: 'Patterns',
  formula: 'u′ = D<sub>u</sub>∇²u − uv² + F(1 − u)',
  blurb: 'Two chemicals that spread and react grow spots, stripes, worms and dividing cells. Explore the map of every pattern, or paint your own.',

  mount(root, { signal }) {
    const canvas = el('canvas', { class: 'stage', style: { cursor: 'crosshair' }, 'aria-label': 'Reaction–diffusion simulation. Drag to paint chemical V.' });
    const overlay = el('canvas', { class: 'stage', style: { pointerEvents: 'none', background: 'transparent' } });
    root.append(canvas, overlay);
    const octx = overlay.getContext('2d');
    let gl;
    let fmt;
    let sim;
    let copy;
    let display;
    try {
      gl = createGL(canvas);
      fmt = pickFormat(gl);
      sim = createProgram(gl, SIM_FS(fmt));
      copy = createProgram(gl, COPY_FS);
      display = createProgram(gl, DISPLAY_FS(fmt));
    } catch (err) {
      showError(root, err.message);
      return;
    }
    onContextLost(canvas, root, signal, showError);

    const state = {
      preset: 0, F: PRESETS[0].F, k: PRESETS[0].k, speed: 20, brush: 32, cell: 2,
      palette: 3, relief: true, paused: false, map: false,
    };

    // ---- grid: two ping-pong targets, plus a copy of the field while the map is open
    let W = 0;
    let H = 0;
    let targets = [];
    let cur = 0;
    let saved = null;
    let savedSteps = 0;
    let steps = 0;
    let overlayDirty = true;

    function makeTarget(w, h) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const filter = fmt.linear ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fmt.internal, w, h);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo, w, h };
    }
    function freeTarget(t) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    // Copy src into a new w × h target, tiling it if the new one is larger.
    function resized(src, w, h) {
      const dst = makeTarget(w, h);
      gl.viewport(0, 0, w, h);
      gl.useProgram(copy.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(copy.u.uSrc, 0);
      gl.uniform2i(copy.u.uSrcSize, src.w, src.h);
      drawFullscreen(gl);
      freeTarget(src);
      return dst;
    }

    function gridSize() {
      const cw = canvas.clientWidth || 1;
      const ch = canvas.clientHeight || 1;
      const cell = Math.max(state.cell, Math.max(cw, ch) / MAX_CELLS);
      return [Math.max(16, Math.round(cw / cell)), Math.max(16, Math.round(ch / cell))];
    }

    function ensureGrid() {
      const [w, h] = gridSize();
      if (w === W && h === H) return;
      const fresh = !targets.length;
      if (fresh) targets = [makeTarget(w, h), makeTarget(w, h)];
      else {
        targets[cur] = resized(targets[cur], w, h);
        freeTarget(targets[1 - cur]);
        targets[1 - cur] = makeTarget(w, h);
        if (saved) saved = resized(saved, w, h);
      }
      W = w;
      H = h;
      cellSlider.setText(`${state.cell} px · ${W}×${H}`);
      if (fresh) seed('blobs');
      overlayDirty = true;
    }

    // Fill the field on the CPU: u = 1, v = 0, plus blobs of u = 0.5, v = 0.25.
    function seed(kind) {
      const u = new Float32Array(W * H).fill(1);
      const v = new Float32Array(W * H);
      const blob = (cx, cy, r) => {
        for (let y = Math.floor(cy - r); y <= cy + r; y++) {
          for (let x = Math.floor(cx - r); x <= cx + r; x++) {
            if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
            const i = ((y + H) % H) * W + ((x + W) % W);
            u[i] = 0.5;
            v[i] = 0.25 + 0.02 * (Math.random() - 0.5);
          }
        }
      };
      if (kind === 'blobs') {
        const count = Math.max(6, Math.round((W * H) / 3500));
        for (let i = 0; i < count; i++) blob(Math.random() * W, Math.random() * H, 3 + Math.random() * 5);
      } else if (kind === 'map') {
        // A jittered lattice, so every region of the map gets a few seeds.
        const gap = 18;
        for (let y = gap / 2; y < H; y += gap) {
          for (let x = gap / 2; x < W; x += gap) blob(x + (Math.random() - 0.5) * gap * 0.5, y + (Math.random() - 0.5) * gap * 0.5, 4);
        }
      }
      upload(u, v);
      steps = 0;
    }

    function upload(u, v) {
      let data;
      if (fmt.packed) {
        data = new Uint8Array(W * H * 4);
        for (let i = 0; i < W * H; i++) {
          const a = Math.round(u[i] * 65535);
          const b = Math.round(v[i] * 65535);
          data[4 * i] = a >> 8; data[4 * i + 1] = a & 255; data[4 * i + 2] = b >> 8; data[4 * i + 3] = b & 255;
        }
      } else {
        data = new Float32Array(W * H * 2);
        for (let i = 0; i < W * H; i++) { data[2 * i] = u[i]; data[2 * i + 1] = v[i]; }
      }
      gl.bindTexture(gl.TEXTURE_2D, targets[cur].tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, fmt.format, fmt.type, data);
    }

    // ---- painting
    const brush = { down: false, erase: false, last: null, at: null };
    const toCells = (e) => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * W, (1 - (e.clientY - r.top) / r.height) * H];
    };

    // Run n simulation steps (n = 0 still applies the brush).
    function simulate(n) {
      const stroke = brush.down && brush.at && !state.map;
      if (!n && !stroke) return;
      gl.viewport(0, 0, W, H);
      gl.useProgram(sim.program);
      const u = sim.u;
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(u.uState, 0);
      gl.uniform2i(u.uSize, W, H);
      gl.uniform2f(u.uFk, state.F, state.k);
      gl.uniform1i(u.uMap, state.map ? 1 : 0);
      gl.uniform4f(u.uMapRange, MAP.k0, MAP.k1, MAP.F0, MAP.F1);
      gl.uniform1f(u.uSeed, Math.random() * 100);
      gl.uniform1f(u.uDt, n ? 1 : 0);
      const radius = Math.max(1.5, (state.brush / 2) * (W / canvas.clientWidth));
      if (stroke) {
        // Stamp along the path since the last frame, so fast strokes stay continuous.
        const a = brush.last || brush.at;
        gl.uniform4f(u.uSeg, a[0], a[1], brush.at[0], brush.at[1]);
        gl.uniform2f(u.uInk, brush.erase ? 1 : 0.5, brush.erase ? 0 : 0.25);
        brush.last = brush.at;
      }
      for (let i = 0; i < Math.max(n, 1); i++) {
        gl.uniform1f(u.uBrushR, i === 0 && stroke ? radius : 0);
        gl.bindTexture(gl.TEXTURE_2D, targets[cur].tex);
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets[1 - cur].fbo);
        drawFullscreen(gl);
        cur = 1 - cur;
      }
      steps += n;
    }

    // ---- UI
    const hud = createHud(root, [['preset', 'Pattern'], ['F', 'Feed F'], ['k', 'Kill k'], ['speed', 'Speed'], ['steps', 'Steps']]);
    const panel = createPanel(root, { title: 'Reaction–Diffusion', formula: 'Gray–Scott model', signal });
    const presetSelect = select({
      label: 'Preset',
      options: [{ value: '', label: 'Custom', hidden: true }, ...PRESETS.map((p, i) => ({ value: String(i), label: p.name }))],
      value: '0',
      onChange: (v) => { if (v !== '') setPreset(+v); },
    });
    const fSlider = slider({
      label: 'Feed rate F', min: 0, max: 0.1, step: 0.0001, value: state.F, format: (v) => v.toFixed(4),
      onInput: (v) => setFk(v, state.k),
    });
    const kSlider = slider({
      label: 'Kill rate k', min: 0.035, max: 0.075, step: 0.0001, value: state.k, format: (v) => v.toFixed(4),
      onInput: (v) => setFk(state.F, v),
    });
    const mapBtn = button({ label: 'Show parameter map', primary: true, onClick: () => setMap(!state.map) });
    const cellSlider = slider({
      label: 'Cell size', min: 1, max: 4, step: 0.5, value: state.cell, format: (v) => `${v} px`,
      onInput: (v) => { state.cell = v; },
    });
    const pauseCheck = check({ label: 'Pause', checked: false, onChange: (on) => { state.paused = on; } });

    panel.add(
      presetSelect,
      actions(mapBtn,
        button({ label: 'Seed randomly', onClick: () => reseed() }),
        button({ label: 'Clear', onClick: () => clear() })),
      fSlider,
      kSlider,
      slider({ label: 'Speed', min: 1, max: 40, step: 1, value: state.speed, format: (v) => `${v} steps/frame`, onInput: (v) => { state.speed = v; } }),
      slider({ label: 'Brush size', min: 8, max: 120, step: 1, value: state.brush, format: (v) => `${v} px`, onInput: (v) => { state.brush = v; } }),
      cellSlider,
      swatches({ palettes: PALETTES, value: state.palette, onChange: (i) => { state.palette = i; } }),
      toggles(
        check({ label: 'Relief shading', checked: state.relief, onChange: (on) => { state.relief = on; } }),
        pauseCheck),
      note('Drag on the picture to add chemical V. Shift-drag or right-drag to erase. Keys: <kbd>M</kbd> parameter map, <kbd>Space</kbd> pause, <kbd>R</kbd> reseed, <kbd>C</kbd> clear, <kbd>H</kbd> panel.'),
      about(`<p>Two chemicals, U and V, spread through a thin layer and react with each other. U is fed in everywhere at the feed rate <i>F</i>. The reaction U + 2V → 3V turns U into more V, so V grows by consuming U. V is removed at rate <i>F</i> + <i>k</i>, where <i>k</i> is the kill rate. The colors show how much V there is.</p>
        <p><i>∂u/∂t = D<sub>u</sub>∇²u − uv² + F(1 − u)</i><br><i>∂v/∂t = D<sub>v</sub>∇²v + uv² − (F + k)v</i></p>
        <p>The key is that U spreads twice as fast as V. In 1952 Alan Turing showed that two substances that react and diffuse at different rates can turn an even mix into stable spots and stripes, and suggested this is how animals get the patterns on their coats. A patch of V grows where it is, but it uses up the U around it, which holds back new patches nearby.</p>
        <p>In 1993 John Pearson simulated this model, the Gray–Scott model, and sorted its patterns (spots that divide like cells, worms, mazes, holes, chaotic waves) by where they appear in the (<i>F</i>, <i>k</i>) plane. The parameter map shows the whole plane at once: every point of the picture runs with its own <i>F</i> and <i>k</i>. Patterns live along a thin band. Above and to the left of it the two chemicals settle into an even mix; below and to the right, V dies out.</p>
        <p>Simulated on the GPU with D<sub>u</sub> = 1, D<sub>v</sub> = 0.5, a time step of 1 and a 9-point Laplacian on a grid that wraps around at the edges.</p>`),
    );

    function setPreset(i) {
      state.preset = i;
      presetSelect.input.value = String(i);
      state.F = PRESETS[i].F;
      state.k = PRESETS[i].k;
      fSlider.set(state.F);
      kSlider.set(state.k);
      if (state.map) setMap(false, false);
      seed('blobs');
      overlayDirty = true;
    }

    // Live change from the sliders or a map click; snaps to a preset if it matches one.
    function setFk(F, k) {
      state.F = F;
      state.k = k;
      const i = PRESETS.findIndex((p) => Math.abs(p.F - F) < 5e-5 && Math.abs(p.k - k) < 5e-5);
      state.preset = i;
      presetSelect.input.value = i < 0 ? '' : String(i);
      overlayDirty = true;
    }

    // Opening the map keeps a copy of the field; closing without a pick restores it.
    function setMap(on, restore = true) {
      if (on === state.map) return;
      state.map = on;
      brush.down = false;
      hover = null;
      if (on) {
        saved = resized(targets[cur], W, H);
        savedSteps = steps;
        targets[cur] = makeTarget(W, H);
        seed('map');
      } else if (saved) {
        if (restore) {
          freeTarget(targets[cur]);
          targets[cur] = saved;
          steps = savedSteps;
        } else freeTarget(saved);
        saved = null;
      }
      mapBtn.textContent = on ? 'Back to simulation' : 'Show parameter map';
      mapBtn.setAttribute('aria-pressed', String(on));
      canvas.setAttribute('aria-label', on
        ? 'Parameter map: feed rate F increases upward, kill rate k to the right. Click to choose a point.'
        : 'Reaction–diffusion simulation. Drag to paint chemical V.');
      overlayDirty = true;
    }

    function reseed() {
      if (state.map) seed('map');
      else seed('blobs');
    }

    function clear() {
      if (state.map) setMap(false, false);
      seed('none');
    }

    function setPaused(p) {
      state.paused = p;
      pauseCheck.input.checked = p;
    }

    // ---- pointer: paint in the simulation, pick (F, k) on the map
    let hover = null;
    let press = null;
    const opts = { signal };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      if (state.map) { press = [e.clientX, e.clientY]; return; }
      brush.down = true;
      brush.erase = e.shiftKey || e.button === 2;
      brush.last = null;
      brush.at = toCells(e);
    }, opts);
    canvas.addEventListener('pointermove', (e) => {
      if (state.map) {
        const r = canvas.getBoundingClientRect();
        hover = [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
        overlayDirty = true;
      } else if (brush.down) brush.at = toCells(e);
    }, opts);
    const release = (e) => {
      if (state.map && press && e.type === 'pointerup' && Math.hypot(e.clientX - press[0], e.clientY - press[1]) < 8) {
        const r = canvas.getBoundingClientRect();
        pickMap((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
      }
      press = null;
      brush.down = false;
    };
    canvas.addEventListener('pointerup', release, opts);
    canvas.addEventListener('pointercancel', release, opts);
    canvas.addEventListener('pointerleave', () => { hover = null; overlayDirty = true; }, opts);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), opts);

    function pickMap(fx, fy) {
      fx = Math.min(1, Math.max(0, fx));
      fy = Math.min(1, Math.max(0, fy));
      // Snap to a preset marker if the click is on it.
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      const near = PRESETS.findIndex((p) => Math.hypot((mapX(p.k) - fx) * cw, (mapY(p.F) - fy) * ch) < 12);
      if (near >= 0) { setPreset(near); return; }
      const F = Math.round(mapF(fy) * 1e4) / 1e4;
      const k = Math.round(mapK(fx) * 1e4) / 1e4;
      fSlider.set(F);
      kSlider.set(k);
      setFk(F, k);
      setMap(false, false);
      seed('blobs');
    }

    attachKeys({
      m: () => setMap(!state.map),
      ' ': () => setPaused(!state.paused),
      r: () => reseed(),
      c: () => clear(),
      h: () => panel.toggle(),
    }, signal);

    // ---- map labels, drawn on a 2D canvas over the simulation
    function drawOverlay() {
      const s = dpr();
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      overlay.width = Math.round(cw * s);
      overlay.height = Math.round(ch * s);
      octx.setTransform(s, 0, 0, s, 0, 0);
      octx.clearRect(0, 0, cw, ch);
      if (!state.map) return;
      const px = (k) => mapX(k) * cw;
      const py = (F) => (1 - mapY(F)) * ch;
      octx.font = '11px "Chivo Mono", ui-monospace, monospace';
      octx.lineWidth = 1;

      // Ticks along the bottom (k) and left (F) edges; on phones the k axis
      // sits above the floating buttons.
      const base = window.matchMedia('(max-width: 640px)').matches ? ch - 62 : ch;
      octx.fillStyle = 'rgba(232, 235, 243, 0.75)';
      octx.strokeStyle = 'rgba(232, 235, 243, 0.45)';
      octx.textBaseline = 'bottom';
      octx.textAlign = 'center';
      for (let k = 0.045; k < MAP.k1 - 0.001; k += 0.005) {
        octx.beginPath(); octx.moveTo(px(k), base); octx.lineTo(px(k), base - 6); octx.stroke();
        octx.fillText(k.toFixed(3), px(k), base - 8);
      }
      octx.textAlign = 'right';
      octx.fillText('kill rate k →', cw - 8, base - 22);
      octx.textAlign = 'left';
      octx.textBaseline = 'middle';
      for (const F of [0.005, 0.01, 0.02, 0.03, 0.04, 0.06, 0.08]) {
        octx.beginPath(); octx.moveTo(0, py(F)); octx.lineTo(6, py(F)); octx.stroke();
        octx.fillText(F.toFixed(3), 9, py(F));
      }
      octx.fillText('↑ feed rate F', 9, py(0.005) + 16);

      // Presets, and the current (F, k).
      for (const p of PRESETS) {
        const x = px(p.k);
        const y = py(p.F);
        octx.strokeStyle = 'rgba(5, 6, 10, 0.9)';
        octx.lineWidth = 3;
        octx.beginPath(); octx.arc(x, y, 5, 0, Math.PI * 2); octx.stroke();
        octx.strokeStyle = '#e8ebf3';
        octx.lineWidth = 1.5;
        octx.beginPath(); octx.arc(x, y, 5, 0, Math.PI * 2); octx.stroke();
        label(p.name, x + 9, y);
      }
      const x = px(state.k);
      const y = py(state.F);
      octx.strokeStyle = '#ffaa00';
      octx.lineWidth = 2;
      octx.beginPath();
      octx.moveTo(x - 12, y); octx.lineTo(x - 6, y); octx.moveTo(x + 6, y); octx.lineTo(x + 12, y);
      octx.moveTo(x, y - 12); octx.lineTo(x, y - 6); octx.moveTo(x, y + 6); octx.lineTo(x, y + 12);
      octx.stroke();

      if (hover) {
        const hx = hover[0] * cw;
        const hy = (1 - hover[1]) * ch;
        octx.strokeStyle = 'rgba(232, 235, 243, 0.4)';
        octx.lineWidth = 1;
        octx.setLineDash([3, 4]);
        octx.beginPath(); octx.moveTo(hx, 0); octx.lineTo(hx, ch); octx.moveTo(0, hy); octx.lineTo(cw, hy); octx.stroke();
        octx.setLineDash([]);
        const text = `F ${mapF(hover[1]).toFixed(4)}  k ${mapK(hover[0]).toFixed(4)}`;
        const flip = hx > cw - 190;
        label(text, flip ? hx - 10 : hx + 10, hy - 14, flip);
      }
    }
    function label(text, x, y, alignRight = false) {
      const w = octx.measureText(text).width;
      const left = alignRight ? x - w : x;
      octx.fillStyle = 'rgba(5, 6, 10, 0.72)';
      octx.fillRect(left - 4, y - 9, w + 8, 18);
      octx.fillStyle = '#e8ebf3';
      octx.textAlign = 'left';
      octx.textBaseline = 'middle';
      octx.fillText(text, left, y);
    }
    window.addEventListener('resize', () => { overlayDirty = true; }, opts);

    // ---- frame loop
    // Fewer steps per frame when frames get slow, but never below a fifth:
    // when drawing is the slow part, cutting steps would not help.
    const scaler = new AdaptiveScale({ min: 0.2 });
    let rate = 0;
    let rateSteps = 0;
    let rateTime = performance.now();

    startLoop(signal, (now, dt) => {
      resizeCanvas(canvas, dpr());
      ensureGrid();

      const factor = scaler.update(dt, !state.paused);
      scaler.renderedLast = true;
      const n = state.paused ? 0 : Math.max(1, Math.round(state.speed * factor));
      simulate(n);
      rateSteps += n;
      if (now - rateTime > 500) {
        rate = (rateSteps * 1000) / (now - rateTime);
        rateSteps = 0;
        rateTime = now;
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(display.program);
      const u = display.u;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, targets[cur].tex);
      // Wrap for the periodic simulation, clamp for the map.
      const wrap = state.map ? gl.CLAMP_TO_EDGE : gl.REPEAT;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      gl.uniform1i(u.uState, 0);
      gl.uniform2i(u.uSize, W, H);
      gl.uniform2f(u.uView, canvas.width, canvas.height);
      gl.uniform1i(u.uMap, state.map ? 1 : 0);
      gl.uniform1f(u.uRelief, state.relief ? 1 : 0);
      gl.uniform3fv(u.uStops, paletteRgb(state.palette));
      drawFullscreen(gl);

      if (overlayDirty) { drawOverlay(); overlayDirty = false; }

      if (state.map) {
        hud.set('preset', 'Parameter map');
        hud.set('F', hover ? mapF(hover[1]).toFixed(4) : `${MAP.F0}–${MAP.F1} ↑`);
        hud.set('k', hover ? mapK(hover[0]).toFixed(4) : `${MAP.k0}–${MAP.k1} →`);
        hud.note('Each point has its own F and k. Click one to try it.');
      } else {
        hud.set('preset', state.preset >= 0 ? PRESETS[state.preset].name : 'Custom');
        hud.set('F', state.F.toFixed(4));
        hud.set('k', state.k.toFixed(4));
        hud.note(state.paused ? 'Paused' : '');
      }
      hud.set('speed', `${Math.round(rate).toLocaleString('en-US')} steps/s`);
      hud.set('steps', steps.toLocaleString('en-US'));
    });

    return () => releaseGL(gl);
  },
};

// Float storage when the GPU can render to float textures, otherwise packed bytes.
function pickFormat(gl) {
  if (gl.getExtension('EXT_color_buffer_float')) {
    const linear = !!gl.getExtension('OES_texture_float_linear');
    const fmt = { internal: gl.RG32F, format: gl.RG, type: gl.FLOAT, packed: false, linear };
    if (renderable(gl, fmt.internal)) return fmt;
  }
  return { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, packed: true, linear: false };
}

function renderable(gl, internal) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internal, 4, 4);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  return ok;
}
