// Mouse, touch and keyboard input. `view` provides pan(dx, dy) and
// zoomAt(x, y, factor) in CSS pixels; onChange() is called after each change.

export function attachControls(canvas, view, onChange, keys = {}) {
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
  });

  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    if (pointers.size === 1) {
      view.pan(p.x - prev.x, p.y - prev.y);
      pointers.set(e.pointerId, p);
    } else if (pointers.size === 2) {
      pointers.set(e.pointerId, p);
      const next = pinchInfo();
      view.pan(next.x - pinch.x, next.y - pinch.y);
      view.zoomAt(next.x, next.y, pinch.d / next.d);
      pinch = next;
    } else {
      pointers.set(e.pointerId, p);
      return;
    }
    onChange();
  });

  const release = (e) => {
    pointers.delete(e.pointerId);
    pinch = pointers.size === 2 ? pinchInfo() : null;
    if (pointers.size === 0) canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? 600 : 1;
    const p = local(e);
    view.zoomAt(p.x, p.y, Math.exp(e.deltaY * unit * 0.0015));
    onChange();
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => {
    const p = local(e);
    view.zoomAt(p.x, p.y, e.shiftKey ? 2 : 0.5);
    onChange();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const step = Math.min(w, h) * 0.1;
    switch (e.key) {
      case 'ArrowLeft': case 'a': view.pan(step, 0); break;
      case 'ArrowRight': case 'd': view.pan(-step, 0); break;
      case 'ArrowUp': case 'w': view.pan(0, step); break;
      case 'ArrowDown': case 's': view.pan(0, -step); break;
      case '+': case '=': view.zoomAt(w / 2, h / 2, 0.8); break;
      case '-': case '_': view.zoomAt(w / 2, h / 2, 1.25); break;
      default: {
        const handler = keys[e.key.toLowerCase()];
        if (!handler) return;
        handler();
      }
    }
    e.preventDefault();
    onChange();
  });
}
