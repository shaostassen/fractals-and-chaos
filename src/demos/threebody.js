import { createView, attachPanZoom } from '../shared/panzoom.js';
import { startLoop, dpr } from '../shared/loop.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about, sci,
} from '../shared/ui.js';

// Planar Newtonian gravity with G = 1. Every preset is shifted into the
// centre-of-mass frame with zero total momentum, so the origin stays put.

const BODY_COLORS = ['#ffaa00', '#4cc9f0', '#f15bb5'];
const BODY_NAMES = ['amber', 'blue', 'pink'];

// Šuvakov & Dmitrašinović (2013) periodic orbits: equal masses at (−1, 0),
// (1, 0), (0, 0); the outer two share velocity (p1, p2), the middle one −2(p1, p2).
const suvakov = (name, p1, p2, period, radius = 1.3) => ({
  name,
  masses: [1, 1, 1],
  pos: [[-1, 0], [1, 0], [0, 0]],
  vel: [[p1, p2], [p1, p2], [-2 * p1, -2 * p2]],
  radius,
  blurb: `Periodic orbit found by Šuvakov and Dmitrašinović in 2013 (period ≈ ${period}). It is unstable: the twin eventually breaks away.`,
});

// Equilateral triangle rotating rigidly (Lagrange, 1772).
function lagrange() {
  const w = Math.sqrt(1 / Math.sqrt(3)); // ω² = G·M / side³ with side √3, M = 3
  const pos = [90, 210, 330].map((a) => [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)]);
  return {
    name: 'Lagrange triangle',
    masses: [1, 1, 1],
    pos,
    vel: pos.map(([x, y]) => [-w * y, w * x]),
    radius: 1.5,
    blurb: 'Three equal masses on a rotating equilateral triangle. It is an exact solution, but unstable for equal masses: any tiny error grows until the triangle falls apart.',
  };
}

const PRESETS = [
  {
    name: 'Figure-eight',
    masses: [1, 1, 1],
    pos: [[-0.97000436, 0.24308753], [0.97000436, -0.24308753], [0, 0]],
    vel: [[0.46620368, 0.43236573], [0.46620368, 0.43236573], [-0.93240737, -0.86473146]],
    radius: 1.35,
    blurb: 'Three equal masses chasing each other around one figure-eight (Moore 1993; proved by Chenciner and Montgomery, 2000). Unusually, it is stable: the twin stays close.',
  },
  lagrange(),
  suvakov('Butterfly', 0.306893, 0.125507, 6.24),
  suvakov('Moth', 0.464445, 0.39606, 14.89),
  suvakov('Yin-yang', 0.513938, 0.304736, 17.33),
  suvakov('Dragonfly', 0.080584, 0.588836, 21.27),
  {
    name: 'Pythagorean (3-4-5)',
    masses: [3, 4, 5],
    pos: [[1, 3], [-2, -1], [1, -1]],
    vel: [[0, 0], [0, 0], [0, 0]],
    radius: 4,
    blurb: "Burrau's problem (1913): masses 3, 4 and 5 start at rest on the corners of a 3-4-5 right triangle. After about 60 time units of chaotic close encounters, the lightest body is thrown out and masses 4 and 5 leave as a binary pair (Szebehely and Peters, 1967). Getting this right takes high accuracy; at lower settings the outcome can change.",
  },
  { name: 'Random', random: true, radius: 1.6, blurb: 'Random masses and starting positions with negative total energy, so the system is bound at first. Most random three-body systems eventually eject one body.' },
];

function randomPreset() {
  const masses = [0, 1, 2].map(() => 0.6 + Math.random() * 0.8);
  const pos = [0, 1, 2].map(() => [Math.random() * 2 - 1, Math.random() * 2 - 1]);
  const vel = [0, 1, 2].map(() => [Math.random() - 0.5, Math.random() - 0.5]);
  return { ...PRESETS.at(-1), masses, pos, vel, scaleKinetic: 0.15 + Math.random() * 0.35 };
}


