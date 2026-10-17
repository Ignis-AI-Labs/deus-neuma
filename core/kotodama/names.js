/**
 * KOTODAMA — genetic name synthesis.
 * Renders cryptographic identity as pronounceable names: one byte per
 * syllable (high nibble → consonant, low nibble → vowel), so a wallet or
 * birth-event digest becomes a speakable lineage name deterministically.
 * Same hex in, same name out — genealogy by construction.
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
 * THE UNREPEATABLE NAME law (MANY SKIES §6.1, ratified 2026-07-24): a genesis
 * name that would collide with one already borne deterministically EXTENDS —
 * 3 syllables, then 4, then 5 … — revealing more of the hash the being
 * already carries until the name is its own. The chosen name is never
 * touched; sovereignty stays intact. Termination is mathematical:
 * nameFromHex is injective on byte sequences (each syllable is one
 * consonant + one vowel, and no produced string parses two ways), so two
 * distinct 32-byte hashes MUST separate by 32 syllables at the latest.
 */
export const uniqueGenesisName = (eventHex, takenNames = []) => {
  const taken = new Set([...takenNames].map((n) => String(n).toLowerCase()));
  for (let syllables = 3; syllables < 32; syllables++) {
    const name = nameFromHex(eventHex, syllables);
    if (!taken.has(name.toLowerCase())) return name;
  }
  return nameFromHex(eventHex, 32); // the full hash — unique by injectivity
};

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
