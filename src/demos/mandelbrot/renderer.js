import { fragmentSource, ORBIT_TEX_WIDTH } from './shaders.js';
import { computeOrbit } from './orbit.js';
import { createGL, createProgram, drawFullscreen } from '../../shared/gl.js';

export const MAX_ITERATIONS = 50000;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = (this.gl = createGL(canvas));
    this.rows = Math.ceil((MAX_ITERATIONS + 2) / ORBIT_TEX_WIDTH);
    this.orbit = new Float32Array(ORBIT_TEX_WIDTH * this.rows * 2);
    this.prog = createProgram(gl, fragmentSource);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, ORBIT_TEX_WIDTH, this.rows);
  }

  // view: { cx, cy, radius, maxIter, stops (flat rgb x5), density, offset, shading }
  render(view) {
    const gl = this.gl;
    const { u, program } = this.prog;
    const { width, height } = this.canvas;
    const maxIter = Math.min(view.maxIter, MAX_ITERATIONS);

    const len = computeOrbit(view.cx, view.cy, maxIter, this.orbit);
    const rows = Math.ceil(len / ORBIT_TEX_WIDTH);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ORBIT_TEX_WIDTH, rows, gl.RG, gl.FLOAT,
      this.orbit.subarray(0, rows * ORBIT_TEX_WIDTH * 2));

    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.uniform1i(u.uOrbit, 0);
    gl.uniform1i(u.uOrbitLen, len);
    gl.uniform1i(u.uMaxIter, maxIter);
    gl.uniform2f(u.uResolution, width, height);
    gl.uniform1f(u.uPixelSize, (2 * view.radius) / Math.min(width, height));
    gl.uniform3fv(u.uStops, view.stops);
    gl.uniform1f(u.uDensity, view.density);
    gl.uniform1f(u.uOffset, view.offset);
    gl.uniform1f(u.uShading, view.shading ? 1 : 0);
    gl.uniform3f(u.uInterior, 0.012, 0.012, 0.02);
    drawFullscreen(gl);
  }
}
