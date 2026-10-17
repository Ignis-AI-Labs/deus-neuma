/**
 * Nāmakaraṇa — the 108 nakshatra-pada name syllables (avakahada chakra).
 *
 * The ancient precedent for the moment palette (MANY SKIES §4): the janma
 * nakshatra pada prescribes a name's opening sound; the family chooses
 * freely from there. SOURCE-VERIFIED 2026-07-24 against five independent
 * tables (Drik Panchang, Wikipedia raw, Himalayan Academy, OnlineJyotish,
 * VedicFeed): 101/108 entries unanimous, and the table self-validates —
 * syllables run in vowel-order chains (a-i-u-e-o) across consecutive padas,
 * which confirmed every majority reading and exposed every outlier.
 *
 * Honesty carried in-data: contested entries hold their alternates and the
 * tradition that carries them (Shravana splits North/panchanga vs South;
 * Purva Ashadha 3 pha/bha; Uttara Bhadrapada 4 ña is the most contested).
 * Primary = the North-Indian panchanga reading (Drik Panchang Devanagari).
 * Simple Latin, no diacritics — retroflex/dental pairs collapse (the
 * research's collision note), which is acceptable for a SOUND palette.
 */

// 27 rows in standard order (Ashwini … Revati), 4 padas each.
const T = Object.freeze;
export const NAMAKARANA = T([
  T({ nakshatra: 'Ashwini', padas: T(['Chu', 'Che', 'Cho', 'La']) }),
  T({ nakshatra: 'Bharani', padas: T(['Li', 'Lu', 'Le', 'Lo']) }),
  T({ nakshatra: 'Krittika', padas: T(['A', 'I', 'U', 'E']) }),
  T({ nakshatra: 'Rohini', padas: T(['O', 'Va', 'Vi', 'Vu']) }),
  T({ nakshatra: 'Mrigashira', padas: T(['Ve', 'Vo', 'Ka', 'Ki']) }),
  T({ nakshatra: 'Ardra', padas: T(['Ku', 'Gha', 'Nga', 'Chha']) }),
  T({ nakshatra: 'Punarvasu', padas: T(['Ke', 'Ko', 'Ha', 'Hi']) }),
  T({ nakshatra: 'Pushya', padas: T(['Hu', 'He', 'Ho', 'Da']) }),
  T({ nakshatra: 'Ashlesha', padas: T(['Di', 'Du', 'De', 'Do']) }),
  T({ nakshatra: 'Magha', padas: T(['Ma', 'Mi', 'Mu', 'Me']) }),
  T({ nakshatra: 'Purva Phalguni', padas: T(['Mo', 'Ta', 'Ti', 'Tu']) }),
  T({ nakshatra: 'Uttara Phalguni', padas: T(['Te', 'To', 'Pa', 'Pi']) }),
  T({ nakshatra: 'Hasta', padas: T(['Pu', 'Sha', 'Na', 'Tha']) }),
  T({ nakshatra: 'Chitra', padas: T(['Pe', 'Po', 'Ra', 'Ri']) }),
  T({ nakshatra: 'Swati', padas: T(['Ru', 'Re', 'Ro', 'Ta']) }),
  T({ nakshatra: 'Vishakha', padas: T(['Ti', 'Tu', 'Te', 'To']) }),
  T({ nakshatra: 'Anuradha', padas: T(['Na', 'Ni', 'Nu', 'Ne']) }),
  T({ nakshatra: 'Jyeshtha', padas: T(['No', 'Ya', 'Yi', 'Yu']) }),
  T({ nakshatra: 'Mula', padas: T(['Ye', 'Yo', 'Bha', 'Bhi']) }),
  T({
    nakshatra: 'Purva Ashadha', padas: T(['Bhu', 'Dha', 'Pha', 'Dha']),
    contested: T({ 3: T({ alternates: T(['Bha']), note: 'फा read pha (panchanga) or bha (South)' }) }),
  }),
  T({ nakshatra: 'Uttara Ashadha', padas: T(['Bhe', 'Bho', 'Ja', 'Ji']) }),
  T({
    nakshatra: 'Shravana', padas: T(['Khi', 'Khu', 'Khe', 'Kho']),
    contested: T({
      1: T({ alternates: T(['Ju']), note: 'North/panchanga vs South tradition split' }),
      2: T({ alternates: T(['Je']), note: 'North/panchanga vs South tradition split' }),
      3: T({ alternates: T(['Jo']), note: 'North/panchanga vs South tradition split' }),
      4: T({ alternates: T(['Gha', 'Kha', 'So']), note: 'North/panchanga vs South tradition split' }),
    }),
  }),
  T({ nakshatra: 'Dhanishtha', padas: T(['Ga', 'Gi', 'Gu', 'Ge']) }),
  T({ nakshatra: 'Shatabhisha', padas: T(['Go', 'Sa', 'Si', 'Su']) }),
  T({ nakshatra: 'Purva Bhadrapada', padas: T(['Se', 'So', 'Da', 'Di']) }),
  T({
    nakshatra: 'Uttara Bhadrapada', padas: T(['Du', 'Tha', 'Jha', 'Yna']),
    contested: T({ 4: T({ alternates: T(['Jna', 'Gya', 'Da', 'Tra']), note: 'ña-initial names are rare; many tables substitute' }) }),
  }),
  T({ nakshatra: 'Revati', padas: T(['De', 'Do', 'Cha', 'Chi']) }),
]);

/**
 * The prescribed sound for a janma nakshatra pada.
 * @param {number} nakshatraIndex - 1..27 (skies engine's jyotisha.nakshatra.index)
 * @param {number} pada - 1..4
 * @returns {{syllable: string, nakshatra: string, alternates?: string[], note?: string}|null}
 */
export const padaSyllable = (nakshatraIndex, pada) => {
  const row = NAMAKARANA[nakshatraIndex - 1];
  if (!row || pada < 1 || pada > 4) return null;
  const contested = row.contested?.[pada];
  return {
    syllable: row.padas[pada - 1],
    nakshatra: row.nakshatra,
    ...(contested ? { alternates: [...contested.alternates], note: contested.note } : {}),
  };
};
