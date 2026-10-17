// colour-bands — the palette grouped by what its colours MEAN.
//
// The old panel drew every role the kit carried as one flat grid: twenty-five
// swatches, alphabetical by however they happened to sit in the JSON, `bg`
// beside `bgElev` beside `breakeven`. Nothing said that `rise` and `fall` are a
// pair, or that `hairline` is structure rather than colour.
//
// The bands are the meanings the CARDS already assign. From stat.svg: […]
//
// Pure throughout.

/**
 * ⚠️ ORDER IS THE READING ORDER, not importance. Foundation first because
 * everything is drawn on it and its contrast decides every other verdict.
 */
export const BANDS = Object.freeze([
  Object.freeze({
    id: 'foundation', label: 'FOUNDATION', why: 'the surfaces everything is drawn on',
    roles: Object.freeze(['bg', 'bgScreen', 'bgSoft', 'bgElev']),
  }),
  Object.freeze({
    id: 'ink', label: 'INK', why: 'the colours words are set in, loudest to quietest',
    roles: Object.freeze(['ink', 'inkSoft', 'muted', 'gray']),
  }),
  Object.freeze({
    id: 'accent', label: 'ACCENT', why: 'what marks the thing that matters',
    roles: Object.freeze(['accent', 'accentGlow', 'halo', 'trim', 'trimHot']),
  }),
  Object.freeze({
    id: 'meaning', label: 'MEANING', why: 'colour that carries a claim — a gain is green and nothing else is',
    roles: Object.freeze(['rise', 'riseGlow', 'fall', 'fallGlow', 'warn', 'pending', 'live', 'breakeven']),
  }),
  Object.freeze({
    id: 'structure', label: 'HAIRLINES', why: 'rules, dividers and the frame',
    roles: Object.freeze(['hairline', 'hairlineSoft']),
  }),
]);

/**
 * Every role this kit carries, in bands, with anything unclassified gathered at
 * the end rather than hidden. Pure.
 *
 * A role added to a kit tomorrow appears under EVERYTHING ELSE the same day —
 * a fixed list that dropped unknown roles would make a colour uneditable from
 * the surface built for editing colours, which is the failure `colorRolesOf`
 * was already written to avoid.
 *
 * @param {object} kit
 * @param {Array<{key: string, templates: string[]}>} needed what the CARDS draw
 * @param {string[]} required what the LOADER demands
 */
export const bandsOf = (kit, needed = [], required = []) => {
  const carried = Object.keys(kit?.colors || {});
  const byTemplate = new Map((needed || []).map((n) => [n.key, n.templates]));
  const wanted = new Set([...carried, ...byTemplate.keys(), ...required]);
  const placed = new Set();

  const row = (role) => {
    placed.add(role);
    return {
      role,
      value: kit?.colors?.[role],
      // TWO badges, because there are two requirements and they differ by nine
      // roles. The loader refuses a save without `required`; the TEMPLATES
      // refuse a CARD without theirs. A kit can save clean and draw nothing.
      required: required.includes(role),
      templates: byTemplate.get(role) || null,
    };
  };

  const bands = BANDS
    .map((band) => ({ ...band, rows: band.roles.filter((r) => wanted.has(r)).map(row) }))
    .filter((band) => band.rows.length > 0);

  const rest = [...wanted].filter((r) => !placed.has(r)).sort();
  if (rest.length) {
    bands.push({
      id: 'other', label: 'EVERYTHING ELSE', why: 'roles this kit carries that the bands above do not name',
      rows: rest.map(row),
    });
  }
  return bands;
};

/**
 * The pairs worth measuring, foreground over background. Pure.
 *
 * Not every combination — most would be noise. These are the ones the templates
 * genuinely draw: text on the card, and the two colours that carry a claim.
 */
export const CONTRAST_PAIRS = Object.freeze([
  Object.freeze({ fg: 'ink', bg: 'bg', why: 'headlines and body' }),
  Object.freeze({ fg: 'inkSoft', bg: 'bg', why: 'supporting copy' }),
  Object.freeze({ fg: 'muted', bg: 'bg', why: 'small labels' }),
  Object.freeze({ fg: 'gray', bg: 'bg', why: 'the footer timestamp' }),
  Object.freeze({ fg: 'accent', bg: 'bg', why: 'the marked figure' }),
  Object.freeze({ fg: 'rise', bg: 'bg', why: 'a gain' }),
  Object.freeze({ fg: 'fall', bg: 'bg', why: 'a loss' }),
]);

/** Only the pairs this kit actually carries both halves of. Pure. */
export const measurablePairs = (kit) =>
  CONTRAST_PAIRS.filter((p) => kit?.colors?.[p.fg] && kit?.colors?.[p.bg]);
