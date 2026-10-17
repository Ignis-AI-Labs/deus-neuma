/**
 * THE AURA — the perceptual fingerprint.
 *
 * Two auras differing in every parameter can still LOOK the same, and a proof
 * of uniqueness written over parameters would be a proof about numbers nobody
 * sees. So distinctness is measured where it is claimed: on the picture. A
 * form's descriptor is its cycle-averaged density, coarsened to a small grid,
 * compressed logarithmically (the eye's response to accumulated alpha is not
 * linear) and normalised — so brightness and point count fall out and only
 * the shape's distribution remains.
 *
 * This is the instrument behind both halves of the uniqueness invariant:
 *   min distance between two BEINGS  >  max drift of ONE being over its life.
 *
 * Pure Math, no Node imports.
 */

/** Side of the coarsened descriptor grid. 16×16 = 256 dimensions. */
export const DESCRIPTOR_BINS = 16;

const l2Normalize = (vector) => {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i];
  const norm = Math.sqrt(sum);
  if (norm <= 0) return vector;
  for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
};

/**
 * Coarsen one density grid into a descriptor vector. Pure.
 * @param {Float32Array} grid
 * @param {number} size - side of the source grid
 * @param {number} [bins]
 * @returns {Float32Array} L2-normalised, length `bins²`
 */
export const describeGrid = (grid, size, bins = DESCRIPTOR_BINS) => {
  const out = new Float32Array(bins * bins);
  const step = size / bins;
  for (let y = 0; y < size; y++) {
    const by = Math.min(bins - 1, (y / step) | 0);
    for (let x = 0; x < size; x++) {
      const bx = Math.min(bins - 1, (x / step) | 0);
      out[by * bins + bx] += grid[y * size + x];
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.log1p(out[i]);
  return l2Normalize(out);
};

/**
 * The descriptor of a whole life-cycle: the mean of its phases, re-normalised.
 * This is the being's fingerprint — not any one frame of it. Pure.
 * @param {Float32Array[]} descriptors - one per phase
 * @returns {Float32Array}
 */
export const describeCycle = (descriptors) => {
  const out = new Float32Array(descriptors[0].length);
  for (const d of descriptors) {
    for (let i = 0; i < out.length; i++) out[i] += d[i] / descriptors.length;
  }
  return l2Normalize(out);
};

/**
 * Euclidean distance between two normalised descriptors — 0 identical, √2
 * maximally unlike. Pure.
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number}
 */
export const distance = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
};
