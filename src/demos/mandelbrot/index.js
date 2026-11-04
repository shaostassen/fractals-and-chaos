import { Renderer, MAX_ITERATIONS } from './renderer.js';
import { LOCATIONS, TOUR_TARGET } from './locations.js';
import { PALETTES, paletteRgb } from '../../shared/palettes.js';
import { createView, attachPanZoom } from '../../shared/panzoom.js';
import { startLoop, AdaptiveScale, dpr } from '../../shared/loop.js';
import { releaseGL, onContextLost, resizeCanvas } from '../../shared/gl.js';
import {
  el, createPanel, createHud, slider, select, check, toggles, button, actions, note, about,
  swatches, showError, fmtZoom, fmtSigned,
} from '../../shared/ui.js';

// Below this radius the 64-bit reference orbit runs out of precision.
const MIN_RADIUS = 2e-13;
const MIN_ITER = 50;

function autoIterations(radius) {
  const depth = Math.max(0, Math.log10(1.5 / radius));
  return Math.round(Math.min(MAX_ITERATIONS, 200 + 90 * depth + 18 * depth * depth));
}

// Iteration slider is logarithmic: 0..1000 maps to MIN_ITER..MAX_ITERATIONS.
const iterFromSlider = (v) => Math.round(MIN_ITER * (MAX_ITERATIONS / MIN_ITER) ** (v / 1000));
const sliderFromIter = (n) => (1000 * Math.log(n / MIN_ITER)) / Math.log(MAX_ITERATIONS / MIN_ITER);

