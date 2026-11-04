// requestAnimationFrame loop that stops when `signal` aborts.
export function startLoop(signal, tick) {
  let last = performance.now();
  let id = requestAnimationFrame(function frame(now) {
    if (signal.aborted) return;
    id = requestAnimationFrame(frame);
    const dt = Math.min(now - last, 100);
    last = now;
    tick(now, dt);
  });
  signal.addEventListener('abort', () => cancelAnimationFrame(id));
}

// Lowers render resolution while things move if frames get slow, and goes
// back to full resolution once the view is still.
export class AdaptiveScale {
  constructor({ min = 0.3, slowMs = 34, fastMs = 21 } = {}) {
    Object.assign(this, { min, slowMs, fastMs, scale: 1, fps: 0, renderedLast: false });
  }

  // Call once per frame. Returns the resolution factor to render at.
  update(dt, moving) {
    if (moving && this.renderedLast) {
      if (dt > this.slowMs) this.scale = Math.max(this.min, this.scale * 0.88);
      else if (dt < this.fastMs) this.scale = Math.min(1, this.scale * 1.06);
      this.fps = this.fps ? this.fps * 0.9 + (1000 / dt) * 0.1 : 1000 / dt;
    }
    return moving ? this.scale : 1;
  }

  describe(moving, target) {
    return moving
      ? `${this.fps ? Math.round(this.fps) : '—'} fps · ${Math.round(target * 100)}% res`
      : 'idle · full res';
  }
}

export const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
