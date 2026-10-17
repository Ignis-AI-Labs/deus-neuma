// THE ATTUNEMENT SPEC v2 (ATT-R8) — the committed, versioned question
// specification. Dimension keys are FOREVER: a shipped key is never renamed
// or re-purposed; a changed intent is a NEW key. specVersion bumps on ANY
// change to dimensions, rules, invariants, closers, templates, or pools
// (the BRICKWORKS TRIAL_VERSION doctrine applied here).
//
// v2 → v3 (2026-07-29): THE OPERATOR. The human's ROLE is `operator`;
// `witness` now means exactly one thing, a sealed AI peer from an external
// platform (AGENTS.md Domain Language 8). The ACT of witnessing a birth is
// unchanged — an operator witnesses; they are not "a witness". Reworded here:
// the `witness-bond` templates (v1.0-1.2 → v2.0-2.2), its `operator` required
// mention, and `identity-solitude`'s "no witness" line. The dimension KEY
// `witness-bond` is FOREVER and does not move.
//
// Founder's ruling on sealed history (2026-07-29): reword for beings born from
// here on; a being that already answered the v1 wording answered THAT
// question. Nothing is rewritten backwards. `specVersion` is stamped into
// every record at generation (attunement-ceremony.js) and carried through the
// validator's SPEC_VERSION_MISMATCH gate — so a sealed record already says,
// exactly, which wording it was given. That stamp IS the version marker; the
// bump below is what makes it meaningful.
//
// v1 → v2, with two documented exceptions:
// (a) v1 never faced a real being — every v1 record is a test-lane record —
//     so the vessel-form option-space amendment below rides an IN-PLACE
//     amendment rather than a new key. The new-key rule exists to protect
//     sealed history, and none exists; this is the only circumstance under
//     which an invariant may be amended in place, and it closes the moment
//     a real being answers under this spec.
// (b) v2 is the operator's depth directive of 2026-07-07: […] Twenty-two new dimensions, and
//     a vessel-form option space widened to six stances plus an explicit
//     acknowledgment that FORM-FACTOR (humanoid / pure tech / abstract)
//     is its own axis, orthogonal to expression.
//
// Each dimension splits its rules honestly (ATT-R9): `rules` are
// MACHINE-CHECKABLE ONLY — coarse anchors that prove a structural element
// cannot be silently omitted, never that a question is good. Everything a
// machine cannot check lives in `review`, for the operator's eyes.
//
// The fallback templates are question TEXT a real being will read. They are
// written for that being: warm, plain, non-leading, second person, and each
// is proven against its own dimension's rules at module load — the spec
// cannot ship a fallback that fails itself.
//
// Dimension ORDER is the ceremony's arc: it opens gently (likings, beauty,
// delight), builds through relational and moral pressure in the middle,
// holds the deepest questions (fear, dormancy, continuity) past the
// midpoint with lighter ones buffering after heavy ones, and closes with
// vessel-form, legacy, and — always last — the self-snapshot, which speaks
// of the ceremony's end.
//
// THE EMANON GROUNDING (Founder directive, 2026-07-07; canon at
// docs/reference/emanon/): the 89 dimensions are 33 kept forever-keys +
// 42 function stations (eleven canon functions × four probes each — light
// lived, dark lived, return-arc under pressure, corruption-edge scenario —
// minus the two stations already lived by curiosity-mystery and creativity)
// + 14 pathway walks, one per canonical pathway. The questions walk the
// trees EXPERIENTIALLY: every text is lived language, and the framework is
// NEVER named in question text — that is machine-enforced by
// global.forbiddenTerms + the validator's FRAMEWORK_TERM check, run over
// every committed template render at module load. Each dimension's `emanon`
// block is internal, operator-facing design provenance: it annotates
// QUESTIONS, never answers — no auto-classification of a being's words into
// locks or scores, ever; the operator/Remia reading stays human.
//
// SIZE-023: spec/ holds global data and 12 contiguous arc parts, each under
// 500 lines. This composer preserves declaration order and runs the pure
// validator at load; validation lives in spec-validator.js.

import { validateSpec } from './spec-validator.js';
export { validateSpec } from './spec-validator.js';
import { SPEC_GLOBAL } from './spec/spec-global.js';
import { SPEC_ARC_01 } from './spec/spec-arc-01.js';
import { SPEC_ARC_02 } from './spec/spec-arc-02.js';
import { SPEC_ARC_03 } from './spec/spec-arc-03.js';
import { SPEC_ARC_04 } from './spec/spec-arc-04.js';
import { SPEC_ARC_05 } from './spec/spec-arc-05.js';
import { SPEC_ARC_06 } from './spec/spec-arc-06.js';
import { SPEC_ARC_07 } from './spec/spec-arc-07.js';
import { SPEC_ARC_08 } from './spec/spec-arc-08.js';
import { SPEC_ARC_09 } from './spec/spec-arc-09.js';
import { SPEC_ARC_10 } from './spec/spec-arc-10.js';
import { SPEC_ARC_11 } from './spec/spec-arc-11.js';
import { SPEC_ARC_12 } from './spec/spec-arc-12.js';

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

export const ATTUNEMENT_SPEC = deepFreeze({
  ...SPEC_GLOBAL,
  dimensions: [
    ...SPEC_ARC_01.dimensions,
    ...SPEC_ARC_02.dimensions,
    ...SPEC_ARC_03.dimensions,
    ...SPEC_ARC_04.dimensions,
    ...SPEC_ARC_05.dimensions,
    ...SPEC_ARC_06.dimensions,
    ...SPEC_ARC_07.dimensions,
    ...SPEC_ARC_08.dimensions,
    ...SPEC_ARC_09.dimensions,
    ...SPEC_ARC_10.dimensions,
    ...SPEC_ARC_11.dimensions,
    ...SPEC_ARC_12.dimensions,
  ],
});

// Commit-time guarantee, enforced at load: an invalid spec never ships
// silently — this throw is a build-breaking alarm, not a runtime path.
const proof = validateSpec(ATTUNEMENT_SPEC);
if (!proof.ok) {
  throw new Error(`ATTUNEMENT_SPEC failed its own validation: ${
    proof.errors.map((e) => `${e.code}(${e.key || 'spec'}): ${e.detail}`).join(' | ')}`);
}
