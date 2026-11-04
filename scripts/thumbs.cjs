// Regenerates the home-page preview images in assets/thumbs/ by opening each
// demo in headless Chromium. Needs Playwright with Chromium installed
// (npm i -D playwright && npx playwright install chromium). Run `npm run build` first.
// Pass demo ids to regenerate only those: node scripts/thumbs.cjs three-body
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const page = 'file://' + path.join(root, 'dist/fractals-and-chaos.html');

// Per-demo setup: what to show and how long to let it run.
const SHOTS = {
  mandelbrot: { wait: 3000, setup: (p) => p.selectOption('.panel select', '1') },
  julia: { wait: 2500 },
  zoo: { wait: 2500, setup: (p) => p.selectOption('.panel select >> nth=1', '1') },
  mandelbulb: { wait: 15000, setup: (p) => p.keyboard.press(' ') },
  // Fern colored by its four maps, guides off. Blur first: keys are ignored
  // while a select has focus. R refits the view after the panel is hidden.
  ifs: {
    wait: 4000,
    setup: async (p) => {
      await p.selectOption('.panel select >> nth=0', '10');
      await p.selectOption('.panel select >> nth=-1', 'map');
      await p.click('text=Show guides');
      await p.evaluate(() => document.activeElement.blur());
      await p.keyboard.press('h');
      await p.keyboard.press('r');
    },
  },
  attractors: { wait: 7000 },
  pendulums: { wait: 6500 },
  'three-body': { wait: 8000 },
  bifurcation: { wait: 5000 },
  // Coarse cells and top speed so coral grows within the wait, even in software rendering.
  'reaction-diffusion': {
    wait: 25000,
    setup: (p) => p.evaluate(() => {
      const set = (label, v) => {
        const f = [...document.querySelectorAll('.panel .field')].find((x) => x.querySelector('.label')?.textContent.startsWith(label));
        f.querySelector('input').value = v;
        f.querySelector('input').dispatchEvent(new Event('input'));
      };
      set('Cell size', 4);
      set('Speed', 40);
    }),
  },
};

(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const only = process.argv.slice(2);
  for (const [id, shot] of Object.entries(SHOTS)) {
    if (only.length && !only.includes(id)) continue;
    const tab = await browser.newPage({ viewport: { width: 800, height: 500 } });
    await tab.goto(`${page}#${id}`);
    await tab.waitForTimeout(500);
    if (shot.setup) await shot.setup(tab);
    await tab.addStyleTag({ content: '.hud, .dock, .panel { display: none !important; }' });
    await tab.waitForTimeout(shot.wait);
    const file = path.join(root, 'assets/thumbs', `${id}.jpg`);
    await tab.screenshot({ path: file, type: 'jpeg', quality: 72 });
    console.log(`${id}.jpg ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
    await tab.close();
  }
  await browser.close();
  // Import every preview that exists, whether or not it was regenerated now.
  const ids = Object.keys(SHOTS).filter((id) => fs.existsSync(path.join(root, 'assets/thumbs', `${id}.jpg`)));
  const ident = (id) => id.replace(/-(\w)/g, (_, c) => c.toUpperCase());
  const src = `// Preview images for the home page, inlined by the bundler.
// Regenerate with: npm run thumbs
${ids.map((id) => `import ${ident(id)} from '../assets/thumbs/${id}.jpg';`).join('\n')}

export const THUMBS = {
${ids.map((id) => `  '${id}': ${ident(id)},`).join('\n')}
};
`;
  fs.writeFileSync(path.join(root, 'src/thumbs.js'), src);
})();
