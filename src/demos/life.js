import { PALETTES, PALETTE_GLSL, paletteRgb } from '../shared/palettes.js';
import { startLoop, dpr } from '../shared/loop.js';
import { attachKeys } from '../shared/panzoom.js';
import { createGL, createProgram, drawFullscreen, releaseGL, resizeCanvas, onContextLost } from '../shared/gl.js';
import {
  el, createPanel, createHud, slider, select, button, actions, note, about, swatches, showError,
} from '../shared/ui.js';

// Life-like rules in B/S notation. A third number is the Generations
// extension: cells that fail to survive spend that many steps dying.
const RULES = [
  { name: "Conway's Life", short: 'Conway', rule: 'B3/S23' },
  { name: 'HighLife', short: 'HighLife', rule: 'B36/S23' },
  { name: 'Day & Night', short: 'Day & Night', rule: 'B3678/S34678' },
  { name: 'Seeds', short: 'Seeds', rule: 'B2/S' },
  { name: 'Maze', short: 'Maze', rule: 'B3/S12345' },
  { name: "Brian's Brain", short: "Brian's Brain", rule: 'B2/S/3' },
].map((r) => ({ ...r, ...parseRule(r.rule) }));

// 'B36/S23' -> neighbour-count bit masks, plus the number of states.
function parseRule(text) {
  const [b, s, c] = text.split('/');
  const mask = (digits) => [...digits.slice(1)].reduce((m, d) => m | (1 << +d), 0);
  return { birth: mask(b), survive: mask(s), states: c ? +c : 2 };
}

// Top row first, 'O' = live.
const PATTERNS = [
  { name: 'Glider', rows: ['.O.', '..O', 'OOO'] },
  { name: 'Lightweight spaceship', rows: ['.O..O', 'O....', 'O...O', 'OOOO.'] },
  { name: 'R-pentomino', rows: ['.OO', 'OO.', '.O.'] },
  { name: 'Acorn', rows: ['.O.....', '...O...', 'OO..OOO'] },
  {
    name: 'Gosper glider gun',
    rows: [
      '........................O',
      '......................O.O',
      '............OO......OO............OO',
      '...........O...O....OO............OO',
      'OO........O.....O...OO',
      'OO........O...O.OO....O.O',
      '..........O.....O.......O',
      '...........O...O',
      '............OO',
    ],
  },
  {
    name: 'Pulsar',
    rows: [
      '..OOO...OOO..', '', 'O....O.O....O', 'O....O.O....O', 'O....O.O....O', '..OOO...OOO..', '',
      '..OOO...OOO..', 'O....O.O....O', 'O....O.O....O', 'O....O.O....O', '', '..OOO...OOO..',
    ],
  },
];

// Orbium, the Lenia glider (Bert Chan's Lenia tutorial), in hundredths.
// Designed for R = 13, μ = 0.15, σ = 0.015, Δt = 0.1.
const ORBIUM = [
  [0, 0, 0, 0, 0, 0, 10, 14, 10, 0, 0, 3, 3, 0, 0, 30, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 8, 24, 30, 30, 18, 14, 15, 16, 15, 9, 20, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 15, 34, 44, 46, 38, 18, 14, 11, 13, 19, 18, 45, 0, 0, 0],
  [0, 0, 0, 0, 6, 13, 39, 50, 50, 37, 6, 0, 0, 0, 2, 16, 68, 0, 0, 0],
  [0, 0, 0, 11, 17, 17, 33, 40, 38, 28, 14, 0, 0, 0, 0, 0, 18, 42, 0, 0],
  [0, 0, 9, 18, 13, 6, 8, 26, 32, 32, 27, 0, 0, 0, 0, 0, 0, 82, 0, 0],
  [27, 0, 16, 12, 0, 0, 0, 25, 38, 44, 45, 34, 0, 0, 0, 0, 0, 22, 17, 0],
  [0, 7, 20, 2, 0, 0, 0, 31, 48, 57, 60, 57, 0, 0, 0, 0, 0, 0, 49, 0],
  [0, 59, 19, 0, 0, 0, 0, 20, 57, 69, 76, 76, 49, 0, 0, 0, 0, 0, 36, 0],
  [0, 58, 19, 0, 0, 0, 0, 0, 67, 83, 90, 92, 87, 12, 0, 0, 0, 0, 22, 7],
  [0, 0, 46, 0, 0, 0, 0, 0, 70, 93, 100, 100, 100, 61, 0, 0, 0, 0, 18, 11],
  [0, 0, 82, 0, 0, 0, 0, 0, 47, 100, 100, 98, 100, 96, 27, 0, 0, 0, 19, 10],
  [0, 0, 46, 0, 0, 0, 0, 0, 25, 100, 100, 84, 92, 97, 54, 14, 4, 10, 21, 5],
  [0, 0, 0, 40, 0, 0, 0, 0, 9, 80, 100, 82, 80, 85, 63, 31, 18, 19, 20, 1],
  [0, 0, 0, 36, 10, 0, 0, 0, 5, 54, 86, 79, 74, 72, 60, 39, 28, 24, 13, 0],
  [0, 0, 0, 1, 30, 7, 0, 0, 8, 36, 64, 70, 64, 60, 51, 39, 29, 19, 4, 0],
  [0, 0, 0, 0, 10, 24, 14, 10, 15, 29, 45, 53, 52, 46, 40, 31, 21, 8, 0, 0],
  [0, 0, 0, 0, 0, 8, 21, 21, 22, 29, 36, 39, 37, 33, 26, 18, 9, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 3, 13, 19, 22, 24, 24, 23, 18, 13, 5, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 2, 6, 8, 9, 7, 5, 1, 0, 0, 0, 0, 0],
];
const LENIA_DEFAULTS = { mu: 0.15, sigma: 0.015, R: 13, dt: 0.1 };

