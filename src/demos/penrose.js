import { PALETTES, samplePalette } from '../shared/palettes.js';
import { createView, attachPanZoom } from '../shared/panzoom.js';
import { startLoop, dpr } from '../shared/loop.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about, swatches, fmtZoom,
} from '../shared/ui.js';

// Penrose tilings by deflation of Robinson triangles (half-tiles). Each step
// cuts every triangle into smaller ones in golden-ratio proportions; pairs of
// triangles form the tiles. Triangles are [kind, A, B, C] with points [x, y].

const PHI = (1 + Math.sqrt(5)) / 2;
const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

// Ten triangles around the centre: a "sun".
function sun() {
  const tris = [];
  for (let i = 0; i < 10; i++) {
    let b = [Math.cos(((2 * i - 1) * Math.PI) / 10), Math.sin(((2 * i - 1) * Math.PI) / 10)];
    let c = [Math.cos(((2 * i + 1) * Math.PI) / 10), Math.sin(((2 * i + 1) * Math.PI) / 10)];
    if (i % 2 === 0) [b, c] = [c, b];
    tris.push([0, [0, 0], b, c]);
  }
  return tris;
}

// Penrose's rhombus tiling (P3): kind 0 = half thin rhombus, 1 = half thick rhombus.
function deflateRhombi(tris) {
  const out = [];
  for (const [kind, a, b, c] of tris) {
    if (kind === 0) {
      const p = lerp(a, b, 1 / PHI);
      out.push([0, c, p, b], [1, p, c, a]);
    } else {
      const q = lerp(b, a, 1 / PHI);
      const r = lerp(b, c, 1 / PHI);
      out.push([1, r, c, a], [1, q, r, b], [0, r, q, a]);
    }
  }
  return out;
}

export function generate(generations) {
  let tris = sun();
  for (let i = 0; i < generations; i++) tris = deflateRhombi(tris);
  return tris;
}

