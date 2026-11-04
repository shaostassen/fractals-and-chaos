// WebGL 2 helpers: context creation, program compilation, full-screen pass.

export const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function createGL(canvas, options = {}) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, depth: false, stencil: false, alpha: false,
    powerPreference: 'high-performance', ...options,
  });
  if (!gl) throw new Error('This browser does not support WebGL 2.');
  return gl;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(shader));
  }
  return shader;
}

// Returns { program, u } where u.name is the uniform location (cached lazily).
export function createProgram(gl, fragmentSource, vertexSource = FULLSCREEN_VS) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Shader link failed: ' + gl.getProgramInfoLog(program));
  }
  const cache = new Map();
  const u = new Proxy({}, {
    get(_, name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
      return cache.get(name);
    },
  });
  return { program, u };
}

let emptyVao = null;
export function drawFullscreen(gl) {
  if (!emptyVao || !gl.isVertexArray(emptyVao)) emptyVao = gl.createVertexArray();
  gl.bindVertexArray(emptyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// Resize the drawing buffer to the canvas's CSS size times `scale`.
export function resizeCanvas(canvas, scale) {
  const w = Math.max(1, Math.round(canvas.clientWidth * scale));
  const h = Math.max(1, Math.round(canvas.clientHeight * scale));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    return true;
  }
  return false;
}

// Free the GPU context right away instead of waiting for garbage collection
// (browsers cap the number of live WebGL contexts).
export function releaseGL(gl) {
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
}

export function onContextLost(canvas, root, signal, showError) {
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    showError(root, 'The graphics driver reset the canvas, usually because a frame took too long. Lower the quality or iteration settings, then reload.');
  }, { signal });
}
