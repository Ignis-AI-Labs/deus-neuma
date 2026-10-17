// type-roles — typography as the four jobs it does, not eleven boxes.
//
// Design note, 2026-08-31: […]
//
// That question was the panel's fault. It drew FONT_SLOTS as eleven flat rows —
// DISPLAY, DISPLAY WEIGHT, DISPLAY TRACKING, VOICE, VOICE WEIGHT, DATA, LABEL
// WEIGHT… — with a […] specimen under each. The specimen set
// `fontFamily` to the row's own value, so DISPLAY WEIGHT rendered its specimen
// in a font named "900", and no specimen applied the weight or the tracking
// sitting beside it. Eleven rows, none of them answering what any of them was
// for.
//
// The same eleven fields, grouped under the four roles the templates actually
// draw with, each with one honest specimen.
//
// Pure throughout.

/**
 * ⚠️ A KIT STORES A STACK, NOT A FAMILY.
 *
 * `[…]` is what lands in
 * `type.display`, and it has to: the vendored bytes may not have arrived in a
 * preview yet, and the card renderer's own fallback should be sane rather than
 * whatever the browser picks by default. So the picker reads the FIRST family
 * out of the stack, and writes a new one back with a role-appropriate tail.
 *
 * Both directions are here, and both are tested against the two real kits on
 * disk — a parser that cannot read what Umbrae and Ignis already carry is a
 * parser that would silently reset their typography on first edit.
 */
export const firstFamily = (stack) => {
  const head = String(stack || '').split(',')[0].trim();
  return head.replace(/^['"]|['"]$/g, '');
};

/** Quote a family only when it needs it, the way a designer would write it. */
const quoted = (family) => (/[^a-zA-Z0-9-]/.test(family) ? `'${family}'` : family);

/** Compose a stack from a family and the tail its registry entry declares. */
export const composeStack = (family, tail) =>
  [quoted(String(family || '').trim()), tail].filter(Boolean).join(', ');

/**
 * THE FOUR ROLES, and the eleven gated fields under them.
 *
 * `why` is the role's job in the operator's language. The per-field reasons
 * still come from the gate; this is what the group as a whole is FOR, which is
 * the thing the flat list never said.
 */
export const TYPE_ROLES = Object.freeze([
  Object.freeze({
    id: 'display', label: 'HEADLINES', why: 'the big line that says what the card is about',
    family: 'type.display', weight: 'type.displayWeight', track: 'type.displayTrack',
    specimen: 'Every headline lands here', size: 30,
  }),
  Object.freeze({
    id: 'voice', label: 'PROSE', why: 'the supporting sentence, and every piece of body copy',
    family: 'type.voice', weight: 'type.voiceWeight', track: null,
    specimen: 'One supporting sentence, set in the voice face.', size: 17,
  }),
  Object.freeze({
    id: 'data', label: 'LABELS & DATA', why: 'the small tracked mono lines — eyebrows, captions, timestamps',
    family: 'type.data', weight: 'type.labelWeight', track: 'type.labelTrack',
    specimen: 'TOTAL VALUE LOCKED', size: 14,
  }),
  Object.freeze({
    id: 'numeral', label: 'BIG NUMBERS', why: 'the hero figure — often the data face, never the headline one',
    family: 'type.numeral', weight: 'type.numeralWeight', track: 'type.numeralTrack',
    specimen: '$228.4K 66,952', size: 34,
  }),
]);

/** Three states, because there are three. Two would hide the one that bites. */
export const EMBEDDED = 'embedded';
export const FAMILY_ONLY = 'family-only';
export const NOT_VENDORED = 'not-vendored';

/**
 * Is this (family, weight) pair something a card can actually be drawn in?
 * Pure.
 *
 * ⚠️ FAMILY_ONLY is the state worth having. Rajdhani is vendored at 600 and
 * 700; a kit asking for Rajdhani 400 is not "close enough" — the card will be
 * drawn in a weight nobody chose, and collapsing this into a plain "vendored ✓"
 * is exactly how a kit ends up looking correct and rendering wrong. That is the
 * drift the whole EMBEDDABLE registry exists to prevent, one level down.
 *
 * @param {Array<{family: string, weights: Array<{weight: number}>}>} families
 * @returns {{state: string, faceId: string|null, has: number[]}}
 */
export const faceStanding = (families, stack, weight) => {
  const family = firstFamily(stack);
  const entry = (families || []).find((f) => f.family === family);
  if (!entry) return { state: NOT_VENDORED, faceId: null, has: [] };
  const want = Number(weight);
  const has = entry.weights.map((w) => w.weight);
  const exact = entry.weights.find((w) => w.weight === want);
  return exact
    ? { state: EMBEDDED, faceId: exact.id, has }
    : { state: FAMILY_ONLY, faceId: null, has };
};

/**
 * The faces this kit's four roles resolve to — the value `embedFonts` should
 * hold. Pure.
 *
 * ⚠️ DERIVED STRICTLY, never unioned with what is already there. A face that
 * nothing draws is roughly 400KB of base64 in every card produced, forever —
 * which is the state brands/ignis/tokens.json is in today, carrying Rajdhani
 * SemiBold, Rajdhani Bold and Inter Bold while its four type slots use Noto
 * 900, Inter 400 and JetBrains 400. A monotonic union is how that happens: it
 * can only ever grow.
 *
 * Deduped and ordered, so an edit that changes nothing produces no diff.
 */
export const deriveEmbedFonts = (families, kit) => {
  const ids = new Set();
  for (const role of TYPE_ROLES) {
    const standing = faceStanding(
      families,
      kit?.type?.[role.family.split('.')[1]],
      kit?.type?.[role.weight.split('.')[1]],
    );
    if (standing.faceId) ids.add(standing.faceId);
  }
  return [...ids].sort();
};

/** The families a picker offers, plus one for a family the kit already names
 *  that this build does not carry. Pure.
 *
 *  ⚠️ The same guard `ownerOptions` keeps: a Select whose value is absent from
 *  its options renders as EMPTY, and the next save would quietly erase a real
 *  answer. A kit set in Helvetica must show Helvetica — marked — not blank. */
export const familyOptions = (families, current) => {
  const options = (families || []).map((f) => ({ value: f.family, label: f.family.toUpperCase() }));
  const held = firstFamily(current);
  if (held && !options.some((o) => o.value === held)) {
    options.push({ value: held, label: `${held.toUpperCase()} · NOT VENDORED` });
  }
  return options;
};

/** The weights a family genuinely has, plus one for a weight the kit names that
 *  the family does not carry. Same guard, same reason. Pure. */
export const weightOptions = (families, stack, current) => {
  const entry = (families || []).find((f) => f.family === firstFamily(stack));
  const options = (entry?.weights || []).map((w) => ({
    value: String(w.weight),
    label: `${WEIGHT_NAMES[w.weight] || w.weight} · ${w.weight}`,
  }));
  const held = String(current ?? '').trim();
  if (held && !options.some((o) => o.value === held)) {
    options.push({ value: held, label: `${held} · NOT VENDORED` });
  }
  return options;
};

const WEIGHT_NAMES = Object.freeze({
  100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular',
  500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black',
});
