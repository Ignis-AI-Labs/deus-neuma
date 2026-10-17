// kit-form — how a brand kit is EDITED, as distinct from how it is JUDGED.
//
// Design note, 2026-08-31: […]
//
// WHY THIS IS NOT PART OF kit-readiness.js. Three reasons, and the first is the
// one that settles it:
//
// 1. THE FORM'S SECTIONS ARE NOT THE GATE'S SECTIONS. The gate has nine
//    sections and IDENTITY is nineteen of its thirty-nine fields — a name, five
//    colours, eleven type slots, a wordmark and an owner. As one screen that is
//    the wall Founder was looking at. As a form it has to become four: IDENTITY,
//    COLOUR, TYPOGRAPHY, MARKS. The gate cannot express that without becoming a
//    presentation document, and re-sectioning it would change the refusal text
//    every being reads and every done/total already in the wild.
//
// 2. `kind` AND `control` GENUINELY DO NOT COINCIDE. `type.display` and
//    `type.displayWeight` are both TEXT to the gate and want completely
//    different controls — a family picker that writes a CSS stack, and a weight
//    picker over what is actually vendored. `channels` is an object and wants
//    handle rows, not a JSON blob. There is no deriving one from the other, so
//    a per-path table is needed either way; the only question is where it
//    lives, and beside the spec — pinned to it by a test — beats inside it.
//
// 3. kit-readiness.js IS LOAD-BEARING FOR THREE OTHER THINGS: the campaign
//    gate's refusal prose, the scaffold generator, and every kit's done/total.
//    Every edit there changes the shape of newly created kits. Putting UI churn
//    on that file is how a placeholder change rewrites brand kits.
//
// WHAT KEEPS THE TWO IN STEP. test/unit/kit-form.test.js: every path in
// KIT_SECTIONS appears in exactly one form section with exactly one control, no
// form field names a path the gate does not have, and each form section's
// declared total matches the gate fields it claims. Add a field to the gate
// with no control here and CI fails — which is strictly stronger than what the
// hand-written panel gave us, where it failed SILENTLY. That is precisely how
// six whole sections ended up reachable only through a raw JSON textarea.
//
// Pure throughout.

import { KIT_SECTIONS } from './kit-readiness.js';

/** How a field is drawn. The client mounts one control per value. */
const TEXT = 'text';        // one line
const PROSE = 'prose';      // a paragraph — textarea
const LIST = 'list';        // rows, add and remove
const NUMBER = 'number';
const TOGGLE = 'toggle';
const CHANNELS = 'channels'; // channel -> handle rows
const COLOR = 'color';       // swatch + hex/rgba
const FONT = 'font';         // family picker over the vendored registry
const WEIGHT = 'weight';     // weight picker, constrained to that family
const TRACK = 'track';       // letter-spacing, in em
const OWNER = 'owner';       // the house roster
const MARK = 'mark';         // an SVG on disk

/**
 * How a form section is laid out. `fields` sections are generic and render
 * straight from the spec; the other three have bespoke editors because the
 * thing being edited is not a list of fields — it is a palette, a type system,
 * or a board of artwork.
 */
const FIELDS = 'fields';
const PALETTE = 'palette';
const TYPE = 'type';
const MARKS = 'marks';

