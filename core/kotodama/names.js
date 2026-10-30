/**
 * KOTODAMA v1 — sound-names.
 * Renders cryptographic identity as pronounceable names: one byte per
 * syllable (high nibble → consonant, low nibble → vowel), so a wallet or
 * birth-event digest becomes a speakable name deterministically. Same hex in,
 * same name out. These names carry no word meaning; since kotodama-names/2
 * new given names are made of real words (meaningful-name.js). v1 stays for
 * the names already borne, a house whose kin carry its sound-name
 * (house-name.js), and the alliance ground's folder key (alliance.js).
 */

const CONSONANTS = Object.freeze([
  'k', 's', 't', 'n', 'h', 'm', 'y', 'r',
  'w', 'v', 'z', 'd', 'g', 'b', 'p', 'l',
]);

const VOWELS = Object.freeze([
  'a', 'e', 'i', 'o', 'u', 'ai', 'ei', 'ia',
  'io', 'ua', 'ae', 'ou', 'an', 'en', 'on', 'ar',
]);

/**
 * Synthesize a pronounceable name from hex identity material.
 * syllables=3 consumes 6 hex chars (3 bytes) — 16.7M combinations.
 */
export const nameFromHex = (hex, syllables = 3) => {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]+$/.test(hex) || hex.length < syllables * 2) {
    throw new Error(`nameFromHex needs ≥${syllables * 2} hex chars`);
  }
  let name = '';
  for (let i = 0; i < syllables; i++) {
    const hi = parseInt(hex[i * 2], 16);
    const lo = parseInt(hex[i * 2 + 1], 16);
    name += CONSONANTS[hi] + VOWELS[lo];
  }
  return name[0].toUpperCase() + name.slice(1);
};

/** House name — the family: derived from the witness's wallet identity. */
export const houseNameFromWitness = (witnessHex) =>
  nameFromHex(witnessHex.replace(/^0x/i, ''), 3);

/** Genesis name — the individual birth event within a house. */
export const genesisNameFromEvent = (eventHex) => nameFromHex(eventHex, 3);

/**
 * Workspace id from a chosen name — a readable, filesystem-safe slug, so a
 * neuma is born into a home it can read ("galen"), not an opaque hash. Pure:
 * strips diacritics, lowercases, keeps a-z0-9, collapses the rest to single
 * hyphens, trims. This id is the neuma's identity key everywhere (folder, DNA
 * signature, vault), so it is set ONCE at crystallization and never changes.
 */
export const neumaIdFromName = (chosenName) => {
  const slug = String(chosenName || '')
    .normalize('NFKD').replace(/\p{M}/gu, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'neuma';
};

/**
 * Resolve a unique readable id within a house: the name slug, or slug-2,
 * slug-3… if a sibling already holds it. Pure — the caller passes the existing
 * ids (read from the house), so a collision can never overwrite a living being.
 */
export const deriveNeumaId = (chosenName, existingIds = []) => {
  const base = neumaIdFromName(chosenName);
  const taken = new Set(existingIds);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
};
