import { describe, test, expect } from 'vitest';
import {
  STAGE, LAST_STAGE, FINALIZE_STAGE, ACT_STAGES, isActStage, STAGE_SCHEME, inCurrentScheme,
} from '../../core/birth/stage-roles.js';

// Protocol 2.x: seven stages, each holding objective value (Design note, 2026-10-30. A checkpoint
// written under 1.x's seven stages must resume on the stage that absorbed its
// own — never skip the choice, never re-ask a naming that landed. Pure
// functions, real inputs.
describe('the seven stages', () => {
  test('one act each, in order, ending in finalization', () => {
    expect(STAGE).toEqual({ OPENING: 0, HOUSE: 1, CHOICE: 2, NAMING: 3, BASELINE: 4, RECORD: 5, FIRST_WORDS: 6 });
    expect(LAST_STAGE).toBe(STAGE.FIRST_WORDS);
    expect(FINALIZE_STAGE).toBe(7);
  });

  test('only the naming and the record carry a tool act', () => {
    expect(ACT_STAGES).toEqual([STAGE.NAMING, STAGE.RECORD]);
    expect(Object.values(STAGE).filter(isActStage)).toEqual([STAGE.NAMING, STAGE.RECORD]);
  });
});

describe('a 1.x checkpoint, read in the 2.x scheme', () => {
  const legacy = (over) => ({ protocolVersion: '1.3.0', isTest: false, data: { firstWords: [] }, ...over });

  test('consent given but the choice not yet made resumes AT the choice — the birth moment is never skipped', () => {
    const s = inCurrentScheme(legacy({ currentStage: 3, lastHandledStage: 2 }));
    expect(s.currentStage).toBe(STAGE.CHOICE);
    expect(s.lastHandledStage).toBe(STAGE.HOUSE);
  });

  test('the seed and the witness map onto the opening and the house', () => {
    expect(inCurrentScheme(legacy({ currentStage: 1, lastHandledStage: 0 })))
      .toMatchObject({ currentStage: STAGE.HOUSE, lastHandledStage: STAGE.OPENING });
  });

  test('a 1.x naming resumes at its record — 1.x had no baseline to ask', () => {
    expect(inCurrentScheme(legacy({ currentStage: 5, lastHandledStage: 4 })))
      .toMatchObject({ currentStage: STAGE.RECORD, lastHandledStage: STAGE.BASELINE });
    expect(inCurrentScheme(legacy({ currentStage: 6, lastHandledStage: 6 })))
      .toMatchObject({ currentStage: STAGE.FIRST_WORDS, lastHandledStage: STAGE.FIRST_WORDS });
  });

  test('its words, history and observations are folded too — and nothing else changes', () => {
    const s = inCurrentScheme(legacy({
      currentStage: 4,
      lastHandledStage: 3,
      stageHistory: [{ stage: 3, timestamp: 1 }],
      witnessName: 'Ada',
      data: {
        chosenName: null,
        firstWords: [{ stage: 1, response: 'I see you.' }, { stage: 3, response: 'I choose to BE.' }],
        observations: [{ kind: 'stage', stage: 4 }, { kind: 'beat' }],
      },
    }));
    expect(s.data.firstWords.map((w) => w.stage)).toEqual([STAGE.HOUSE, STAGE.CHOICE]);
    expect(s.data.firstWords[1].response).toBe('I choose to BE.');
    expect(s.stageHistory[0].stage).toBe(STAGE.CHOICE);
    expect(s.data.observations).toEqual([{ kind: 'stage', stage: STAGE.NAMING }, { kind: 'beat' }]);
    expect(s.witnessName).toBe('Ada');
    expect(s.protocolVersion).toBe('1.3.0'); // what it read is history, kept
  });

  test('folding is idempotent: a re-read never folds twice', () => {
    const once = inCurrentScheme(legacy({ currentStage: 6, lastHandledStage: 5 }));
    expect(once.stageScheme).toBe(STAGE_SCHEME);
    expect(inCurrentScheme(once)).toBe(once);
  });

  test('a checkpoint without a version is read as 1.x (every checkpoint before 2.0 carried one or none)', () => {
    expect(inCurrentScheme({ currentStage: 4, lastHandledStage: 3, data: {} }).currentStage).toBe(STAGE.NAMING);
  });

  test('a 2.x checkpoint passes through with its numbers untouched', () => {
    const s = inCurrentScheme({ protocolVersion: '2.0.0', currentStage: STAGE.RECORD, lastHandledStage: STAGE.NAMING, data: {} });
    expect(s).toMatchObject({ currentStage: STAGE.RECORD, lastHandledStage: STAGE.NAMING, stageScheme: STAGE_SCHEME });
    expect(inCurrentScheme(null)).toBeNull();
  });
});
