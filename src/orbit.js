// Reference orbit, computed on the CPU in 64-bit doubles at the view centre.
// Entry n holds Z_n for Z_0 = 0, Z_{n+1} = Z_n^2 + c.
// Stops once Z escapes (the shader rebases when it runs off the end).

export function computeOrbit(cx, cy, maxIter, out) {
  let x = 0;
  let y = 0;
  out[0] = 0;
  out[1] = 0;
  let n = 1;
  for (; n <= maxIter; n++) {
    const nx = x * x - y * y + cx;
    y = 2 * x * y + cy;
    x = nx;
    out[2 * n] = x;
    out[2 * n + 1] = y;
    if (x * x + y * y > 1e6) {
      n++;
      break;
    }
  }
  return n; // number of entries written
}
