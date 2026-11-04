# Mandelbrot Explorer

A real-time Mandelbrot set renderer that runs in the browser on the GPU (WebGL 2).
Pan and zoom smoothly from the whole set down to about **10¹² × magnification**.

## Run it

No dependencies. Any static file server works (ES modules need `http://`, not `file://`):

```bash
npm start            # serves at http://localhost:8080
```

or

```bash
python3 -m http.server 8080
```

`npm run build` writes `dist/mandelbrot.html`, a single self-contained file
(only the web fonts load from Google Fonts) that opens directly in a browser.

## Controls

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Pan | Drag | Arrow keys or WASD |
| Zoom | Scroll wheel, pinch, double-click (Shift to zoom out) | `+` / `−` |
| Zoom tour (auto-dive into Seahorse Valley) | Panel button | `Space` |
| Reset view | Panel button | `R` |
| Hide or show the panel | × button | `H` |

The panel also has preset locations, an iteration limit (automatic by default),
six palettes, color band density and shift, edge shading, and color cycling.

## How it works

**Every pixel is computed each frame on the GPU** by a fragment shader
(`src/shaders.js`), so panning and zooming are live, not tiled.

**Deep zoom via perturbation.** GPU floats are 32-bit, which by themselves blur
out at around 10⁵ ×. Instead:

1. The CPU computes one *reference orbit* `Z₀, Z₁, …` in 64-bit doubles at the
   view centre (`src/orbit.js`) and uploads it as a float texture.
2. Each pixel iterates only its small difference `dz` from that orbit, which
   32-bit floats represent accurately at any scale:
   `dz ← 2·Z·dz + dz² + dc`
3. *Rebasing*: when a pixel's own value `|Z + dz|` becomes smaller than `|dz|`,
   it restarts from the beginning of the reference orbit. This removes the
   glitches that plain perturbation produces.

The remaining depth limit (about 10¹² ×, radius 2·10⁻¹³) comes from the 64-bit
reference orbit and the double-precision view centre.

**Coloring.** Smooth (fractional) escape counts are mapped through a cyclic
five-stop palette. Edge shading uses a distance estimate, tracked as a
derivative scaled to pixel units so it does not overflow at depth.

**Staying real-time.** While you move, the renderer lowers the internal
resolution if frames take longer than about 30 ms, then renders one sharp
frame once you stop. Iterations rise automatically with zoom depth.

## Files

```
index.html           page markup
style.css            styles
src/main.js          app state, render loop, UI wiring, zoom tour
src/renderer.js      WebGL 2 setup, orbit texture upload, draw call
src/shaders.js       GLSL shaders (perturbation + rebasing, coloring)
src/orbit.js         reference orbit in double precision
src/controls.js      mouse, touch (pinch) and keyboard input
src/palettes.js      color palettes
src/locations.js     preset locations and zoom-tour target
scripts/build.mjs    bundles everything into dist/mandelbrot.html
scripts/serve.mjs    tiny static dev server
```

## Ideas for going further

- Arbitrary-precision reference orbit (e.g. BigInt fixed point) plus an extended
  exponent for `dz` to zoom past 10¹² ×.
- Series approximation to skip early iterations at deep zoom.
- Progressive supersampling (anti-aliasing) when the view is still.
