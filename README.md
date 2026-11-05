# Fractals & Chaos

Interactive mathematics that runs live in the browser on the GPU (WebGL 2 and Canvas).
Sixteen demos in five areas (fractals, chaos, patterns, geometry, number theory), all with
mouse, touch and keyboard controls.

**Live site: https://shaostassen.github.io/fractals-and-chaos/**

| Area | Demo | What it shows |
| --- | --- | --- |
| Fractals | **Mandelbrot Set** | Deep zoom to about 10¹² × using perturbation theory, adaptive resolution, zoom tour |
| Fractals | **Julia Sets** | Pick *c* on a live Mandelbrot map; animate *c*; connected vs. dust readout |
| Fractals | **Fractal Zoo** | Burning Ship, Tricorn, Multibrot (any power, with morphing), Newton fractals |
| Fractals | **Mandelbulb** | Ray-marched 3D fractal with soft shadows, ambient occlusion, orbit-trap color |
| Fractals | **Chaos Game & IFS** | Jump part of the way to a random corner, millions of times, and exact fractals appear: Sierpinski triangle and carpet, restricted chaos games, Barnsley fern, Heighway dragon. Drag the corners, color each point by the map that placed it, or step through single jumps |
| Chaos | **Strange Attractors** | Lorenz, Rössler, Aizawa, Thomas, Halvorsen with up to 60,000 particles and a butterfly-effect mode |
| Chaos | **Double Pendulums** | Up to 2,000 pendulums started 10⁻⁶ rad apart; drag to pose; live divergence readout |
| Chaos | **Three-Body Problem** | Figure-eight, Lagrange triangle, 2013 periodic orbits, the Pythagorean problem and random setups, raced against a twin started 10⁻⁹ away |
| Chaos | **Bifurcation Diagram** | Logistic, sine and Gauss maps; zoomable; cobweb plot and Lyapunov exponent for any *r* |
| Patterns | **Reaction–Diffusion** | Gray–Scott chemicals on the GPU: coral, dividing cells, worms, mazes and chaotic waves. Paint with chemical V, or open Pearson's parameter map, where every point runs its own (F, k), and click to pick one |
| Patterns | **Life & Lenia** | Conway's Game of Life (and HighLife, Day & Night, Seeds, Maze, Brian's Brain) and Bert Chan's continuous Lenia on the GPU: stamp gliders and guns, paint cells, watch the Orbium creature glide |
| Geometry | **Fourier Epicycles** | Draw any closed shape (or pick one) and up to 512 spinning circles redraw it; build up one circle at a time; exact error readout via Parseval's theorem |
| Geometry | **Hyperbolic Tilings** | {p, q} tilings in the Poincaré disk, rendered on the GPU by reflecting each pixel into one triangle; drag to travel through the hyperbolic plane |
| Geometry | **Penrose Tiling** | Rhombus tiling built by golden-ratio deflation; watch it grow; the thick-to-thin ratio converges to φ |
| Number theory | **Ulam Prime Spiral** | Primes up to 1.4 million in Ulam's square spiral or Sacks's round one; Euler's n² + n + 41 diagonal, twin primes, divisor counts, factorization on hover |
| Number theory | **Collatz Tree** | Every path to 1 drawn at once as a branching coral, plus the steps-to-1 plot; highlight any number's path |

Each demo has a "What am I looking at?" section explaining the math.

## Run it

```bash
npm install
npm start          # http://localhost:8080, rebuilds on reload
```

```bash
npm run build      # dist/fractals-and-chaos.html, one self-contained file
```

The build writes two files: `dist/site/index.html`, a complete page that GitHub Pages
publishes (see `.github/workflows/pages.yml`; it deploys on every push to `main`), and
`dist/fractals-and-chaos.html`, the same app as a page fragment for embedding. Both are
self-contained; only the web fonts load from Google Fonts.

`npm run thumbs` regenerates the home-page preview images. It needs Playwright with
Chromium installed, and a fresh `npm run build` first.

## How it is organized

```
index.html                 page shell (dev)
src/app.js                 hash router: #julia mounts the Julia demo, empty hash shows home
src/home.js                home page cards
src/style.css              all styles
src/shared/
  ui.js                    panel, sliders, readout (HUD), formatting
  gl.js                    WebGL 2 helpers
  panzoom.js               pan/zoom view with mouse, pinch and keyboard input
  loop.js                  animation loop and adaptive resolution
  palettes.js              color palettes (CPU and GLSL)
src/demos/
  mandelbrot/              perturbation renderer, reference orbit, locations
  julia.js  zoo.js  mandelbulb.js  ifs.js
  attractors.js  pendulums.js  threebody.js  bifurcation.js
  reaction-diffusion.js  life.js
  fourier.js  hyperbolic.js  penrose.js  ulam.js  collatz.js
scripts/build.mjs          esbuild bundle + dev server
scripts/thumbs.cjs         preview image generator
assets/thumbs/             preview images
```

Every demo exports `{ id, title, area, formula, blurb, mount(root, { signal, params, navigate }) }`.
`mount` builds its canvas and panel inside `root`, registers listeners with `signal`
(aborted when you leave the demo), and returns a cleanup function that frees the
GPU context. Adding a demo means writing one module and listing it in `src/demos/index.js`.

## Notes on the math and rendering

**Mandelbrot deep zoom.** GPU floats are 32-bit and blur out near 10⁵ ×. The CPU computes
one reference orbit at the screen centre in 64-bit doubles, uploads it as a float texture,
and each pixel iterates only its difference from it: `dz ← 2·Z·dz + dz² + dc`.
When `|Z + dz| < |dz|` the pixel restarts from the beginning of the reference orbit
("rebasing"), which removes the usual perturbation glitches. The other escape-time
fractals use plain 32-bit math and stop at 10⁴ ×.