// A pattern is { w, h, data } with data in rows from the bottom up, like the grid.
function lifePattern(rows) {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const data = new Float32Array(w * h);
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === 'O') data[(h - 1 - r) * w + c] = 1;
  });
  return { w, h, data };
}

// Orbium resampled for kernel radius R (Lenia is roughly scale-free) and
// turned by a multiple of 90°.
function orbiumPattern(R, turn) {
  const n = ORBIUM.length;
  const k = R / LENIA_DEFAULTS.R;
  const s = Math.max(4, Math.round(n * k));
  const at = (x, y) => (x >= 0 && y >= 0 && x < n && y < n ? ORBIUM[y][x] / 100 : 0);
  const data = new Float32Array(s * s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = (x + 0.5) / k - 0.5;
      const v = (y + 0.5) / k - 0.5;
      const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
      const val = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy)
        + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      const [tx, ty] = [[x, y], [s - 1 - y, x], [s - 1 - x, s - 1 - y], [y, s - 1 - x]][turn & 3];
      data[ty * s + tx] = val;
    }
  }
  return { w: s, h: s, data };
}

// Lenia kernel: one smooth ring, exp(4 − 1/(r(1 − r))) for 0 < r < 1 with
// r = distance / R, normalised to sum to 1. Taps below 1e-5 of the peak are
// dropped (they change nothing visible and cost a texture read each).
function leniaKernel(R) {
  const taps = [];
  let sum = 0;
  for (let y = -R; y <= R; y++) {
    for (let x = -R; x <= R; x++) {
      const r = Math.hypot(x, y) / R;
      if (r <= 0 || r >= 1) continue;
      const w = Math.exp(4 - 1 / (r * (1 - r)));
      if (w < 1e-5) continue;
      taps.push(x, y, w, 0);
      sum += w;
    }
  }
  const data = new Float32Array(taps);
  for (let i = 2; i < data.length; i += 4) data[i] /= sum;
  return { data, count: data.length / 4 };
}

// ---- shaders

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;
const BG = 'const vec3 BG = vec3(0.016, 0.018, 0.03);';

// Life cell texel (RGBA8): r = state (0 dead, 1 live, 2+ dying) / 255,
// g = trail brightness, b = age of a live cell in generations / 255.
const LIFE_IO = `${HEAD}
uniform sampler2D uState;
out vec4 outColor;
int stateOf(vec4 c) { return int(c.r * 255.0 + 0.5); }
const vec4 LIVE = vec4(1.0 / 255.0, 1.0, 0.0, 1.0);`;

const LIFE_STEP = `${LIFE_IO}
uniform int uBirth;
uniform int uSurvive;
uniform int uStates;
uniform float uDecay;
void main() {
  ivec2 size = textureSize(uState, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(uState, p, 0);
  int s = stateOf(c);
  int n = 0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      if (x == 0 && y == 0) continue;
      // Wrap around the edges: the grid is a torus.
      if (stateOf(texelFetch(uState, (p + ivec2(x, y) + size) % size, 0)) == 1) n++;
    }
  }
  int next;
  if (s == 0) next = ((uBirth >> n) & 1) == 1 ? 1 : 0;
  else if (s == 1) next = ((uSurvive >> n) & 1) == 1 ? 1 : (uStates > 2 ? 2 : 0);
  else next = s + 1 < uStates ? s + 1 : 0;
  float age = next == 1 && s == 1 ? min(c.b + 1.0 / 255.0, 1.0) : 0.0;
  float trail = next == 1 ? 1.0 : max(c.g - uDecay, 0.0);
  outColor = vec4(float(next) / 255.0, trail, age, 1.0);
}`;

const LIFE_SHOW = `${LIFE_IO}
uniform float uCell;
uniform float uLines;
uniform int uStates;
${PALETTE_GLSL}
${BG}
void main() {
  vec2 f = gl_FragCoord.xy / uCell;
  vec4 c = texelFetch(uState, min(ivec2(f), textureSize(uState, 0) - 1), 0);
  int s = stateOf(c);
  vec3 col = BG;
  if (s == 1) {
    // Newborn cells are pale, cells that have lasted a while turn warmer.
    col = palette(0.4 + 0.2 * min(c.b * 255.0 / 30.0, 1.0));
  } else if (s > 1) {
    col = mix(BG, palette(0.22), 0.85 * (1.0 - float(s - 2) / float(uStates - 1)));
  } else if (c.g > 0.0) {
    col = mix(BG, palette(0.2), 0.55 * c.g * c.g); // recently dead: fading trail
  }
  vec2 e = fract(f) * uCell;
  if (uLines > 0.0 && (e.x < 1.0 || e.y < 1.0)) col = mix(col, vec3(0.1, 0.11, 0.15), uLines);
  outColor = vec4(col, 1.0);
}`;

