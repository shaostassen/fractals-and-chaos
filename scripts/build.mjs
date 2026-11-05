// Build:  node scripts/build.mjs          -> dist/fractals-and-chaos.html (one self-contained page fragment)
//                                          and dist/site/index.html (full page, published to GitHub Pages)
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

  const body = `<style>
${css.trim()}
</style>
<div id="app"></div>
<script>
${js.replace(/<\/script/gi, '<\\/script')}
</script>
`;

  // A page fragment (no <html>/<head>/<body>) so a host page can wrap it;
  // browsers also open it directly.
  const fragment = `<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="${fonts}">
${body}`;

  // A complete document for the public website.
  const description = 'Real-time interactive mathematics in the browser: fractals, chaos, self-organizing patterns, geometry and number theory.';
  const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%2305060a'/%3E%3Ccircle cx='13' cy='16' r='7' fill='none' stroke='%23ffaa00' stroke-width='3'/%3E%3Ccircle cx='23' cy='16' r='3' fill='%234cc9f0'/%3E%3C/svg%3E";
  const site = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta name="theme-color" content="#05060a">
<link rel="icon" href="${icon}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fonts}">
</head>
<body>
${body}</body>
</html>
`;

  await mkdir(path.join(root, 'dist/site'), { recursive: true });
  await writeFile(path.join(root, 'dist/fractals-and-chaos.html'), fragment);
  await writeFile(path.join(root, 'dist/site/index.html'), site);
  console.log(`dist/fractals-and-chaos.html (${(fragment.length / 1024).toFixed(1)} KB), dist/site/index.html`);
}
