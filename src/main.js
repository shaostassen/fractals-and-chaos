import { Renderer, MAX_ITERATIONS } from './renderer.js';
import { attachControls } from './controls.js';
import { PALETTES, hexToRgb } from './palettes.js';
import { LOCATIONS, TOUR_TARGET } from './locations.js';

// Below this radius the 64-bit reference orbit runs out of precision.
const MIN_RADIUS = 2e-13;
const MAX_RADIUS = 4;
const MIN_ITER = 50;

const $ = (id) => document.getElementById(id);
const canvas = $('view');

const state = {
  cx: LOCATIONS[0].cx,
  cy: LOCATIONS[0].cy,
  radius: LOCATIONS[0].radius,
  autoIter: true,
  manualIter: 500,
  palette: 0,
  density: 0.35,
  offset: 0,
  shading: true,
  cycle: false,
  tour: 0, // 0 = off, -1 = zooming in, +1 = zooming out
};

const view = {
  cssPixel() {
    return (2 * state.radius) / Math.min(canvas.clientWidth, canvas.clientHeight);
  },
  pan(dx, dy) {
    const s = this.cssPixel();
    state.cx -= dx * s;
    state.cy += dy * s;
  },
  zoomAt(x, y, factor) {
    const s = this.cssPixel();
    const px = state.cx + (x - canvas.clientWidth / 2) * s;
    const py = state.cy - (y - canvas.clientHeight / 2) * s;
    const r = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, state.radius * factor));
    const k = r / state.radius;
    state.cx = px + (state.cx - px) * k;
    state.cy = py + (state.cy - py) * k;
    state.radius = r;
  },
};

function autoIterations(radius) {
  const depth = Math.max(0, Math.log10(1.5 / radius));
  return Math.round(Math.min(MAX_ITERATIONS, 200 + 90 * depth + 18 * depth * depth));
}

const maxIter = () => (state.autoIter ? autoIterations(state.radius) : state.manualIter);

// ---------------------------------------------------------------- render loop

let renderer;
let dirty = true;
let lastInput = -Infinity;
let lastFrame = 0;
let renderedLastFrame = false;
let scale = 1; // fraction of full device resolution used while moving
let fps = 0;

function markDirty() {
  dirty = true;
  lastInput = performance.now();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(now - lastFrame, 100);
  lastFrame = now;

  if (state.tour) stepTour(dt);
  if (state.cycle) {
    state.offset = (state.offset + dt * 0.00006) % 1;
    syncOffsetSlider();
    dirty = true;
  }

  const moving = state.tour !== 0 || state.cycle || now - lastInput < 180;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // Adapt resolution while moving to keep the frame rate up, go sharp when still.
  if (moving && renderedLastFrame) {
    if (dt > 34) scale = Math.max(0.3, scale * 0.88);
    else if (dt < 21) scale = Math.min(1, scale * 1.06);
  }
  const target = moving ? scale : 1;
  const sharpPending = !moving && canvas.width !== Math.round(canvas.clientWidth * dpr);

  if (!dirty && !sharpPending) {
    renderedLastFrame = false;
    return;
  }

  if (renderedLastFrame && dt > 0) fps = fps ? fps * 0.9 + (1000 / dt) * 0.1 : 1000 / dt;
  renderer.resize(dpr * target);
  renderer.render({
    cx: state.cx,
    cy: state.cy,
    radius: state.radius,
    maxIter: maxIter(),
    stops: PALETTES[state.palette].stops.map(hexToRgb),
    density: state.density,
    offset: state.offset,
    shading: state.shading,
  });
  dirty = false;
  renderedLastFrame = true;
  updateHud(moving, target);
}

// ----------------------------------------------------------------- zoom tour

function stepTour(dt) {
  const t = dt / 1000;
  const pull = 1 - Math.exp(-t * 3);
  state.cx += (TOUR_TARGET.cx - state.cx) * pull;
  state.cy += (TOUR_TARGET.cy - state.cy) * pull;
  state.radius *= Math.exp(state.tour * t * 0.9);
  if (state.radius <= MIN_RADIUS * 1.5) state.tour = 1;
  if (state.radius >= 1.5) state.tour = -1;
  state.radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, state.radius));
  markDirty();
}

function setTour(on) {
  state.tour = on ? -1 : 0;
  $('tour').textContent = on ? 'Stop zoom tour' : 'Start zoom tour';
  $('tour').setAttribute('aria-pressed', String(on));
  if (on) $('preset').value = '';
  markDirty();
}

// ------------------------------------------------------------------------ UI

function fmtCoord(v) {
  const digits = Math.min(17, Math.max(5, Math.ceil(-Math.log10(view.cssPixel())) + 1));
  return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(digits);
}

function fmtZoom(z) {
  if (z < 1000) return z.toFixed(z < 10 ? 2 : 0) + '×';
  const e = Math.floor(Math.log10(z));
  const sup = String(e).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
  return (z / 10 ** e).toFixed(2) + '×10' + sup;
}