// Shared by both modes: a capsule from uA to uB in cell units, measured on the torus.
const BRUSH_DIST = `
uniform vec2 uA;
uniform vec2 uB;
float brushDist() {
  vec2 size = vec2(textureSize(uState, 0));
  vec2 d = gl_FragCoord.xy - uA;
  d -= size * floor(d / size + 0.5);
  vec2 ab = uB - uA;
  float h = clamp(dot(d, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(d - ab * h);
}`;

const LIFE_BRUSH = `${LIFE_IO}
${BRUSH_DIST}
uniform float uRadius;
uniform int uErase;
void main() {
  vec4 c = texelFetch(uState, ivec2(gl_FragCoord.xy), 0);
  if (brushDist() > uRadius + 0.5) outColor = c;
  else outColor = uErase == 1 ? vec4(0.0) : LIVE;
}`;

// Copies a pattern (R32F, 0 or 1) into the grid at uOrigin, wrapping.
const STAMP_LOOKUP = `
uniform sampler2D uPattern;
uniform ivec2 uOrigin;
float patternAt(ivec2 p) {
  ivec2 size = textureSize(uState, 0);
  ivec2 q = (p - uOrigin + size) % size;
  ivec2 ps = textureSize(uPattern, 0);
  return q.x < ps.x && q.y < ps.y ? texelFetch(uPattern, q, 0).r : 0.0;
}`;

const LIFE_STAMP = `${LIFE_IO}
${STAMP_LOOKUP}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  outColor = patternAt(p) > 0.5 ? LIVE : texelFetch(uState, p, 0);
}`;

// Live cells per 8×8 block, read back to count the population exactly.
const LIFE_COUNT = `${LIFE_IO}
void main() {
  ivec2 size = textureSize(uState, 0);
  ivec2 base = ivec2(gl_FragCoord.xy) * 8;
  int n = 0;
  for (int y = 0; y < 8; y++) {
    for (int x = 0; x < 8; x++) {
      ivec2 q = base + ivec2(x, y);
      if (q.x < size.x && q.y < size.y && stateOf(texelFetch(uState, q, 0)) == 1) n++;
    }
  }
  outColor = vec4(float(n) / 255.0, 0.0, 0.0, 1.0);
}`;

// Lenia state is one number per cell in [0, 1]: a float texture when the GPU
// can render to one, otherwise 16-bit fixed point split over two 8-bit channels.
const FLOAT_IO = `
float decode(vec4 t) { return t.r; }
vec4 encode(float v) { return vec4(v, 0.0, 0.0, 1.0); }`;
const PACKED_IO = `
float decode(vec4 t) { vec2 b = floor(t.rg * 255.0 + 0.5); return (b.x * 256.0 + b.y) / 65535.0; }
vec4 encode(float v) {
  float q = floor(clamp(v, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(q / 256.0);
  return vec4(hi, q - hi * 256.0, 0.0, 255.0) / 255.0;
}`;
const leniaIO = (packed) => `${HEAD}
uniform sampler2D uState;
out vec4 outColor;
${packed ? PACKED_IO : FLOAT_IO}
float load(vec2 uv) { return decode(texture(uState, uv)); } // REPEAT wrap = torus
float fetch(ivec2 p) { return decode(texelFetch(uState, p, 0)); }`;

const leniaStep = (io) => `${io}
uniform sampler2D uKernel; // one texel per tap: (dx, dy, weight)
uniform int uTaps;
uniform float uMu;
uniform float uSigma;
uniform float uDt;
void main() {
  vec2 inv = 1.0 / vec2(textureSize(uState, 0));
  vec2 uv = gl_FragCoord.xy * inv;
  float u = 0.0;
  for (int i = 0; i < uTaps; i++) {
    vec3 k = texelFetch(uKernel, ivec2(i, 0), 0).xyz;
    u += k.z * load(uv + k.xy * inv);
  }
  float d = (u - uMu) / uSigma;
  float growth = 2.0 * exp(-0.5 * d * d) - 1.0;
  outColor = encode(clamp(fetch(ivec2(gl_FragCoord.xy)) + uDt * growth, 0.0, 1.0));
}`;

const leniaShow = (io) => `${io}
uniform float uCell;
${PALETTE_GLSL}
${BG}
void main() {
  // Bilinear between cell centres so creatures look smooth.
  vec2 inv = 1.0 / vec2(textureSize(uState, 0));
  vec2 f = gl_FragCoord.xy / uCell - 0.5;
  vec2 i = floor(f);
  vec2 t = f - i;
  vec2 uv = (i + 0.5) * inv;
  float v = mix(mix(load(uv), load(uv + vec2(inv.x, 0.0)), t.x),
                mix(load(uv + vec2(0.0, inv.y)), load(uv + inv), t.x), t.y);
  outColor = vec4(mix(BG, palette(0.1 + 0.55 * v), smoothstep(0.0, 0.3, v)), 1.0);
}`;

const leniaBrush = (io) => `${io}
${BRUSH_DIST}
uniform float uRadius;
uniform float uAmount;
void main() {
  float d = brushDist();
  float a = fetch(ivec2(gl_FragCoord.xy));
  outColor = encode(a + uAmount * exp(-2.0 * d * d / (uRadius * uRadius)));
}`;

const leniaStamp = (io) => `${io}
${STAMP_LOOKUP}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  outColor = encode(max(fetch(p), patternAt(p)));
}`;

