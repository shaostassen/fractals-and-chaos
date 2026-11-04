// Build:  node scripts/build.mjs          -> dist/fractals-and-chaos.html (one self-contained file)
// Dev:    node scripts/build.mjs --serve  -> http://localhost:8080 with live bundling
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = {
  entryPoints: [path.join(root, 'src/app.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  loader: { '.jpg': 'dataurl', '.webp': 'dataurl', '.png': 'dataurl' },
  logLevel: 'warning',
};

if (process.argv.includes('--serve')) {
  const port = Number(process.env.PORT || 8080);
  const ctx = await esbuild.context({ ...options, outfile: path.join(root, 'app.js'), write: false });
  await ctx.serve({ servedir: root, port });
  console.log(`Fractals & Chaos: http://localhost:${port}/`);
} else {
  const result = await esbuild.build({ ...options, write: false, minify: true });
  const js = result.outputFiles[0].text;
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const css = await readFile(path.join(root, 'src/style.css'), 'utf8');
  const title = html.match(/<title>(.*?)<\/title>/)[1];
  const fonts = html.match(/<link rel="stylesheet" href="(https:\/\/fonts[^"]+)">/)[1];

  // A page fragment (no <html>/<head>/<body>) so a host page can wrap it;
  // browsers also open it directly.
  const out = `<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="${fonts}">
<style>
${css.trim()}
</style>
<div id="app"></div>
<script>
${js.replace(/<\/script/gi, '<\\/script')}
</script>
`;
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist/fractals-and-chaos.html'), out);
  console.log(`dist/fractals-and-chaos.html (${(out.length / 1024).toFixed(1)} KB)`);
}
