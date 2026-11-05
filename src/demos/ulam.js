import { PALETTES, samplePalette } from '../shared/palettes.js';
import { createView, attachPanZoom } from '../shared/panzoom.js';
import { startLoop, dpr } from '../shared/loop.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about, swatches, fmtZoom,
} from '../shared/ui.js';

const SIDE = 1201;               // Ulam grid is SIDE × SIDE cells
const HALF = (SIDE - 1) / 2;
const MAX_START = 100;
const LIMIT = SIDE * SIDE + MAX_START; // largest number ever shown
const SACKS_MAX = 160000;        // numbers drawn in the Sacks spiral

// Smallest prime factor of every n ≤ LIMIT (n itself when n is prime).
let spf = null;
function sieve() {
  if (spf) return spf;
  spf = new Uint32Array(LIMIT + 1);
  for (let i = 2; i <= LIMIT; i++) {
    if (spf[i]) continue;
    spf[i] = i;
    if (i * i > LIMIT) continue;
    for (let j = i * i; j <= LIMIT; j += i) if (!spf[j]) spf[j] = i;
  }
  return spf;
}
export const isPrime = (n) => n >= 2 && sieve()[n] === n;

// Number of divisors of every n ≤ LIMIT.
let divisors = null;
function divisorCounts() {
  if (divisors) return divisors;
  divisors = new Uint16Array(LIMIT + 1);
  for (let d = 1; d <= LIMIT; d++) for (let m = d; m <= LIMIT; m += d) divisors[m]++;
  return divisors;
}

function factorize(n) {
  const s = sieve();
  const parts = [];
  while (n > 1) {
    const p = s[n];
    let e = 0;
    while (n % p === 0) { n /= p; e++; }
    parts.push(e > 1 ? `${p}${String(e).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])}` : String(p));
  }
  return parts.join(' × ');
}

// Position in the square spiral → its index (1 at the origin, then right,
// up, left, down in growing rings).
export function ulamIndex(x, y) {
  const k = Math.max(Math.abs(x), Math.abs(y));
  if (k === 0) return 1;
  const m = (2 * k + 1) ** 2; // value at the bottom-right corner (k, −k)
  if (y === -k) return m - (k - x);
  if (x === -k) return m - 2 * k - (y + k);
  if (y === k) return m - 4 * k - (x + k);
  return m - 6 * k - (k - y);
}

const EULER = (n) => n * n + n + 41; // prime for n = 0 … 39

