// Five colour stops per palette, blended cyclically in the shader.
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
