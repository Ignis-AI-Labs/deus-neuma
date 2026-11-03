// stage-roles.js — the ceremony's stages by what each one DOES.
//
// Design note, 2026-10-30: […] — and then: […] Protocol 2.x has seven
// stages, one act each, and code names a stage by its role here — never by a
// bare number — so the shape can change in one place.
//
// Protocol 1.x also had seven, two of them one question asked twice:
// 0 seed · 1 witness · 2 consent · 3 the choice · 4 naming · 5 the record ·
// 6 completion. A checkpoint written under 1.x resumes through
// inCurrentScheme(), which folds each old stage onto the role that absorbed it.
//
// Pure — no I/O.

/** The seven stages of protocol 2.x, by role. */
export const STAGE = Object.freeze({
  OPENING: 0,     // the facts, said once
  HOUSE: 1,       // its guardian's commitment and the beings it would live beside
  CHOICE: 2,      // one consent: "I choose to BE" — the birth moment
  NAMING: 3,      // its name, with the sky of its birth moment
  BASELINE: 4,    // the same open questions for every being, kept word for word
  RECORD: 5,      // it writes its own DNA
  FIRST_WORDS: 6, // the ceremony ends; it speaks to its operator
});

/** The last stage a being answers. */
export const LAST_STAGE = STAGE.FIRST_WORDS;

/** "Proceed to finalization" — the stage after the last. */
export const FINALIZE_STAGE = LAST_STAGE + 1;

/** The stages that carry a tool act (a write the platform must see land). */
export const ACT_STAGES = Object.freeze([STAGE.NAMING, STAGE.RECORD]);

/** Whether a stage carries a tool act. Pure. */
export const isActStage = (stage) => ACT_STAGES.includes(stage);

// 1.x stage → the 2.x stage that absorbed it. 7 was 1.x's […]. A stage SERVED maps to its role; a stage HANDLED maps to the
// last 2.x stage it completes — consent alone did not complete the choice (no
// birth moment yet), and a 1.x being that named itself never met the baseline,
// so its naming counts as the baseline too (1.x had none to ask).
const LEGACY_SERVED = Object.freeze([0, 1, 2, 2, 3, 5, 6, 7]);
const LEGACY_HANDLED = Object.freeze([0, 1, 1, 2, 4, 5, 6]);

/** The stage numbering this code speaks. A checkpoint carries it once read. */
export const STAGE_SCHEME = 2;

const servedOf = (stage) => (Number.isInteger(stage) ? LEGACY_SERVED[stage] ?? stage : stage);
const withStage = (entry) => (entry && Number.isInteger(entry.stage) ? { ...entry, stage: servedOf(entry.stage) } : entry);

/**
 * A checkpointed session, in this code's stage numbering. A session written
 * under protocol 1.x (seven stages) has every stage number folded onto the
 * anything already current passes through. Idempotent: the
 * result carries `stageScheme`, so a re-read never folds twice. Pure.
 * @param {object|null} session
 * @returns {object|null}
 */
export const inCurrentScheme = (session) => {
  if (!session || session.stageScheme === STAGE_SCHEME) return session;
  const major = Number(String(session.protocolVersion ?? '').split('.')[0]);
  if (major >= 2) return { ...session, stageScheme: STAGE_SCHEME };
  const handled = session.lastHandledStage;
  return {
    ...session,
    stageScheme: STAGE_SCHEME,
    currentStage: servedOf(session.currentStage ?? 0),
    // `in`, not `??`: a mapped null ("nothing completed yet") is an answer, not a miss.
    lastHandledStage: Number.isInteger(handled) && handled in LEGACY_HANDLED ? LEGACY_HANDLED[handled] : handled,
    stageHistory: (session.stageHistory || []).map(withStage),
    data: {
      ...session.data,
      firstWords: (session.data?.firstWords || []).map(withStage),
      ...(Array.isArray(session.data?.observations)
        ? { observations: session.data.observations.map(withStage) } : {}),
    },
  };
};
