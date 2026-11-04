// Regenerates the home-page preview images in assets/thumbs/ by opening each
// demo in headless Chromium. Needs Playwright with Chromium installed
// (npm i -D playwright && npx playwright install chromium). Run `npm run build` first.
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
  attractors: { wait: 7000 },
  pendulums: { wait: 6500 },
  bifurcation: { wait: 5000 },
};

(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const imports = [];
  for (const [id, shot] of Object.entries(SHOTS)) {
    const tab = await browser.newPage({ viewport: { width: 800, height: 500 } });
    await tab.goto(`${page}#${id}`);
    await tab.waitForTimeout(500);
    if (shot.setup) await shot.setup(tab);
    await tab.addStyleTag({ content: '.hud, .dock, .panel { display: none !important; }' });
    await tab.waitForTimeout(shot.wait);
    const file = path.join(root, 'assets/thumbs', `${id}.jpg`);
    await tab.screenshot({ path: file, type: 'jpeg', quality: 72 });
    console.log(`${id}.jpg ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
    imports.push(id);
    await tab.close();
  }
  await browser.close();
  const src = `// Preview images for the home page, inlined by the bundler.
// Regenerate with: npm run thumbs
${imports.map((id) => `import ${id} from '../assets/thumbs/${id}.jpg';`).join('\n')}

export const THUMBS = { ${imports.join(', ')} };
`;
  fs.writeFileSync(path.join(root, 'src/thumbs.js'), src);
})();
