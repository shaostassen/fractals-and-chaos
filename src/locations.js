// Named places worth visiting. radius = half the shorter screen side, in
// complex-plane units.
export const LOCATIONS = [
  { name: 'Whole set', cx: -0.6, cy: 0, radius: 1.3 },
  { name: 'Seahorse Valley', cx: -0.7453, cy: 0.1127, radius: 0.0065 },
  { name: 'Elephant Valley', cx: 0.285, cy: 0.0115, radius: 0.004 },
  { name: 'Mini Mandelbrot', cx: -1.7548776662466927, cy: 0, radius: 0.028 },
  { name: 'Deep spiral', cx: -0.7746806106269039, cy: -0.1374168856037867, radius: 2.5e-11 },
  { name: 'Double spiral', cx: -0.10109636384562, cy: 0.95628651080914, radius: 4e-12 },
];

// Where the zoom tour heads.
export const TOUR_TARGET = { cx: -0.743643887037151, cy: 0.13182590420533 };
