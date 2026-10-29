/**
 * Seeded generators for the standing fuzz suites (security seat, 2026-10-19:
 * hand-rolled, no fuzz dependency). A seed makes a red run replay exactly —
 * the failing input is in the assertion message, the seed in the file.
 */

/** mulberry32 — a tiny seeded PRNG returning floats in [0, 1). Pure per seed. */
export const prng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** One element of a list, chosen by the generator. */
export const pick = (r, list) => list[Math.floor(r() * list.length)];

/** The text with each letter's case flipped at the given rate. */
export const flipCase = (r, text, rate = 0.4) => [...text]
  .map((ch) => (r() < rate ? (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()) : ch)).join('');

/**
 * A respelling of an absolute POSIX path that resolves to the same place:
 * `./` and `name/..` hops between segments, doubled slashes, an optional
 * trailing slash. Case is kept — callers flip it separately when the
 * property they test is case-folded.
 */
export const respellPath = (r, target) => {
  const parts = target.split('/').filter(Boolean);
  const out = [];
  for (const part of parts) {
    if (r() < 0.25) out.push('.');
    if (r() < 0.2) out.push(`hop${Math.floor(r() * 9)}`, '..');
    out.push(part);
  }
  const joined = out.map((seg) => (r() < 0.2 ? `${seg}/` : seg)).join('/');
  return `/${joined}${r() < 0.2 ? '/' : ''}`;
};