// Sum over 8×8 blocks (divided by 64 to stay in [0, 1]), read back for the mass.
const leniaCount = (io) => `${io}
void main() {
  ivec2 size = textureSize(uState, 0);
  ivec2 base = ivec2(gl_FragCoord.xy) * 8;
  float s = 0.0;
  for (int y = 0; y < 8; y++) {
    for (int x = 0; x < 8; x++) {
      ivec2 q = base + ivec2(x, y);
      if (q.x < size.x && q.y < size.y) s += fetch(q);
    }
  }
  outColor = encode(s / 64.0);
}`;

// Moves the old grid into a resized one, centred.
const COPY = `${HEAD}
uniform sampler2D uOld;
uniform ivec2 uOffset;
out vec4 outColor;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy) - uOffset;
  ivec2 size = textureSize(uOld, 0);
  outColor = q.x >= 0 && q.y >= 0 && q.x < size.x && q.y < size.y ? texelFetch(uOld, q, 0) : vec4(0.0);
}`;

// Steps per frame; below 1 means one step every few frames.
const SPEEDS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];
const fmtSpeed = (i) => (SPEEDS[i] < 1 ? `1 per ${1 / SPEEDS[i]} frames` : `${SPEEDS[i]} per frame`);
const MAX_CELLS = { life: 1024, lenia: 512 }; // grid side limit; cells grow beyond it
const TOOL_LABELS = {
  life: ['Draw cells', 'Erase cells', 'Place pattern'],
  lenia: ['Add mass', 'Erase mass', 'Place Orbium'],
};