export default {
  id: 'penrose',
  title: 'Penrose Tiling',
  area: 'Geometry',
  formula: 'thick ÷ thin → φ = (1 + √5) / 2',
  blurb: 'Two tile shapes that cover the plane forever without ever repeating. Zoom in and count them.',

  mount(root, { signal }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Penrose tiling. Drag to pan, scroll or pinch to zoom.' });
    root.append(canvas);
    const ctx = canvas.getContext('2d');

    const state = { generations: 6, color: 'kind', palette: 1, outlines: true, growing: false };
    const HOME = { cx: 0, cy: 0, radius: 1.02 };
    const view = createView(canvas, { ...HOME, minRadius: 1e-4, maxRadius: 4 });
    let tris = [];
    let dirty = true;

    function rebuild() {
      tris = generate(state.generations);
      const counts = [0, 0];
      for (const t of tris) counts[t[0]]++;
      // Two half-triangles per tile (tiles cut by the outer edge count as halves).
      hud.set('tiles', `${Math.round(counts[0] / 2).toLocaleString('en-US')} thin, ${Math.round(counts[1] / 2).toLocaleString('en-US')} thick`);
      hud.set('ratio', counts[0] ? `${(counts[1] / counts[0]).toFixed(6)} (φ = ${PHI.toFixed(6)})` : '—');
      hud.set('gen', String(state.generations));
      dirty = true;
    }

    // ---- UI
    const hud = createHud(root, [['gen', 'Generation'], ['tiles', 'Tiles'], ['ratio', 'Ratio'], ['zoom', 'Zoom']]);
    const panel = createPanel(root, { title: 'Penrose Tiling', formula: 'deflation by φ', signal });
    const genSlider = slider({
      label: 'Subdivisions', min: 0, max: 10, value: state.generations,
      onInput: (v) => { setGrowing(false); state.generations = v; rebuild(); },
    });
    const growBtn = button({ label: 'Watch it grow', primary: true, onClick: () => setGrowing(!state.growing) });
    panel.add(
      genSlider,
      select({
        label: 'Color by',
        options: [{ value: 'kind', label: 'Tile shape' }, { value: 'angle', label: 'Direction the tile points' }],
        value: state.color,
        onChange: (v) => { state.color = v; dirty = true; },
      }),
      swatches({ palettes: PALETTES, value: state.palette, onChange: (i) => { state.palette = i; dirty = true; } }),
      toggles(check({ label: 'Outlines', checked: true, onChange: (on) => { state.outlines = on; dirty = true; } })),
      actions(growBtn, button({ label: 'Reset view', onClick: () => { view.set(HOME); dirty = true; } })),
      note('Drag to pan, scroll or pinch to zoom. Keys: <kbd>G</kbd> grow, <kbd>R</kbd> reset view, <kbd>H</kbd> panel.'),
      about(`<p>Roger Penrose found these tilings in 1974. This one uses two rhombi, a thick one and a thin one. They cover the whole plane with no gaps, yet the pattern never repeats: no shift of the tiling lines it up with itself. Look closely and you will find five-fold symmetry everywhere, which is impossible for any repeating pattern.</p>
        <p>The tiling is built by deflation. Each tile is cut into smaller tiles of the same two shapes, scaled down by the golden ratio φ ≈ 1.618. Repeat forever and the whole plane fills. Each step turns the counts (thin, thick) into (thin + thick, thin + 2 × thick), so their ratio approaches φ. Since φ is irrational, the pattern cannot repeat.</p>
        <p>In 1982 Dan Shechtman found crystals with the same five-fold order. These "quasicrystals" were thought impossible, and won him the 2011 Nobel Prize in Chemistry.</p>`),
    );

    function setGrowing(on) {
      state.growing = on;
      growBtn.textContent = on ? 'Stop' : 'Watch it grow';
      growBtn.setAttribute('aria-pressed', String(on));
      if (on) { state.generations = 0; state.growT = 0; genSlider.set(0); rebuild(); }
    }

    attachPanZoom(canvas, view, () => { dirty = true; }, {
      signal,
      keys: { g: () => setGrowing(!state.growing), r: () => { view.set(HOME); dirty = true; }, h: () => { panel.toggle(); dirty = true; } },
    });
    window.addEventListener('resize', () => { dirty = true; }, { signal });

    rebuild();

    startLoop(signal, (now, dt) => {
      if (state.growing) {
        state.growT += dt;
        if (state.growT > 1100) {
          state.growT = 0;
          if (state.generations >= 8) setGrowing(false);
          else { state.generations++; genSlider.set(state.generations); rebuild(); }
        }
      }
      const s = dpr();
      const w = Math.round(canvas.clientWidth * s);
      const h = Math.round(canvas.clientHeight * s);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; dirty = true; }
      if (!dirty) return;
      dirty = false;

      const unit = s / view.cssPixel(); // device pixels per world unit
      const ox = w / 2 - view.cx * unit;
      const oy = h / 2 + view.cy * unit;
      const X = (p) => ox + p[0] * unit;
      const Y = (p) => oy - p[1] * unit;
      const visible = (a, b, c) => {
        const xs = [X(a), X(b), X(c)], ys = [Y(a), Y(b), Y(c)];
        return Math.max(...xs) >= 0 && Math.min(...xs) <= w && Math.max(...ys) >= 0 && Math.min(...ys) <= h;
      };

      ctx.fillStyle = '#05060a';
      ctx.fillRect(0, 0, w, h);

      // Group fills by colour so each colour is one path.
      const groups = new Map();
      for (const [kind, a, b, c] of tris) {
        if (!visible(a, b, c)) continue;
        let key;
        if (state.color === 'kind') key = kind;
        else {
          // Direction from A across the cut edge, modulo half a turn: the two
          // halves of a tile agree, so whole tiles get one colour.
          const m = lerp(b, c, 0.5);
          let ang = Math.atan2(m[1] - a[1], m[0] - a[0]);
          ang = ((ang % Math.PI) + Math.PI) % Math.PI;
          key = 2 + (Math.round(ang / (Math.PI / 5)) % 5);
        }
        if (!groups.has(key)) groups.set(key, new Path2D());
        const path = groups.get(key);
        path.moveTo(X(a), Y(a)); path.lineTo(X(b), Y(b)); path.lineTo(X(c), Y(c)); path.closePath();
      }
      for (const [key, path] of groups) {
        const t = key < 2 ? (key === 0 ? 0.35 : 0.62) : 0.15 + (key - 2) * 0.17;
        const [r, g, b] = samplePalette(state.palette, t);
        const css = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
        ctx.fillStyle = css;
        ctx.fill(path);
        // Hairline in the same colour hides the seam between the two halves.
        ctx.strokeStyle = css;
        ctx.lineWidth = 0.8 * s;
        ctx.stroke(path);
      }

      // Tile outlines, if the tiles are big enough to see them.
      const tileSize = (unit / PHI ** state.generations);
      if (state.outlines && tileSize > 4 * s) {
        const edges = new Path2D();
        for (const [, a, b, c] of tris) {
          if (!visible(a, b, c)) continue;
          // Tile edges are AB and AC; BC is the cut between the two halves.
          for (const [p, q] of [[c, a], [a, b]]) { edges.moveTo(X(p), Y(p)); edges.lineTo(X(q), Y(q)); }
        }
        ctx.strokeStyle = 'rgba(5, 6, 10, 0.85)';
        ctx.lineWidth = Math.min(2.2 * s, Math.max(0.8 * s, tileSize * 0.04));
        ctx.lineJoin = 'round';
        ctx.stroke(edges);
      }
      hud.set('zoom', fmtZoom(HOME.radius / view.radius));
    });
  },
};
