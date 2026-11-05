import { startLoop, dpr } from '../shared/loop.js';
import { attachKeys } from '../shared/panzoom.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about,
} from '../shared/ui.js';

// Any closed curve z(t), 0 ≤ t < 1, is a sum of circles turning at whole-number
// speeds: z(t) = Σ c_k·e^(2πikt). The discrete Fourier transform of N evenly
// spaced samples gives the c_k; sorted by size, the first few circles carry
// most of the shape.

const N = 512; // samples per curve, so up to 512 circles

const TAU = Math.PI * 2;
const curve = (fn, steps = 2000) => Array.from({ length: steps }, (_, i) => fn((i / steps) * TAU));
const polygon = (pts) => [...pts, pts[0]];

const SHAPES = [
  {
    name: 'Heart',
    points: () => curve((t) => [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]),
    circles: 12,
  },
  {
    name: 'Square',
    points: () => polygon([[-1, -1], [1, -1], [1, 1], [-1, 1]]),
    circles: 25,
  },
  {
    name: 'Star',
    points: () => polygon(Array.from({ length: 10 }, (_, i) => {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 0.4 : 1;
      return [r * Math.cos(a), r * Math.sin(a)];
    })),
    circles: 40,
  },
  {
    name: 'Butterfly curve',
    // Temple Fay's butterfly; closed after 12π.
    points: () => curve((t) => {
      const s = t * 6;
      const r = Math.exp(Math.cos(s)) - 2 * Math.cos(4 * s) - Math.sin(s / 12) ** 5;
      return [Math.sin(s) * r, Math.cos(s) * r];
    }, 6000),
    circles: 120,
  },
  {
    name: 'Trefoil knot shadow',
    points: () => curve((t) => [Math.sin(t) + 2 * Math.sin(2 * t), Math.cos(t) - 2 * Math.cos(2 * t)]),
    circles: 3,
  },
  {
    name: 'Rose (7 petals)',
    points: () => curve((t) => {
      const r = Math.cos(7 * t / 2);
      return [r * Math.cos(t), r * Math.sin(t)];
    }, 4000).concat(curve((t) => {
      const r = Math.cos(7 * (t + TAU) / 2);
      return [r * Math.cos(t), r * Math.sin(t)];
    }, 4000)),
    circles: 30,
  },
];

// Resample a closed polyline to n points evenly spaced along its length.
function resample(pts, n) {
  const closed = [...pts, pts[0]];
  const cum = [0];
  for (let i = 1; i < closed.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(closed[i][0] - closed[i - 1][0], closed[i][1] - closed[i - 1][1]));
  }
  const total = cum.at(-1) || 1;
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = (i / n) * total;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const f = (s - cum[j]) / seg;
    out.push([closed[j][0] + (closed[j + 1][0] - closed[j][0]) * f, closed[j][1] + (closed[j + 1][1] - closed[j][1]) * f]);
  }
  return out;
}

// Centre on the mean point and scale so the shape has RMS radius 1.
function normalize(pts) {
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const rms = Math.sqrt(pts.reduce((s, p) => s + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0) / pts.length) || 1;
  return pts.map(([x, y]) => [(x - mx) / rms, (y - my) / rms]);
}

// Discrete Fourier transform; returns terms sorted largest first.
function dft(pts) {
  const n = pts.length;
  const terms = [];
  for (let k = -n / 2; k < n / 2; k++) {
    let re = 0, im = 0;
    for (let j = 0; j < n; j++) {
      const a = (-TAU * k * j) / n;
      const c = Math.cos(a), s = Math.sin(a);
      re += pts[j][0] * c - pts[j][1] * s;
      im += pts[j][0] * s + pts[j][1] * c;
    }
    re /= n; im /= n;
    terms.push({ freq: k, re, im, amp: Math.hypot(re, im), phase: Math.atan2(im, re) });
  }
  return terms.sort((a, b) => b.amp - a.amp);
}

