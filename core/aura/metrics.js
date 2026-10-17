/**
 * THE AURA — the measurements a verdict is built from.
 *
 * Every function here answers one question about a density grid, in units that
 * do not depend on grid size or point count, so a threshold tuned once holds
 * everywhere. Nothing here judges: gate.js does the judging. Keeping the two
 * apart is what makes it possible to re-tune taste without re-deriving a single
 * being's aura.
 *
 * Pure Math, no Node imports.
 */

/** Fraction of cells carrying any ink at all — is there a form, or a smear? */
const coverage = (grid) => {
  let lit = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] > 0) lit++;
  return lit / grid.length;
};

/**
 * How much of the ink piles into the single densest cell. A curve retraced
 * over itself concentrates; a living cloud spreads.
 */
const peakShare = (grid) => {
  let total = 0;
  let peak = 0;
  for (let i = 0; i < grid.length; i++) {
    total += grid[i];
    if (grid[i] > peak) peak = grid[i];
  }
  return total > 0 ? peak / total : 1;
};

/**
 * Ratio of the minor to the major axis of the ink's second moment. Near 0 is a
 * hairline (a form with no body); near 1 is a disc (a form with no direction).
 */
const anisotropy = (grid, size) => {
  let mass = 0, sx = 0, sy = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const w = grid[y * size + x];
      if (w <= 0) continue;
      mass += w; sx += w * x; sy += w * y;
    }
  }
  if (mass <= 0) return 0;
  const cx = sx / mass, cy = sy / mass;
  let mxx = 0, myy = 0, mxy = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const w = grid[y * size + x];
      if (w <= 0) continue;
      const dx = x - cx, dy = y - cy;
      mxx += w * dx * dx; myy += w * dy * dy; mxy += w * dx * dy;
    }
  }
  mxx /= mass; myy /= mass; mxy /= mass;
  const half = (mxx + myy) / 2;
  const root = Math.sqrt(Math.max(0, ((mxx - myy) / 2) ** 2 + mxy * mxy));
  const major = half + root;
  return major > 0 ? (half - root) / major : 0;
};

/**
 * Mean neighbour-to-neighbour contrast, normalised by mean density — the
 * internal structure the eye reads as texture. A uniform fog scores near 0.
 */
const detail = (grid, size) => {
  let mean = 0;
  for (let i = 0; i < grid.length; i++) mean += grid[i];
  mean /= grid.length;
  if (mean <= 0) return 0;
  let sum = 0, n = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size - 1; x++) {
      sum += Math.abs(grid[y * size + x] - grid[y * size + x + 1]); n++;
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size; x++) {
      sum += Math.abs(grid[y * size + x] - grid[(y + 1) * size + x]); n++;
    }
  }
  return sum / n / mean;
};

/**
 * Occupancy grown by one cell, 8-connected. Connectivity is judged on THIS,
 * not on the raw grid: a one-pixel gap in a point cloud is a sampling artefact,
 * not evidence of two creatures, and the eye closes it without noticing.
 * Measuring raw adjacency instead makes cohesion fall off a cliff — one form in
 * the sweep read 0.79 at rest and 0.40 after a 12% bend, because a thin bridge
 * between two lobes happened to break. Dilating first makes the measure
 * continuous exactly where perception is.
 */
const dilated = (grid, size) => {
  const mask = new Uint8Array(grid.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[y * size + x] <= 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < size && ny < size) mask[ny * size + nx] = 1;
        }
      }
    }
  }
  return mask;
};

/**
 * Share of the ink held by the largest connected region. One body scores near
 * 1; confetti — specks too far apart for the dilation to bridge — scores low.
 * This is what separates a creature from a scatter of unrelated fragments.
 */
export const cohesion = (grid, size) => {
  const mask = dilated(grid, size);
  const seen = new Uint8Array(grid.length);
  const stack = new Int32Array(grid.length);
  let total = 0;
  for (let i = 0; i < grid.length; i++) total += grid[i];
  if (total <= 0) return 0;

  let best = 0;
  for (let start = 0; start < grid.length; start++) {
    if (seen[start] || mask[start] === 0) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let mass = 0;
    while (top > 0) {
      const cell = stack[--top];
      mass += grid[cell]; // mass from the REAL ink; only reachability is dilated
      const cx = cell % size, cy = (cell / size) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const next = ny * size + nx;
          if (seen[next] || mask[next] === 0) continue;
          seen[next] = 1;
          stack[top++] = next;
        }
      }
    }
    if (mass > best) best = mass;
  }
  return best / total;
};

/** The longer side of the ink's bounding box, as a fraction of the frame. */
const extent = (grid, size) => {
  let minX = size, maxX = -1, minY = size, maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[y * size + x] <= 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return 0;
  return Math.max(maxX - minX + 1, maxY - minY + 1) / size;
};

/**
 * Every measurement of one phase, in one pass of intent. Pure.
 * @param {{grid:Float32Array, size:number, inside:number, count:number}} raster
 */
export const measure = ({ grid, size, finite, inside, count }) => Object.freeze({
  drawn: count > 0 ? finite / count : 0,
  framed: count > 0 ? inside / count : 0,
  coverage: coverage(grid),
  peakShare: peakShare(grid),
  anisotropy: anisotropy(grid, size),
  detail: detail(grid, size),
  cohesion: cohesion(grid, size),
  extent: extent(grid, size),
});
