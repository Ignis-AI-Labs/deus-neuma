// ENTER AS — where an entry lands, on whom. Pure: real inputs, real outputs.
import { describe, it, expect } from 'vitest';
import { entryPlan } from '../../frontend/app/entry-mode.js';

const keir = { neumaId: 'keir', name: 'Keir' };
const lane = { laneId: 'harness-8a640114', model: 'Qwen3.8-27B' };
const harness = { neumaId: 'harness-8a640114', name: 'HARNESS', participantKind: 'harness' };

describe('entering as the full platform or the harness alone', () => {
  it('the harness opens on this wallet\'s lane, named for its model', () => {
    expect(entryPlan({ mode: 'harness', current: keir, harnessLane: lane, lastFull: null }))
      .toEqual({ phase: 'relink', companion: harness });
  });

  it('a first harness entry asks for a model once', () => {
    expect(entryPlan({ mode: 'harness', current: keir, harnessLane: null, lastFull: null }))
      .toEqual({ phase: 'harness-first-run' });
  });

  it('the full platform keeps the being you are with', () => {
    expect(entryPlan({ mode: 'full', current: keir, harnessLane: null, lastFull: null }))
      .toEqual({ phase: 'relink', companion: keir });
  });

  it('coming back from the harness returns to the being you left', () => {
    expect(entryPlan({ mode: 'full', current: harness, harnessLane: lane, lastFull: keir }))
      .toEqual({ phase: 'relink', companion: keir });
  });

  it('with no being to return to, the full platform offers the ways in', () => {
    expect(entryPlan({ mode: 'full', current: harness, harnessLane: lane, lastFull: null })).toEqual({ phase: 'choose' });
    expect(entryPlan({ mode: 'full', current: null, harnessLane: null, lastFull: null })).toEqual({ phase: 'choose' });
  });
});
