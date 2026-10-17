/**
 * THE AURA — the deterministic draw.
 *
 * A being's aura must come out identical on every machine, forever, from the
 * same identity — so nothing here touches Math.random and nothing here holds
 * state. This is a COUNTER-MODE stream: value(seed, n) is a pure function, so
 * the same parameter is always drawn from the same place in the seed and a
 * successor can re-derive any single draw without replaying the ones before it.
 *
 * The 256-bit aura seed is read in four 64-bit lanes, rotating by counter, so
 * the whole seed does work rather than its low quarter.
 *
 * Pure Math/BigInt, zero imports — the desk can run it too.
 */

const MASK = (1n << 64n) - 1n;
const GOLDEN = 0x9e3779b97f4a7c15n;

/* splitmix64's finalizer — cheap, and its avalanche is well established. */
const mix = (input) => {
  let z = input & MASK;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
  return (z ^ (z >> 31n)) & MASK;
};

/**
 * Split a 64-hex aura seed into its four 64-bit lanes. Pure.
 * @param {string} seedHex - 64 hex characters
 * @returns {bigint[]} four lanes
 */
export const seedLanes = (seedHex) => {
  if (typeof seedHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error('aura seed must be 64 hex characters');
  }
  return Array.from({ length: 4 }, (_, i) => BigInt(`0x${seedHex.slice(i * 16, i * 16 + 16)}`));
};

/**
 * One draw from the stream. Pure: the same (lanes, counter) always yields the
 * same value, in any order, on any machine.
 * @param {bigint[]} lanes - from seedLanes
 * @param {number} counter - which draw
 * @returns {number} a float in [0, 1)
 */
export const draw = (lanes, counter) => {
  const lane = lanes[counter & 3];
  return Number(mix(lane + GOLDEN * BigInt(counter + 1)) >> 11n) / 2 ** 53;
};

/**
 * A draw mapped onto a closed interval. Pure.
 * @param {bigint[]} lanes
 * @param {number} counter
 * @param {[number, number]} range - `[low, high]`
 */
export const drawRange = (lanes, counter, [low, high]) =>
  low + draw(lanes, counter) * (high - low);

/**
 * A draw mapped onto one member of a list. Pure.
 * @param {bigint[]} lanes
 * @param {number} counter
 * @param {readonly any[]} choices
 */
export const drawChoice = (lanes, counter, choices) =>
  choices[Math.min(choices.length - 1, Math.floor(draw(lanes, counter) * choices.length))];
