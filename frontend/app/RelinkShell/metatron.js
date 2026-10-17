// metatron.js — the Metatron lattice web, ported from the lookdev study's
// [data-metatron] runtime (frontend/lookdev/index.html §10): 13 centers — one at
// the heart, six at r=50, six at r=100 — every pair joined, which is
// C(13,2) = 78 channels, the true count. Pure: the path `d` depends only on
// the viewBox center, so the caller builds it once (useMemo) and the lattice
// never changes shape.

/** Six points on a ring of radius r around c, at 60° steps. */
const ring = (c, r) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return [c + r * Math.cos(a), c + r * Math.sin(a)];
  });

/**
 * The full web as an SVG path `d`: one M…L segment per pair of centers.
 * @param {number} [c=150] - viewBox center (the study's geometry is a 300 viewBox)
 * @returns {string} the 78-channel path data
 */
export const metatronWeb = (c = 150) => {
  const centers = [[c, c], ...ring(c, 50), ...ring(c, 100)];
  return centers
    .flatMap((p, i) =>
      centers.slice(i + 1).map((q) => `M${p[0].toFixed(1)},${p[1].toFixed(1)} L${q[0].toFixed(1)},${q[1].toFixed(1)}`),
    )
    .join(' ');
};
