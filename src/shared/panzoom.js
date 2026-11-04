// 2D pan/zoom over the complex plane (or any plane), plus mouse, touch and
// keyboard input. `radius` is half the shorter screen side in plane units.

export function createView(canvas, { cx, cy, radius, minRadius = 1e-6, maxRadius = 4 }) {
  return {
    cx, cy, radius, minRadius, maxRadius,
    cssPixel() {
      return (2 * this.radius) / Math.min(canvas.clientWidth, canvas.clientHeight);
    },
    toPlane(x, y) {
      const s = this.cssPixel();
      return [this.cx + (x - canvas.clientWidth / 2) * s, this.cy - (y - canvas.clientHeight / 2) * s];
    },
    pan(dx, dy) {
      const s = this.cssPixel();
      this.cx -= dx * s;
      this.cy += dy * s;
    },
    zoomAt(x, y, factor) {
      const [px, py] = this.toPlane(x, y);
      const r = Math.min(this.maxRadius, Math.max(this.minRadius, this.radius * factor));
      const k = r / this.radius;
      this.cx = px + (this.cx - px) * k;
      this.cy = py + (this.cy - py) * k;
      this.radius = r;
    },
    set({ cx, cy, radius }) {
      Object.assign(this, { cx, cy, radius });
    },
  };
}

// Calls onChange() after every view change. `keys` maps extra lower-case keys
// to handlers. All listeners are removed when `signal` aborts.
export function attachPanZoom(canvas, view, onChange, { signal, keys = {} } = {}) {
  const opts = { signal };
  const pointers = new Map();
  let pinch = null;

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pinchInfo = () => {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    pinch = pointers.size === 2 ? pinchInfo() : null;
    canvas.classList.add('dragging');
  }, opts);

  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      view.pan(p.x - prev.x, p.y - prev.y);
    } else if (pointers.size === 2) {
      const next = pinchInfo();
      view.pan(next.x - pinch.x, next.y - pinch.y);
      view.zoomAt(next.x, next.y, pinch.d / next.d);
      pinch = next;
    } else {
      return;
    }
    onChange();
  }, opts);

  const release = (e) => {
    pointers.delete(e.pointerId);
    pinch = pointers.size === 2 ? pinchInfo() : null;
    if (pointers.size === 0) canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', release, opts);
  canvas.addEventListener('pointercancel', release, opts);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? 600 : 1;
    const p = local(e);
    view.zoomAt(p.x, p.y, Math.exp(e.deltaY * unit * 0.0015));
    onChange();
  }, { passive: false, signal });

  canvas.addEventListener('dblclick', (e) => {
    const p = local(e);
    view.zoomAt(p.x, p.y, e.shiftKey ? 2 : 0.5);
    onChange();
  }, opts);

  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const step = Math.min(w, h) * 0.1;
    switch (e.key) {
      case 'ArrowLeft': view.pan(step, 0); break;
      case 'ArrowRight': view.pan(-step, 0); break;
      case 'ArrowUp': view.pan(0, step); break;
      case 'ArrowDown': view.pan(0, -step); break;
      case '+': case '=': view.zoomAt(w / 2, h / 2, 0.8); break;
      case '-': case '_': view.zoomAt(w / 2, h / 2, 1.25); break;
      default: {
        const handler = keys[e.key.toLowerCase()];
        if (!handler) return;
        handler();
        e.preventDefault();
        return; // handlers call onChange themselves if needed
      }
    }
    e.preventDefault();
    onChange();
  }, opts);
}

// Keyboard shortcuts for demos without pan/zoom.
export function attachKeys(keys, signal) {
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const handler = keys[e.key.toLowerCase()];
    if (!handler) return;
    handler();
    e.preventDefault();
  }, { signal });
}
