import { PALETTES, samplePalette } from '../shared/palettes.js';
import { createView, attachPanZoom } from '../shared/panzoom.js';
import { startLoop, dpr } from '../shared/loop.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about, swatches,
} from '../shared/ui.js';

// Affine maps as [a, b, c, d, e, f]: x' = a·x + b·y + e, y' = c·x + d·y + f.
const IFS = {
  // Barnsley's fern, with his original coefficients and probabilities.
  fern: {
    maps: [
      [0, 0, 0, 0.16, 0, 0],
      [0.85, 0.04, -0.04, 0.85, 0, 1.6],
      [0.2, -0.26, 0.23, 0.22, 0, 1.6],
      [-0.15, 0.28, 0.26, 0.24, 0, 0.44],
    ],
    probs: [0.01, 0.85, 0.07, 0.07],
    names: ['stem', 'whole fern, smaller and tilted', 'lowest left leaflet', 'lowest right leaflet'],
  },
  // z → (1 + i)z/2 and z → 1 − (1 − i)z/2: two copies, each turned and shrunk by √2.
  dragon: {
    maps: [[0.5, -0.5, 0.5, 0.5, 0, 0], [-0.5, -0.5, 0.5, -0.5, 1, 0]],
    probs: [0.5, 0.5],
    names: ['turn 45°, shrink by √2', 'turn 135°, shrink by √2, shift'],
  },
  // z → (1 − i)z/2 and z → 1 + (1 + i)(z − 1)/2.
  levy: {
    maps: [[0.5, 0.5, -0.5, 0.5, 0, 0], [0.5, -0.5, 0.5, 0.5, 0.5, -0.5]],
    probs: [0.5, 0.5],
    names: ['turn −45°, shrink by √2', 'turn 45°, shrink by √2, shift'],
  },
  maple: {
    maps: [
      [0.14, 0.01, 0, 0.51, -0.08, -1.31],
      [0.43, 0.52, -0.45, 0.5, 1.49, -0.75],
      [0.45, -0.49, 0.47, 0.47, -1.62, -0.74],
      [0.49, 0, 0, 0.51, 0.02, 1.62],
    ],
    probs: [0.1, 0.35, 0.35, 0.2],
    names: ['stem', 'right lobe', 'left lobe', 'top lobe'],
  },
};

const PHI = (Math.sqrt(5) - 1) / 2; // 0.618…: pentagon copies just touch

const GROUPS = [
  { id: 'game', label: 'Chaos game' },
  { id: 'rule', label: 'Restricted chaos game' },
  { id: 'ifs', label: 'Affine maps (IFS)' },
];

const PRESETS = [
  { name: 'Sierpinski triangle', group: 'game', sides: 3, ratio: 0.5, rule: 'none', extra: 'none' },
  { name: 'Sierpinski pentagon', group: 'game', sides: 5, ratio: PHI, rule: 'none', extra: 'none' },
  { name: 'Hexaflake', group: 'game', sides: 6, ratio: 2 / 3, rule: 'none', extra: 'centre' },
  { name: 'Sierpinski carpet', group: 'game', sides: 4, ratio: 2 / 3, rule: 'none', extra: 'mid' },
  { name: 'Vicsek fractal', group: 'game', sides: 4, ratio: 2 / 3, rule: 'none', extra: 'centre' },
  { name: 'Square, any corner', group: 'rule', sides: 4, ratio: 0.5, rule: 'none', extra: 'none' },
  { name: 'Square, no corner twice', group: 'rule', sides: 4, ratio: 0.5, rule: 'same', extra: 'none' },
  { name: 'Square, not the next corner', group: 'rule', sides: 4, ratio: 0.5, rule: 'next', extra: 'none' },
  { name: 'Pentagon, no corner twice', group: 'rule', sides: 5, ratio: 0.5, rule: 'same', extra: 'none' },
  { name: 'Pentagon, no neighbours', group: 'rule', sides: 5, ratio: 0.5, rule: 'adjacent', extra: 'none' },
  { name: 'Barnsley fern', group: 'ifs', ifs: 'fern' },
  { name: 'Heighway dragon', group: 'ifs', ifs: 'dragon' },
  { name: 'Lévy C curve', group: 'ifs', ifs: 'levy' },
  { name: 'Maple leaf', group: 'ifs', ifs: 'maple' },
];

const RULES = [
  { value: 'none', label: 'Any corner', hud: 'any corner' },
  { value: 'same', label: 'Never the same corner twice', hud: 'never the same corner twice' },
  { value: 'next', label: 'Never the next corner along', hud: 'never the next corner' },
  { value: 'adjacent', label: 'Never a neighbour of the last', hud: 'never a neighbour' },
  { value: 'two', label: 'Never two corners along', hud: 'never two corners along' },
];

const EXTRAS = [
  { value: 'none', label: 'Corners only' },
  { value: 'centre', label: 'Corners and centre' },
  { value: 'mid', label: 'Corners and edge midpoints' },
  { value: 'both', label: 'Corners, midpoints and centre' },
];

const COLORINGS = [
  { value: 'density', label: 'Density (palette)' },
  { value: 'map', label: 'Last map: the copies' },
  { value: 'map2', label: 'Last two maps: copies of copies' },
];

