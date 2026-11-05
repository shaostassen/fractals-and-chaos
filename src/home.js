import { el } from './shared/ui.js';
import { THUMBS } from './thumbs.js';

const AREAS = [
  {
    name: 'Fractals',
    intro: 'Shapes built by repeating one simple rule, with detail at every scale you zoom to.',
  },
  {
    name: 'Chaos',
    intro: 'Deterministic systems where a difference in the tenth decimal place grows until it decides everything.',
  },
  {
    name: 'Patterns',
    intro: 'Simple local rules, applied everywhere at once, that organize themselves into spots, stripes and moving creatures.',
  },
  {
    name: 'Geometry',
    intro: 'Curves built from spinning circles, a plane with more room than ours, and tilings that never repeat.',
  },
  {
    name: 'Number theory',
    intro: 'Whole numbers hide patterns that are easy to see and, so far, impossible to explain.',
  },
];

export function renderHome(root, demos) {
  root.append(el('main', { class: 'home' },
    el('header', { class: 'home-head' },
      el('p', { class: 'eyebrow' }, 'Real-time mathematics'),
      el('h1', {}, 'Fractals & Chaos'),
      el('p', { class: 'lede' }, 'Interactive experiments that run live on your graphics card. Pick one, then drag, zoom and change the rules.')),
    // Skip areas that have no demos yet.
    AREAS.filter((area) => demos.some((d) => d.area === area.name)).map((area) => el('section', { class: 'area', 'aria-labelledby': `area-${area.name}` },
      el('div', { class: 'area-head' },
        el('h2', { id: `area-${area.name}` }, area.name),
        el('p', {}, area.intro)),
      cards(demos.filter((d) => d.area === area.name)))),
    el('footer', { class: 'home-foot' },
      el('p', {}, 'WebGL 2 and Canvas. No libraries. Works with mouse, touch and keyboard.'))));
}

// As many columns as cards, up to 4; 5 or 6 cards use 3 columns so no
// card sits alone in a row.
function cards(list) {
  const cols = list.length <= 4 ? list.length : 3;
  return el('div', { class: 'cards', style: { '--cols': String(cols) } }, list.map(card));
}

function card(demo) {
  const thumb = THUMBS[demo.id];
  return el('a', { class: 'card', href: `#${demo.id}` },
    el('div', { class: 'thumb' }, thumb ? el('img', { src: thumb, alt: '', loading: 'lazy' }) : null),
    el('div', { class: 'card-body' },
      el('h3', {}, demo.title),
      el('p', { class: 'card-formula', html: demo.formula }),
      el('p', { class: 'card-blurb' }, demo.blurb)));
}
