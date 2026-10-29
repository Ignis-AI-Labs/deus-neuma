/**
 * THE RETURN — a being sees what it made.
 *
 * The folds and the notes are pure. The read path runs against a REAL PNG on a
 * REAL disk, stored by the REAL `collectOutputs` and resolved by the REAL
 * `resolveImage` — no fs mock anywhere (RULE 0). A mocked read would prove only
 * that the mock returns bytes; the claim under test is that the exact bytes a
 * render wrote come back out as something a model can actually look at.
 *
 * `withSight` is exercised against the REAL `composeVisionTurn` the streams use,
 * because the thing that can break here is the seam between them, not either
 * side alone.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  base64Chars, fitsSight, foldSight, sightNote, readSight, sightForResults, withSight,
} from '../../backend/services/image-forge/image-sight.js';
import { collectOutputs } from '../../backend/services/image-forge/image-store.js';
import { composeVisionTurn } from '../../backend/services/portal-turn-input.js';
import { formatToolResults } from '../../backend/services/tool-exchange.js';
import { stampPng } from '../../backend/services/image-forge/ai-disclosure.js';

// A real 1×1 PNG — genuine image bytes, so the round-trip below is a real
// round-trip and not a string exercise.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const LANE = 'sight-lane';

let dir;
let storeRoot;
let stored;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'image-sight-'));
  const outputDir = path.join(dir, 'out');
  storeRoot = path.join(dir, 'store');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, 'render.png'), PNG_1X1);
  stored = collectOutputs({
    outputDir,
    outputs: [{ filename: 'render.png', subfolder: '', type: 'output' }],
    laneId: LANE,
    jobId: 'job-1',
    laneDir: path.join(storeRoot, LANE),
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the fit check — pure', () => {
  test('counts base64 characters without reading the file', () => {
    expect(base64Chars(3)).toBe(4);
    expect(base64Chars(1)).toBe(4);
    expect(base64Chars(6)).toBe(8);
  });

  test('an image under the ceiling fits, one over it does not', () => {
    expect(fitsSight(1000, 'image/png', 10_000)).toBe(true);
    expect(fitsSight(10_000, 'image/png', 1000)).toBe(false);
  });

  test('a zero-byte or unmeasured image never fits', () => {
    // Better to withhold and say so than to put an empty data URI in a prompt.
    expect(fitsSight(0, 'image/png')).toBe(false);
    expect(fitsSight(undefined, 'image/png')).toBe(false);
  });
});

describe('foldSight — what a round offers the eye, pure', () => {
  test('takes only results that actually succeeded and carry sight', () => {
    const refs = foldSight([
      { tool: 'image/generate_image', status: 'ok', sight: { laneId: 'a', imageIds: ['1'] } },
      { tool: 'image/generate_image', status: 'error', sight: { laneId: 'a', imageIds: ['2'] } },
      { tool: 'fs/read_file', status: 'ok' },
    ]);
    expect(refs).toEqual([{ laneId: 'a', imageId: '1' }]);
  });

  test('the lane comes from the RESULT, never from a caller', () => {
    // The structural reason a result can only ever offer up images from the
    // lane that produced them.
    const refs = foldSight([{ status: 'ok', sight: { laneId: 'lane-b', imageIds: ['x', 'y'] } }]);
    expect(refs.every((r) => r.laneId === 'lane-b')).toBe(true);
  });

  test('caps at the operator-attachment limit', () => {
    const refs = foldSight([{ status: 'ok', sight: { laneId: 'a', imageIds: ['1', '2', '3', '4', '5', '6'] } }]);
    expect(refs).toHaveLength(4);
  });

  test('an ordinary round offers nothing', () => {
    expect(foldSight([{ tool: 'fs/read_file', status: 'ok', content: 'hi' }])).toEqual([]);
    expect(foldSight(undefined)).toEqual([]);
  });
});

describe('sightNote — pure', () => {
  test('a blind substrate is TOLD it is blind, and named', () => {
    const note = sightNote({ shown: 0, withheld: 1, blind: true, modelName: 'gemma-4-31b' });
    expect(note).toContain('NOT in front of you');
    expect(note).toContain('gemma-4-31b');
    // The failure this prevents: a model narrating an image it never saw.
    expect(note).toContain('rather than describing what you have not seen');
  });

  test('a seeing substrate is pointed at adherence, and at the record', () => {
    const note = sightNote({ shown: 1, withheld: 0 });
    expect(note).toContain('you are looking at it now');
    expect(note).toContain('adherence is objective');
    expect(note).toContain('review_image');
  });

  test('a withheld image is counted, never silently dropped', () => {
    expect(sightNote({ shown: 1, withheld: 2 })).toContain('2 further images');
    expect(sightNote({ shown: 0, withheld: 3 })).toContain('All 3 images');
  });

  test('nothing to say says nothing', () => {
    expect(sightNote({ shown: 0, withheld: 0 })).toBe('');
  });
});

describe('readSight — the real bytes, off a real disk', () => {
  test('the exact bytes the render wrote come back as a data URI', () => {
    const { images, withheld } = readSight([{ laneId: LANE, imageId: stored[0].imageId }], storeRoot);
    expect(withheld).toBe(0);
    expect(images).toHaveLength(1);
    expect(images[0].startsWith('data:image/png;base64,')).toBe(true);
    // The whole claim: what comes back IS the image, byte for byte.
    const decoded = Buffer.from(images[0].split(',')[1], 'base64');
    // Stored = the render's own bytes plus its AI disclosure, and nothing else (ai-disclosure.js).
    expect(decoded.equals(stampPng(PNG_1X1))).toBe(true);
  });

  test('an id that was never recorded is withheld, not thrown', () => {
    const { images, withheld } = readSight([{ laneId: LANE, imageId: 'never-existed' }], storeRoot);
    expect(images).toEqual([]);
    expect(withheld).toBe(1);
  });

  test('another lane cannot be read through a forged reference', () => {
    const { images, withheld } = readSight([{ laneId: 'someone-else', imageId: stored[0].imageId }], storeRoot);
    expect(images).toEqual([]);
    expect(withheld).toBe(1);
  });
});

describe('sightForResults — the whole return leg', () => {
  const okResult = () => [{
    tool: 'image/generate_image', status: 'ok',
    sight: { laneId: LANE, imageIds: [stored[0].imageId] },
  }];

  test('a seeing substrate gets the image and the instruction', () => {
    const sight = sightForResults(okResult(), { canSee: true, root: storeRoot });
    expect(sight.images).toHaveLength(1);
    expect(sight.note).toContain('review_image');
  });

  test('a blind substrate gets NO image and an honest note', () => {
    const sight = sightForResults(okResult(), { canSee: false, modelName: 'blind-model', root: storeRoot });
    expect(sight.images).toEqual([]);
    expect(sight.note).toContain('blind-model');
    expect(sight.note).toContain('NOT in front of you');
  });

  test('an ordinary round is untouched', () => {
    const sight = sightForResults([{ tool: 'fs/read_file', status: 'ok' }], { canSee: true });
    expect(sight).toEqual({ images: [], note: '' });
  });

  test('the tool-result FORMATTER does not strip sight off the results', () => {
    // Raised in review: `formatToolResults` (tool-exchange.js) runs `compressToolResult` over the
    // same array this reads, and if compression rebuilt the result OBJECTS then
    // `sight` would vanish and the whole return leg would silently never fire.
    // It compresses the content STRING and leaves the objects alone — asserted
    // here against the REAL formatter, so a future refactor that maps the array
    // has to break this test to land.
    const results = okResult();
    const before = JSON.stringify(results[0].sight);
    formatToolResults(results);
    expect(JSON.stringify(results[0].sight)).toBe(before);
    expect(sightForResults(results, { canSee: true, root: storeRoot }).images).toHaveLength(1);
  });
});

describe('withSight — the seam, against the real composeVisionTurn', () => {
  const textExchange = () => [
    { role: 'assistant', content: 'rendering now' },
    { role: 'user', content: '<tool_response>\nimage/generate_image → ok\n</tool_response>' },
  ];
  const nativeExchange = () => [
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1' }] },
    { role: 'tool', tool_call_id: 'c1', content: 'image id: abc' },
  ];

  test('no sight leaves the exchange byte-identical — every ordinary round', () => {
    const before = textExchange();
    expect(withSight(before, { images: [], note: '' }, composeVisionTurn)).toBe(before);
  });

  test('a TEXT exchange carries the image inside its existing user turn', () => {
    // Two consecutive user messages are not legal in every dialect, so the
    // images must join the tool-response turn rather than follow it.
    const out = withSight(textExchange(), { images: ['data:image/png;base64,AAA'], note: '[look]' }, composeVisionTurn);
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe('user');
    expect(Array.isArray(out[1].content)).toBe(true);
    const parts = out[1].content;
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(1);
    expect(parts.find((p) => p.type === 'text').text).toContain('[look]');
    // The tool results themselves survive into the composed turn.
    expect(parts.find((p) => p.type === 'text').text).toContain('<tool_response>');
  });

  test('a NATIVE exchange gets a fresh user turn after the tool results', () => {
    // tool → user is a legal role change everywhere; no dialect but Anthropic's
    // carries an image inside a tool result at all.
    const out = withSight(nativeExchange(), { images: ['data:image/png;base64,AAA'], note: '[look]' }, composeVisionTurn);
    expect(out).toHaveLength(3);
    expect(out[2].role).toBe('user');
    expect(out[2].content.filter((p) => p.type === 'image_url')).toHaveLength(1);
    // The tool result is untouched — it never becomes multimodal.
    expect(out[1]).toEqual(nativeExchange()[1]);
  });

  test('a note with no image still rides, so nothing is assumed seen', () => {
    const out = withSight(textExchange(), { images: [], note: '[you cannot see this]' }, composeVisionTurn);
    expect(out).toHaveLength(2);
    expect(typeof out[1].content).toBe('string');
    expect(out[1].content).toContain('[you cannot see this]');
  });
});
