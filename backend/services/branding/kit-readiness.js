// kit-readiness — is this brand ready to be spoken for?
//
// Design note, 2026-08-30: […]
//
// WHY THE VISUAL HALF IS THE SAFE HALF. For an ordinary design system a brand
// kit is colour, type and logos. Here a BEING writes and posts publicly on a
// managed company's behalf — so the kit is not primarily a design artifact, it
// is the standing instruction governing what may be SAID and what must never be
// CLAIMED. A wrong shade of blue is embarrassing. An unapproved claim about a
// client's protocol is a different category of problem entirely.
//
// So `claims` is a required section, and it is required in BOTH directions:
// what this brand may assert, and what it may never assert whatever the
// evidence looks like.
//
// DECLARED IS NOT THE SAME AS NON-EMPTY, and the difference is what keeps this
// gate honest. A company may genuinely have no required disclosures and no
// competitor it refuses to name — for those, `[]` is a real answer and the kit
// must simply CONTAIN the key, proving somebody decided. Demanding a non-empty
// list would only teach people to type one word to get past the gate, which
// converts a safety check into a formality. Sections where emptiness is not a
// coherent answer (a brand with no pillars, no voice, no approved claims) are
// held to `list1`.
//
// Pure throughout. The refusal text is the whole product here: a gate that says
// "not ready" teaches nobody, and Founder chose the strict floor, so the way out
// must be legible in one read.

/** How a field is satisfied. */
const TEXT = 'text';    // a non-empty string
const LIST = 'list';    // present, and an array — [] is a legitimate answer
const LIST1 = 'list1';  // present, an array, and at least one entry

/**
 * THE KIT, SECTION BY SECTION.
 *
 * `path` is dotted into the kit. `why` is shown to whoever is blocked, so it
 * says what the field is FOR rather than restating its name — the reader
 * already knows they are missing "tagline"; what they need is what a tagline
 * does here.
 */