class Sim {
  constructor(preset, nudge = 0) {
    this.m = [...preset.masses];
    const s = (this.s = new Float64Array(12)); // x0 y0 x1 y1 x2 y2 vx0 vy0 vx1 vy1 vx2 vy2
    preset.pos.forEach(([x, y], i) => { s[2 * i] = x; s[2 * i + 1] = y; });
    preset.vel.forEach(([x, y], i) => { s[6 + 2 * i] = x; s[7 + 2 * i] = y; });
    this.toCentreOfMass();
    if (preset.scaleKinetic) {
      // Random preset: set kinetic energy to a fraction of |potential| so it is bound.
      const k = Math.sqrt((preset.scaleKinetic * Math.abs(this.potential())) / Math.max(1e-9, this.kinetic()));
      for (let i = 6; i < 12; i++) s[i] *= k;
    }
    s[0] += nudge;
    this.t = 0;
    this.e0 = this.energy();
    this.k = [0, 1, 2, 3].map(() => new Float64Array(12));
    this.tmp = new Float64Array(12);
    this.trail = new Float64Array(3 * 3 * 20000); // per body: [t, x, y] ring
    this.trailCap = 20000;
    this.trailHead = 0;
    this.trailLen = 0;
    this.lastSample = -Infinity;
  }

  toCentreOfMass() {
    const { s, m } = this;
    const M = m[0] + m[1] + m[2];
    for (const off of [0, 6]) {
      for (const axis of [0, 1]) {
        const mean = (m[0] * s[off + axis] + m[1] * s[off + 2 + axis] + m[2] * s[off + 4 + axis]) / M;
        for (let i = 0; i < 3; i++) s[off + 2 * i + axis] -= mean;
      }
    }
  }

  deriv(s, d) {
    const m = this.m;
    for (let i = 0; i < 6; i++) d[i] = s[6 + i];
    d[6] = d[7] = d[8] = d[9] = d[10] = d[11] = 0;
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const dx = s[2 * j] - s[2 * i];
        const dy = s[2 * j + 1] - s[2 * i + 1];
        const r2 = Math.max(dx * dx + dy * dy, 1e-30); // only an exact collision hits the floor
        const inv = 1 / (r2 * Math.sqrt(r2));
        d[6 + 2 * i] += m[j] * dx * inv; d[7 + 2 * i] += m[j] * dy * inv;
        d[6 + 2 * j] -= m[i] * dx * inv; d[7 + 2 * j] -= m[i] * dy * inv;
      }
    }
  }

  // Step size from the tightest pair: a fraction of its local orbital time.
  stepSize(eta) {
    const { s, m } = this;
    let h = Infinity;
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const r = Math.hypot(s[2 * j] - s[2 * i], s[2 * j + 1] - s[2 * i + 1]);
        h = Math.min(h, eta * Math.sqrt((r * r * r) / (m[i] + m[j])));
      }
    }
    return Math.max(h, 1e-13);
  }

  step(h) {
    const { s, k, tmp } = this;
    this.deriv(s, k[0]);
    for (let i = 0; i < 12; i++) tmp[i] = s[i] + (h / 2) * k[0][i];
    this.deriv(tmp, k[1]);
    for (let i = 0; i < 12; i++) tmp[i] = s[i] + (h / 2) * k[1][i];
    this.deriv(tmp, k[2]);
    for (let i = 0; i < 12; i++) tmp[i] = s[i] + h * k[2][i];
    this.deriv(tmp, k[3]);
    for (let i = 0; i < 12; i++) s[i] += (h / 6) * (k[0][i] + 2 * k[1][i] + 2 * k[2][i] + k[3][i]);
    this.t += h;
  }

  // Integrate up to time `until`; returns false if the step budget ran out.
  advance(until, eta, budget) {
    let steps = 0;
    while (this.t < until && steps < budget) {
      this.step(Math.min(until - this.t, this.stepSize(eta)));
      steps++;
      if (this.t - this.lastSample >= 0.004) this.sample();
    }
    return this.t >= until;
  }

  sample() {
    const { s, trail } = this;
    const base = this.trailHead * 9;
    for (let i = 0; i < 3; i++) {
      trail[base + 3 * i] = this.t;
      trail[base + 3 * i + 1] = s[2 * i];
      trail[base + 3 * i + 2] = s[2 * i + 1];
    }
    this.trailHead = (this.trailHead + 1) % this.trailCap;
    this.trailLen = Math.min(this.trailLen + 1, this.trailCap);
    this.lastSample = this.t;
  }

  kinetic() {
    const { s, m } = this;
    let k = 0;
    for (let i = 0; i < 3; i++) k += 0.5 * m[i] * (s[6 + 2 * i] ** 2 + s[7 + 2 * i] ** 2);
    return k;
  }

  potential() {
    const { s, m } = this;
    let u = 0;
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) u -= (m[i] * m[j]) / Math.hypot(s[2 * j] - s[2 * i], s[2 * j + 1] - s[2 * i + 1]);
    }
    return u;
  }

  energy() { return this.kinetic() + this.potential(); }

  // Index of a body that has left the closest pair for good, or -1: it is far
  // away and has positive energy relative to the pair's centre of mass.
  escaping(scale) {
    const { s, m } = this;
    const dist = (i, j) => Math.hypot(s[2 * j] - s[2 * i], s[2 * j + 1] - s[2 * i + 1]);
    const pairs = [[0, 1, 2], [0, 2, 1], [1, 2, 0]];
    const [a, b, i] = pairs.reduce((best, p) => (dist(p[0], p[1]) < dist(best[0], best[1]) ? p : best));
    const M = m[a] + m[b];
    const cx = (m[a] * s[2 * a] + m[b] * s[2 * b]) / M;
    const cy = (m[a] * s[2 * a + 1] + m[b] * s[2 * b + 1]) / M;
    const vx = (m[a] * s[6 + 2 * a] + m[b] * s[6 + 2 * b]) / M;
    const vy = (m[a] * s[7 + 2 * a] + m[b] * s[7 + 2 * b]) / M;
    const r = Math.hypot(s[2 * i] - cx, s[2 * i + 1] - cy);
    const v2 = (s[6 + 2 * i] - vx) ** 2 + (s[7 + 2 * i] - vy) ** 2;
    const mu = (m[i] * M) / (m[i] + M);
    return r > 4 * scale && 0.5 * mu * v2 - (m[i] * M) / r > 0 ? i : -1;
  }
}