export default {
  id: 'mandelbrot',
  title: 'Mandelbrot Set',
  area: 'Fractals',
  formula: 'z<sub>n+1</sub> = z<sub>n</sub>² + c',
  blurb: 'Deep-zoom explorer. Perturbation math keeps it sharp down to 10¹² magnification.',

  mount(root, { signal, params, navigate }) {
    const canvas = el('canvas', { class: 'stage', 'aria-label': 'Mandelbrot set. Drag to pan, scroll or pinch to zoom.' });
    root.append(canvas);

    let renderer;
    try {
      renderer = new Renderer(canvas);
    } catch (err) {
      showError(root, err.message);
      return;
    }
    onContextLost(canvas, root, signal, showError);

    const start = params.view || LOCATIONS[0];
    const view = createView(canvas, { ...start, minRadius: MIN_RADIUS, maxRadius: 4 });
    const state = {
      autoIter: true, manualIter: 500, palette: 0, density: 0.35, offset: 0,
      shading: true, cycle: false, tour: 0, // tour: 0 off, -1 zooming in, +1 zooming out
    };
    const maxIter = () => (state.autoIter ? autoIterations(view.radius) : state.manualIter);

    const scaler = new AdaptiveScale();
    let dirty = true;
    let lastInput = -Infinity;
    const markDirty = () => { dirty = true; lastInput = performance.now(); };

    // ---- readout
    const hud = createHud(root, [['re', 'Re'], ['im', 'Im'], ['zoom', 'Zoom'], ['iter', 'Iter'], ['speed', 'Speed']]);
    const coord = (v) => fmtSigned(v, Math.min(17, Math.max(5, Math.ceil(-Math.log10(view.cssPixel())) + 1)));

    // ---- panel
    const panel = createPanel(root, { title: 'Mandelbrot', formula: 'z<sub>n+1</sub> = z<sub>n</sub>² + c', signal });
    const preset = select({
      label: 'Location',
      options: [{ value: '', label: 'Custom', hidden: true }, ...LOCATIONS.map((l, i) => ({ value: String(i), label: l.name }))],
      value: params.view ? '' : '0',
      onChange: (v) => { if (v !== '') goTo(LOCATIONS[+v]); },
    });
    const iterSlider = slider({
      label: 'Max iterations', min: 0, max: 1000, value: sliderFromIter(maxIter()),
      format: () => maxIter().toLocaleString('en-US'),
      onInput: (v) => {
        state.autoIter = false;
        autoCheck.input.checked = false;
        state.manualIter = iterFromSlider(v);
        iterSlider.setText(state.manualIter.toLocaleString('en-US'));
        markDirty();
      },
    });
    const autoCheck = check({
      label: 'Increase with zoom depth', checked: true,
      onChange: (on) => {
        state.autoIter = on;
        if (!on) state.manualIter = autoIterations(view.radius);
        syncIter();
        markDirty();
      },
    });
    iterSlider.append(autoCheck);
    const offsetSlider = slider({
      label: 'Color shift', min: 0, max: 1000, value: 0, format: () => '',
      onInput: (v) => { state.offset = v / 1000; markDirty(); },
    });
    const tourBtn = button({ label: 'Start zoom tour', primary: true, onClick: () => setTour(state.tour === 0) });

    panel.add(
      preset,
      iterSlider,
      swatches({ palettes: PALETTES, value: 0, onChange: (i) => { state.palette = i; markDirty(); } }),
      slider({ label: 'Color bands', min: 5, max: 150, value: 35, format: () => '', onInput: (v) => { state.density = v / 100; markDirty(); } }),
      offsetSlider,
      toggles(
        check({ label: 'Edge shading', checked: true, onChange: (on) => { state.shading = on; markDirty(); } }),
        check({ label: 'Cycle colors', checked: false, onChange: (on) => { state.cycle = on; markDirty(); } }),
      ),
      actions(
        tourBtn,
        button({ label: 'Julia set here', onClick: () => navigate('julia', { c: [view.cx, view.cy] }) }),
        button({ label: 'Reset view', onClick: () => { preset.input.value = '0'; goTo(LOCATIONS[0]); } }),
      ),
      note('Drag to pan. Scroll or pinch to zoom. Double-click zooms in, Shift+double-click zooms out. Keys: arrows, <kbd>+</kbd> <kbd>−</kbd>, <kbd>Space</kbd> tour, <kbd>R</kbd> reset, <kbd>H</kbd> panel.'),
      about(`<p>Each point <i>c</i> of the plane is tested: start at <i>z</i> = 0 and repeat <i>z</i> → <i>z</i>² + <i>c</i>. If <i>z</i> stays bounded forever, <i>c</i> is in the set (black). Otherwise the color shows how fast it escaped.</p>
        <p>Graphics cards compute in 32-bit floats, which blur out near 10⁵× zoom. Here the CPU computes one orbit at the screen center in 64-bit precision, and the GPU only tracks each pixel's small difference from it (perturbation theory). That pushes the limit to about 10¹²×.</p>
        <p>"Julia set here" opens the Julia set for the point at the center of the screen.</p>`),
    );

    function syncIter() {
      iterSlider.input.value = sliderFromIter(maxIter());
      iterSlider.setText(maxIter().toLocaleString('en-US'));
    }

    function setTour(on) {
      state.tour = on ? -1 : 0;
      tourBtn.textContent = on ? 'Stop zoom tour' : 'Start zoom tour';
      tourBtn.setAttribute('aria-pressed', String(on));
      if (on) preset.input.value = '';
      markDirty();
    }

    function goTo(loc) {
      setTour(false);
      view.set(loc);
      markDirty();
    }

    function stepTour(dt) {
      const t = dt / 1000;
      const pull = 1 - Math.exp(-t * 3);
      view.cx += (TOUR_TARGET.cx - view.cx) * pull;
      view.cy += (TOUR_TARGET.cy - view.cy) * pull;
      view.radius *= Math.exp(state.tour * t * 0.9);
      if (view.radius <= MIN_RADIUS * 1.5) state.tour = 1;
      if (view.radius >= 1.5) state.tour = -1;
      view.radius = Math.min(4, Math.max(MIN_RADIUS, view.radius));
      markDirty();
    }

    attachPanZoom(canvas, view, () => {
      if (state.tour) setTour(false);
      preset.input.value = '';
      markDirty();
    }, {
      signal,
      keys: {
        r: () => { preset.input.value = '0'; goTo(LOCATIONS[0]); },
        h: () => panel.toggle(),
        ' ': () => setTour(state.tour === 0),
      },
    });
    window.addEventListener('resize', markDirty, { signal });

    startLoop(signal, (now, dt) => {
      if (state.tour) stepTour(dt);
      if (state.cycle) {
        state.offset = (state.offset + dt * 0.00006) % 1;
        offsetSlider.input.value = Math.round(state.offset * 1000);
        dirty = true;
      }
      const moving = state.tour !== 0 || state.cycle || now - lastInput < 180;
      const target = scaler.update(dt, moving);
      const sharpPending = !moving && canvas.width !== Math.round(canvas.clientWidth * dpr());
      if (!dirty && !sharpPending) {
        scaler.renderedLast = false;
        return;
      }
      resizeCanvas(canvas, dpr() * target);
      renderer.render({
        cx: view.cx, cy: view.cy, radius: view.radius, maxIter: maxIter(),
        stops: paletteRgb(state.palette), density: state.density, offset: state.offset, shading: state.shading,
      });
      dirty = false;
      scaler.renderedLast = true;

      hud.set('re', coord(view.cx));
      hud.set('im', coord(view.cy) + 'i');
      hud.set('zoom', fmtZoom(1.3 / view.radius));
      hud.set('iter', maxIter().toLocaleString('en-US'));
      hud.set('speed', scaler.describe(moving, target));
      hud.note(view.radius <= MIN_RADIUS * 1.01 ? 'Deepest zoom reached: 64-bit precision limit' : '');
      if (state.autoIter) syncIter();
    });

    return () => releaseGL(renderer.gl);
  },
};