/** Every per-path decision, in one table. */
const CONTROLS = Object.freeze({
  name: { control: TEXT, label: 'NAME', hint: 'as it should be written' },
  handle: { control: TEXT, label: 'HANDLE', hint: 'the @ this brand signs with — four of the six cards draw it' },
  owner: { control: OWNER, label: 'OWNER', hint: 'the house member answerable' },

  'colors.bg': { control: COLOR, label: 'BG' },
  'colors.ink': { control: COLOR, label: 'INK' },
  'colors.accent': { control: COLOR, label: 'ACCENT' },
  'colors.rise': { control: COLOR, label: 'RISE' },
  'colors.halo': { control: COLOR, label: 'HALO' },

  'type.display': { control: FONT, label: 'FAMILY', role: 'display' },
  'type.displayWeight': { control: WEIGHT, label: 'WEIGHT', role: 'display' },
  'type.displayTrack': { control: TRACK, label: 'TRACKING', role: 'display' },
  'type.voice': { control: FONT, label: 'FAMILY', role: 'voice' },
  'type.voiceWeight': { control: WEIGHT, label: 'WEIGHT', role: 'voice' },
  'type.data': { control: FONT, label: 'FAMILY', role: 'data' },
  'type.labelWeight': { control: WEIGHT, label: 'WEIGHT', role: 'data' },
  'type.labelTrack': { control: TRACK, label: 'TRACKING', role: 'data' },
  'type.numeral': { control: FONT, label: 'FAMILY', role: 'numeral' },
  'type.numeralWeight': { control: WEIGHT, label: 'WEIGHT', role: 'numeral' },
  'type.numeralTrack': { control: TRACK, label: 'TRACKING', role: 'numeral' },

  'marks.wordmark': { control: MARK, label: 'WORDMARK', hint: 'every card signs bottom-left with this' },
  'marks.mask': { control: MARK, label: 'MASK', hint: 'the big watermark — five of the six cards draw it' },

  positioning: { control: TEXT, label: 'POSITIONING' },
  audience: { control: TEXT, label: 'AUDIENCE' },
  pillars: { control: LIST, label: 'PILLARS', placeholder: 'one thing this brand comes back to' },

  tagline: { control: TEXT, label: 'TAGLINE' },
  boilerplate: { control: PROSE, label: 'BOILERPLATE' },

  voice: { control: PROSE, label: 'VOICE' },
  tone: { control: PROSE, label: 'TONE' },
  bannedPatterns: { control: LIST, label: 'NEVER USES', placeholder: 'a word or habit this brand never uses' },

  'claims.approved': { control: LIST, label: 'MAY BE ASSERTED', placeholder: 'something already published under this brand' },
  'claims.forbidden': { control: LIST, label: 'NEVER ASSERTED', placeholder: 'something that must never be claimed' },

  disclosures: { control: LIST, label: 'DISCLOSURES', placeholder: 'a line that must ride certain posts' },

  'logoRules.clearSpace': { control: TEXT, label: 'CLEAR SPACE' },
  'logoRules.minWidthPx': { control: NUMBER, label: 'MIN WIDTH', unit: 'px' },
  'logoRules.misuse': { control: LIST, label: 'MISUSE', placeholder: 'what may never be done to the mark' },
  'imagery.direction': { control: PROSE, label: 'DIRECTION' },
  'imagery.avoid': { control: LIST, label: 'AVOID', placeholder: 'imagery this brand stays away from' },

  'accessibility.contrastMin': { control: NUMBER, label: 'CONTRAST FLOOR', step: 0.1 },
  'accessibility.altTextRequired': { control: TOGGLE, label: 'ALT TEXT REQUIRED' },

  channels: { control: CHANNELS, label: 'CHANNELS' },
  'competitors.neverName': { control: LIST, label: 'NEVER NAMED', placeholder: 'a competitor this brand does not name' },
});

/**
 * THE RAIL, in the order it is worked.
 *
 * IDENTITY's nineteen gate fields split four ways; the other eight gate
 * sections pass through one-to-one. `owns` lists the gate paths this form
 * section is answerable for, which is what makes the progress arithmetic add up
 * to the gate's own numbers rather than to a second count of our own.
 */
