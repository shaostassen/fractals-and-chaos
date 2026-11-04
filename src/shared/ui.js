// Small DOM helpers shared by every demo: element builder, control panel,
// readout (HUD) and error screen.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, val);
        else node.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

let uid = 0;
const nextId = (base) => `${base}-${++uid}`;

// Floating control panel with a back link, title, controls and notes.
export function createPanel(root, { title, formula, signal }) {
  const body = el('div', { class: 'panel-body' });
  const close = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Hide controls', title: 'Hide controls (H)' }, '×');
  const panel = el('aside', { class: 'panel', 'aria-label': `${title} controls` },
    el('a', { class: 'back', href: '#' }, '← All demos'),
    el('header', { class: 'panel-head' },
      el('h1', {}, title, formula ? el('span', { class: 'formula', html: formula }) : null),
      close),
    body);
  const dock = el('div', { class: 'dock', hidden: true },
    el('a', { class: 'btn floating', href: '#' }, 'All demos'),
    el('button', { type: 'button', class: 'btn floating', onclick: () => api.setOpen(true) }, 'Controls'));
  root.append(panel, dock);

  const api = {
    panel,
    body,
    add(...nodes) { body.append(...nodes); return nodes[0]; },
    setOpen(open) { panel.hidden = !open; dock.hidden = open; },
    toggle() { api.setOpen(panel.hidden); },
  };
  close.addEventListener('click', () => api.setOpen(false), { signal });
  if (window.matchMedia('(max-width: 640px)').matches) api.setOpen(false);
  return api;
}

// ---- controls. Each returns its root element; extra handles hang off it.

export function slider({ label, min, max, step = 1, value, format = (v) => v, onInput }) {
  const id = nextId('range');
  const out = el('output', { for: id }, format(value));
  const input = el('input', { type: 'range', id, min, max, step, value });
  input.addEventListener('input', () => {
    out.textContent = format(+input.value);
    onInput(+input.value);
  });
  const root = el('div', { class: 'field' },
    el('div', { class: 'label-row' }, el('label', { class: 'label', for: id }, label), out),
    input);
  root.set = (v) => { input.value = v; out.textContent = format(+input.value); };
  root.setText = (t) => { out.textContent = t; };
  root.input = input;
  return root;
}

export function select({ label, options, value, onChange }) {
  const id = nextId('select');
  const input = el('select', { id }, options.map((o) => {
    const opt = el('option', { value: o.value }, o.label);
    if (o.hidden) opt.hidden = true;
    return opt;
  }));
  input.value = value;
  input.addEventListener('change', () => onChange(input.value));
  const root = el('div', { class: 'field' }, el('label', { class: 'label', for: id }, label), input);
  root.input = input;
  return root;
}

export function check({ label, checked, onChange }) {
  const input = el('input', { type: 'checkbox', id: nextId('check') });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  const root = el('label', { class: 'check' }, input, ' ', label);
  root.input = input;
  return root;
}

export const toggles = (...checks) => el('div', { class: 'toggles' }, checks);

export function button({ label, primary = false, onClick }) {
  return el('button', { type: 'button', class: primary ? 'btn primary' : 'btn', onclick: onClick }, label);
}

export const actions = (...buttons) => el('div', { class: 'actions' }, buttons);

export const note = (html) => el('p', { class: 'hint', html });

export function about(html) {
  return el('details', { class: 'about' }, el('summary', {}, 'What am I looking at?'), el('div', { html }));
}

export function swatches({ palettes, value, onChange }) {
  const name = el('span', { class: 'value' }, palettes[value].name);
  const row = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Palette' });
  palettes.forEach((p, i) => {
    const b = el('button', {
      type: 'button', class: 'swatch', title: p.name, role: 'radio', 'aria-label': p.name,
      'aria-checked': String(i === value), style: { background: `linear-gradient(90deg, ${p.stops.join(', ')})` },
    });
    b.addEventListener('click', () => {
      row.querySelectorAll('.swatch').forEach((s, j) => s.setAttribute('aria-checked', String(j === i)));
      name.textContent = p.name;
      onChange(i);
    });
    row.append(b);
  });
  return el('div', { class: 'field' },
    el('div', { class: 'label-row' }, el('span', { class: 'label' }, 'Palette'), name), row);
}

// ---- readout in the top-left corner

export function createHud(root, rows) {
  const cells = {};
  const hud = el('dl', { class: 'hud' }, rows.map(([key, label]) => {
    cells[key] = el('dd', {}, '—');
    return el('div', {}, el('dt', {}, label), cells[key]);
  }));
  const extra = el('p', { class: 'hud-note', hidden: true });
  hud.append(extra);
  root.append(hud);
  return {
    el: hud,
    set(key, text) { if (cells[key].textContent !== text) cells[key].textContent = text; },
    note(text) { extra.hidden = !text; if (text) extra.textContent = text; },
  };
}

export function showError(root, message) {
  root.append(el('div', { class: 'error', role: 'alert' },
    el('h2', {}, "Can't render this demo"), el('p', {}, message), el('a', { class: 'btn', href: '#' }, 'Back to all demos')));
}

// ---- number formatting

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export function sci(v, digits = 2) {
  if (v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  if (e >= -2 && e < 4) return v.toFixed(Math.max(0, digits - e));
  const sup = String(e).replace('-', '⁻').replace(/\d/g, (d) => SUP[d]);
  return (v / 10 ** e).toFixed(digits) + '×10' + sup;
}

export function fmtZoom(z) {
  if (z < 1000) return z.toFixed(z < 10 ? 2 : 0) + '×';
  return sci(z) + '×';
}

export function fmtSigned(v, digits) {
  return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(digits);
}
