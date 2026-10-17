/**
 * THE OPERATOR'S EYE — the pure display law behind the gallery verdict panel.
 *
 * Pure throughout: real calls, real inputs, no mock anywhere (RULE 0).
 *
 * The claim that matters is the JOIN. A gallery item is a file; a verdict is
 * written against (lane, imageId). Both facts already ride existing surfaces —
 * the root is one per being, the file is named for its image id — so the panel
 * must appear for exactly the forge renders and for nothing else.
 */
import { describe, test, expect } from 'vitest';
import {
  forgeRefOf, splitReviews, verdictLine, askedLine, VERDICTS,
} from '../../frontend/app/RelinkShell/gallery/verdict-view.js';

const UUID = '0c76bccd-8138-488e-8ff8-9f32f200b89d';

describe('forgeRefOf — the join, pure', () => {
  test('a being\'s render resolves to its lane and image id', () => {
    expect(forgeRefOf({ rootId: 'being-comfy-proof', name: `${UUID}.png` }))
      .toEqual({ laneId: 'comfy-proof', imageId: UUID });
  });

  test('a witness lane resolves the same way', () => {
    // The image tools were registered once for both seats; so is this surface.
    expect(forgeRefOf({ rootId: 'being-witness-openai-chatgpt-Kagipem', name: `${UUID}.png` }))
      .toEqual({ laneId: 'witness-openai-chatgpt-Kagipem', imageId: UUID });
  });

  test('any extension the collector can store resolves', () => {
    expect(forgeRefOf({ rootId: 'being-x', name: `${UUID}.webp` })?.imageId).toBe(UUID);
    expect(forgeRefOf({ rootId: 'being-x', name: `${UUID}.jpg` })?.imageId).toBe(UUID);
  });

  test('a folder the operator added is NOT a being\'s art', () => {
    // No manifest row, no prompt behind it, nothing to judge adherence against.
    expect(forgeRefOf({ rootId: 'comfy-output', name: `${UUID}.png` })).toBeNull();
    expect(forgeRefOf({ rootId: 'pictures', name: `${UUID}.png` })).toBeNull();
  });

  test('a hand-dropped file in a being\'s folder is not a render', () => {
    expect(forgeRefOf({ rootId: 'being-x', name: 'holiday.png' })).toBeNull();
    expect(forgeRefOf({ rootId: 'being-x', name: 'IMG_2031.jpg' })).toBeNull();
    // Nearly-a-uuid must not pass — the guard is the collector's exact shape.
    expect(forgeRefOf({ rootId: 'being-x', name: '0c76bccd-8138-488e-8ff8.png' })).toBeNull();
  });

  test('junk in is null out, never a throw', () => {
    expect(forgeRefOf(null)).toBeNull();
    expect(forgeRefOf({})).toBeNull();
    expect(forgeRefOf({ rootId: 'being-', name: `${UUID}.png` })).toBeNull();
  });
});

describe('splitReviews — two standings, pure', () => {
  test('the being\'s row is never folded into the operator\'s', () => {
    const { operator, own } = splitReviews([
      { by: 'operator', verdict: 'keep' },
      { by: 'being', verdict: 'redo' },
      { by: 'being', verdict: 'keep' },
    ]);
    expect(operator).toHaveLength(1);
    expect(own).toHaveLength(2);
  });

  test('junk in is empty out', () => {
    expect(splitReviews(null)).toEqual({ operator: [], own: [] });
    expect(splitReviews([null])).toEqual({ operator: [], own: [] });
  });
});

describe('the lines — pure', () => {
  test('adherence is named, not buried', () => {
    expect(verdictLine({ verdict: 'redo', matches: 'partial' })).toBe('REDO · adherence partial');
    expect(verdictLine({ verdict: 'keep' })).toBe('KEEP');
  });

  test('the ask carries its negative when there was one', () => {
    expect(askedLine({ positive: 'three apples', negative: 'blur' })).toBe('three apples   —   not: blur');
    expect(askedLine({ positive: 'three apples' })).toBe('three apples');
  });

  test('a scrolled-out attempt reads as null, never as an empty prompt', () => {
    // The surface then says so in words rather than showing a blank ask.
    expect(askedLine(null)).toBeNull();
    expect(askedLine({ positive: '   ' })).toBeNull();
  });
});

describe('the verdicts offered', () => {
  test('are exactly the ledger\'s three', () => {
    expect(VERDICTS).toEqual(['keep', 'redo', 'discard']);
  });
});
