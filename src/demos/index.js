import mandelbrot from './mandelbrot/index.js';
import julia from './julia.js';
import zoo from './zoo.js';
import mandelbulb from './mandelbulb.js';
import ifs from './ifs.js';
import attractors from './attractors.js';
import pendulums from './pendulums.js';
import threeBody from './threebody.js';
import bifurcation from './bifurcation.js';
import reactionDiffusion from './reaction-diffusion.js';
import life from './life.js';
import fourier from './fourier.js';
import hyperbolic from './hyperbolic.js';
import penrose from './penrose.js';
import ulam from './ulam.js';
import collatz from './collatz.js';
import ripple from './ripple.js';
import quantum from './quantum.js';

// Order here is the order on the home page.
export const DEMOS = [
  mandelbrot, julia, zoo, mandelbulb, ifs,
  attractors, pendulums, threeBody, bifurcation,
  reactionDiffusion, life,
  fourier, hyperbolic, penrose,
  ulam, collatz,
  ripple, quantum,
];