**Staying real-time.** While you interact, renderers lower their internal resolution
when frames take longer than about 30 ms, then draw one sharp frame when you stop.

**Mandelbulb.** White–Nylander power formula in spherical coordinates, rendered by sphere
tracing against its distance estimate `0.5·log r·r / |dr|`.

**Chaos game and IFS.** Each preset is a set of contracting affine maps
f<sub>i</sub>(x) = A<sub>i</sub>x + b<sub>i</sub>; "jump a fraction r of the way to corner v<sub>i</sub>" is
f<sub>i</sub>(x) = (1 − r)x + r·v<sub>i</sub>. Hutchinson's theorem (1981) says the maps have exactly one
non-empty compact set A with A = ∪ f<sub>i</sub>(A), the attractor. Every jump shrinks the distance
to A, whichever map is picked, so after a short burn-in each point lies on A to within a
pixel. The probabilities change only the density, not the shape. Coloring by the last map
shows the decomposition A = ∪ f<sub>i</sub>(A) directly. Restricted games (such as "never the same
corner twice") forbid some pairs of maps, which removes second-level copies.

**Attractors.** Fourth-order Runge–Kutta on the CPU (64-bit), points drawn additively
into a half-float buffer that fades each frame for trails, then tone-mapped.

**Pendulums.** Equal masses and rods, standard Lagrangian equations of motion,
RK4 with a fixed 1/300 s step.

**Three-body problem.** Planar Newtonian gravity (G = 1) in the centre-of-mass frame,
RK4 with an adaptive step: a fraction of the tightest pair's free-fall time, √(r³/(m₁ + m₂)).
That keeps close encounters accurate. With the default setting the Pythagorean problem
conserves energy to about 10⁻⁸ and reproduces the known outcome (mass 3 ejected at t ≈ 64,
masses 4 and 5 leave as a binary). The readout shows the energy error so you can see when
accuracy is too low.

**Bifurcation.** For each pixel column the map is iterated thousands of times and the
visited values are binned into a density image (log-scaled). The strip along the bottom
is the Lyapunov exponent, the average of `log|f′(x)|` along the orbit: positive means chaos.

**Reaction–diffusion.** Two chemicals follow u′ = D<sub>u</sub>∇²u − uv² + F(1 − u) and
v′ = D<sub>v</sub>∇²v + uv² − (F + k)v, simulated in float textures on the GPU. It uses Karl Sims's
units: grid spacing 1, time step 1, D<sub>u</sub> = 1, D<sub>v</sub> = 0.5, and a 9-point Laplacian
(−1 centre, 0.2 edges, 0.05 corners; the weights sum to zero). Explicit Euler is stable
because dt·D<sub>u</sub>·1.6 < 2. The parameter map plots k linearly and F on a square-root
scale so the low-F wave regimes get room. Without float render targets, u and v are stored
as 16-bit fixed point in RGBA8.

**Life and Lenia.** Life updates every cell at once from its eight neighbours: B3/S23 means
a dead cell is born with exactly 3 live neighbours and a live cell survives with 2 or 3. It
runs as a fragment-shader pass over two ping-pong textures that wrap at the edges, and was
checked cell-for-cell against a CPU reference for all six rules. Lenia makes everything
continuous: states in [0, 1], a smooth ring kernel K(r) ∝ exp(4 − 1/(r(1 − r))) normalized to
sum to 1, and A ← clip(A + Δt·G(K∗A), 0, 1) with G(u) = 2·exp(−(u − μ)²/2σ²) − 1. Orbium
(R = 13, μ = 0.15, σ = 0.015, Δt = 0.1) keeps its mass and glides about 0.6 cells per step.

**Fourier epicycles.** The shape is resampled to 512 points evenly spaced along its length, and
the discrete Fourier transform gives one circle per frequency, c<sub>k</sub>·e<sup>2πikt</sup>, drawn largest
first. By Parseval's theorem the RMS distance between the k-circle copy and the shape is
√(Σ |c<sub>j</sub>|²) over the circles left out, which is what the error readout shows.

**Hyperbolic tilings.** A {p, q} tiling splits into right triangles with angles π/p, π/q, π/2.
In the Poincaré disk the central triangle is bounded by two lines through the origin and a
circle orthogonal to the unit circle, with centre d = 1/√(1 − sin²(π/p)/cos²(π/q)) and
radius d·sin(π/p)/cos(π/q). The shader reflects each pixel across those mirrors until it
lands in that triangle; the reflection count gives the colour. Dragging composes Möbius
translations z → (z + a)/(āz + 1), kept as a normalized 2×2 complex matrix.

**Penrose tiling.** Robinson-triangle deflation: each half-rhombus is cut at golden-ratio
points into two or three smaller ones. The thin and thick counts go (t, T) → (t + T, t + 2T),
so their ratio runs through ratios of Fibonacci numbers toward φ. Tests check the total area
is preserved exactly at every step.

**Ulam spiral.** A smallest-prime-factor sieve up to 1.44 million gives primality and
factorizations; a closed-form formula maps each spiral cell to its number. Starting the
spiral at 41 puts Euler's n² + n + 41 (prime for n = 0…39) on one diagonal.

**Collatz tree.** Each number is joined to its successor (n/2 or 3n + 1). Laid out from 1, a
branch turns one way at even numbers and the other at odd ones, and segments thicken with
the number of starting values whose paths share them. Steps to 1 are memoized through
smaller values.

## Ideas for going further

- Arbitrary-precision reference orbit for the Mandelbrot set beyond 10¹² ×
- L-system plants, Riemann zeta function, ripple tank and fluid simulation
