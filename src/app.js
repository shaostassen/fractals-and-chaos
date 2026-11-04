// Hash router: '#julia' mounts the Julia demo, an empty hash shows the home page.
import { DEMOS } from './demos/index.js';
import { renderHome } from './home.js';
import { el, showError } from './shared/ui.js';

const app = document.getElementById('app');
let current = null;
let pendingParams = {};

function navigate(id, params = {}) {
  pendingParams = params;
  const hash = id ? `#${id}` : '';
  if (location.hash === hash || (!id && location.hash === '')) route();
  else location.hash = hash;
}

function route() {
  if (current) {
    current.controller.abort();
    try { current.cleanup?.(); } catch { /* already gone */ }
  }
  app.replaceChildren();
  const controller = new AbortController();
  const demo = DEMOS.find((d) => d.id === location.hash.slice(1));
  document.body.dataset.view = demo ? 'demo' : 'home';
  document.title = demo ? `${demo.title} · Fractals & Chaos` : 'Fractals & Chaos';
  current = { controller };

  if (!demo) {
    renderHome(app, DEMOS);
    window.scrollTo(0, 0);
    return;
  }
  const root = el('div', { class: 'demo' });
  app.append(root);
  try {
    current.cleanup = demo.mount(root, { signal: controller.signal, params: pendingParams, navigate });
  } catch (err) {
    console.error(err);
    showError(root, err.message);
  }
  pendingParams = {};
}

window.addEventListener('hashchange', () => route());
route();