export default {
  id: 'life',
  title: 'Life & Lenia',
  area: 'Patterns',
  formula: 'B3/S23 · A ← A + Δt·G(K∗A)',
  blurb: "Conway's Game of Life and its continuous cousin Lenia on the GPU. Draw cells, fire glider guns, watch smooth creatures glide.",

  mount(root, { signal }) {
    const canvas = el('canvas', {
      class: 'stage', style: { cursor: 'crosshair' },
      'aria-label': 'Cellular automaton grid. Draw with the mouse or a finger; right-click drag erases.',
    });
    root.append(canvas);
    let gl;
    let P;
    let leniaPacked;
    try {
      gl = createGL(canvas);
      leniaPacked = !(gl.getExtension('EXT_color_buffer_float') && canRender(gl, gl.R32F));
      const io = leniaIO(leniaPacked);
      P = {
        life: {
          step: createProgram(gl, LIFE_STEP), show: createProgram(gl, LIFE_SHOW), brush: createProgram(gl, LIFE_BRUSH),
          stamp: createProgram(gl, LIFE_STAMP), count: createProgram(gl, LIFE_COUNT),
        },
        lenia: {
          step: createProgram(gl, leniaStep(io)), show: createProgram(gl, leniaShow(io)), brush: createProgram(gl, leniaBrush(io)),
          stamp: createProgram(gl, leniaStamp(io)), count: createProgram(gl, leniaCount(io)),
        },
        copy: createProgram(gl, COPY),
      };
    } catch (err) {
      showError(root, err.message);
      return;
    }
    onContextLost(canvas, root, signal, showError);
    const FORMATS = { life: gl.RGBA8, lenia: leniaPacked ? gl.RGBA8 : gl.R32F };

    const state = {
      mode: 'life', rule: 0, pattern: 0, trail: 0.6, palette: 0,
      paused: false, gen: 0,
      life: { cell: 3, speed: 3, brush: 1, density: 0.3, tool: 'draw' },
      lenia: { cell: 4, speed: 3, brush: 6, density: 0.5, tool: 'stamp', ...LENIA_DEFAULTS },
    };
    const mode = () => state[state.mode];

    // ---- GPU grid: two textures we ping-pong between, plus a small one for counting
    function makeTarget(w, h, format) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
      setSampling(gl, gl.REPEAT);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fbo, w, h };
    }
    const dropTarget = (t) => { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); };

    let field = null; // { mode, w, h, src, dst, red }
    let cellPx = 1;   // device pixels per cell
    let cellCss = 1;

    // Match the grid to the screen; on resize keep what is there, centred.
    function syncGrid() {
      const scale = canvas.width / Math.max(1, canvas.clientWidth);
      const cap = MAX_CELLS[state.mode];
      const css = Math.max(mode().cell, canvas.clientWidth / cap, canvas.clientHeight / cap);
      cellPx = Math.max(1, Math.round(css * scale));
      cellCss = cellPx / scale;
      const w = Math.ceil(canvas.width / cellPx);
      const h = Math.ceil(canvas.height / cellPx);
      if (field && field.mode === state.mode && field.w === w && field.h === h) return;
      const format = FORMATS[state.mode];
      const next = {
        mode: state.mode, w, h, src: makeTarget(w, h, format), dst: makeTarget(w, h, format),
        red: makeTarget(Math.ceil(w / 8), Math.ceil(h / 8), format),
      };
      if (field) {
        if (field.mode === next.mode) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, next.src.fbo);
          gl.viewport(0, 0, w, h);
          gl.useProgram(P.copy.program);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, field.src.tex);
          gl.uniform1i(P.copy.u.uOld, 0);
          gl.uniform2i(P.copy.u.uOffset, Math.floor((w - field.w) / 2), Math.floor((h - field.h) / 2));
          drawFullscreen(gl);
        }
        [field.src, field.dst, field.red].forEach(dropTarget);
      }
      field = next;
      needsCount = true;
    }

    // One full-grid pass reading src and writing dst, then swap.
    function pass(prog, setup) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, field.dst.fbo);
      gl.viewport(0, 0, field.w, field.h);
      gl.useProgram(prog.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, field.src.tex);
      gl.uniform1i(prog.u.uState, 0);
      setup(prog.u);
      drawFullscreen(gl);
      [field.src, field.dst] = [field.dst, field.src];
    }

    const kernelTex = gl.createTexture();
    let kernel = null;
    function setKernel(R) {
      kernel = leniaKernel(R);
      kernel.R = R;
      gl.bindTexture(gl.TEXTURE_2D, kernelTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, kernel.count, 1, 0, gl.RGBA, gl.FLOAT, kernel.data);
      setSampling(gl, gl.CLAMP_TO_EDGE);
    }

    function step() {
      if (field.mode === 'life') {
        const rule = RULES[state.rule];
        // Trail fade per generation: long trails at 1, none at 0.
        const decay = state.trail > 0 ? 0.3 * (1 - state.trail) + 0.015 : 1;
        pass(P.life.step, (u) => {
          gl.uniform1i(u.uBirth, rule.birth);
          gl.uniform1i(u.uSurvive, rule.survive);
          gl.uniform1i(u.uStates, rule.states);
          gl.uniform1f(u.uDecay, decay);
        });
      } else {
        const L = state.lenia;
        if (kernel.R !== L.R) setKernel(L.R);
        pass(P.lenia.step, (u) => {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, kernelTex);
          gl.uniform1i(u.uKernel, 1);
          gl.uniform1i(u.uTaps, kernel.count);
          gl.uniform1f(u.uMu, L.mu);
          gl.uniform1f(u.uSigma, L.sigma);
          gl.uniform1f(u.uDt, L.dt);
        });
      }
      state.gen++;
      needsCount = true;
    }

    const patternTex = gl.createTexture();
    // Stamp a pattern centred on cell (cx, cy); the full grid uses the origin.
    function stamp(pat, cx, cy) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, patternTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, pat.w, pat.h, 0, gl.RED, gl.FLOAT, pat.data);
      setSampling(gl, gl.CLAMP_TO_EDGE);
      const mod = (a, n) => ((a % n) + n) % n;
      const ox = cx == null ? 0 : mod(Math.floor(cx) - Math.floor(pat.w / 2), field.w);
      const oy = cy == null ? 0 : mod(Math.floor(cy) - Math.floor(pat.h / 2), field.h);
      pass(P[field.mode].stamp, (u) => {
        gl.uniform1i(u.uPattern, 1);
        gl.uniform2i(u.uOrigin, ox, oy);
      });
      needsCount = true;
    }

    function paint(a, b, erase) {
      const m = mode();
      pass(P[field.mode].brush, (u) => {
        gl.uniform2f(u.uA, a[0], a[1]);
        gl.uniform2f(u.uB, b[0], b[1]);
        if (field.mode === 'life') {
          gl.uniform1f(u.uRadius, m.brush);
          gl.uniform1i(u.uErase, erase ? 1 : 0);
        } else {
          gl.uniform1f(u.uRadius, Math.max(1, m.brush));
          gl.uniform1f(u.uAmount, erase ? -0.5 : 0.12);
        }
      });
      needsCount = true;
    }

    function clearGrid() {
      for (const t of [field.src, field.dst]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      state.gen = 0;
      needsCount = true;
    }

    // Life: each cell live with probability = density. Lenia: random square
    // patches of side 2R with values in [0, 0.5]. At Orbium's settings sparse
    // soups mostly die out and dense ones grow into a labyrinth.
    function soup() {
      clearGrid();
      const { w, h } = field;
      const data = new Float32Array(w * h);
      if (field.mode === 'life') {
        for (let i = 0; i < data.length; i++) data[i] = Math.random() < mode().density ? 1 : 0;
      } else {
        const side = 2 * state.lenia.R;
        const n = Math.max(1, Math.round((mode().density * w * h) / (side * side)));
        for (let k = 0; k < n; k++) {
          const x0 = Math.floor(Math.random() * w), y0 = Math.floor(Math.random() * h);
          for (let y = 0; y < side; y++) {
            for (let x = 0; x < side; x++) {
              const i = ((y0 + y) % h) * w + ((x0 + x) % w);
              data[i] = Math.max(data[i], Math.random() * 0.5);
            }
          }
        }
      }
      stamp({ w, h, data });
    }

    function placeOrbiums() {
      const { w, h } = field;
      const n = Math.max(2, Math.min(6, Math.round((w * h) / 9000)));
      const cols = Math.max(1, Math.round(Math.sqrt((n * w) / h)));
      const rows = Math.ceil(n / cols);
      for (let i = 0; i < n; i++) {
        const cx = ((i % cols) + 0.5 + (Math.random() - 0.5) * 0.3) * (w / cols);
        const cy = (Math.floor(i / cols) + 0.5 + (Math.random() - 0.5) * 0.3) * (h / rows);
        stamp(orbiumPattern(state.lenia.R, Math.floor(Math.random() * 4)), cx, cy);
      }
    }

    // Life: a fresh random soup. Lenia: default parameters and a few Orbiums.
    function reset() {
      if (state.mode === 'life') {
        soup();
      } else {
        Object.assign(state.lenia, LENIA_DEFAULTS);
        leniaSliders.mu.set(LENIA_DEFAULTS.mu);
        leniaSliders.sigma.set(LENIA_DEFAULTS.sigma);
        leniaSliders.R.set(LENIA_DEFAULTS.R);
        leniaSliders.dt.set(LENIA_DEFAULTS.dt);
        clearGrid();
        placeOrbiums();
      }
      state.gen = 0;
    }

    // Population (Life) or total mass (Lenia), summed over 8×8 blocks on the
    // GPU and read back asynchronously (pixel buffer + fence), so the
    // pipeline never stalls waiting for it.
    let population = 0;
    let needsCount = true;
    let lastCount = -Infinity;
    let readback = null;
    const packBuf = gl.createBuffer();
    function requestCount() {
      const { red } = field;
      gl.bindFramebuffer(gl.FRAMEBUFFER, red.fbo);
      gl.viewport(0, 0, red.w, red.h);
      const prog = P[field.mode].count;
      gl.useProgram(prog.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, field.src.tex);
      gl.uniform1i(prog.u.uState, 0);
      drawFullscreen(gl);
      const n = red.w * red.h;
      const float = field.mode === 'lenia' && !leniaPacked;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, packBuf);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, n * 4 * (float ? 4 : 1), gl.STREAM_READ);
      gl.readPixels(0, 0, red.w, red.h, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      readback = { sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), n, float, field };
      gl.flush();
    }
    function collectCount() {
      if (!readback) return;
      const status = gl.clientWaitSync(readback.sync, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) return;
      const { n, float } = readback;
      gl.deleteSync(readback.sync);
      const stale = readback.field !== field;
      readback = null;
      if (status === gl.WAIT_FAILED || stale) return;
      const buf = float ? new Float32Array(n * 4) : new Uint8Array(n * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, packBuf);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, buf);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      let sum = 0;
      if (float) for (let i = 0; i < n; i++) sum += buf[4 * i] * 64;
      else if (field.mode === 'life') for (let i = 0; i < n; i++) sum += buf[4 * i];
      else for (let i = 0; i < n; i++) sum += ((buf[4 * i] * 256 + buf[4 * i + 1]) / 65535) * 64;
      population = sum;
    }

    // ---- UI
    const hud = createHud(root, [['mode', 'Mode'], ['rule', 'Rule'], ['gen', 'Generation'], ['pop', 'Live cells'], ['speed', 'Speed']]);
    const popLabel = hud.el.querySelectorAll('dt')[3];
    const panel = createPanel(root, { title: 'Life & Lenia', formula: RULES[0].rule, signal });
    const formulaEl = panel.panel.querySelector('.formula');
    const pauseBtn = button({ label: 'Pause', primary: true, onClick: () => setPaused(!state.paused) });

    const toolSelect = select({
      label: 'Pointer', value: state.life.tool,
      options: ['draw', 'erase', 'stamp'].map((v, i) => ({ value: v, label: TOOL_LABELS.life[i] })),
      onChange: (v) => setTool(v),
    });
    const speedSlider = slider({
      label: 'Speed', min: 0, max: SPEEDS.length - 1, value: state.life.speed, format: fmtSpeed,
      onInput: (v) => { mode().speed = v; },
    });
    const cellSlider = slider({
      label: 'Cell size', min: 2, max: 10, value: state.life.cell, format: (v) => `${v} px`,
      onInput: (v) => { mode().cell = v; },
    });
    const soupSlider = slider({
      label: 'Soup density', min: 0.05, max: 0.8, step: 0.01, value: state.life.density, format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => { mode().density = v; },
    });
    const brushSlider = slider({
      label: 'Brush radius', min: 0, max: 20, value: state.life.brush, format: (v) => (v ? `${v} cell${v > 1 ? 's' : ''}` : 'single cell'),
      onInput: (v) => { mode().brush = v; },
    });

    const lifeBox = el('div', { class: 'panel-body' },
      select({
        label: 'Rule', value: '0', options: RULES.map((r, i) => ({ value: String(i), label: `${r.name}  ${r.rule}` })),
        onChange: (v) => { state.rule = +v; formulaEl.textContent = RULES[state.rule].rule; },
      }),
      select({
        label: 'Pattern', value: '0', options: PATTERNS.map((p, i) => ({ value: String(i), label: p.name })),
        onChange: (v) => { state.pattern = +v; setTool('stamp'); },
      }),
      slider({
        label: 'Trails', min: 0, max: 1, step: 0.05, value: state.trail, format: (v) => (v ? `${Math.round(v * 100)}%` : 'off'),
        onInput: (v) => { state.trail = v; },
      }));

    const L = state.lenia;
    const leniaSliders = {
      mu: slider({ label: 'μ (growth center)', min: 0.05, max: 0.45, step: 0.001, value: L.mu, format: (v) => v.toFixed(3), onInput: (v) => { L.mu = v; } }),
      sigma: slider({ label: 'σ (growth width)', min: 0.002, max: 0.06, step: 0.0005, value: L.sigma, format: (v) => v.toFixed(4), onInput: (v) => { L.sigma = v; } }),
      R: slider({ label: 'R (kernel radius)', min: 6, max: 24, value: L.R, format: (v) => `${v} cells`, onInput: (v) => { L.R = v; } }),
      dt: slider({ label: 'Δt (time step)', min: 0.02, max: 0.5, step: 0.01, value: L.dt, format: (v) => v.toFixed(2), onInput: (v) => { L.dt = v; } }),
    };
    const leniaBox = el('div', { class: 'panel-body', hidden: true },
      ...Object.values(leniaSliders),
      note('Click to drop an Orbium. The soft brush adds or removes mass: use it to nudge or cut creatures.'),
      button({
        label: 'Add an Orbium',
        onClick: () => pending.push(() => stamp(orbiumPattern(L.R, Math.floor(Math.random() * 4)), Math.random() * field.w, Math.random() * field.h)),
      }),
    );

    panel.add(
      select({
        label: 'Mode', value: 'life',
        options: [{ value: 'life', label: "Conway's Game of Life" }, { value: 'lenia', label: 'Lenia (continuous)' }],
        onChange: (v) => setMode(v),
      }),
      lifeBox,
      leniaBox,
      toolSelect,
      brushSlider,
      speedSlider,
      cellSlider,
      soupSlider,
      swatches({ palettes: PALETTES, value: state.palette, onChange: (i) => { state.palette = i; } }),
      actions(
        pauseBtn,
        button({ label: 'Step', onClick: () => stepOnce() }),
        button({ label: 'Random soup', onClick: () => { pending.push(soup); } }),
        button({ label: 'Clear', onClick: () => { pending.push(clearGrid); } }),
        button({ label: 'Reset', onClick: () => { pending.push(reset); } }),
      ),
      note('Draw with the mouse or a finger; right-click drag erases. Keys: <kbd>Space</kbd> pause, <kbd>N</kbd> step, <kbd>E</kbd> draw/erase, <kbd>S</kbd> soup, <kbd>C</kbd> clear, <kbd>M</kbd> switch mode, <kbd>R</kbd> reset (in Lenia this also restores the Orbium settings), <kbd>H</kbd> panel.'),
      about(`<p><b>Game of Life.</b> John Conway invented it in 1970 and Martin Gardner made it famous in <i>Scientific American</i>. Every square is a cell that is either alive or dead, and all cells update at once from their eight neighbours:</p>
        <p>1. A live cell with fewer than two live neighbours dies. 2. A live cell with two or three live neighbours survives. 3. A live cell with more than three dies. 4. A dead cell with exactly three live neighbours comes alive.</p>
        <p>In shorthand that is B3/S23: born with 3, survives with 2 or 3. From these rules come gliders, five-cell shapes that crawl one cell diagonally every four generations, and Bill Gosper's glider gun, which fires a new glider every 30 generations. Streams of gliders can act as wires and logic gates, and Life is universal: with a big enough grid it can compute anything an ordinary computer can.</p>
        <p>Other numbers give other worlds: HighLife (B36/S23) has a pattern that copies itself, Day & Night treats live and dead the same way, in Seeds every cell dies at once yet the pattern explodes, Maze grows corridors, and Brian's Brain adds a dying state. Color shows age: newborn cells and long-lived ones get different shades, and the fading trail marks cells that died recently. The grid wraps around at the edges.</p>
        <p><b>Lenia.</b> Bert Chan (2019) made every part of Life continuous. A cell holds any value from 0 to 1, the neighbourhood is a smooth ring of radius <i>R</i> weighted by a kernel <i>K</i>, and the birth and survival rules become a growth function <i>G</i>(<i>u</i>) = 2e<sup>−(<i>u</i>−μ)²/2σ²</sup> − 1. Each step, every cell computes the weighted sum <i>u</i> = <i>K</i>∗<i>A</i> of its neighbourhood, grows when <i>u</i> is close to μ and shrinks otherwise: <i>A</i> ← clip(<i>A</i> + Δt·<i>G</i>(<i>u</i>), 0, 1).</p>
        <p>If the kernel simply counts the eight neighbours, Δt = 1 and the growth is +1 at three neighbours, 0 at two and −1 otherwise, the same formula is exactly Conway's Life. With smooth choices it produces hundreds of lifelike "creatures". Orbium, shown here, keeps its shape and glides about 0.6 cells per step. Nudge μ or σ and it dies out or swells into a labyrinth.</p>
        <p>The creatures are fragile: most blobs you paint fade away, sparse random soups usually die and dense ones grow into a labyrinth that fills the world. Lenia's species were found by searching, and by mutating ones already known.</p>`),
    );

    function setTool(tool) {
      mode().tool = tool;
      toolSelect.input.value = tool;
    }

    function setPaused(p) {
      state.paused = p;
      pauseBtn.textContent = p ? 'Resume' : 'Pause';
      pauseBtn.setAttribute('aria-pressed', String(p));
    }

    let singleSteps = 0;
    function stepOnce() {
      setPaused(true);
      singleSteps++;
    }

    function setMode(m) {
      state.mode = m;
      const lenia = m === 'lenia';
      lifeBox.hidden = lenia;
      leniaBox.hidden = !lenia;
      formulaEl.textContent = lenia ? 'A ← clip(A + Δt·G(K∗A), 0, 1)' : RULES[state.rule].rule;
      popLabel.textContent = lenia ? 'Mass' : 'Live cells';
      [...toolSelect.input.options].forEach((o, i) => { o.textContent = TOOL_LABELS[m][i]; });
      speedSlider.set(mode().speed);
      cellSlider.set(mode().cell);
      brushSlider.set(mode().brush);
      soupSlider.set(mode().density);
      setTool(mode().tool);
      if (field) [field.src, field.dst, field.red].forEach(dropTarget);
      field = null;
      pending.push(reset);
    }

    // ---- pointer: draw, erase or place
    const pending = [reset]; // grid actions run at the start of the next frame
    let stroke = null;
    function toCell(e) {
      const r = canvas.getBoundingClientRect();
      return [
        ((e.clientX - r.left) * canvas.width) / r.width / cellPx,
        ((r.bottom - e.clientY) * canvas.height) / r.height / cellPx,
      ];
    }
    const opts = { signal };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      const p = toCell(e);
      const erase = e.button === 2 || mode().tool === 'erase';
      if (mode().tool === 'stamp' && !erase) {
        pending.push(() => stamp(state.mode === 'life'
          ? lifePattern(PATTERNS[state.pattern].rows)
          : orbiumPattern(state.lenia.R, Math.floor(Math.random() * 4)), p[0], p[1]));
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      stroke = { id: e.pointerId, erase, last: p, moved: true };
      pending.push(() => paint(p, p, erase));
    }, opts);
    canvas.addEventListener('pointermove', (e) => {
      if (!stroke || e.pointerId !== stroke.id) return;
      const a = stroke.last;
      const b = toCell(e);
      const erase = stroke.erase;
      stroke.last = b;
      stroke.moved = true;
      pending.push(() => paint(a, b, erase));
    }, opts);
    const release = (e) => { if (stroke && e.pointerId === stroke.id) stroke = null; };
    canvas.addEventListener('pointerup', release, opts);
    canvas.addEventListener('pointercancel', release, opts);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), opts);

    attachKeys({
      ' ': () => setPaused(!state.paused),
      n: () => stepOnce(),
      '.': () => stepOnce(),
      e: () => setTool(mode().tool === 'erase' ? 'draw' : 'erase'),
      s: () => pending.push(soup),
      c: () => pending.push(clearGrid),
      m: () => setMode(state.mode === 'life' ? 'lenia' : 'life'),
      r: () => pending.push(reset),
      h: () => panel.toggle(),
    }, signal);

    setKernel(L.R);

    // ---- frame loop
    let carry = 0;       // fractional steps owed
    let cap = 64;        // adaptive limit on steps per frame
    let rate = 0;        // measured steps per second
    startLoop(signal, (now, dt) => {
      resizeCanvas(canvas, dpr());
      syncGrid();
      while (pending.length) pending.shift()();
      // Holding still with the Lenia brush keeps adding mass.
      if (stroke && field.mode === 'lenia' && !stroke.moved) paint(stroke.last, stroke.last, stroke.erase);
      if (stroke) stroke.moved = false;

      const want = SPEEDS[mode().speed];
      let steps = singleSteps;
      singleSteps = 0;
      let limited = false;
      if (!state.paused) {
        carry += want;
        let n = Math.floor(carry);
        carry -= n;
        if (n > cap) { n = Math.max(1, Math.floor(cap)); limited = true; }
        steps += n;
        // Fewer steps per frame when frames get slow, more again when quick.
        if (dt > 40) cap = Math.max(1, cap * 0.8);
        else if (dt < 24) cap = Math.min(64, cap * 1.1 + 0.1);
      }
      for (let i = 0; i < steps; i++) step();
      rate = state.paused ? 0 : rate * 0.9 + ((steps * 1000) / Math.max(dt, 1)) * 0.1;

      // Draw.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      const show = P[field.mode].show;
      gl.useProgram(show.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, field.src.tex);
      gl.uniform1i(show.u.uState, 0);
      gl.uniform1f(show.u.uCell, cellPx);
      gl.uniform3fv(show.u.uStops, paletteRgb(state.palette));
      if (field.mode === 'life') {
        // Faint grid lines once cells are big enough to draw one at a time.
        gl.uniform1f(show.u.uLines, cellCss >= 6 ? Math.min(0.6, (cellCss - 5) / 6) : 0);
        gl.uniform1i(show.u.uStates, RULES[state.rule].states);
      }
      drawFullscreen(gl);

      collectCount();
      if (needsCount && !readback && now - lastCount > 250) {
        requestCount();
        needsCount = false;
        lastCount = now;
      }

      const lenia = field.mode === 'lenia';
      hud.set('mode', lenia ? 'Lenia' : 'Game of Life');
      hud.set('rule', lenia
        ? `μ ${L.mu.toFixed(3)} · σ ${L.sigma.toFixed(4)} · R ${L.R}`
        : `${RULES[state.rule].short} ${RULES[state.rule].rule}`);
      hud.set('gen', lenia ? `${state.gen.toLocaleString('en-US')} (t = ${(state.gen * L.dt).toFixed(1)})` : state.gen.toLocaleString('en-US'));
      hud.set('pop', lenia ? population.toFixed(1) : Math.round(population).toLocaleString('en-US'));
      hud.set('speed', state.paused ? 'paused' : `${Math.round(rate)} steps/s`);
      hud.note(limited
        ? `Slowed to ${Math.floor(cap)} step${cap >= 2 ? 's' : ''} per frame to keep up`
        : mode().tool === 'stamp'
          ? `Tap or click to place: ${lenia ? 'Orbium' : PATTERNS[state.pattern].name}`
          : '');
    });

    return () => releaseGL(gl);
  },
};

function setSampling(gl, wrap) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
}

// Can we render into a texture of this format?
function canRender(gl, format) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, 4, 4);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  return ok;
}
