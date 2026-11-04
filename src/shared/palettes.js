// Five colour stops per palette, blended cyclically in shaders.
export const PALETTES = [
  { name: 'Classic', stops: ['#000764', '#206bcb', '#edffff', '#ffaa00', '#000200'] },
  { name: 'Ember', stops: ['#0a0208', '#7a1420', '#eb5a14', '#ffd278', '#3a0a2a'] },
  { name: 'Glacier', stops: ['#020a1e', '#14468c', '#78c8e6', '#f4faff', '#284a6a'] },
  { name: 'Verdigris', stops: ['#05140f', '#1e6e5a', '#bedca0', '#faf0c8', '#503c1e'] },
  { name: 'Neon', stops: ['#140028', '#c814a0', '#ff783c', '#faf05a', '#1eb4c8'] },
  { name: 'Graphite', stops: ['#000000', '#5a5a5a', '#ffffff', '#969696', '#1e1e1e'] },
];

export function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export const paletteRgb = (i) => PALETTES[i].stops.map(hexToRgb).flat();

// Sample a palette on the CPU (t wraps around), returns [r, g, b] in 0..1.
export function samplePalette(i, t) {
  const stops = PALETTES[i].stops.map(hexToRgb);
  t = (((t % 1) + 1) % 1) * stops.length;
  const k = Math.floor(t);
  let f = t - k;
  f = f * f * (3 - 2 * f);
  const a = stops[k];
  const b = stops[(k + 1) % stops.length];
  return [0, 1, 2].map((j) => a[j] + (b[j] - a[j]) * f);
}

// GLSL: declare `uniform vec3 uStops[5];` and `vec3 palette(float t)`.
export const PALETTE_GLSL = `
uniform vec3 uStops[5];
vec3 palette(float t) {
  t = fract(t) * 5.0;
  int i = int(t);
  float f = t - float(i);
  f = f * f * (3.0 - 2.0 * f);
  return mix(uStops[i], uStops[(i + 1) % 5], f);
}`;