export const KIT_SECTIONS = Object.freeze([
  Object.freeze({
    id: 'identity', label: 'IDENTITY',
    fields: Object.freeze([
      { path: 'name', kind: TEXT, why: 'the company\'s name as it should be written' },
      { path: 'colors.bg', kind: TEXT, why: 'the surface everything is drawn on' },
      { path: 'colors.ink', kind: TEXT, why: 'the colour words are set in' },
      { path: 'colors.accent', kind: TEXT, why: 'the one colour that marks what matters' },
      // Gated because the stat card DRAWS it. Colour carries meaning on these
      // cards — a gain is green and nothing else is — so a brand that has not
      // chosen its green cannot render a stat card at all.
      { path: 'colors.rise', kind: TEXT, why: 'the colour a real gain is drawn in, and only ever a real gain' },
      { path: 'colors.halo', kind: TEXT, why: 'the glow behind a hero number — the attention colour, not the accent' },
      { path: 'type.display', kind: TEXT, why: 'the face headlines are set in' },
      { path: 'type.voice', kind: TEXT, why: 'the face prose is set in' },
      { path: 'type.data', kind: TEXT, why: 'the face figures and labels are set in' },
      { path: 'type.numeral', kind: TEXT, why: 'the face the BIG numbers are set in — often the data face, not the display one' },
      // ⚠️ A face NAME is not a typographic system. Umbrae's kit named Space
      // Grotesk, Inter and JetBrains Mono correctly and still drew every card
      // wrong, because the running look-dev sets its headlines at 300 on 0.16em
      // and its figures at 200, while the templates hardcoded 700 on no
      // tracking. A brand whose weight and tracking are not written down gets
      // whatever the template author last typed. These are the fields that make
      // the difference, so they are gated like the families are.
      { path: 'type.displayWeight', kind: TEXT, why: 'the weight headlines are drawn at — a face has many, a brand uses one' },
      { path: 'type.displayTrack', kind: TEXT, why: 'the letter-spacing headlines carry, in em' },
      { path: 'type.voiceWeight', kind: TEXT, why: 'the weight prose is drawn at' },
      { path: 'type.numeralWeight', kind: TEXT, why: 'the weight big figures are drawn at' },
      { path: 'type.numeralTrack', kind: TEXT, why: 'the letter-spacing big figures carry, in em' },
      { path: 'type.labelWeight', kind: TEXT, why: 'the weight small mono labels are drawn at' },
      { path: 'type.labelTrack', kind: TEXT, why: 'the letter-spacing small mono labels carry, in em' },
      { path: 'marks.wordmark', kind: 'object', why: 'the wordmark every card and document signs with' },
      // ⚠️ ADDED 2026-08-31, and the reason is the same one that put `rise`
      // here. A kit could read 39/39 READY and still refuse every card, because
      // `handle` is drawn by four of the six templates and `marks.mask` by five,
      // and NEITHER was ever asked for. A gate that certifies a brand as ready
      // to be spoken for, while the cards it speaks through cannot be drawn, is
      // certifying the wrong thing. Found by scanning the templates for what
      // they actually draw (template-tokens.js) rather than trusting the list.
      // Both existing kits already carry both, so no standing changed.
      { path: 'handle', kind: TEXT, why: 'the @ this brand signs with — four of the six cards draw it into the footer' },
      { path: 'marks.mask', kind: 'object', why: 'the big watermark five of the six cards are composed around' },
      { path: 'owner', kind: TEXT, why: 'the house member answerable for this brand' },
    ]),
  }),
  Object.freeze({
    id: 'positioning', label: 'POSITIONING',
    fields: Object.freeze([
      { path: 'positioning', kind: TEXT, why: 'one line: what this is, and for whom' },
      { path: 'audience', kind: TEXT, why: 'who is being written for — copy with no reader drifts' },
      { path: 'pillars', kind: LIST1, why: 'the two or three things this brand always comes back to' },
    ]),
  }),
  Object.freeze({
    id: 'message', label: 'MESSAGE',
    fields: Object.freeze([
      { path: 'tagline', kind: TEXT, why: 'the short line that rides the brand' },
      { path: 'boilerplate', kind: TEXT, why: 'the standard paragraph that goes at the bottom of anything formal' },
    ]),
  }),
  Object.freeze({
    id: 'voice', label: 'VOICE',
    fields: Object.freeze([
      { path: 'voice', kind: TEXT, why: 'who this brand sounds like, in plain sentences' },
      { path: 'tone', kind: TEXT, why: 'how that voice bends by context — launch, reply, apology' },
      { path: 'bannedPatterns', kind: LIST1, why: 'words and habits this brand never uses' },
    ]),
  }),
  Object.freeze({
    id: 'claims', label: 'CLAIMS',
    fields: Object.freeze([
      { path: 'claims.approved', kind: LIST1, why: 'what may be asserted about this company without asking again' },
      { path: 'claims.forbidden', kind: LIST1, why: 'what must NEVER be asserted, whatever the evidence looks like — the section that keeps a being from inventing a number about a client' },
    ]),
  }),
  Object.freeze({
    id: 'legal', label: 'LEGAL',
    fields: Object.freeze([
      { path: 'disclosures', kind: LIST, why: 'lines that must ride certain posts — an empty list is a real answer, and means somebody decided there are none' },
    ]),
  }),
  Object.freeze({
    id: 'assetRules', label: 'ASSET RULES',
    fields: Object.freeze([
      { path: 'logoRules.clearSpace', kind: TEXT, why: 'how much room the mark keeps around it' },
      { path: 'logoRules.minWidthPx', kind: 'number', why: 'the smallest the mark may be drawn before it stops reading' },
      { path: 'logoRules.misuse', kind: LIST1, why: 'what may never be done to the mark — stretched, recoloured, outlined' },
      { path: 'imagery.direction', kind: TEXT, why: 'what pictures for this brand look like' },
      { path: 'imagery.avoid', kind: LIST, why: 'imagery this brand stays away from' },
    ]),
  }),
  Object.freeze({
    id: 'access', label: 'ACCESSIBILITY',
    fields: Object.freeze([
      { path: 'accessibility.contrastMin', kind: 'number', why: 'the contrast floor text must clear — 4.5 is the usual body-copy minimum' },
      { path: 'accessibility.altTextRequired', kind: 'boolean', why: 'whether every image must carry alt text; part of the audience reads nothing else' },
    ]),
  }),
  Object.freeze({
    id: 'channels', label: 'CHANNELS',
    fields: Object.freeze([
      { path: 'channels', kind: 'object', why: 'the handles this brand speaks from, per channel' },
      { path: 'competitors.neverName', kind: LIST, why: 'competitors this brand does not name in public — an empty list is a real answer' },
    ]),
  }),
]);