function updateHud(moving, resScale) {
  $('hud-re').textContent = fmtCoord(state.cx);
  $('hud-im').textContent = fmtCoord(state.cy) + 'i';
  $('hud-zoom').textContent = fmtZoom(1.3 / state.radius);
  $('hud-iter').textContent = maxIter().toLocaleString('en-US');
  $('hud-speed').textContent = moving
    ? `${fps ? Math.round(fps) : '—'} fps · ${Math.round(resScale * 100)}% res`
    : 'idle · full res';
  $('hud-limit').hidden = state.radius > MIN_RADIUS * 1.01;
  if (state.autoIter) syncIterSlider();
}

// Iteration slider is logarithmic: 0..1000 maps to MIN_ITER..MAX_ITERATIONS.
const iterFromSlider = (v) => Math.round(MIN_ITER * (MAX_ITERATIONS / MIN_ITER) ** (v / 1000));
const sliderFromIter = (n) => (1000 * Math.log(n / MIN_ITER)) / Math.log(MAX_ITERATIONS / MIN_ITER);

function syncIterSlider() {
  const n = maxIter();
  $('iter').value = sliderFromIter(n);
  $('iter-out').textContent = n.toLocaleString('en-US');
}

function syncOffsetSlider() {
  $('offset').value = Math.round(state.offset * 1000);
}

function goTo(loc) {
  setTour(false);
  state.cx = loc.cx;
  state.cy = loc.cy;
  state.radius = loc.radius;
  markDirty();
}

function buildUi() {
  const preset = $('preset');
  LOCATIONS.forEach((loc, i) => preset.add(new Option(loc.name, String(i))));
  preset.add(new Option('Custom', ''), 0);
  preset.options[0].hidden = true;
  preset.value = '0';
  preset.addEventListener('change', () => {
    if (preset.value !== '') goTo(LOCATIONS[+preset.value]);
  });

  const swatches = $('swatches');
  PALETTES.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.title = p.name;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', p.name);
    b.style.background = `linear-gradient(90deg, ${p.stops.join(', ')})`;
    b.addEventListener('click', () => {
      state.palette = i;
      swatches.querySelectorAll('.swatch').forEach((s, j) => s.setAttribute('aria-checked', String(j === i)));
      $('palette-name').textContent = p.name;
      markDirty();
    });
    b.setAttribute('aria-checked', String(i === state.palette));
    swatches.append(b);
  });
  $('palette-name').textContent = PALETTES[state.palette].name;

  $('iter').addEventListener('input', (e) => {
    state.autoIter = false;
    $('iter-auto').checked = false;
    state.manualIter = iterFromSlider(+e.target.value);
    $('iter-out').textContent = state.manualIter.toLocaleString('en-US');
    markDirty();
  });
  $('iter-auto').addEventListener('change', (e) => {
    state.autoIter = e.target.checked;
    if (!state.autoIter) state.manualIter = autoIterations(state.radius);
    syncIterSlider();
    markDirty();
  });

  $('density').value = Math.round(state.density * 100);
  $('density').addEventListener('input', (e) => {
    state.density = +e.target.value / 100;
    markDirty();
  });
  $('offset').addEventListener('input', (e) => {
    state.offset = +e.target.value / 1000;
    markDirty();
  });
  $('shade').addEventListener('change', (e) => {
    state.shading = e.target.checked;
    markDirty();
  });
  $('cycle').addEventListener('change', (e) => {
    state.cycle = e.target.checked;
    markDirty();
  });

  $('tour').addEventListener('click', () => setTour(state.tour === 0));
  $('reset').addEventListener('click', () => {
    preset.value = '0';
    goTo(LOCATIONS[0]);
  });
  $('copy').addEventListener('click', async () => {
    const text = `re = ${state.cx}\nim = ${state.cy}\nradius = ${state.radius}`;
    const btn = $('copy');
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = 'Copy failed';
    }
    setTimeout(() => (btn.textContent = 'Copy coordinates'), 1400);
  });

  const setPanel = (open) => {
    $('panel').hidden = !open;
    $('panel-open').hidden = open;
  };
  $('panel-close').addEventListener('click', () => setPanel(false));
  $('panel-open').addEventListener('click', () => setPanel(true));
  if (window.matchMedia('(max-width: 640px)').matches) setPanel(false);

  attachControls(canvas, view, () => {
    if (state.tour) setTour(false);
    preset.value = '';
    markDirty();
  }, {
    r: () => { preset.value = '0'; goTo(LOCATIONS[0]); },
    h: () => setPanel($('panel').hidden),
    ' ': () => setTour(state.tour === 0),
  });

  window.addEventListener('resize', markDirty);
}

function showError(message) {
  $('error').hidden = false;
  $('error-text').textContent = message;
}

function start() {
  buildUi();
  try {
    renderer = new Renderer(canvas);
  } catch (err) {
    showError(err.message);
    return;
  }
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    showError('The graphics driver reset the canvas, usually because a frame took too long. Lower the iteration count, then reload the page.');
  });
  syncIterSlider();
  requestAnimationFrame(frame);
}

start();
