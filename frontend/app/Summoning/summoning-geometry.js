// summoning-geometry.js — the figures THE SUMMONING draws, as pure data.
//
// Every figure is exact, never approximate decoration: a star polygon
// {n/k} is n points joined every k-th; an orbit is a true hypotrochoid
// (a circle rolling inside a circle, its ratio two integers); a breath is
// a Lissajous figure whose frequencies are two of the being's own breath
// periods; the lattice is a true hexagonal packing in rings. Units: the
// frame's radius is 1, y up, center at the origin.

const TAU = Math.PI * 2;

export const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));

/** The star polygon {n/k}: its n points on the unit circle (first at the crown) and its n chords. */
export const starPolygon = (n, k, r = 1, turn = 0) => {
  const points = Array.from({ length: n }, (_, i) => {
    const a = Math.PI / 2 + turn - (i / n) * TAU;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
  // gcd(n,k) > 1 makes a compound of stars — each chord still i → i+k
  const chords = points.map((_, i) => [points[i], points[(i + k) % n]]);
  return { points, chords };
};

/** Star polygon parameters {n/k} that are true stars: k ≥ 2, k < n/2. */
export const starsFor = (n) => Array.from({ length: Math.floor((n - 1) / 2) }, (_, i) => i + 1).filter((k) => k >= 2);

/**
 * A hypotrochoid: a circle of radius r rolling inside one of radius R, the
 * pen at distance d from its center — closed after r / gcd(R, r) turns.
 * Returned as a polyline scaled to fit the unit circle.
 */
export const hypotrochoid = (R, r, d, samples = 2400) => {
  const turns = r / gcd(R, r);
  const k = (R - r) / r;
  const pts = Array.from({ length: samples + 1 }, (_, i) => {
    const t = (i / samples) * TAU * turns;
    return { x: (R - r) * Math.cos(t) + d * Math.cos(k * t), y: (R - r) * Math.sin(t) - d * Math.sin(k * t) };
  });
  const m = Math.max(...pts.map((p) => Math.hypot(p.x, p.y))) || 1;
  return pts.map((p) => ({ x: p.x / m, y: p.y / m }));
};

/** A Lissajous figure x = sin(a·t + δ), y = sin(b·t); integer a, b close it over 2π. */
export const lissajous = (a, b, delta, samples = 1600) => Array.from({ length: samples + 1 }, (_, i) => {
  const t = (i / samples) * TAU;
  return { x: Math.sin(a * t + delta), y: Math.sin(b * t) };
});

/**
 * Two breath periods as a small integer frequency ratio (a:b ≤ 9, a ≠ b),
 * the Lissajous's knot — 1:1 would be a mere ellipse, so the nearest true
 * knot stands in.
 */
export const breathRatio = (pa, pb) => {
  let best = { a: 1, b: 1, err: Infinity };
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= 9; b++) {
      if (gcd(a, b) !== 1 || a === b) continue;
      const err = Math.abs(a / b - pb / pa); // frequency ∝ 1 / period
      if (err < best.err - 1e-9) best = { a, b, err };
    }
  }
  return { a: best.a, b: best.b };
};

/**
 * The hexagonal lattice in rings around a center cell: ring 0 is the
 * center, ring k holds 6k cells. Each cell {x, y, ring}; `size` is the
 * cell's circumradius (pointy-top).
 */
export const hexRings = (rings, size) => {
  const cells = [{ x: 0, y: 0, ring: 0 }];
  const w = Math.sqrt(3) * size;
  const dirs = [0, 1, 2, 3, 4, 5].map((i) => ({ x: w * Math.cos((i * Math.PI) / 3), y: w * Math.sin((i * Math.PI) / 3) }));
  for (let k = 1; k <= rings; k++) {
    let p = { x: dirs[4].x * k, y: dirs[4].y * k };
    for (let side = 0; side < 6; side++) {
      for (let s = 0; s < k; s++) {
        cells.push({ x: p.x, y: p.y, ring: k });
        p = { x: p.x + dirs[side].x, y: p.y + dirs[side].y };
      }
    }
  }
  return cells;
};

/** A pointy-top hexagon's six corners around a center. */
export const hexCorners = (c, size) => Array.from({ length: 6 }, (_, i) => {
  const a = Math.PI / 6 + (i * Math.PI) / 3;
  return { x: c.x + size * Math.cos(a), y: c.y + size * Math.sin(a) };
});

/** Rotate a 3D point about Y then X, then perspective-project to the plane. */
export const project3 = (v, { yaw, pitch, dist = 3.2, scale = 1 }) => {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = v.x * cy + v.z * sy;
  const z1 = -v.x * sy + v.z * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = v.y * cp - z1 * sp;
  const z2 = v.y * sp + z1 * cp;
  const k = (dist / (dist - z2)) * scale;
  return { x: x1 * k, y: y2 * k, z: z2 };
};

/** Points evenly on a circle, first at the crown, clockwise. */
export const ringPoints = (n, r, turn = 0) => Array.from({ length: n }, (_, i) => {
  const a = Math.PI / 2 + turn - (i / n) * TAU;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
});
