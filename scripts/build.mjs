// Bundles the app into one self-contained HTML file: dist/mandelbrot.html.
// No dependencies: inlines style.css and concatenates the ES modules in
// dependency order (they share no conflicting top-level names).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFile(path.join(root, p), 'utf8');

const MODULES = [
  'src/shaders.js',
  'src/orbit.js',
  'src/palettes.js',
  'src/locations.js',
  'src/renderer.js',
  'src/controls.js',
  'src/main.js',
];

const html = await read('index.html');
const css = await read('style.css');
const body = html.match(/<!-- BODY -->([\s\S]*?)<!-- \/BODY -->/)[1].trim();
const title = html.match(/<title>(.*?)<\/title>/)[1];
const fonts = html.match(/<link rel="stylesheet" href="(https:\/\/fonts[^"]+)">/)[1];

const js = (await Promise.all(MODULES.map(async (file) => {
  const src = (await read(file))
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  return `// ---- ${file}\n${src.trim()}\n`;
}))).join('\n');

// A page fragment (no <html>/<head>/<body>), so it can also be embedded in a
// host page that supplies the document skeleton. Browsers accept it as-is too.
const out = `<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="${fonts}">
<style>
${css.trim()}
</style>
${body}
<script type="module">
${js}
</script>
`;

await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/mandelbrot.html'), out);
console.log(`dist/mandelbrot.html (${(out.length / 1024).toFixed(1)} KB)`);
