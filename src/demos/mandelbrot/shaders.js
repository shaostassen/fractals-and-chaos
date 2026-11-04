// GLSL sources for the Mandelbrot renderer.
//
// Precision trick (perturbation theory): GPU floats are 32-bit, which only
// resolves the set down to about 1e-5. Instead, the CPU computes one reference
// orbit Z_n in 64-bit doubles at the view centre. Each pixel then iterates only
// its small offset dz from that orbit, which float32 handles fine:
//
//   dz_{n+1} = 2 * Z_n * dz_n + dz_n^2 + dc
//
// "Rebasing" (resetting to the start of the reference orbit when the pixel's
// own z gets smaller than dz) avoids the usual perturbation glitches.

import { PALETTE_GLSL } from '../../shared/palettes.js';

export const ORBIT_TEX_WIDTH = 2048;

export const fragmentSource = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uOrbit;   // reference orbit Z_n, RG32F
uniform int uOrbitLen;      // number of valid entries in uOrbit
uniform int uMaxIter;
uniform vec2 uResolution;   // drawing buffer size in pixels
uniform float uPixelSize;   // complex-plane units per pixel
uniform float uDensity;
uniform float uOffset;
uniform float uShading;     // 0 = off, 1 = edge shading on
uniform vec3 uInterior;

out vec4 outColor;

const int W = ${ORBIT_TEX_WIDTH};

vec2 orbitAt(int i) {
  return texelFetch(uOrbit, ivec2(i % W, i / W), 0).xy;
}

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

${PALETTE_GLSL}

void main() {
  vec2 dc = (gl_FragCoord.xy - 0.5 * uResolution) * uPixelSize;

  vec2 Z = vec2(0.0);   // reference orbit value
  vec2 dz = vec2(0.0);  // this pixel's offset from the reference
  vec2 z = vec2(0.0);   // full value, Z + dz
  vec2 der = vec2(0.0); // dz/dc, pre-multiplied by pixel size (for edge shading)
  int m = 0;            // index into the reference orbit
  int i = 0;
  bool escaped = false;

  for (i = 0; i < uMaxIter; i++) {
    der = 2.0 * cmul(z, der) + vec2(uPixelSize, 0.0);
    dz = 2.0 * cmul(Z, dz) + cmul(dz, dz) + dc;
    m++;
    Z = orbitAt(m);
    z = Z + dz;
    float r2 = dot(z, z);
    if (r2 > 1.0e6) { escaped = true; break; }
    if (r2 < dot(dz, dz) || m >= uOrbitLen - 1) {
      dz = z;
      m = 0;
      Z = vec2(0.0);
    }
  }

  if (!escaped) {
    outColor = vec4(uInterior, 1.0);
    return;
  }

  // Smooth (continuous) iteration count.
  float logZ = 0.5 * log(dot(z, z));
  float mu = max(float(i) + 1.0 - log2(logZ), 0.0);
  vec3 col = palette(sqrt(mu) * uDensity + uOffset);

  // Distance estimate in pixels; darken thin filaments near the boundary.
  float dePx = length(z) * logZ / max(length(der), 1e-30);
  float edge = clamp(pow(dePx * 0.75, 0.4), 0.0, 1.0);
  col *= mix(1.0, 0.15 + 0.85 * edge, uShading);

  outColor = vec4(col, 1.0);
}`;
