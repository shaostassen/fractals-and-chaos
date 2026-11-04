import { vertexSource, fragmentSource, ORBIT_TEX_WIDTH } from './shaders.js';
import { computeOrbit } from './orbit.js';

export const MAX_ITERATIONS = 50000;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(shader));
  }
  return shader;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      depth: false,
      stencil: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('This browser does not support WebGL 2.');
    this.gl = gl;
    this.orbitRows = Math.ceil((MAX_ITERATIONS + 2) / ORBIT_TEX_WIDTH);
    this.orbit = new Float32Array(ORBIT_TEX_WIDTH * this.orbitRows * 2);
    this.init();
  }

  init() {
    const gl = this.gl;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Shader link failed: ' + gl.getProgramInfoLog(program));
    }
    this.program = program;
    this.vao = gl.createVertexArray();

    this.u = {};
    for (const name of ['uOrbit', 'uOrbitLen', 'uMaxIter', 'uResolution', 'uPixelSize',
      'uStops', 'uDensity', 'uOffset', 'uShading', 'uInterior']) {
      this.u[name] = gl.getUniformLocation(program, name);
    }

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, ORBIT_TEX_WIDTH, this.orbitRows);
  }

  // Resize the drawing buffer to the canvas's CSS size times `scale`.
  resize(scale) {
    const c = this.canvas;
    const w = Math.max(1, Math.round(c.clientWidth * scale));
    const h = Math.max(1, Math.round(c.clientHeight * scale));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }

  // view: { cx, cy, radius, maxIter, stops (5 x [r,g,b]), density, offset, shading }
  render(view) {
    const gl = this.gl;
    const { width, height } = this.canvas;
    const maxIter = Math.min(view.maxIter, MAX_ITERATIONS);

    const len = computeOrbit(view.cx, view.cy, maxIter, this.orbit);
    const rows = Math.ceil(len / ORBIT_TEX_WIDTH);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ORBIT_TEX_WIDTH, rows, gl.RG, gl.FLOAT,
      this.orbit.subarray(0, rows * ORBIT_TEX_WIDTH * 2));

    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.u.uOrbit, 0);
    gl.uniform1i(this.u.uOrbitLen, len);
    gl.uniform1i(this.u.uMaxIter, maxIter);
    gl.uniform2f(this.u.uResolution, width, height);
    gl.uniform1f(this.u.uPixelSize, (2 * view.radius) / Math.min(width, height));
    gl.uniform3fv(this.u.uStops, view.stops.flat());
    gl.uniform1f(this.u.uDensity, view.density);
    gl.uniform1f(this.u.uOffset, view.offset);
    gl.uniform1f(this.u.uShading, view.shading ? 1 : 0);
    gl.uniform3f(this.u.uInterior, 0.012, 0.012, 0.02);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
