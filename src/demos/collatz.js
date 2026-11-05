import { PALETTES, samplePalette } from '../shared/palettes.js';
import { createView, attachPanZoom } from '../shared/panzoom.js';
import { startLoop, dpr } from '../shared/loop.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about, swatches,
} from '../shared/ui.js';

// Collatz rule: halve an even number, send an odd one to 3n + 1. Every number
// tried so far reaches 1. The tree joins each number to the next one on its
// path; drawn from 1 outward, it bends one way at even numbers and the other
// way at odd ones (the "Collatz coral", after Edmund Harriss).

export const next = (n) => (n % 2 === 0 ? n / 2 : 3 * n + 1);

export function trajectory(n) {
  const path = [n];
  while (n !== 1) { n = next(n); path.push(n); }
  return path;
}

// Steps to reach 1 for every n ≤ max (memoized through smaller values).
export function stoppingTimes(max) {
  const steps = new Uint16Array(max + 1);
  for (let n = 2; n <= max; n++) {
    let m = n, k = 0;
    while (m >= n) { m = next(m); k++; } // until it drops below n
    steps[n] = k + steps[m];
  }
  return steps;
}

export default {
  id: 'collatz',
  title: 'Collatz Tree',
  area: 'Number theory',
  formula: 'n → n/2 or 3n + 1',
  blurb: 'Halve it if even, triple and add one if odd. Every number tried falls to 1, and nobody can prove why.',

  mount(root, { signal }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Collatz tree. Drag to pan, scroll or pinch to zoom.' });
    root.append(canvas);
    const ctx = canvas.getContext('2d');

    const state = {
      mode: 'tree', count: 3000, even: 8.6, odd: -16.4, palette: 3, highlight: 27, sway: false, swayT: 0,
    };
    const view = createView(canvas, { cx: 0, cy: 0, radius: 100, minRadius: 0.5, maxRadius: 1e5 });
    let tree = null;   // Map n -> { parent, depth, visits }
    let steps = null;  // stopping times up to state.count
    let dirty = true;
    let fitPending = true;

    function rebuild() {
      tree = new Map([[1, { parent: 0, depth: 0, visits: 0 }]]);
      for (let n = 1; n <= state.count; n++) {
        // Walk down until we meet the known tree, then attach the new branch.
        const fresh = [];
        let m = n;
        while (!tree.has(m)) { fresh.push(m); m = next(m); }
        for (let i = fresh.length - 1; i >= 0; i--) {
          const v = fresh[i];
          tree.set(v, { parent: next(v), depth: tree.get(next(v)).depth + 1, visits: 0 });
        }
        // How many starting numbers pass through each node: trunks get thick.
        for (let v = n; ; v = next(v)) { tree.get(v).visits++; if (v === 1) break; }
      }
      steps = stoppingTimes(state.count);
      fitPending = true;
      dirty = true;
    }

    // Positions depend on the angles, so they are laid out separately.
    let layout = null;
    function computeLayout() {
      const even = (state.even + (state.sway ? 2.5 * Math.sin(state.swayT * 0.7) : 0)) * Math.PI / 180;
      const odd = (state.odd + (state.sway ? 2.5 * Math.sin(state.swayT * 0.9 + 1) : 0)) * Math.PI / 180;
      layout = new Map([[1, { x: 0, y: 0, h: Math.PI / 2 }]]);
      const place = (v) => {
        if (layout.has(v)) return layout.get(v);
        // Iterative to avoid deep recursion on long paths.
        const chain = [];
        let u = v;
        while (!layout.has(u)) { chain.push(u); u = tree.get(u).parent; }
        let p = layout.get(u);
        for (let i = chain.length - 1; i >= 0; i--) {
          const w = chain[i];
          const h = p.h + (w % 2 === 0 ? even : odd);
          p = { x: p.x + Math.cos(h), y: p.y + Math.sin(h), h };
          layout.set(w, p);
        }
        return p;
      };
      for (const v of tree.keys()) place(v);
    }

    function fit() {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of layout.values()) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      const rect = panel.panel.hidden ? null : panel.panel.getBoundingClientRect();
      const visibleW = rect && rect.left > cw * 0.4 ? rect.left - 12 : cw;
      // Plane units per CSS pixel so the tree fits the visible area.
      const upp = Math.max((x1 - x0) / (visibleW * 0.9), (y1 - y0) / (ch * 0.88));
      view.radius = (upp * Math.min(cw, ch)) / 2;
      view.cx = (x0 + x1) / 2 + ((cw - visibleW) / 2) * upp;
      view.cy = (y0 + y1) / 2;
    }

    // ---- UI
    const hud = createHud(root, [['numbers', 'Numbers'], ['pick', 'Highlighted'], ['steps', 'Steps to 1'], ['peak', 'Highest value']]);
    const panel = createPanel(root, { title: 'Collatz Tree', formula: 'n → n/2 if even, 3n + 1 if odd', signal });
    const pickSlider = slider({
      label: 'Highlight the path of', min: 1, max: state.count, value: state.highlight, format: (v) => v.toLocaleString('en-US'),
      onInput: (v) => { state.highlight = v; dirty = true; },
    });
    const treeOnly = el('div', { class: 'panel-body' },
      slider({ label: 'Turn at even numbers', min: -30, max: 30, step: 0.1, value: state.even, format: (v) => `${v.toFixed(1)}°`, onInput: (v) => { state.even = v; layout = null; fitPending = true; dirty = true; } }),
      slider({ label: 'Turn at odd numbers', min: -30, max: 30, step: 0.1, value: state.odd, format: (v) => `${v.toFixed(1)}°`, onInput: (v) => { state.odd = v; layout = null; fitPending = true; dirty = true; } }),
      toggles(check({ label: 'Sway', checked: false, onChange: (on) => { state.sway = on; layout = null; dirty = true; } })));

    panel.add(
      select({
        label: 'View',
        options: [{ value: 'tree', label: 'Tree of paths to 1' }, { value: 'times', label: 'Steps to reach 1, for each n' }],
        value: state.mode,
        onChange: (v) => { state.mode = v; treeOnly.hidden = v !== 'tree'; fitPending = true; dirty = true; },
      }),
      slider({
        label: 'Numbers 1 to', min: 100, max: 20000, step: 100, value: state.count, format: (v) => v.toLocaleString('en-US'),
        onInput: (v) => {
          state.count = v;
          pickSlider.input.max = v;
          if (state.highlight > v) { state.highlight = v; pickSlider.set(v); }
          rebuild(); layout = null;
        },
      }),
      pickSlider,
      treeOnly,
      swatches({ palettes: PALETTES, value: state.palette, onChange: (i) => { state.palette = i; dirty = true; } }),
      actions(
        button({ label: 'Show 27', primary: true, onClick: () => { state.highlight = 27; pickSlider.set(27); dirty = true; } }),
        button({ label: 'Longest path', onClick: () => {
          let best = 1;
          for (let n = 1; n <= state.count; n++) if (steps[n] > steps[best]) best = n;
          state.highlight = best; pickSlider.set(best); dirty = true;
        } }),
        button({ label: 'Fit to screen', onClick: () => { fitPending = true; dirty = true; } }),
      ),
      note('In the tree view, drag to pan and scroll or pinch to zoom. Keys: <kbd>T</kbd> switch view, <kbd>R</kbd> fit to screen, <kbd>H</kbd> panel.'),
      about(`<p>Pick any whole number. If it is even, halve it; if it is odd, triple it and add one. Repeat. Starting from 27 the numbers climb as high as 9,232 before falling, and reach 1 after 111 steps. The Collatz conjecture (Lothar Collatz, 1937) says every starting number eventually reaches 1.</p>
        <p>Computers have checked every number up to about 2.95 × 10²⁰, and in 2019 Terence Tao proved that almost every starting number falls far below where it started. A full proof is still missing. Paul Erdős said that "mathematics may not be ready for such problems".</p>
        <p>The tree draws every path at once. Each number is one segment, joined to the number its rule leads to. Starting from 1 at the base, a branch bends one way at even numbers and the other way at odd ones, and branches thicken where many paths share them. The "steps" view plots how long each number takes to reach 1.</p>`),
    );
    treeOnly.hidden = state.mode !== 'tree';

    attachPanZoom(canvas, view, () => { dirty = true; }, {
      signal,
      keys: {
        t: () => { state.mode = state.mode === 'tree' ? 'times' : 'tree'; panel.body.querySelector('select').value = state.mode; treeOnly.hidden = state.mode !== 'tree'; fitPending = true; dirty = true; },
        r: () => { fitPending = true; dirty = true; },
        h: () => { panel.toggle(); fitPending = true; dirty = true; },
      },
    });
    window.addEventListener('resize', () => { fitPending = true; dirty = true; }, { signal });

    rebuild();

    startLoop(signal, (now, dt) => {
      if (state.sway && state.mode === 'tree') { state.swayT += dt / 1000; layout = null; dirty = true; }
      const s = dpr();
      const w = Math.round(canvas.clientWidth * s);
      const h = Math.round(canvas.clientHeight * s);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; dirty = true; }
      if (!dirty) return;
      dirty = false;

      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, w, h);
      const path = trajectory(state.highlight);

      if (state.mode === 'tree') {
        if (!layout) computeLayout();
        if (fitPending) { fit(); fitPending = false; }
        const unit = s / view.cssPixel();
        const X = (p) => w / 2 + (p.x - view.cx) * unit;
        const Y = (p) => h / 2 - (p.y - view.cy) * unit;
        // Bucket segments by thickness and colour so each bucket is one stroke.
        let maxDepth = 0;
        for (const t of tree.values()) maxDepth = Math.max(maxDepth, t.depth);
        const buckets = new Map();
        for (const [v, t] of tree) {
          if (v === 1) continue;
          const a = layout.get(v), b = layout.get(t.parent);
          const wb = Math.min(7, Math.floor(Math.log2(t.visits)));
          const cb = Math.min(11, Math.floor((t.depth / (maxDepth + 1)) * 12));
          const key = wb * 16 + cb;
          if (!buckets.has(key)) buckets.set(key, new Path2D());
          const p2 = buckets.get(key);
          p2.moveTo(X(a), Y(a)); p2.lineTo(X(b), Y(b));
        }
        ctx.lineCap = 'round';
        for (const [key, p2] of [...buckets].sort((x, y) => x[0] - y[0])) {
          const wb = key >> 4, cb = key & 15;
          const [r, g, b] = samplePalette(state.palette, 0.2 + 0.65 * (cb / 11));
          ctx.strokeStyle = `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${0.35 + wb * 0.08})`;
          ctx.lineWidth = Math.max(0.6 * s, Math.min(unit * 0.5, (0.6 + wb * 0.55) * s));
          ctx.stroke(p2);
        }
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        path.forEach((v, i) => { const p = layout.get(v); if (i) ctx.lineTo(X(p), Y(p)); else ctx.moveTo(X(p), Y(p)); });
        ctx.stroke();
        const start = layout.get(state.highlight);
        ctx.fillStyle = '#ffaa00';
        ctx.beginPath(); ctx.arc(X(start), Y(start), 4 * s, 0, Math.PI * 2); ctx.fill();
      } else {
        // Scatter plot: n across, steps to reach 1 up, inside the visible area.
        let maxSteps = 0;
        for (let n = 1; n <= state.count; n++) maxSteps = Math.max(maxSteps, steps[n]);
        const rect = panel.panel.hidden ? null : panel.panel.getBoundingClientRect();
        const visibleW = (rect && rect.left > canvas.clientWidth * 0.4 ? rect.left - 12 : canvas.clientWidth) * s;
        const left = 64 * s, right = visibleW - 24 * s, top = 150 * s, bottom = h - 48 * s;
        const X = (n) => left + (n / state.count) * (right - left);
        const Y = (k) => bottom - (k / maxSteps) * (bottom - top);
        fitPending = false;
        const dot = Math.max(1.4 * s, Math.min(3 * s, (6000 / state.count) * s));
        const groups = new Map();
        for (let n = 1; n <= state.count; n++) {
          const cb = Math.min(9, Math.floor((steps[n] / (maxSteps + 1)) * 10));
          if (!groups.has(cb)) groups.set(cb, new Path2D());
          groups.get(cb).rect(X(n) - dot / 2, Y(steps[n]) - dot / 2, dot, dot);
        }
        for (const [cb, p2] of groups) {
          const [r, g, b] = samplePalette(state.palette, 0.25 + 0.6 * (cb / 9));
          ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
          ctx.fill(p2);
        }
        // Axes with a few labels.
        ctx.strokeStyle = 'rgba(232, 235, 243, 0.35)';
        ctx.fillStyle = 'rgba(232, 235, 243, 0.7)';
        ctx.lineWidth = s;
        ctx.font = `${11 * s}px "Chivo Mono", ui-monospace, monospace`;
        ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(state.count), Y(0)); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(0), Y(maxSteps)); ctx.stroke();
        for (let i = 0; i <= 4; i++) {
          const n = Math.round((state.count * i) / 4);
          ctx.fillText(n.toLocaleString('en-US'), X(n) - 10 * s, Y(0) + 16 * s);
          const k = Math.round((maxSteps * i) / 4);
          ctx.fillText(String(k), X(0) - 34 * s, Y(k) + 4 * s);
        }
        ctx.fillText('n →', X(state.count) - 30 * s, Y(0) - 8 * s);
        ctx.fillText('steps to 1 ↑', X(0) + 8 * s, Y(maxSteps) - 8 * s);
        ctx.strokeStyle = '#ffaa00';
        ctx.lineWidth = 2 * s;
        ctx.beginPath(); ctx.arc(X(state.highlight), Y(steps[state.highlight]), 6 * s, 0, Math.PI * 2); ctx.stroke();
      }

      hud.set('numbers', `1 to ${state.count.toLocaleString('en-US')} (${tree.size.toLocaleString('en-US')} values visited)`);
      hud.set('pick', state.highlight.toLocaleString('en-US'));
      hud.set('steps', String(path.length - 1));
      hud.set('peak', path.reduce((a, b) => Math.max(a, b), 0).toLocaleString('en-US'));
    });
  },
};
