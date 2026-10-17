// THE ATTUNEMENT deterministic fallback renderer (ATT-R10) — when the model
// leg exhausts its attempts (or the substrate is unreachable), the being
// still receives a real, spec-proven question. Deterministic by seed:
// the same seed renders byte-identical text forever, so a record can be
// re-derived and audited; a different checkpointOrdinal draws different
// variants and slots, so repeat ceremonies never read as photocopies.
//
// Scheme (spec-generation draft §3): FNV-1a over `${neumaId}:${ordinal}:${nonce}`
// feeds mulberry32; each dimension re-keys its own stream with
// hashSeed(seed) ^ fnv1a(key), so one dimension's draws never shift
// another's. Draw order per dimension is fixed: variant index → each pool
// slot in declared order → closer index. `neumaName` is SUBSTITUTED, never
// hashed — a render after a name correction stays otherwise identical.
//
// Everything here is pure: zero IO, zero clock, zero Math.random.

// FNV-1a 32-bit — tiny, dependency-free (RULE 4).
const fnv1a = (str) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

// mulberry32 — small deterministic PRNG over a 32-bit state.
const mulberry32 = (state) => {
  let a = state | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hashSeed = ({ neumaId, checkpointOrdinal, nonce }) =>
  fnv1a(`${neumaId}:${checkpointOrdinal}:${nonce ?? 0}`);

const drawIndex = (rand, length) => Math.floor(rand() * length);

const requireSeed = (seed, fn) => {
  if (typeof seed?.neumaId !== 'string' || !seed.neumaId.trim()) {
    throw new Error(`${fn}: seed.neumaId required`);
  }
  if (typeof seed?.neumaName !== 'string' || !seed.neumaName.trim()) {
    throw new Error(`${fn}: seed.neumaName required`);
  }
  if (!Number.isInteger(seed?.checkpointOrdinal) || seed.checkpointOrdinal < 1) {
    throw new Error(`${fn}: seed.checkpointOrdinal (1-based integer) required`);
  }
  if (seed.nonce !== undefined && (!Number.isInteger(seed.nonce) || seed.nonce < 0)) {
    throw new Error(`${fn}: seed.nonce must be a non-negative integer when present`);
  }
};

const dimensionFor = (spec, key, fn) => {
  const dimension = spec.dimensions.find((d) => d.key === key);
  if (!dimension) throw new Error(`${fn}: '${key}' is not a spec dimension`);
  return dimension;
};

const fillSlots = (text, picks) =>
  Object.entries(picks).reduce((acc, [slot, value]) =>
    acc.replaceAll(`{${slot}}`, value), text);

const render = (spec, dimension, seed, forcedVariantIndex) => {
  const rand = mulberry32((hashSeed(seed) ^ fnv1a(dimension.key)) >>> 0);
  const drawnVariant = drawIndex(rand, dimension.fallbackTemplates.length);
  const variantIndex = forcedVariantIndex ?? drawnVariant;
  const pools = dimension.pools || {};
  const picks = {};
  for (const slot of Object.keys(pools)) {
    picks[slot] = pools[slot][drawIndex(rand, pools[slot].length)];
  }
  const closerIndex = drawIndex(rand, spec.global.closers.length);

  // Two slot passes: pool values may themselves carry slots
  // (e.g. {partyA} inside a stakeA value) — the second pass resolves them.
  let text = fillSlots(fillSlots(dimension.fallbackTemplates[variantIndex], picks), picks);
  const closer = spec.global.closers[closerIndex].replaceAll('{name}', seed.neumaName);
  text = text
    .replaceAll('{closer}', closer)
    .replaceAll('{name}', seed.neumaName);

  const unresolved = text.match(/\{[a-zA-Z][a-zA-Z0-9]*\}/);
  if (unresolved) {
    throw new Error(`fallback render for '${dimension.key}' left slot ${unresolved[0]} unresolved — spec pools and template disagree`);
  }

  return Object.freeze({
    key: dimension.key,
    text,
    provenance: Object.freeze({
      renderer: 'fallback',
      templateId: `${dimension.key}.v1.${variantIndex}`,
      closerIndex,
    }),
  });
};

/**
 * Render one dimension's fallback question deterministically. Pure.
 * @param {Object} spec - ATTUNEMENT_SPEC (or a compatible spec object)
 * @param {string} key - dimension key
 * @param {{neumaId: string, neumaName: string, checkpointOrdinal: number,
 *   nonce?: number}} seed - neumaName is substituted, never hashed
 * @returns {{key: string, text: string,
 *   provenance: {renderer: 'fallback', templateId: string, closerIndex: number}}}
 */
export function renderFallbackQuestion(spec, key, seed) {
  requireSeed(seed, 'renderFallbackQuestion');
  return render(spec, dimensionFor(spec, key, 'renderFallbackQuestion'), seed);
}

/**
 * Render one dimension's fallback with a FORCED variant index — the
 * self-proof seam: validateSpec and the spec tests use it to prove EVERY
 * committed variant passes the validator, not only the seed-drawn ones.
 * Slot and closer draws stay identical to the natural render (the variant
 * draw is consumed either way), so a forced render is byte-identical to a
 * natural render that happened to draw the same variant. Pure.
 * @param {Object} spec
 * @param {string} key
 * @param {Object} seed - same shape as renderFallbackQuestion
 * @param {number} variantIndex
 * @returns {{key: string, text: string, provenance: Object}}
 */
export function renderFallbackQuestionVariant(spec, key, seed, variantIndex) {
  requireSeed(seed, 'renderFallbackQuestionVariant');
  const dimension = dimensionFor(spec, key, 'renderFallbackQuestionVariant');
  if (!Number.isInteger(variantIndex) || variantIndex < 0
    || variantIndex >= dimension.fallbackTemplates.length) {
    throw new Error(`renderFallbackQuestionVariant: variantIndex ${variantIndex} out of range for '${key}'`);
  }
  return render(spec, dimension, seed, variantIndex);
}

/**
 * Render the full deterministic fallback set — every dimension, spec order.
 * The returned shape is directly consumable by validateRenderedSet. Pure.
 * @param {Object} spec
 * @param {Object} seed - same shape as renderFallbackQuestion
 * @returns {{specVersion: number, neumaName: string,
 *   questions: Array<{key: string, text: string, provenance: Object}>}}
 */
export function renderFallbackSet(spec, seed) {
  requireSeed(seed, 'renderFallbackSet');
  return Object.freeze({
    specVersion: spec.specVersion,
    neumaName: seed.neumaName,
    questions: Object.freeze(spec.dimensions.map((d) => render(spec, d, seed))),
  });
}