const MAX_PIXELS = 3.2e6; // caps buffer memory: up to 16 bytes per pixel when colouring by map
const CAP = 3e8; // stop accumulating here; the picture no longer changes visibly
const TRAIL = 60000; // points kept for "Step slowly"
const FRAME_MS = 9; // time spent iterating per frame
const BG = [5, 6, 10];
const BG32 = ((255 << 24) | (BG[2] << 16) | (BG[1] << 8) | BG[0]) >>> 0; // packed RGBA, little-endian

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

// Colour of a point that map t put there, after map p. One hue sector per map;
// with two levels the sector is split again by the previous map.
function mapColor(t, p, k, depth) {
  const sub = k > 1 ? p / (k - 1) : 0.5;
  const h = depth === 1 ? ((t + 0.5) / k + 0.04) % 1 : ((t + 0.12 + 0.76 * sub) / k + 0.04) % 1;
  // Blues look darker than other hues at the same lightness; lift them.
  const lift = 0.12 * Math.max(0, Math.cos(2 * Math.PI * (h - 0.66)));
  return hsl(h, 0.8, (depth === 1 ? 0.6 : p % 2 ? 0.7 : 0.52) + lift);
}

const css = ([r, g, b]) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;

// Contraction for which the copies of a regular n-gon just touch.
function touchingRatio(n) {
  let s = 1;
  for (let k = 1; k <= Math.floor(n / 4); k++) s += Math.cos((2 * Math.PI * k) / n);
  return 1 - 1 / (2 * s);
}

// Regular polygon of radius 1 around the origin, flat bottom edge, anticlockwise.
function regular(n) {
  const a0 = Math.PI / 2 + (n % 2 ? 0 : Math.PI / n);
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (2 * Math.PI * i) / n;
    return [Math.cos(a), Math.sin(a)];
  });
}