const FORM_SECTIONS = Object.freeze([
  Object.freeze({
    id: 'identity', label: 'IDENTITY', layout: FIELDS,
    note: 'Who this is, and who in the house answers for it.',
    owns: Object.freeze(['name', 'handle', 'owner']),
  }),
  Object.freeze({
    id: 'colour', label: 'COLOUR', layout: PALETTE,
    note: 'Colour carries meaning on these cards — a gain is green and nothing else is.',
    owns: Object.freeze(['colors.bg', 'colors.ink', 'colors.accent', 'colors.rise', 'colors.halo']),
  }),
  Object.freeze({
    id: 'type', label: 'TYPOGRAPHY', layout: TYPE,
    note: 'A face name is not a typographic system. Each role carries its own weight and tracking.',
    owns: Object.freeze([
      'type.display', 'type.displayWeight', 'type.displayTrack',
      'type.voice', 'type.voiceWeight',
      'type.data', 'type.labelWeight', 'type.labelTrack',
      'type.numeral', 'type.numeralWeight', 'type.numeralTrack',
    ]),
  }),
  Object.freeze({
    id: 'marks', label: 'MARKS', layout: MARKS,
    note: 'The brand signs with its mark, never its name set in a font.',
    owns: Object.freeze(['marks.wordmark', 'marks.mask']),
  }),
  Object.freeze({ id: 'positioning', label: 'POSITIONING', layout: FIELDS, owns: Object.freeze(['positioning', 'audience', 'pillars']) }),
  Object.freeze({ id: 'message', label: 'MESSAGE', layout: FIELDS, owns: Object.freeze(['tagline', 'boilerplate']) }),
  Object.freeze({ id: 'voice', label: 'VOICE', layout: FIELDS, owns: Object.freeze(['voice', 'tone', 'bannedPatterns']) }),
  Object.freeze({
    id: 'claims', label: 'CLAIMS', layout: FIELDS,
    note: 'A being writes and posts publicly under this brand. This is the section that keeps it from inventing a number about a client — take both lists only from material already published.',
    owns: Object.freeze(['claims.approved', 'claims.forbidden']),
  }),
  Object.freeze({
    id: 'legal', label: 'LEGAL', layout: FIELDS,
    note: 'An empty list is a real answer here, and means somebody decided there are none.',
    owns: Object.freeze(['disclosures']),
  }),
  Object.freeze({
    id: 'assetRules', label: 'ASSET RULES', layout: FIELDS,
    owns: Object.freeze(['logoRules.clearSpace', 'logoRules.minWidthPx', 'logoRules.misuse', 'imagery.direction', 'imagery.avoid']),
  }),
  Object.freeze({ id: 'access', label: 'ACCESSIBILITY', layout: FIELDS, owns: Object.freeze(['accessibility.contrastMin', 'accessibility.altTextRequired']) }),
  Object.freeze({ id: 'channels', label: 'CHANNELS', layout: FIELDS, owns: Object.freeze(['channels', 'competitors.neverName']) }),
]);

/** Every gate field, flattened by path, carrying its kind and its `why`. Pure. */
export const gateFields = () => {
  const out = new Map();
  for (const section of KIT_SECTIONS) {
    for (const field of section.fields) {
      out.set(field.path, { path: field.path, kind: field.kind, why: field.why, gateSection: section.label });
    }
  }
  return out;
};

/**
 * The form, ready to render. Pure.
 *
 * Every field carries BOTH halves: the gate's `kind` and `why` — which is the
 * brand's own language for what the field is for, and the only text worth
 * showing beside an empty box — and this file's control decision.
 *
 * @returns {{sections: Array<object>, controls: object}}
 */
export const kitForm = () => {
  const gate = gateFields();
  const sections = FORM_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    layout: section.layout,
    note: section.note || null,
    fields: section.owns.map((path) => {
      const field = gate.get(path);
      const control = CONTROLS[path];
      return {
        path,
        kind: field ? field.kind : null,
        why: field ? field.why : null,
        gateSection: field ? field.gateSection : null,
        ...(control || { control: TEXT, label: path.toUpperCase() }),
      };
    }),
  }));
  return { sections };
};

/** Which form section a gate path is edited in. Pure — for a […]
 *  jump from a refusal to the control that answers it. */
export const formSectionOf = (path) =>
  FORM_SECTIONS.find((s) => s.owns.includes(path))?.id || null;

export const FORM_LAYOUTS = Object.freeze({ FIELDS, PALETTE, TYPE, MARKS });
export const FORM_CONTROLS = Object.freeze({
  TEXT, PROSE, LIST, NUMBER, TOGGLE, CHANNELS, COLOR, FONT, WEIGHT, TRACK, OWNER, MARK,
});
export { FORM_SECTIONS };