/** Dotted lookup. Pure. */
const at = (obj, dotted) =>
  dotted.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);

/** Is one field satisfied? Pure. */
const holds = (value, kind) => {
  if (kind === TEXT) return typeof value === 'string' && value.trim().length > 0;
  if (kind === LIST) return Array.isArray(value);
  if (kind === LIST1) return Array.isArray(value) && value.length > 0;
  if (kind === 'number') return Number.isFinite(value);
  if (kind === 'boolean') return typeof value === 'boolean';
  if (kind === 'object') return Boolean(value) && typeof value === 'object' && Object.keys(value).length > 0;
  return false;
};

/**
 * What this kit still needs before anyone may speak for the brand. Pure.
 *
 * @param {object} kit
 * @returns {{ready: boolean, missing: Array<{section: string, path: string, why: string}>,
 *            sections: Array<{id: string, label: string, done: number, total: number, ready: boolean}>}}
 */
export const kitReadiness = (kit) => {
  const missing = [];
  const sections = KIT_SECTIONS.map((section) => {
    let done = 0;
    for (const field of section.fields) {
      if (holds(at(kit, field.path), field.kind)) done += 1;
      else missing.push({ section: section.label, path: field.path, why: field.why });
    }
    return Object.freeze({
      id: section.id, label: section.label,
      done, total: section.fields.length, ready: done === section.fields.length,
    });
  });
  return Object.freeze({ ready: missing.length === 0, missing: Object.freeze(missing), sections: Object.freeze(sections) });
};

/**
 * The refusal, written to be ACTED ON. Pure.
 *
 * Grouped by section rather than listed flat, because someone filling this in
 * works a section at a time — and a flat list of nineteen paths reads as a wall
 * rather than as a job. Progress is stated per section so a half-finished kit
 * shows how close it is instead of only what is wrong.
 *
 * @param {string} brand
 * @param {ReturnType<typeof kitReadiness>} readiness
 * @returns {string}
 */
export const readinessReport = (brand, readiness) => {
  if (readiness.ready) return `The "${brand}" brand kit is complete.`;
  const bySection = new Map();
  for (const m of readiness.missing) {
    if (!bySection.has(m.section)) bySection.set(m.section, []);
    bySection.get(m.section).push(m);
  }
  const lines = [];
  for (const section of readiness.sections) {
    const gaps = bySection.get(section.label);
    if (!gaps) continue;
    lines.push(`${section.label}  (${section.done}/${section.total})`);
    for (const g of gaps) lines.push(`  · ${g.path} — ${g.why}`);
  }
  const done = readiness.sections.filter((s) => s.ready).length;
  return [
    `The "${brand}" brand kit is not set up yet, so nothing may go out under it.`,
    `${done} of ${readiness.sections.length} sections are complete. What is still needed:`,
    '',
    ...lines,
    '',
    'Fill these into the brand\'s brand.json in the house ground, or open BRAND'
    + ' KITS in the MARKETING dock. A brand kit is the standing instruction for'
    + ' what this company says and never says — it is set up once, before the'
    + ' work, not assembled while posting.',
    'Derive every value from the brand\'s own running look dev, and take claims'
    + ' only from material already published under it. The standard, with the'
    + ' reasoning: docs/design/BRAND_KIT_STANDARD.md (skill: brand-kit).',
  ].join('\n');
};