function fmtCount(n) {
  if (n < 1e6) return Math.round(n).toLocaleString('en-US');
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)} million`;
  return `${(n / 1e9).toFixed(2)} billion`;
}

export default {
  id: 'ifs',
  title: 'Chaos Game & IFS',
  area: 'Fractals',
  formula: 'x<sub>n+1</sub> = f<sub>i</sub>(x<sub>n</sub>), i at random',
  blurb: 'Jump halfway to a random corner, again and again, and an exact Sierpinski triangle appears. Four random maps grow a fern.',

  mount(root, { signal }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Chaos game fractal. Drag a corner to move it, drag elsewhere to pan, scroll or pinch to zoom.' });
    const overlay = el('canvas', { class: 'stage', style: { pointerEvents: 'none', background: 'transparent' } });
    root.append(canvas, overlay);
    const ctx = canvas.getContext('2d');
    const octx = overlay.getContext('2d');
    const view = createView(canvas, { cx: 0, cy: 0, radius: 1.2, minRadius: 1e-5, maxRadius: 60 });

    const state = {
      preset: 0, base: 0, kind: 'poly', ifs: 'fern', sides: 3, ratio: 0.5, rule: 'none', extra: 'none',
      verts: regular(3), color: 'density', palette: 0, guides: true,
    };

    // ---- the system of maps
    let sys = null;

    function targets() {
      const v = state.verts;
      const n = v.length;
      const out = v.map((p) => [...p]);
      if (state.extra === 'mid' || state.extra === 'both') {
        for (let i = 0; i < n; i++) {
          const a = v[i], b = v[(i + 1) % n];
          out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        }
      }
      if (state.extra === 'centre' || state.extra === 'both') {
        out.push([v.reduce((s, p) => s + p[0], 0) / n, v.reduce((s, p) => s + p[1], 0) / n]);
      }
      return out;
    }

    // May corner t follow corner p? Rules only constrain corners, not midpoints or the centre.
    function allowedAfter(p, t, n) {
      const corners = p < n && t < n;
      switch (state.rule) {
        case 'same': return t !== p;
        case 'next': return !(corners && t === (p + 1) % n);
        case 'adjacent': return !(corners && (t === (p + 1) % n || t === (p + n - 1) % n));
        case 'two': return !(corners && t === (p + 2) % n);
        default: return true;
      }
    }

    function buildSystem() {
      let maps, probs, names, tg = null;
      if (state.kind === 'ifs') {
        ({ maps, probs, names } = IFS[state.ifs]);
      } else {
        // "Move a fraction r of the way to target v": x' = (1 − r)x + r·v.
        tg = targets();
        const r = state.ratio;
        maps = tg.map(([vx, vy]) => [1 - r, 0, 0, 1 - r, r * vx, r * vy]);
        probs = null;
        names = null;
      }
      const k = maps.length;
      const A = Float64Array.from(maps.flat());
      const cum = new Float64Array(k);
      for (let i = 0, s = 0; i < k; i++) { s += probs ? probs[i] : 1 / k; cum[i] = s; }
      const allowed = new Uint8Array(k * k).fill(1);
      if (tg) {
        const n = state.verts.length;
        for (let p = 0; p < k; p++) {
          let any = 0;
          for (let t = 0; t < k; t++) any += allowed[p * k + t] = allowedAfter(p, t, n) ? 1 : 0;
          if (!any) allowed.fill(1, p * k, p * k + k); // never leave a corner with no way out
        }
      }
      sys = { k, A, cum, uniform: !!tg, allowed, targets: tg, names, probs, box: null };
      pt.prev %= k;
      sys.box = tg ? boxOf(tg) : orbitBox();
      buildColors();
    }

    // One random jump of point p (x, y, index of the previous map). Returns the map used.
    function jumpFrom(p) {
      const { A, cum, k, uniform, allowed } = sys;
      let t;
      if (uniform) {
        const row = p.prev * k;
        do t = (Math.random() * k) | 0; while (allowed[row + t] === 0);
      } else {
        const u = Math.random();
        t = 0;
        while (t < k - 1 && u >= cum[t]) t++;
      }
      const o = 6 * t;
      const nx = A[o] * p.x + A[o + 1] * p.y + A[o + 4];
      p.y = A[o + 2] * p.x + A[o + 3] * p.y + A[o + 5];
      p.x = nx;
      p.prev = t;
      return t;
    }

    function boxOf(pts) {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }

    function orbitBox() {
      const p = { x: 0, y: 0, prev: 0 };
      for (let i = 0; i < 50; i++) jumpFrom(p);
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = 0; i < 40000; i++) {
        jumpFrom(p);
        b[0] = Math.min(b[0], p.x); b[1] = Math.min(b[1], p.y);
        b[2] = Math.max(b[2], p.x); b[3] = Math.max(b[3], p.y);
      }
      return b;
    }

    // ---- colours
    let lut = null; // density → packed RGBA (little-endian)
    let mapRgb = null; // per (map, previous map), 0..255
    let mapCss = []; // same, as CSS colours for the slow-mode dots
    let legendCss = []; // one colour per map
    let dotCss = '';

    function buildLut() {
      lut = new Uint32Array(1024);
      for (let i = 0; i < 1024; i++) {
        const v = i / 1023;
        // Up to 0.62: every palette is bright there and turns dark beyond.
        const [r, g, b] = samplePalette(state.palette, 0.06 + 0.56 * v);
        const f = Math.min(1, 0.25 + v * 2);
        const R = BG[0] + (r * 255 - BG[0]) * f;
        const G = BG[1] + (g * 255 - BG[1]) * f;
        const B = BG[2] + (b * 255 - BG[2]) * f;
        lut[i] = ((255 << 24) | (B << 16) | (G << 8) | R) >>> 0;
      }
      dotCss = css(samplePalette(state.palette, 0.06 + 0.56 * 0.8));
    }

    function buildColors() {
      const k = sys.k;
      const depth = state.color === 'map2' ? 2 : 1;
      mapRgb = new Float32Array(3 * k * k);
      mapCss = [];
      for (let t = 0; t < k; t++) {
        for (let p = 0; p < k; p++) {
          const c = mapColor(t, p, k, depth);
          mapRgb.set(c.map((v) => v * 255), 3 * (t * k + p));
          mapCss.push(css(c));
        }
      }
      legendCss = Array.from({ length: k }, (_, t) => css(mapColor(t, 0, k, 1)));
    }

    // ---- accumulation buffers (one cell per canvas pixel)
    let W = 0, H = 0;
    let counts = new Uint32Array(0);
    let sumR = null, sumG = null, sumB = null;
    let image = null, pixels = null;
    const px = { inv: 1, left: 0, top: 0 }; // plane → buffer pixels
    const pt = { x: 0, y: 0, prev: 0 };
    let total = 0, inView = 0;
    let budget = 60000;
    let pps = 0;
    let needsRestart = true;
    let clearTrail = true;
    let painted = false;

    function bufferSize() {
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      const s = Math.min(dpr(), Math.sqrt(MAX_PIXELS / Math.max(1, cw * ch)));
      return [Math.max(1, Math.round(cw * s)), Math.max(1, Math.round(ch * s))];
    }

    function resize(w, h) {
      W = canvas.width = w;
      H = canvas.height = h;
      counts = new Uint32Array(W * H);
      sumR = sumG = sumB = null;
      image = ctx.createImageData(W, H);
      pixels = new Uint32Array(image.data.buffer);
    }

    function restart() {
      needsRestart = false;
      painted = false;
      total = 0;
      inView = 0;
      const ps = (view.cssPixel() * canvas.clientWidth) / W;
      px.inv = 1 / ps;
      px.left = view.cx - (W / 2) * ps;
      px.top = view.cy + (H / 2) * ps;
      if (!(Math.abs(pt.x) < 1e6 && Math.abs(pt.y) < 1e6)) Object.assign(pt, { x: 0, y: 0, prev: 0 });
      if (clearTrail) { clearTrail = false; resetTrail(); }
      if (slow.on) { redrawTrail(); return; }
      counts.fill(0);
      if (state.color !== 'density') {
        if (!sumR) { sumR = new Float32Array(W * H); sumG = new Float32Array(W * H); sumB = new Float32Array(W * H); }
        sumR.fill(0); sumG.fill(0); sumB.fill(0);
      }
      // Burn-in: a few jumps put any starting point within a pixel of the fractal.
      for (let i = 0; i < 40; i++) jumpFrom(pt);
    }

    // Hot loop: same as jumpFrom, inlined, plus plotting.
    function iterate(count) {
      const { A, cum, k, uniform, allowed } = sys;
      const w = W, h = H, cnt = counts, pal = mapRgb;
      const R = sumR, G = sumG, B = sumB;
      const byMap = state.color !== 'density';
      const { inv, left, top } = px;
      let x = pt.x, y = pt.y, prev = pt.prev, hits = 0;
      for (let n = 0; n < count; n++) {
        let t;
        if (uniform) {
          const row = prev * k;
          do t = (Math.random() * k) | 0; while (allowed[row + t] === 0);
        } else {
          const u = Math.random();
          t = 0;
          while (t < k - 1 && u >= cum[t]) t++;
        }
        const o = 6 * t;
        const nx = A[o] * x + A[o + 1] * y + A[o + 4];
        y = A[o + 2] * x + A[o + 3] * y + A[o + 5];
        x = nx;
        const fx = (x - left) * inv;
        const fy = (top - y) * inv;
        if (fx >= 0 && fx < w && fy >= 0 && fy < h) {
          const i = (fy | 0) * w + (fx | 0);
          cnt[i]++;
          hits++;
          if (byMap) {
            const c = 3 * (t * k + prev);
            R[i] += pal[c]; G[i] += pal[c + 1]; B[i] += pal[c + 2];
          }
        }
        prev = t;
      }
      pt.x = x; pt.y = y; pt.prev = prev;
      total += count;
      inView += hits;
    }

    // Log tone mapping relative to the mean density of lit pixels: a pixel at
    // the mean sits at 0.62, ten times denser at the top of the palette. Being
    // relative, the image keeps its look while it fills in; sparse regions
    // simply become smoother.
    const tone = new Float32Array(4096);
    function paint() {
      const n = W * H;
      let max = 0, sum = 0, nz = 0;
      for (let i = 0; i < n; i++) {
        const c = counts[i];
        if (c) { nz++; sum += c; if (c > max) max = c; }
      }
      const lm = Math.log10(nz ? sum / nz : 1);
      const level = (c) => Math.min(1, Math.max(0.05, 0.62 + 0.38 * (Math.log10(c) - lm)));
      const tn = Math.min(4096, max + 1);
      for (let c = 0; c < tn; c++) tone[c] = level(c);
      const bg = BG32;
      if (state.color === 'density') {
        for (let i = 0; i < n; i++) {
          const c = counts[i];
          pixels[i] = c === 0 ? bg : lut[((c < 4096 ? tone[c] : level(c)) * 1023) | 0];
        }
      } else {
        const d = image.data;
        for (let i = 0, p = 0; i < n; i++, p += 4) {
          const c = counts[i];
          if (c === 0) { pixels[i] = bg; continue; }
          const v = c < 4096 ? tone[c] : level(c);
          const m = Math.min(1, v * 1.35) / c;
          d[p] = BG[0] + sumR[i] * m;
          d[p + 1] = BG[1] + sumG[i] * m;
          d[p + 2] = BG[2] + sumB[i] * m;
          d[p + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
      painted = true;
    }

    // ---- "Step slowly": single jumps, animated, drawn as dots
    const slow = { on: false, rate: 2, acc: 0, count: 0, start: [0, 0], from: [0, 0], to: [0, 0], t: 0, prevT: 0 };
    const trailX = new Float64Array(TRAIL), trailY = new Float64Array(TRAIL), trailC = new Uint16Array(TRAIL);
    let trailLen = 0, trailHead = 0;

    function nextJump() {
      slow.from = [pt.x, pt.y];
      slow.prevT = pt.prev;
      slow.t = jumpFrom(pt);
      slow.to = [pt.x, pt.y];
    }

    function resetTrail() {
      trailLen = 0; trailHead = 0;
      slow.count = 0; slow.acc = 0;
      slow.start = [pt.x, pt.y];
      nextJump();
    }

    // Big dots while there are few, so each early jump is easy to follow.
    const dotCssPx = () => (trailLen < 100 ? 5 : trailLen < 2000 ? 3 : 2);

    function drawDot(x, y, c) {
      const d = Math.max(1.5, dotCssPx() * (W / canvas.clientWidth));
      ctx.fillStyle = state.color === 'density' ? dotCss : mapCss[c];
      ctx.fillRect((x - px.left) * px.inv - d / 2, (px.top - y) * px.inv - d / 2, d, d);
    }

    function redrawTrail() {
      ctx.fillStyle = css(BG.map((v) => v / 255));
      ctx.fillRect(0, 0, W, H);
      for (let j = 0; j < trailLen; j++) {
        const i = (trailHead - trailLen + j + TRAIL) % TRAIL;
        drawDot(trailX[i], trailY[i], trailC[i]);
      }
      painted = true;
    }

    function commitJump() {
      const c = slow.t * sys.k + slow.prevT;
      trailX[trailHead] = slow.to[0]; trailY[trailHead] = slow.to[1]; trailC[trailHead] = c;
      trailHead = (trailHead + 1) % TRAIL;
      const size = dotCssPx();
      trailLen = Math.min(TRAIL, trailLen + 1);
      slow.count++;
      if (dotCssPx() !== size) redrawTrail();
      else drawDot(slow.to[0], slow.to[1], c);
    }

    function stepSlow(dt) {
      slow.acc += (slow.rate * dt) / 1000;
      // At high rates several jumps land in one frame.
      let guard = 0;
      while (slow.acc >= 1 && guard++ < 2000) {
        slow.acc -= 1;
        commitJump();
        nextJump();
      }
      if (slow.acc >= 1) slow.acc = 0;
    }

    function setSlow(on) {
      slow.on = on;
      slowBtn.textContent = on ? 'Full speed' : 'Step slowly';
      slowBtn.setAttribute('aria-pressed', String(on));
      rateField.hidden = !on;
      if (on) {
        // Start somewhere random near the fractal, usually not on it, to show the pull.
        const [x0, y0, x1, y1] = sys.box;
        const mx = (x1 - x0) * 0.1, my = (y1 - y0) * 0.1;
        pt.x = x0 - mx + Math.random() * (x1 - x0 + 2 * mx);
        pt.y = y0 - my + Math.random() * (y1 - y0 + 2 * my);
        clearTrail = true;
      }
      needsRestart = true;
    }

    // ---- view
    function fitView() {
      const [x0, y0, x1, y1] = sys.box;
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      // Keep the picture clear of the readout and the panel (at the side on
      // wide screens, a bottom sheet on phones) or the phone's dock buttons.
      const wide = cw > 640;
      const open = !panel.panel.hidden;
      const pr = panel.panel.getBoundingClientRect();
      const aw = open && wide ? Math.max(cw * 0.45, pr.left - 8) : cw;
      const top = Math.min(ch * 0.3, hud.el.getBoundingClientRect().bottom + 12);
      const bottom = wide ? ch - 16 : open ? Math.max(top + ch * 0.25, pr.top - 8) : ch - 64;
      const ah = Math.max(ch * 0.2, bottom - top);
      const ps = Math.max((x1 - x0) / (aw * 0.86), (y1 - y0) / (ah * 0.94), 1e-9);
      view.set({
        cx: (x0 + x1) / 2 + ((cw - aw) / 2) * ps,
        cy: (y0 + y1) / 2 + ((top + bottom) / 2 - ch / 2) * ps,
        radius: (ps * Math.min(cw, ch)) / 2,
      });
      needsRestart = true;
    }

    const toScreen = (x, y) => {
      const s = view.cssPixel();
      return [canvas.clientWidth / 2 + (x - view.cx) / s, canvas.clientHeight / 2 - (y - view.cy) / s];
    };

    // ---- UI
    const hud = createHud(root, [['fractal', 'Fractal'], ['maps', 'Maps'], ['points', 'Points'], ['speed', 'Speed']]);
    const panel = createPanel(root, { title: 'Chaos Game & IFS', formula: 'x → x + r(v<sub>i</sub> − x)', signal });
    const formulaEl = panel.panel.querySelector('.formula');

    const presetSel = select({
      label: 'Preset',
      options: [{ value: '', label: 'Custom', hidden: true }, ...PRESETS.map((p, i) => ({ value: String(i), label: p.name }))],
      value: '0',
      onChange: (v) => { if (v !== '') loadPreset(+v); },
    });
    // Group the long list into three short menus.
    for (const g of GROUPS) {
      const group = el('optgroup', { label: g.label });
      PRESETS.forEach((p, i) => { if (p.group === g.id) group.append(presetSel.input.querySelector(`option[value="${i}"]`)); });
      presetSel.input.append(group);
    }
    presetSel.input.value = '0';

    const sidesSl = slider({ label: 'Corners', min: 3, max: 8, value: 3, onInput: (v) => {
      state.sides = v; state.verts = regular(v); custom(); systemChanged(); fitView();
    } });
    const ratioSl = slider({
      label: 'Jump ratio', min: 0.05, max: 0.95, step: 0.001, value: 0.5,
      format: (v) => `${v.toFixed(3)} of the way`,
      onInput: (v) => { state.ratio = v; custom(); systemChanged(); },
    });
    const ruleSel = select({ label: 'Rule for the next corner', options: RULES, value: 'none', onChange: (v) => { state.rule = v; custom(); systemChanged(); } });
    const extraSel = select({ label: 'Targets', options: EXTRAS, value: 'none', onChange: (v) => { state.extra = v; custom(); systemChanged(); } });
    const polyActions = actions(
      button({ label: 'Copies just touch', onClick: () => {
        setRatio(state.extra === 'none' ? touchingRatio(state.verts.length) : 2 / 3);
        custom(); systemChanged();
      } }),
      button({ label: 'Regular shape', onClick: () => { state.verts = regular(state.verts.length); systemChanged(); fitView(); } }),
    );
    const polyFields = [sidesSl, ratioSl, ruleSel, extraSel, polyActions];

    const legend = el('p', { class: 'hint' });
    const legendField = el('div', { class: 'field' },
      el('div', { class: 'label-row' }, el('span', { class: 'label' }, 'Maps')), legend);
    const colorSel = select({ label: 'Colour by', options: COLORINGS, value: 'density', onChange: (v) => setColor(v) });
    const slowBtn = button({ label: 'Step slowly', primary: true, onClick: () => setSlow(!slow.on) });
    const rateField = slider({
      label: 'Jumps per second', min: 0, max: 100, value: 11,
      format: (v) => String(Math.round(10 ** (v * 0.027))),
      onInput: (v) => { slow.rate = Math.round(10 ** (v * 0.027)); },
    });
    rateField.hidden = true;
    const aboutBox = about(`<p><b>The chaos game.</b> Mark three corners and start anywhere. Pick a corner at random and jump halfway towards it. Repeat forever, plotting every point. Out of pure randomness comes an exact Sierpinski triangle, and nothing ever lands in the empty middle. Turn on "Step slowly" to watch the rule one jump at a time.</p>
      <p><b>Why randomness gives an exact shape.</b> "Jump halfway to corner <i>i</i>" is a map <i>f<sub>i</sub></i> that shrinks the whole plane by half towards that corner. The Sierpinski triangle <i>S</i> is the one shape made of its own three half-size copies: <i>S</i> = <i>f</i><sub>1</sub>(<i>S</i>) ∪ <i>f</i><sub>2</sub>(<i>S</i>) ∪ <i>f</i><sub>3</sub>(<i>S</i>). Hutchinson proved in 1981 that any finite set of shrinking maps has exactly one such shape, its attractor. Every jump halves the distance to <i>S</i>, whichever corner is picked, so after a few jumps the point is on <i>S</i> to within a pixel. The random choices then carry it all over <i>S</i>.</p>
      <p><b>See the copies.</b> Colour by "Last map" paints each point by the map that put it there. The picture splits into smaller copies of itself, one per map. "Last two maps" splits every copy again.</p>
      <p><b>The fern</b> is just four affine maps, each a stretch, turn and shift. One squashes everything onto the stem. One makes a copy of the whole fern, slightly smaller and tilted, and that copy is everything above the lowest pair of leaflets. The other two make those leaflets. With guides on, the coloured boxes show where each map sends the fern's bounding box. The probabilities only decide how fast each part fills in, not the shape.</p>
      <p><b>Restricted games.</b> On a square with any corner allowed, the four half-size copies tile the square exactly, so the points just fill it in. Forbid some choices, such as the same corner twice in a row, and certain copies-of-copies can no longer occur. Holes appear, and a new fractal emerges.</p>`);

    panel.add(
      presetSel,
      ...polyFields,
      colorSel,
      legendField,
      swatches({ palettes: PALETTES, value: state.palette, onChange: (i) => { state.palette = i; buildLut(); if (slow.on) needsRestart = true; else paint(); } }),
      toggles(check({ label: 'Show guides', checked: true, onChange: (on) => { state.guides = on; } })),
      rateField,
      actions(
        slowBtn,
        button({ label: 'Restart', onClick: () => { if (slow.on) setSlow(true); else needsRestart = true; } }),
        button({ label: 'Reset view', onClick: () => fitView() }),
      ),
      note('In chaos-game presets, drag a corner to move it. Drag elsewhere to pan, scroll or pinch to zoom. Keys: <kbd>Space</kbd> step slowly, <kbd>C</kbd> colouring, <kbd>R</kbd> reset, <kbd>H</kbd> panel.'),
      aboutBox,
    );

    function setRatio(r) { state.ratio = r; ratioSl.set(r); ratioSl.setText(`${r.toFixed(3)} of the way`); }

    function custom() { presetSel.input.value = ''; state.preset = -1; }

    function setColor(v) {
      state.color = v;
      colorSel.input.value = v;
      buildColors();
      updateLegend();
      needsRestart = true;
    }

    function systemChanged() {
      buildSystem();
      updateLegend();
      clearTrail = true;
      needsRestart = true;
    }

    function updateLegend() {
      const sw = (i) => el('span', { style: { color: legendCss[i] } }, '■');
      const parts = [];
      if (state.kind === 'ifs') {
        sys.names.forEach((name, i) => {
          if (i) parts.push(el('br'));
          parts.push(sw(i), ` ${i + 1}. ${name} (${Math.round(sys.probs[i] * 100)}%)`);
        });
      } else {
        const n = state.verts.length;
        parts.push(...Array.from({ length: n }, (_, i) => sw(i)), ` corners 1–${n}`);
        if (state.extra === 'mid' || state.extra === 'both') {
          parts.push(el('br'), ...Array.from({ length: n }, (_, i) => sw(n + i)), ' edge midpoints');
        }
        if (state.extra === 'centre' || state.extra === 'both') parts.push(el('br'), sw(sys.k - 1), ' centre');
        parts.push(el('br'), `Each map moves ${state.ratio.toFixed(3)} of the way to its target, chosen with equal odds.`);
      }
      legend.replaceChildren(...parts);
    }

    function loadPreset(i) {
      const p = PRESETS[i];
      state.preset = i;
      state.base = i;
      presetSel.input.value = String(i);
      if (p.ifs) {
        state.kind = 'ifs';
        state.ifs = p.ifs;
      } else {
        Object.assign(state, { kind: 'poly', sides: p.sides, rule: p.rule, extra: p.extra, verts: regular(p.sides) });
        sidesSl.set(p.sides);
        setRatio(p.ratio);
        ruleSel.input.value = p.rule;
        extraSel.input.value = p.extra;
      }
      for (const f of polyFields) f.hidden = state.kind === 'ifs';
      formulaEl.innerHTML = state.kind === 'ifs' ? 'x → A<sub>i</sub>x + b<sub>i</sub>' : 'x → x + r(v<sub>i</sub> − x)';
      systemChanged();
      if (slow.on) setSlow(true); // fresh start point for the new shape
      fitView();
    }

    // Back to the last preset chosen, undoing drags and slider changes.
    function reset() { loadPreset(state.base); }

    // ---- corner handles (registered before pan/zoom so they win on a handle)
    let drag = null;
    let hover = -1;
    const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function hitHandle(e) {
      if (state.kind !== 'poly' || !state.guides) return -1;
      const [x, y] = local(e);
      const reach = e.pointerType === 'touch' ? 26 : 14;
      let best = -1, bestD = reach;
      state.verts.forEach((v, i) => {
        const [sx, sy] = toScreen(v[0], v[1]);
        const d = Math.hypot(sx - x, sy - y);
        if (d < bestD) { bestD = d; best = i; }
      });
      return best;
    }
    canvas.addEventListener('pointerdown', (e) => {
      const i = hitHandle(e);
      if (i < 0 || drag) return;
      e.stopImmediatePropagation();
      canvas.setPointerCapture(e.pointerId);
      const [wx, wy] = view.toPlane(...local(e));
      drag = { i, id: e.pointerId, dx: state.verts[i][0] - wx, dy: state.verts[i][1] - wy };
      hover = i;
    }, { signal });
    canvas.addEventListener('pointermove', (e) => {
      if (drag && e.pointerId === drag.id) {
        e.stopImmediatePropagation();
        const [wx, wy] = view.toPlane(...local(e));
        state.verts[drag.i] = [wx + drag.dx, wy + drag.dy];
        custom();
        systemChanged();
        return;
      }
      if (!drag && e.pointerType === 'mouse') {
        hover = e.buttons ? -1 : hitHandle(e);
        canvas.style.cursor = hover >= 0 ? 'move' : '';
      }
    }, { signal });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      e.stopImmediatePropagation();
      drag = null;
      hover = -1;
      canvas.style.cursor = '';
    };
    canvas.addEventListener('pointerup', endDrag, { signal });
    canvas.addEventListener('pointercancel', endDrag, { signal });

    attachPanZoom(canvas, view, () => { needsRestart = true; }, {
      signal,
      keys: {
        r: () => reset(),
        h: () => panel.toggle(),
        ' ': () => setSlow(!slow.on),
        c: () => setColor(COLORINGS[(COLORINGS.findIndex((o) => o.value === state.color) + 1) % COLORINGS.length].value),
      },
    });
    window.addEventListener('resize', () => { needsRestart = true; }, { signal });

    // ---- overlay: guides and the current slow jump, in CSS pixels
    function drawOverlay() {
      const s = dpr();
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      const ow = Math.round(cw * s), oh = Math.round(ch * s);
      if (overlay.width !== ow || overlay.height !== oh) { overlay.width = ow; overlay.height = oh; }
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, ow, oh);
      octx.setTransform(s, 0, 0, s, 0, 0);
      octx.lineCap = 'round';
      octx.lineJoin = 'round';
      octx.font = '11px "Chivo Mono", ui-monospace, monospace';
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      const byMap = state.color !== 'density';
      const colorOf = (i) => (byMap ? legendCss[i] : '#e8ebf3');

      if (state.guides && state.kind === 'poly') {
        const tg = sys.targets;
        const n = state.verts.length;
        const scr = tg.map((v) => toScreen(v[0], v[1]));
        octx.setLineDash([4, 5]);
        octx.strokeStyle = 'rgba(232, 235, 243, 0.3)';
        octx.lineWidth = 1;
        octx.beginPath();
        for (let i = 0; i < n; i++) octx[i ? 'lineTo' : 'moveTo'](scr[i][0], scr[i][1]);
        octx.closePath();
        octx.stroke();
        octx.setLineDash([]);
        const [mx, my] = toScreen(...tg.slice(0, n).reduce((a, v) => [a[0] + v[0] / n, a[1] + v[1] / n], [0, 0]));
        for (let i = 0; i < tg.length; i++) {
          const [x, y] = scr[i];
          if (i >= n) {
            octx.fillStyle = colorOf(i);
            octx.beginPath(); octx.arc(x, y, 3.5, 0, Math.PI * 2); octx.fill();
            continue;
          }
          const r = i === hover || (drag && drag.i === i) ? 9 : 7;
          octx.fillStyle = colorOf(i);
          octx.strokeStyle = 'rgba(5, 6, 10, 0.9)';
          octx.lineWidth = 2;
          octx.beginPath(); octx.arc(x, y, r, 0, Math.PI * 2); octx.fill(); octx.stroke();
          // Number the corners so the rules ("the next corner") can be followed.
          const d = Math.hypot(x - mx, y - my) || 1;
          octx.fillStyle = 'rgba(232, 235, 243, 0.75)';
          octx.fillText(String(i + 1), x + ((x - mx) / d) * 18, y + ((y - my) / d) * 18);
        }
      } else if (state.guides) {
        // Where each map sends the attractor's bounding box.
        const [x0, y0, x1, y1] = sys.box;
        const box = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        const quad = (pts) => {
          octx.beginPath();
          pts.forEach(([x, y], j) => { const [sx, sy] = toScreen(x, y); octx[j ? 'lineTo' : 'moveTo'](sx, sy); });
          octx.closePath();
        };
        octx.setLineDash([4, 5]);
        octx.strokeStyle = 'rgba(232, 235, 243, 0.3)';
        octx.lineWidth = 1;
        quad(box);
        octx.stroke();
        octx.setLineDash([]);
        const A = sys.A;
        for (let t = 0; t < sys.k; t++) {
          const o = 6 * t;
          const img = box.map(([x, y]) => [A[o] * x + A[o + 1] * y + A[o + 4], A[o + 2] * x + A[o + 3] * y + A[o + 5]]);
          const active = slow.on && slow.t === t;
          octx.strokeStyle = legendCss[t];
          octx.globalAlpha = active ? 1 : 0.7;
          octx.lineWidth = active ? 2.5 : 1.25;
          quad(img);
          octx.stroke();
          const [cx, cy] = toScreen(img.reduce((a, p) => a + p[0] / 4, 0), img.reduce((a, p) => a + p[1] / 4, 0));
          octx.fillStyle = legendCss[t];
          octx.fillText(String(t + 1), cx, cy);
        }
        octx.globalAlpha = 1;
      }

      if (slow.on) {
        // The jump in flight: dot travels from the last point towards the target.
        const [fx, fy] = toScreen(...slow.from);
        const [tx, ty] = toScreen(...slow.to);
        const e = slow.rate <= 12 ? 1 - (1 - slow.acc) ** 3 : 1;
        const x = fx + (tx - fx) * e, y = fy + (ty - fy) * e;
        const col = byMap ? legendCss[slow.t] : '#ffaa00';
        octx.strokeStyle = col;
        octx.lineWidth = 1.25;
        octx.setLineDash([3, 4]);
        octx.beginPath();
        octx.moveTo(fx, fy);
        if (state.kind === 'poly') {
          const [vx, vy] = toScreen(...sys.targets[slow.t]);
          octx.lineTo(vx, vy);
          octx.stroke();
          octx.setLineDash([]);
          octx.lineWidth = 2;
          octx.beginPath(); octx.arc(vx, vy, 13, 0, Math.PI * 2); octx.stroke();
        } else {
          octx.lineTo(tx, ty);
          octx.stroke();
        }
        octx.setLineDash([]);
        octx.lineWidth = 2;
        octx.beginPath(); octx.moveTo(fx, fy); octx.lineTo(x, y); octx.stroke();
        octx.fillStyle = '#e8ebf3';
        octx.beginPath(); octx.arc(x, y, 4, 0, Math.PI * 2); octx.fill();
        // Where it all started.
        const [sx, sy] = toScreen(...slow.start);
        octx.strokeStyle = 'rgba(232, 235, 243, 0.7)';
        octx.lineWidth = 1.25;
        octx.beginPath(); octx.arc(sx, sy, 6, 0, Math.PI * 2); octx.stroke();
        octx.fillStyle = 'rgba(232, 235, 243, 0.7)';
        octx.textAlign = 'left';
        octx.fillText('start', sx + 10, sy);
      }
    }

    function updateHud() {
      const preset = state.preset >= 0 ? PRESETS[state.preset].name : 'Custom';
      hud.set('fractal', preset);
      hud.set('maps', state.kind === 'ifs'
        ? `${sys.k} affine maps`
        : `${sys.k} targets · r = ${state.ratio.toFixed(3)}`);
      if (slow.on) {
        hud.set('points', fmtCount(slow.count));
        const what = state.kind === 'poly' ? (slow.t < state.verts.length ? `corner ${slow.t + 1}` : 'target') : `map ${slow.t + 1}`;
        hud.set('speed', `${slow.rate} jumps/s · next: ${what}`);
        const rule = state.rule !== 'none' ? `, ${RULES.find((r) => r.value === state.rule).hud}` : '';
        hud.note(state.kind === 'poly'
          ? `Each jump goes ${state.ratio.toFixed(3)} of the way to a random corner${rule}.${slow.count < 12 ? ' The first few points are off the fractal; every jump pulls the point closer.' : ''}`
          : `Each jump applies one of the ${sys.k} maps, picked at random with its probability.`);
        return;
      }
      hud.set('points', fmtCount(total));
      hud.set('speed', total >= CAP ? 'done' : `${fmtCount(pps)} points/s`);
      const frac = total ? inView / total : 1;
      hud.note(total > 2e5 && frac < 0.05 ? 'Zoomed in: most points land outside the view, so the picture fills in slowly.' : '');
    }

    // ---- start
    buildLut();
    loadPreset(0);

    startLoop(signal, (now, dt) => {
      const [w, h] = bufferSize();
      if (w !== W || h !== H) { resize(w, h); needsRestart = true; }
      if (needsRestart) restart();
      if (slow.on) {
        stepSlow(dt);
      } else if (total < CAP) {
        const t0 = performance.now();
        iterate(Math.round(budget));
        const ms = performance.now() - t0;
        pps = pps ? pps * 0.9 + (budget / Math.max(dt, 1)) * 100 : budget / Math.max(dt, 1) * 1000;
        // Aim for a fixed time per frame so dragging stays smooth.
        budget = Math.min(500000, Math.max(5000, budget * Math.min(1.5, Math.max(0.5, FRAME_MS / Math.max(ms, 0.1)))));
        paint();
      } else if (!painted) {
        paint();
      }
      drawOverlay();
      updateHud();
    });
  },
};