// Sum of the first k terms at time t (0..1).
function evaluate(terms, k, t) {
  let x = 0, y = 0;
  for (let i = 0; i < k; i++) {
    const { freq, amp, phase } = terms[i];
    const a = TAU * freq * t + phase;
    x += amp * Math.cos(a);
    y += amp * Math.sin(a);
  }
  return [x, y];
}

const sliderFromCircles = (k) => Math.round((Math.log(k) / Math.log(N)) * 1000);
const circlesFromSlider = (v) => Math.max(1, Math.round(Math.exp((v / 1000) * Math.log(N))));

export default {
  id: 'fourier',
  title: 'Fourier Epicycles',
  area: 'Geometry',
  formula: 'z(t) = Σ c<sub>k</sub>·e<sup>2πikt</sup>',
  blurb: 'Draw any closed shape and a chain of spinning circles draws it back. More circles, sharper copy.',

  mount(root, { signal }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Fourier epicycles drawing a shape. Drag on the canvas to draw your own shape.' });
    root.append(canvas);
    const ctx = canvas.getContext('2d');

    const state = {
      shape: 0, circles: SHAPES[0].circles, loop: 10, showCircles: true, showOriginal: true,
      follow: false, paused: false, building: false, t: 0,
    };
    let original = [];   // N resampled, normalized points
    let terms = [];
    let approx = [];     // the k-term curve, for drawing
    let trail = [];
    let drawing = null;  // points of a stroke in progress (world units)
    let custom = null;   // last user drawing

    // ---- view: world units (RMS radius 1) to screen pixels
    const geometry = () => {
      const s = dpr();
      const w = canvas.width, h = canvas.height;
      const panelOpen = !panel.panel.hidden && panel.panel.getBoundingClientRect().left > canvas.clientWidth * 0.4;
      const visibleW = panelOpen ? panel.panel.getBoundingClientRect().left * s : w;
      return { cx: visibleW / 2, cy: h / 2, scale: Math.min(visibleW, h) * 0.2 };
    };

    function setShape(pts, name) {
      original = normalize(resample(pts, N));
      terms = dft(original);
      hud.set('shape', name);
      updateApprox();
    }

    function updateApprox() {
      approx = Array.from({ length: N + 1 }, (_, i) => evaluate(terms, state.circles, i / N));
      trail = [];
      circlesSlider.set(sliderFromCircles(state.circles));
      circlesSlider.setText(`${state.circles} of ${N}`);
      // Parseval: the mean squared error is the energy in the circles left out.
      let missing = 0, total = 0;
      terms.forEach((term, i) => {
        if (term.freq === 0) return;
        total += term.amp ** 2;
        if (i >= state.circles) missing += term.amp ** 2;
      });
      hud.set('error', `${((100 * Math.sqrt(missing)) / Math.sqrt(total)).toFixed(missing / total < 1e-6 ? 3 : 1)}% of size`);
      hud.set('circles', `${state.circles} of ${N}`);
    }

    function pickShape(i) {
      state.shape = i;
      setBuilding(false);
      if (i === SHAPES.length) {
        if (custom) { state.circles = 60; setShape(custom, 'Your drawing'); }
        return;
      }
      state.circles = SHAPES[i].circles;
      setShape(SHAPES[i].points(), SHAPES[i].name);
    }

    // ---- UI
    const hud = createHud(root, [['shape', 'Shape'], ['circles', 'Circles'], ['error', 'Error']]);
    const panel = createPanel(root, { title: 'Fourier Epicycles', formula: 'z(t) = Σ c<sub>k</sub> e<sup>2πikt</sup>', signal });
    const shapeSelect = select({
      label: 'Shape',
      options: [...SHAPES.map((s, i) => ({ value: String(i), label: s.name })), { value: String(SHAPES.length), label: 'Your drawing', hidden: true }],
      value: '0',
      onChange: (v) => pickShape(+v),
    });
    const circlesSlider = slider({
      label: 'Circles', min: 0, max: 1000, value: sliderFromCircles(state.circles),
      format: () => `${state.circles} of ${N}`,
      onInput: (v) => { setBuilding(false); state.circles = circlesFromSlider(v); updateApprox(); },
    });
    const buildBtn = button({ label: 'Build up from 1 circle', primary: true, onClick: () => setBuilding(!state.building) });
    const pauseBtn = button({ label: 'Pause', onClick: () => setPaused(!state.paused) });
    const followCheck = check({ label: 'Follow the pen', checked: false, onChange: (on) => { state.follow = on; } });
    const circlesCheck = check({ label: 'Circles', checked: true, onChange: (on) => { state.showCircles = on; } });

    panel.add(
      shapeSelect,
      note('Or drag on the canvas to draw your own closed shape.'),
      circlesSlider,
      slider({ label: 'Time per loop', min: 3, max: 40, value: state.loop, format: (v) => `${v} s`, onInput: (v) => { state.loop = v; } }),
      toggles(circlesCheck, check({ label: 'Original', checked: true, onChange: (on) => { state.showOriginal = on; } }), followCheck),
      actions(buildBtn, pauseBtn, button({ label: 'Restart loop', onClick: () => { state.t = 0; trail = []; } })),
      note('Keys: <kbd>B</kbd> build up, <kbd>F</kbd> follow the pen, <kbd>C</kbd> circles, <kbd>Space</kbd> pause, <kbd>R</kbd> restart, <kbd>H</kbd> panel.'),
      about(`<p>Each circle spins at a whole number of turns per loop, some clockwise and some counterclockwise, and each one rides on the rim of the one before. Adding up enough of them can trace any closed curve. This is a Fourier series: the shape is written as <i>z</i>(<i>t</i>) = Σ <i>c<sub>k</sub></i> e<sup>2πi<i>kt</i></sup>, where <i>c<sub>k</sub></i> gives the size and starting angle of the circle that turns <i>k</i> times.</p>
        <p>The circles come from the discrete Fourier transform of ${N} evenly spaced points on the shape, and are drawn largest first. Smooth shapes need only a few. Sharp corners need many, and the copy overshoots near each corner (the Gibbs phenomenon): watch the square.</p>
        <p>The error readout uses Parseval's theorem: the average squared distance between the copy and the shape equals the sum of the squared radii of the circles left out.</p>
        <p>Astronomers from Ptolemy to Copernicus used the same idea, circles riding on circles, to predict planetary motion.</p>`),
    );

    function setBuilding(on) {
      state.building = on;
      buildBtn.textContent = on ? 'Stop building' : 'Build up from 1 circle';
      buildBtn.setAttribute('aria-pressed', String(on));
      if (on) { state.circles = 1; state.buildT = 0; updateApprox(); }
    }
    function setPaused(p) { state.paused = p; pauseBtn.textContent = p ? 'Resume' : 'Pause'; }

    // ---- drawing your own shape
    const toWorld = (e) => {
      const r = canvas.getBoundingClientRect();
      const { cx, cy, scale } = geometry();
      const s = dpr();
      return [((e.clientX - r.left) * s - cx) / scale, -((e.clientY - r.top) * s - cy) / scale];
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      drawing = [toWorld(e)];
    }, { signal });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = toWorld(e);
      const last = drawing.at(-1);
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.004) drawing.push(p);
    }, { signal });
    const finish = () => {
      if (!drawing) return;
      const pts = drawing;
      drawing = null;
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (pts.length < 8 || len < 0.3) return; // a tap, not a drawing
      custom = pts;
      shapeSelect.input.value = String(SHAPES.length);
      state.shape = SHAPES.length;
      setBuilding(false);
      state.circles = 60;
      setShape(custom, 'Your drawing');
      state.t = 0;
    };
    canvas.addEventListener('pointerup', finish, { signal });
    canvas.addEventListener('pointercancel', () => { drawing = null; }, { signal });

    attachKeys({
      b: () => setBuilding(!state.building),
      f: () => { state.follow = !state.follow; followCheck.input.checked = state.follow; },
      c: () => { state.showCircles = !state.showCircles; circlesCheck.input.checked = state.showCircles; },
      ' ': () => setPaused(!state.paused),
      r: () => { state.t = 0; trail = []; },
      h: () => panel.toggle(),
    }, signal);

    pickShape(0);

    startLoop(signal, (now, dt) => {
      const s = dpr();
      const w = Math.round(canvas.clientWidth * s);
      const h = Math.round(canvas.clientHeight * s);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

      if (state.building) {
        // Double the circle count about every 1.5 loops' worth of time.
        state.buildT += dt / 1000;
        const k = Math.min(N, Math.max(1, Math.round(2 ** (state.buildT / 1.2))));
        if (k !== state.circles) { state.circles = k; updateApprox(); }
        if (k === N) setBuilding(false);
      }
      if (!state.paused && !drawing) {
        const prev = state.t;
        state.t = (state.t + dt / 1000 / state.loop) % 1;
        if (state.t < prev) trail = [];
      }

      const g = geometry();
      const pen = evaluate(terms, state.circles, state.t);
      let { cx, cy, scale } = g;
      if (state.follow) {
        // Zoom in on the pen so the smallest circles are visible.
        scale *= 6;
        cx = g.cx - pen[0] * scale;
        cy = g.cy + pen[1] * scale;
      }
      const X = (p) => cx + p[0] * scale;
      const Y = (p) => cy - p[1] * scale;

      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, w, h);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      if (state.showOriginal && !drawing) {
        ctx.strokeStyle = 'rgba(232, 235, 243, 0.22)';
        ctx.lineWidth = 1.5 * s;
        ctx.setLineDash([4 * s, 5 * s]);
        ctx.beginPath();
        original.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (!drawing) {
        // The full k-circle curve, faint, so the target of the pen is visible.
        ctx.strokeStyle = 'rgba(255, 170, 0, 0.22)';
        ctx.lineWidth = 1.5 * s;
        ctx.beginPath();
        approx.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
        ctx.stroke();

        // Trail drawn this loop.
        trail.push(pen);
        ctx.strokeStyle = '#ffaa00';
        ctx.lineWidth = 2.5 * s;
        ctx.beginPath();
        trail.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
        ctx.stroke();

        // The chain of circles.
        if (state.showCircles) {
          let x = 0, y = 0;
          for (let i = 0; i < state.circles; i++) {
            const { freq, amp, phase } = terms[i];
            const r = amp * scale;
            const a = TAU * freq * state.t + phase;
            const nx = x + amp * Math.cos(a);
            const ny = y + amp * Math.sin(a);
            if (r > 0.6 * s) {
              ctx.strokeStyle = `rgba(76, 201, 240, ${i === 0 ? 0.12 : 0.28})`;
              ctx.lineWidth = s;
              ctx.beginPath();
              ctx.arc(X([x, y]), Y([x, y]), r, 0, TAU);
              ctx.stroke();
              ctx.strokeStyle = 'rgba(232, 235, 243, 0.7)';
              ctx.beginPath();
              ctx.moveTo(X([x, y]), Y([x, y]));
              ctx.lineTo(X([nx, ny]), Y([nx, ny]));
              ctx.stroke();
            }
            x = nx; y = ny;
          }
        }
        ctx.fillStyle = '#fff8ec';
        ctx.beginPath(); ctx.arc(X(pen), Y(pen), 4 * s, 0, TAU); ctx.fill();
      } else {
        ctx.strokeStyle = '#ffaa00';
        ctx.lineWidth = 2.5 * s;
        ctx.beginPath();
        drawing.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
        ctx.stroke();
      }
      hud.note(drawing ? 'Drawing: let go to close the shape.' : state.building ? 'Adding circles, largest first.' : '');
    });
  },
};

// Exported for tests.
export { resample, normalize, dft, evaluate };
