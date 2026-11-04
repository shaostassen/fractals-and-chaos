import { PALETTES, samplePalette } from '../shared/palettes.js';
import { startLoop, dpr } from '../shared/loop.js';
import { attachKeys } from '../shared/panzoom.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about, swatches, sci,
} from '../shared/ui.js';

// Two equal rods (length 1) with equal point masses. Angles from straight down.
// Standard equations of motion; integrated with fixed-step RK4.
function accel(t1, t2, w1, w2, g, out) {
  const d = t1 - t2;
  const sd = Math.sin(d);
  const cd = Math.cos(d);
  const den = 3 - Math.cos(2 * d);
  out[0] = (-3 * g * Math.sin(t1) - g * Math.sin(t1 - 2 * t2) - 2 * sd * (w2 * w2 + w1 * w1 * cd)) / den;
  out[1] = (2 * sd * (2 * w1 * w1 + 2 * g * Math.cos(t1) + w2 * w2 * cd)) / den;
}

const COUNTS = [1, 10, 100, 500, 1000, 2000];
const H = 1 / 300; // simulation step, seconds

export default {
  id: 'pendulums',
  title: 'Double Pendulums',
  area: 'Chaos',
  formula: 'θ̈ from Lagrangian mechanics, two rods',
  blurb: 'A thousand pendulums released a millionth of a radian apart. They move as one, then explode into a rainbow.',

  mount(root, { signal }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Double pendulums swinging. Drag to set the starting angles.' });
    root.append(canvas);
    const ctx = canvas.getContext('2d');
    const trails = document.createElement('canvas');
    const tctx = trails.getContext('2d');

    const state = {
      count: 1000, angle1: 130, angle2: 160, spreadExp: -6, gravity: 9.81, speed: 1,
      trails: true, rods: true, palette: 4, paused: false, t: 0,
    };

    let n = 0;
    let t1, t2, w1, w2;
    const a = new Float64Array(2);

    function reset() {
      n = state.count;
      t1 = new Float64Array(n); t2 = new Float64Array(n);
      w1 = new Float64Array(n); w2 = new Float64Array(n);
      const eps = 10 ** state.spreadExp;
      for (let i = 0; i < n; i++) {
        t1[i] = (state.angle1 * Math.PI) / 180;
        // Each pendulum's lower arm starts eps radians further than the last.
        t2[i] = (state.angle2 * Math.PI) / 180 + (i - (n - 1) / 2) * eps;
      }
      state.t = 0;
      tctx.clearRect(0, 0, trails.width, trails.height);
    }

    function stepAll(dtSim) {
      const g = state.gravity;
      const steps = Math.max(1, Math.round(dtSim / H));
      for (let i = 0; i < n; i++) {
        let a1 = t1[i], a2 = t2[i], b1 = w1[i], b2 = w2[i];
        for (let s = 0; s < steps; s++) {
          accel(a1, a2, b1, b2, g, a); const k1a = b1, k1b = b2, k1c = a[0], k1d = a[1];
          accel(a1 + k1a * H / 2, a2 + k1b * H / 2, b1 + k1c * H / 2, b2 + k1d * H / 2, g, a);
          const k2a = b1 + k1c * H / 2, k2b = b2 + k1d * H / 2, k2c = a[0], k2d = a[1];
          accel(a1 + k2a * H / 2, a2 + k2b * H / 2, b1 + k2c * H / 2, b2 + k2d * H / 2, g, a);
          const k3a = b1 + k2c * H / 2, k3b = b2 + k2d * H / 2, k3c = a[0], k3d = a[1];
          accel(a1 + k3a * H, a2 + k3b * H, b1 + k3c * H, b2 + k3d * H, g, a);
          const k4a = b1 + k3c * H, k4b = b2 + k3d * H, k4c = a[0], k4d = a[1];
          a1 += (H / 6) * (k1a + 2 * k2a + 2 * k3a + k4a);
          a2 += (H / 6) * (k1b + 2 * k2b + 2 * k3b + k4b);
          b1 += (H / 6) * (k1c + 2 * k2c + 2 * k3c + k4c);
          b2 += (H / 6) * (k1d + 2 * k2d + 2 * k3d + k4d);
        }
        t1[i] = a1; t2[i] = a2; w1[i] = b1; w2[i] = b2;
      }
      state.t += steps * H;
    }

    // Largest distance between any pendulum's tip and the middle one's, in rod lengths.
    function tipSpread() {
      const m = n >> 1;
      const mx = Math.sin(t1[m]) + Math.sin(t2[m]);
      const my = Math.cos(t1[m]) + Math.cos(t2[m]);
      let s = 0;
      for (let i = 0; i < n; i++) {
        s = Math.max(s, Math.hypot(Math.sin(t1[i]) + Math.sin(t2[i]) - mx, Math.cos(t1[i]) + Math.cos(t2[i]) - my));
      }
      return s;
    }

    // ---- UI
    const hud = createHud(root, [['n', 'Pendulums'], ['t', 'Time'], ['spread', 'Tip spread']]);
    const panel = createPanel(root, { title: 'Double Pendulums', formula: 'two rods, one hinge', signal });
    const pauseBtn = button({ label: 'Pause', onClick: () => setPaused(!state.paused) });
    const angle1 = slider({ label: 'Upper arm start', min: -180, max: 180, value: state.angle1, format: (v) => `${v}°`, onInput: (v) => { state.angle1 = v; reset(); } });
    const angle2 = slider({ label: 'Lower arm start', min: -180, max: 180, value: state.angle2, format: (v) => `${v}°`, onInput: (v) => { state.angle2 = v; reset(); } });
    function setPaused(p) { state.paused = p; pauseBtn.textContent = p ? 'Resume' : 'Pause'; }

    panel.add(
      select({
        label: 'Pendulums', options: COUNTS.map((c) => ({ value: String(c), label: c.toLocaleString('en-US') })), value: String(state.count),
        onChange: (v) => { state.count = +v; reset(); },
      }),
      angle1,
      angle2,
      slider({
        label: 'Difference between neighbours', min: -12, max: -1, value: state.spreadExp,
        format: (v) => `${sci(10 ** v, 0).replace('1×', '')} rad`,
        onInput: (v) => { state.spreadExp = v; reset(); },
      }),
      slider({ label: 'Gravity', min: 1, max: 30, step: 0.01, value: state.gravity, format: (v) => `${v.toFixed(2)} m/s²`, onInput: (v) => { state.gravity = v; } }),
      slider({ label: 'Speed', min: 0.1, max: 3, step: 0.05, value: state.speed, format: (v) => `${v.toFixed(2)}×`, onInput: (v) => { state.speed = v; } }),
      swatches({ palettes: PALETTES, value: state.palette, onChange: (i) => { state.palette = i; } }),
      toggles(
        check({ label: 'Trails', checked: true, onChange: (on) => { state.trails = on; tctx.clearRect(0, 0, trails.width, trails.height); } }),
        check({ label: 'Rods', checked: true, onChange: (on) => { state.rods = on; } }),
      ),
      actions(
        button({ label: 'Release again', primary: true, onClick: () => reset() }),
        pauseBtn,
        button({ label: 'Gentle swing', onClick: () => { setAngles(25, 35); } }),
      ),
      note('Drag on the canvas to pose the pendulum, then let go. Keys: <kbd>Space</kbd> pause, <kbd>R</kbd> release again, <kbd>H</kbd> panel.'),
      about(`<p>Each pendulum follows Newton's laws exactly, with no randomness. Their starting angles differ by a tiny amount, set by the slider. For the first few seconds they look like a single pendulum. Then the differences grow exponentially, and within seconds the pendulums are spread across every possible position.</p>
        <p>This is sensitive dependence on initial conditions: to predict where one will be after a minute you would need its starting angle to more decimal places than any measurement can give.</p>
        <p>Try "Gentle swing". At small angles the motion is nearly regular and the pendulums stay together for a long time. Chaos needs enough energy to make the arms flip.</p>`),
    );

    function setAngles(d1, d2) {
      state.angle1 = d1; state.angle2 = d2;
      angle1.set(d1); angle2.set(d2);
      reset();
    }

    // ---- drag to pose
    let posing = false;
    const geometry = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const L = Math.min(w, h) * 0.21;
      return { px: w / 2, py: h * 0.42, L };
    };
    canvas.addEventListener('pointerdown', (e) => { posing = true; canvas.setPointerCapture(e.pointerId); pose(e); }, { signal });
    canvas.addEventListener('pointermove', (e) => { if (posing) pose(e); }, { signal });
    const endPose = () => { if (posing) { posing = false; setPaused(false); } };
    canvas.addEventListener('pointerup', endPose, { signal });
    canvas.addEventListener('pointercancel', endPose, { signal });
    function pose(e) {
      // Point the arms at the cursor: solve the two-link reach for the tip.
      const { px, py, L } = geometry();
      const r = canvas.getBoundingClientRect();
      let dx = e.clientX - r.left - px;
      let dy = e.clientY - r.top - py;
      let d = Math.hypot(dx, dy);
      if (d > 2 * L * 0.999) { dx *= (2 * L * 0.999) / d; dy *= (2 * L * 0.999) / d; d = 2 * L * 0.999; }
      d = Math.max(d, 1);
      const base = Math.atan2(dx, dy);
      const bend = Math.acos(Math.min(1, d / (2 * L)));
      const a1 = base + bend;
      const a2 = base - bend;
      const toDeg = (x) => Math.round(((((x * 180) / Math.PI) % 360) + 540) % 360 - 180);
      setAngles(toDeg(a1), toDeg(a2));
      setPaused(true);
    }

    attachKeys({ ' ': () => setPaused(!state.paused), r: () => reset(), h: () => panel.toggle() }, signal);

    reset();
    let colors = [];
    let colorKey = '';

    startLoop(signal, (now, dt) => {
      const s = dpr();
      const w = Math.round(canvas.clientWidth * s);
      const h = Math.round(canvas.clientHeight * s);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = trails.width = w;
        canvas.height = trails.height = h;
      }
      if (!state.paused) stepAll((dt / 1000) * state.speed);

      const key = `${n}-${state.palette}`;
      if (key !== colorKey) {
        colorKey = key;
        colors = Array.from({ length: n }, (_, i) => {
          const [r, g, b] = samplePalette(state.palette, 0.08 + 0.84 * (n > 1 ? i / (n - 1) : 0.5) * 0.999);
          return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
        });
      }

      const { px, py, L } = geometry();
      const X = px * s, Y = py * s, R = L * s;
      const tip = (i) => [X + R * (Math.sin(t1[i]) + Math.sin(t2[i])), Y + R * (Math.cos(t1[i]) + Math.cos(t2[i]))];

      // Trails: fade the old layer, then dot each tip.
      if (state.trails && !state.paused) {
        tctx.globalCompositeOperation = 'destination-out';
        tctx.fillStyle = `rgba(0,0,0,${Math.min(1, 0.035 * (dt / 16.7))})`;
        tctx.fillRect(0, 0, w, h);
        tctx.globalCompositeOperation = 'source-over';
        tctx.globalAlpha = Math.min(1, 0.35 + 30 / n);
        for (let i = 0; i < n; i++) {
          const [x, y] = tip(i);
          tctx.fillStyle = colors[i];
          tctx.fillRect(x - s, y - s, 2 * s, 2 * s);
        }
        tctx.globalAlpha = 1;
      }

      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, w, h);
      if (state.trails) ctx.drawImage(trails, 0, 0);

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const alpha = Math.min(1, 0.25 + 40 / n);
      if (state.rods) {
        ctx.lineWidth = Math.max(1, 2.2 * s * Math.min(1, 6 / Math.sqrt(n)));
        ctx.globalAlpha = alpha;
        for (let i = 0; i < n; i++) {
          const x1 = X + R * Math.sin(t1[i]), y1 = Y + R * Math.cos(t1[i]);
          const [x2, y2] = tip(i);
          ctx.strokeStyle = colors[i];
          ctx.beginPath();
          ctx.moveTo(X, Y); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = Math.min(1, alpha * 1.5);
      const bob = Math.max(1.5 * s, 7 * s * Math.min(1, 4 / Math.sqrt(n)));
      for (let i = 0; i < n; i++) {
        const [x, y] = tip(i);
        ctx.fillStyle = colors[i];
        ctx.beginPath(); ctx.arc(x, y, bob, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e8ebf3';
      ctx.beginPath(); ctx.arc(X, Y, 4 * s, 0, Math.PI * 2); ctx.fill();

      hud.set('n', n.toLocaleString('en-US'));
      hud.set('t', `${state.t.toFixed(1)} s`);
      hud.set('spread', n > 1 ? `${sci(tipSpread(), 1)} rod lengths` : '—');
    });
  },
};