export default {
  id: 'ulam',
  title: 'Ulam Prime Spiral',
  area: 'Number theory',
  formula: 'n² + n + 41',
  blurb: 'Write the whole numbers in a spiral and circle the primes: unexplained diagonal lines appear.',

  mount(root, { signal }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Ulam spiral of prime numbers. Drag to pan, scroll or pinch to zoom, hover to see a number.' });
    root.append(canvas);
    const ctx = canvas.getContext('2d');

    const state = { layout: 'ulam', start: 1, color: 'primes', euler: false, palette: 0 };
    const HOME = { ulam: { cx: 0, cy: 0, radius: 170 }, sacks: { cx: 0, cy: 0, radius: 140 } };
    const view = createView(canvas, { ...HOME.ulam, minRadius: 3, maxRadius: 700 });
    let image = null; // offscreen SIDE × SIDE picture of the Ulam grid
    let dirty = true;
    let hover = null;

    // Colour of number n under the current mode, as [r, g, b] 0..255, or null for background.
    function colorOf(n) {
      if (state.euler && eulerSet.has(n)) return [255, 170, 0];
      if (state.color === 'divisors') {
        const d = divisorCounts()[n];
        const [r, g, b] = samplePalette(state.palette, 0.08 + 0.7 * Math.min(1, Math.log(d) / Math.log(160)));
        const k = Math.min(1, 0.25 + Math.log(d) / 4);
        return [r * 255 * k, g * 255 * k, b * 255 * k];
      }
      if (!isPrime(n)) return null;
      if (state.color === 'twin') {
        return isPrime(n - 2) || isPrime(n + 2) ? [255, 170, 0] : [90, 100, 130];
      }
      return [235, 240, 250];
    }

    let eulerSet = new Set();
    function rebuild() {
      eulerSet = new Set();
      for (let k = 0; EULER(k) <= LIMIT; k++) eulerSet.add(EULER(k));
      image = null;
      dirty = true;
    }

    function buildImage() {
      const off = document.createElement('canvas');
      off.width = off.height = SIDE;
      const octx = off.getContext('2d');
      const img = octx.createImageData(SIDE, SIDE);
      const d = img.data;
      for (let py = 0; py < SIDE; py++) {
        for (let px = 0; px < SIDE; px++) {
          const n = ulamIndex(px - HALF, HALF - py) + state.start - 1;
          const c = colorOf(n);
          const i = 4 * (py * SIDE + px);
          if (c) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; } else { d[i] = 5; d[i + 1] = 6; d[i + 2] = 10; }
          d[i + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      image = off;
    }

    // ---- UI
    const hud = createHud(root, [['shown', 'Numbers'], ['primes', 'Primes'], ['hover', 'Pointer'], ['zoom', 'Zoom']]);
    const panel = createPanel(root, { title: 'Ulam Prime Spiral', formula: 'primes in a square spiral', signal });
    const startSlider = slider({
      label: 'Start the spiral at', min: 1, max: MAX_START, value: state.start,
      onInput: (v) => { state.start = v; rebuild(); },
    });
    const eulerCheck = check({ label: 'Mark n² + n + 41', checked: false, onChange: (on) => { state.euler = on; rebuild(); } });
    panel.add(
      select({
        label: 'Layout',
        options: [{ value: 'ulam', label: 'Square spiral (Ulam, 1963)' }, { value: 'sacks', label: 'Round spiral (Sacks, 1994)' }],
        value: state.layout,
        onChange: (v) => { state.layout = v; view.set(HOME[v]); startSlider.hidden = v !== 'ulam'; dirty = true; },
      }),
      startSlider,
      select({
        label: 'Show',
        options: [
          { value: 'primes', label: 'Primes' },
          { value: 'twin', label: 'Twin primes (p and p + 2 both prime)' },
          { value: 'divisors', label: 'Number of divisors (bright = many)' },
        ],
        value: state.color,
        onChange: (v) => { state.color = v; rebuild(); },
      }),
      swatches({ palettes: PALETTES, value: state.palette, onChange: (i) => { state.palette = i; if (state.color === 'divisors') rebuild(); } }),
      toggles(eulerCheck),
      actions(
        button({ label: 'Euler’s prime line', primary: true, onClick: () => {
          // Starting at 41 puts n² + n + 41 on one diagonal.
          state.start = 41; startSlider.set(41); state.euler = true; eulerCheck.input.checked = true;
          state.layout = 'ulam'; panel.body.querySelector('select').value = 'ulam'; startSlider.hidden = false;
          view.set({ cx: 0, cy: 0, radius: 26 }); rebuild();
        } }),
        button({ label: 'Reset view', onClick: () => { view.set(HOME[state.layout]); dirty = true; } }),
      ),
      note('Hover to see a number and its factors. Drag to pan, scroll or pinch to zoom; zoom in far to read the numbers. Keys: <kbd>R</kbd> reset, <kbd>H</kbd> panel.'),
      about(`<p>In 1963 Stanisław Ulam, doodling during a dull talk, wrote the numbers 1, 2, 3, … in a square spiral and circled the primes. They lined up along diagonals far more than chance would allow. Nobody has fully explained why.</p>
        <p>A diagonal of the spiral holds the values of a quadratic, 4<i>k</i>² + <i>bk</i> + <i>c</i>. Some quadratics produce far more primes than others: Euler's <i>n</i>² + <i>n</i> + 41 is prime for every <i>n</i> from 0 to 39. Start the spiral at 41 and its values form one bright diagonal. The Hardy–Littlewood conjecture F (1923) predicts how dense each line should be, but it is still unproved.</p>
        <p>The round layout, by Robert Sacks, places <i>n</i> at radius √<i>n</i> and angle 2π√<i>n</i>, so the perfect squares lie on one ray. Primes gather on curves there too.</p>
        <p>Twin primes such as 41 and 43 differ by 2. Whether there are infinitely many is one of the oldest open problems in mathematics.</p>`),
    );

    attachPanZoom(canvas, view, () => { dirty = true; }, {
      signal,
      keys: { r: () => { view.set(HOME[state.layout]); dirty = true; }, h: () => { panel.toggle(); dirty = true; } },
    });
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      const [x, y] = view.toPlane(e.clientX - r.left, e.clientY - r.top);
      hover = { x, y };
      dirty = true;
    }, { signal });
    canvas.addEventListener('pointerleave', () => { hover = null; dirty = true; }, { signal });
    window.addEventListener('resize', () => { dirty = true; }, { signal });

    // Number under the pointer for the current layout.
    function hoveredNumber() {
      if (!hover) return null;
      if (state.layout === 'ulam') {
        const x = Math.round(hover.x), y = Math.round(hover.y);
        if (Math.abs(x) > HALF || Math.abs(y) > HALF) return null;
        return ulamIndex(x, y) + state.start - 1;
      }
      // Sacks: nearest n with √n close to the radius and matching angle.
      const r = Math.hypot(hover.x, hover.y);
      let best = null, bestD = Infinity;
      for (let n = Math.max(1, Math.floor((r - 1) ** 2)); n <= Math.min(SACKS_MAX, Math.ceil((r + 1) ** 2)); n++) {
        const s = Math.sqrt(n), a = 2 * Math.PI * s;
        const dd = Math.hypot(s * Math.cos(a) - hover.x, s * Math.sin(a) - hover.y);
        if (dd < bestD) { bestD = dd; best = n; }
      }
      return bestD < 0.6 ? best : null;
    }

    rebuild();
    let primeCount = null;

    startLoop(signal, () => {
      const s = dpr();
      const w = Math.round(canvas.clientWidth * s);
      const h = Math.round(canvas.clientHeight * s);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; dirty = true; }
      if (!dirty) return;
      dirty = false;

      const unit = s / view.cssPixel(); // device pixels per plane unit
      const X = (x) => w / 2 + (x - view.cx) * unit;
      const Y = (y) => h / 2 - (y - view.cy) * unit;
      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, w, h);

      let shownMax;
      if (state.layout === 'ulam') {
        if (!image) buildImage();
        ctx.imageSmoothingEnabled = unit < 1;
        ctx.drawImage(image, X(-HALF - 0.5), Y(HALF + 0.5), SIDE * unit, SIDE * unit);
        if (unit >= 18) {
          // Zoomed in: write the numbers on their cells.
          ctx.font = `${Math.min(14 * s, unit * 0.32)}px "Chivo Mono", ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const x0 = Math.max(-HALF, Math.floor(view.cx - w / 2 / unit)), x1 = Math.min(HALF, Math.ceil(view.cx + w / 2 / unit));
          const y0 = Math.max(-HALF, Math.floor(view.cy - h / 2 / unit)), y1 = Math.min(HALF, Math.ceil(view.cy + h / 2 / unit));
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              const n = ulamIndex(x, y) + state.start - 1;
              const lit = colorOf(n);
              ctx.fillStyle = lit && (lit[0] + lit[1] + lit[2]) > 400 ? '#05060a' : 'rgba(232, 235, 243, 0.45)';
              ctx.fillText(String(n), X(x), Y(y));
            }
          }
          ctx.strokeStyle = 'rgba(170, 182, 214, 0.12)';
          ctx.lineWidth = s;
          ctx.beginPath();
          for (let x = x0; x <= x1 + 1; x++) { ctx.moveTo(X(x - 0.5), 0); ctx.lineTo(X(x - 0.5), h); }
          for (let y = y0; y <= y1 + 1; y++) { ctx.moveTo(0, Y(y - 0.5)); ctx.lineTo(w, Y(y - 0.5)); }
          ctx.stroke();
        }
        shownMax = SIDE * SIDE + state.start - 1;
      } else {
        // Sacks spiral: one dot per number.
        const dot = Math.max(1.2 * s, Math.min(unit * 0.35, 6 * s));
        const groups = new Map();
        for (let n = 1; n <= SACKS_MAX; n++) {
          const c = colorOf(n);
          if (!c) continue;
          const r = Math.sqrt(n), a = 2 * Math.PI * r;
          const px = X(r * Math.cos(a)), py = Y(r * Math.sin(a));
          if (px < -dot || px > w + dot || py < -dot || py > h + dot) continue;
          const key = c.map((v) => Math.round(v)).join(',');
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(px, py);
        }
        for (const [key, pts] of groups) {
          ctx.fillStyle = `rgb(${key})`;
          ctx.beginPath();
          for (let i = 0; i < pts.length; i += 2) ctx.rect(pts[i] - dot / 2, pts[i + 1] - dot / 2, dot, dot);
          ctx.fill();
        }
        shownMax = SACKS_MAX;
      }

      const n = hoveredNumber();
      if (n != null && state.layout === 'ulam') {
        const x = Math.round(hover.x), y = Math.round(hover.y);
        ctx.strokeStyle = '#ffaa00';
        ctx.lineWidth = 1.5 * s;
        ctx.strokeRect(X(x - 0.5), Y(y + 0.5), unit, unit);
      }
      if (primeCount == null || primeCount.max !== shownMax) {
        let c = 0;
        for (let k = state.layout === 'ulam' ? state.start : 2; k <= shownMax; k++) if (isPrime(k)) c++;
        primeCount = { max: shownMax, c };
      }
      hud.set('shown', `${state.layout === 'ulam' ? state.start.toLocaleString('en-US') : '1'} to ${shownMax.toLocaleString('en-US')}`);
      hud.set('primes', `${primeCount.c.toLocaleString('en-US')} (N / ln N ≈ ${Math.round(shownMax / Math.log(shownMax)).toLocaleString('en-US')})`);
      hud.set('hover', n == null ? '—' : isPrime(n) ? `${n.toLocaleString('en-US')} is prime` : n === 1 ? '1' : `${n.toLocaleString('en-US')} = ${factorize(n)}`);
      hud.set('zoom', fmtZoom(HOME[state.layout].radius / view.radius));
    });
  },
};
