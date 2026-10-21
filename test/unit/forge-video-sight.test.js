/**
 * Video sight — the pure halves: when a clip is sampled, and what the being is
 * told it is looking at. Real functions, real inputs; no mocks (RULE 0). The
 * sampling and the transcript run live (docs/work/forge-engine-upgrade.md).
 */
import { describe, test, expect } from 'vitest';
import { frameTimes } from '../../backend/services/image-forge/video-sight.js';
import { foldSight, sightNote } from '../../backend/services/image-forge/image-sight.js';

describe('frameTimes — first moment to last, evenly', () => {
  test('a 4.84 s clip: four frames across it, never past the end', () => {
    expect(frameTimes(4.84)).toEqual([0, 1.58, 3.16, 4.74]);
  });
  test('a broken length samples nothing rather than guessing', () => {
    expect(frameTimes(NaN)).toEqual([]);
    expect(frameTimes(0)).toEqual([]);
  });
});

describe('the video-frames sight', () => {
  const result = { status: 'ok', sight: { laneId: 'keir', imageIds: ['a', 'b', 'c', 'd'], store: 'ephemeral', purpose: 'video-frames' } };

  test('the purpose rides the fold, so the note speaks of a clip across time', () => {
    expect(foldSight([result]).every((r) => r.purpose === 'video-frames' && r.store === 'ephemeral')).toBe(true);
  });

  test('seeing: names both judgments — adherence and cohesion — and the review', () => {
    const note = sightNote({ shown: 4, withheld: 0, purpose: 'video-frames' });
    expect(note).toMatch(/4 frames sampled across the clip/);
    expect(note).toMatch(/ADHERENCE/);
    expect(note).toMatch(/COHESION/);
    expect(note).toMatch(/review_image/);
  });

  test('blind: said as a fact, never narrated', () => {
    expect(sightNote({ shown: 0, withheld: 4, blind: true, modelName: 'text-only', purpose: 'video-frames' })).toMatch(/NOT in front of you/);
  });
});
