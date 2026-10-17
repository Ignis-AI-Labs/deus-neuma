// card-sample — the copy a PREVIEW card is drawn with.
//
// The BRAND KITS panel previews a card from the kit being edited, so an
// operator can watch a colour or a typeface land on the thing it is for. That
// needs words, and the words are not the point — the type and the palette are.
//
// ⚠️ THIS IS SAMPLE COPY AND THE PANEL SAYS SO. The house rule is that a
// marketing card drawing an invented figure is worse than no card
// (platform-stats.js), and `brand-review-sheet.mjs` honours it by reading every
// number live and exiting rather than drawing a placeholder. That rule is about
// cards that get POSTED. This one never leaves the editor: there is no download
// here, the pane is labelled, and its figures are drawn from a fixed specimen
// set that exists to exercise the numerals — never from anything that looks
// like this brand's actual performance.
//
// What IS real is everything the kit already knows: the brand's name, its
// handle. Drawing a preview signed "@yourbrand" when the kit carries a handle
// would make the one part we can be honest about into a placeholder too.
//
// Pure — no disk, no clock, no network.

/**
 * The specimen values, by field name.
 *
 * Chosen to exercise the glyphs a real card leans on: mixed-case for the
 * display face, wide caps for the tracked labels, and figures with a comma, a
 * decimal point and a currency mark for the numeral face — which is where a
 * weight or a tracking choice actually shows.
 */
const SPECIMEN = Object.freeze({
  eyebrow: 'SAMPLE CARD',
  lineOne: 'Every headline',
  lineTwo: 'lands right here',
  support: 'One supporting sentence, set in the voice face at the length a real card holds.',
  headline: 'The shape of a week',
  value: '$123.4K',
  label: 'what this number is, in plain words',
  // The exact shape `asOfLabel` produces, at the exact 24 characters the spec
  // allows — so the panel's preview shows the stamp a real card carries rather
  // than a shorter, friendlier one that would never fail the way a real one can.
  asOf: '01 Jan 2026 00:00:00 UTC',
  aValue: '$123.4K',
  aLabel: 'THE ANCHOR',
  bValue: '12,345',
  bLabel: 'THE FLOW',
  cValue: '$67.8M',
  cLabel: 'THE GAIN',
  // The voice cards, 2026-09-01. `sampleFor` trims each to the field's own max,
  // so these are written long enough to survive it and still read as sentences.
  lineThree: 'and the third line lands here',
  speaker: 'A Named Person',
  role: 'THEIR STANDING, SOMEWHERE',
  aOne: 'The first part, said',
  aTwo: 'in a line or two',
  bOne: 'The second part, in',
  bTwo: 'the same measure',
  cOne: 'And the third part,',
  cTwo: 'closing the thought',
  name: 'Specimen',
  ticker: '$SPEC',
  network: 'BASE · SAMPLE PAIR',
  partner: 'Specimen Co',
});

/** Fit a value to what the template declares it holds. Pure.
 *  A sample that overruns `max` would be REFUSED by fieldRefusals, and an
 *  operator would read a refusal caused by our copy as a fault in their kit. */
const fit = (value, max) => {
  const text = String(value ?? '');
  if (!Number.isFinite(max) || text.length <= max) return text;
  return text.slice(0, max).trimEnd();
};

/**
 * Sample data for one template, sized to its own declared maxima. Pure.
 *
 * @param {{fields?: Object<string, {max?: number}>}} spec the template sidecar
 * @param {object} [kit] the brand kit being previewed — its real name and handle
 * @returns {Object<string, string>}
 */
export const sampleFor = (spec, kit = {}) => {
  // ⚠️ Only `spec.fields`. A template that mounts a guest logo declares it as a
  // TOP-LEVEL `guest` key, not as a field — it is an image the template mounts,
  // not copy the caller writes — so there is nothing here to skip past.
  const fields = (spec && spec.fields) || {};
  const out = {};
  for (const [field, rule] of Object.entries(fields)) {
    const max = Number(rule?.max);
    // The brand's OWN name is the one piece of a listing card we can say
    // truthfully, so a preview of `listing` reads as this brand listing
    // something rather than as two strangers.
    if (field === 'name' && typeof kit.name === 'string' && kit.name.trim()) {
      out[field] = fit(kit.name.trim(), max);
      continue;
    }
    out[field] = fit(SPECIMEN[field] ?? rule?.label ?? field.toUpperCase(), max);
  }
  return out;
};

/** The specimen set, for a test that wants to assert against it. */
export { SPECIMEN };