export default {
  id: 'three-body',
  title: 'Three-Body Problem',
  area: 'Chaos',
  formula: 'F = G·m<sub>1</sub>m<sub>2</sub> / r², three times over',
  blurb: 'Three stars under gravity: rare periodic dances and chaotic ejections, raced against a twin started a billionth away.',

  mount(root, { signal }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Three bodies orbiting under gravity. Drag to pan, scroll or pinch to zoom.' });
    root.append(canvas);
    const ctx = canvas.getContext('2d');

    const state = {
      preset: 0, speed: 1, trail: 12, twin: true, twinExp: -9, accuracy: 4, autoFit: true, paused: false,
    };
    const view = createView(canvas, { cx: 0, cy: 0, radius: PRESETS[0].radius, minRadius: 0.05, maxRadius: 400 });
    let sim;
    let twin;
    let scale = 1;
    let budgetHit = false;

    const eta = () => [0.03, 0.015, 0.008, 0.004, 0.002][state.accuracy - 1];

    function restart() {
      const p = PRESETS[state.preset].random ? randomPreset() : PRESETS[state.preset];
      sim = new Sim(p);
      twin = new Sim(p, 10 ** state.twinExp);
      scale = p.radius;
      if (state.autoFit) view.set({ cx: 0, cy: 0, radius: p.radius });
      blurb.textContent = p.blurb;
    }

    // ---- UI
    const hud = createHud(root, [['t', 'Time'], ['energy', 'Energy err'], ['gap', 'Twin gap']]);
    const panel = createPanel(root, { title: 'Three-Body Problem', formula: 'Newtonian gravity, G = 1', signal });
    const blurb = el('p', { class: 'hint' });
    const pauseBtn = button({ label: 'Pause', onClick: () => setPaused(!state.paused) });
    const fitCheck = check({ label: 'Auto-fit view', checked: true, onChange: (on) => { state.autoFit = on; } });
    const twinCheck = check({ label: 'Show twin', checked: true, onChange: (on) => { state.twin = on; } });
    function setPaused(p) { state.paused = p; pauseBtn.textContent = p ? 'Resume' : 'Pause'; }

    panel.add(
      select({
        label: 'Starting setup',
        options: PRESETS.map((p, i) => ({ value: String(i), label: p.name })),
        value: '0',
        onChange: (v) => { state.preset = +v; restart(); },
      }),
      blurb,
      slider({ label: 'Speed', min: 0.1, max: 5, step: 0.05, value: state.speed, format: (v) => `${v.toFixed(2)}×`, onInput: (v) => { state.speed = v; } }),
      slider({ label: 'Trail length', min: 0, max: 60, step: 1, value: state.trail, format: (v) => (v ? `${v} time units` : 'off'), onInput: (v) => { state.trail = v; } }),
      slider({
        label: 'Twin starts off by', min: -14, max: -2, value: state.twinExp,
        format: (v) => sci(10 ** v, 0).replace('1×', ''),
        onInput: (v) => { state.twinExp = v; restart(); },
      }),
      slider({
        label: 'Accuracy', min: 1, max: 5, value: state.accuracy,
        format: (v) => ['rough', 'low', 'medium', 'high', 'very high'][v - 1],
        onInput: (v) => { state.accuracy = v; },
      }),
      toggles(twinCheck, fitCheck),
      actions(
        button({ label: 'Restart', primary: true, onClick: () => restart() }),
        pauseBtn,
        button({ label: 'Random setup', onClick: () => { state.preset = PRESETS.length - 1; presetSelect().value = String(state.preset); restart(); } }),
      ),
      note('Drag to pan, scroll or pinch to zoom (turns off auto-fit). Keys: <kbd>Space</kbd> pause, <kbd>T</kbd> twin, <kbd>R</kbd> restart, <kbd>H</kbd> panel.'),
      about(`<p>Newton solved the motion of two bodies under gravity exactly: ellipses, forever. Add a third and there is no general formula. In the 1880s Henri Poincaré showed why. Most three-body motion is chaotic, and while studying it he discovered the mathematics of chaos.</p>
        <p>Only a few special starting setups repeat. Euler and Lagrange found the first in the 1700s, the figure-eight was found in 1993, and dozens more since 2013, all by computer search.</p>
        <p>The faint <i>twin</i> is a second copy of the same system with one starting position moved by a tiny amount. Its gap from the original shows how unpredictable the motion is. For a chaotic setup the gap grows exponentially, so no measurement can be precise enough for long-range prediction.</p>
        <p><i>Energy err</i> is how far the total energy has drifted from its starting value. The exact motion conserves energy, so this measures the integrator's numerical error. Raise accuracy if it climbs.</p>`),
    );
    const presetSelect = () => panel.body.querySelector('select');

    attachPanZoom(canvas, view, () => {
      state.autoFit = false;
      fitCheck.input.checked = false;
    }, {
      signal,
      keys: {
        ' ': () => setPaused(!state.paused),
        t: () => { state.twin = !state.twin; twinCheck.input.checked = state.twin; },
        r: () => restart(),
        h: () => panel.toggle(),
      },
    });

    restart();

    function drawTrail(s, i, x0, y0, sc, alphaScale, width) {
      if (!state.trail || s.trailLen < 2) return;
      const color = BODY_COLORS[i];
      const cap = s.trailCap;
      const oldest = (s.trailHead - s.trailLen + cap) % cap;
      const cutoff = s.t - state.trail;
      // Draw in age bands so older parts fade out.
      const BANDS = 12;
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      let k = 0;
      while (k < s.trailLen && s.trail[((oldest + k) % cap) * 9 + 3 * i] < cutoff) k++;
      const n = s.trailLen - k;
      if (n < 2) return;
      for (let b = 0; b < BANDS; b++) {
        const from = k + Math.floor((b * n) / BANDS);
        const to = Math.min(s.trailLen - 1, k + Math.floor(((b + 1) * n) / BANDS));
        if (to <= from) continue;
        ctx.globalAlpha = alphaScale * ((b + 1) / BANDS) ** 1.5;
        ctx.beginPath();
        for (let q = from; q <= to; q++) {
          const base = ((oldest + q) % cap) * 9 + 3 * i;
          const x = x0 + s.trail[base + 1] * sc;
          const y = y0 - s.trail[base + 2] * sc;
          if (q === from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    startLoop(signal, (_, dt) => {
      const px = dpr();
      const w = Math.round(canvas.clientWidth * px);
      const h = Math.round(canvas.clientHeight * px);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

      if (!state.paused) {
        const until = sim.t + (dt / 1000) * state.speed;
        const budget = 40000;
        budgetHit = !sim.advance(until, eta(), budget);
        twin.advance(sim.t, eta(), budget); // always kept in step, so the gap stays meaningful
      }

      // Camera: keep every body in frame, easing so it does not jitter.
      if (state.autoFit) {
        let far = scale * 0.8;
        for (const s of state.twin ? [sim, twin] : [sim]) {
          for (let i = 0; i < 3; i++) far = Math.max(far, Math.hypot(s.s[2 * i], s.s[2 * i + 1]) * 1.2);
        }
        // Fit into the part of the screen the panel does not cover (desktop).
        const cw = canvas.clientWidth;
        const ch = canvas.clientHeight;
        const rect = panel.panel.hidden ? null : panel.panel.getBoundingClientRect();
        const visibleW = rect && rect.left > cw * 0.4 ? rect.left - 12 : cw;
        const fitScale = Math.min(cw, ch) / Math.min(visibleW, ch);
        const target = Math.min(far * fitScale, 300);
        // Plane x of the screen centre such that the origin sits mid-visible-area.
        const targetCx = ((cw - visibleW) / 2) * ((2 * view.radius) / Math.min(cw, ch));
        const k = Math.min(1, dt * 0.004);
        view.radius += (target - view.radius) * k;
        view.cx += (targetCx - view.cx) * k;
        view.cy += (0 - view.cy) * k;
      }

      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, w, h);
      const sc = (Math.min(w, h) / 2) / view.radius;
      const x0 = w / 2 - view.cx * sc;
      const y0 = h / 2 + view.cy * sc;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Centre of mass marker.
      ctx.strokeStyle = 'rgba(232, 235, 243, 0.25)';
      ctx.lineWidth = px;
      ctx.beginPath();
      ctx.moveTo(x0 - 6 * px, y0); ctx.lineTo(x0 + 6 * px, y0);
      ctx.moveTo(x0, y0 - 6 * px); ctx.lineTo(x0, y0 + 6 * px);
      ctx.stroke();

      if (state.twin) for (let i = 0; i < 3; i++) drawTrail(twin, i, x0, y0, sc, 0.3, 1 * px);
      for (let i = 0; i < 3; i++) drawTrail(sim, i, x0, y0, sc, 0.85, 1.6 * px);

      for (let i = 0; i < 3; i++) {
        const r = (4 + 3.5 * Math.cbrt(sim.m[i])) * px;
        if (state.twin) {
          ctx.strokeStyle = BODY_COLORS[i];
          ctx.globalAlpha = 0.6;
          ctx.lineWidth = 1.2 * px;
          ctx.beginPath();
          ctx.arc(x0 + twin.s[2 * i] * sc, y0 - twin.s[2 * i + 1] * sc, r + 3 * px, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        const x = x0 + sim.s[2 * i] * sc;
        const y = y0 - sim.s[2 * i + 1] * sc;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
        glow.addColorStop(0, BODY_COLORS[i]);
        glow.addColorStop(0.3, BODY_COLORS[i] + '66');
        glow.addColorStop(1, BODY_COLORS[i] + '00');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff8ec';
        ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
      }

      // Readout.
      let gap = 0;
      for (let i = 0; i < 3; i++) gap = Math.max(gap, Math.hypot(sim.s[2 * i] - twin.s[2 * i], sim.s[2 * i + 1] - twin.s[2 * i + 1]));
      const err = Math.abs((sim.energy() - sim.e0) / sim.e0);
      hud.set('t', sim.t.toFixed(2));
      hud.set('energy', err < 1e-14 ? '< 10⁻¹⁴' : sci(err, 1));
      hud.set('gap', state.twin ? sci(gap, 1) : 'twin hidden');
      const esc = sim.escaping(scale);
      hud.note(esc >= 0
        ? `Ejection: the ${BODY_NAMES[esc]} body has escaping energy and will never return.`
        : budgetHit ? 'Very close encounter: slowed down to keep accuracy.' : '');
    });
  },
};

// Exported for tests.
export { Sim, PRESETS };
