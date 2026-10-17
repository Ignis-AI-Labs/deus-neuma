/**
 * READING AN IMAGE PUTS IT IN FRONT OF THE BEING'S EYES.
 *
 * Design note, 2026-08-29: […]
 *
 * BOTH DOORS WERE BROKEN, and that is the point of this file.
 *
 *   `read_text_file` read a PNG as UTF-8 and came back with nothing usable —
 *   silently, with no error and no hint the file was an image. Metidar, on
 *   screen: […]
 *
 *   `read_media_file` returned an MCP `{type:'image'}` block, which LOOKS
 *   right and is invisible: the eye works on `sight: {laneId, imageIds}` and
 *   `foldSight` filters on exactly that, so a content block was skipped and
 *   flattened into a wall of base64 the model cannot see.
 *
 * These tests use the REAL sight fold (`foldSight`) and the REAL ephemeral
 * store, never a stand-in — the whole failure was two real systems not
 * meeting, so a mock of either would have proven nothing.
 */
import { describe, test, expect } from 'vitest';
import {
  imageBlocksIn, sightPlaceholder, withoutImageBytes, withFileSight, SIGHTED_MIME,
} from '../../backend/services/fs-sight.js';
import { foldSight } from '../../backend/services/image-forge/image-sight.js';
import { takeEphemeralSight } from '../../backend/services/image-forge/ephemeral-sight.js';
import { readFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

// A real 1x1 PNG — actual bytes, so the store's own format gate is exercised.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const imageResult = (n = 1, mimeType = 'image/png') => ({
  content: Array.from({ length: n }, () => ({ type: 'image', data: PNG_B64, mimeType })),
  structuredContent: { content: [{ type: 'image', data: PNG_B64, mimeType }] },
});
const textResult = (text) => ({ content: [{ type: 'text', text }] });

const LANE = 'sight-probe-lane';

describe('finding what there is to look at', () => {
  test('an image block is found; a text result has nothing in it', () => {
    expect(imageBlocksIn(imageResult())).toHaveLength(1);
    expect(imageBlocksIn(textResult('hello'))).toHaveLength(0);
    expect(imageBlocksIn(null)).toHaveLength(0);
    expect(imageBlocksIn({})).toHaveLength(0);
  });

  test('only mimes the EYE takes count — a promise of a look must be keepable', () => {
    // Audio, SVG and PDFs have no vision path. Routing them here would tell a
    // being it is about to see something it never will.
    expect(SIGHTED_MIME).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    for (const mime of ['audio/mpeg', 'image/svg+xml', 'image/gif', 'application/pdf']) {
      expect(imageBlocksIn(imageResult(1, mime)), mime).toHaveLength(0);
    }
  });

  test('a malformed block is not an image', () => {
    for (const block of [{ type: 'image', mimeType: 'image/png' }, { type: 'image', data: '', mimeType: 'image/png' }]) {
      expect(imageBlocksIn({ content: [block] })).toHaveLength(0);
    }
  });
});

describe('THE BRIDGE: a read becomes sight the real fold can see', () => {
  test('THE REGRESSION: the result now carries what foldSight actually reads', () => {
    // The whole bug in one assertion. Before, an image read produced a content
    // block and foldSight — which filters on `sight.laneId` — skipped it.
    const before = imageResult();
    expect(foldSight([{ status: 'ok', ...before }])).toHaveLength(0);

    const after = withFileSight(before, LANE);
    const refs = foldSight([{ status: 'ok', ...after }]);
    expect(refs).toHaveLength(1);
    expect(refs[0].laneId).toBe(LANE);
    expect(refs[0].store).toBe('ephemeral');
  });

  test('the bytes are really held, and are the ones that were read', () => {
    const out = withFileSight(imageResult(), LANE);
    const entry = takeEphemeralSight(LANE, out.sight.imageIds[0]);
    expect(entry).toBeTruthy();
    expect(entry.mime).toBe('image/png');
    expect(entry.bytes.toString('base64')).toBe(PNG_B64);
  });

  test('THE BASE64 NEVER REACHES THE MODEL', () => {
    // It is unreadable to it and would spend the whole window on bytes nobody
    // can see. What is left is one short line.
    const out = withFileSight(imageResult(), LANE);
    expect(JSON.stringify(out.content)).not.toContain(PNG_B64);
    expect(JSON.stringify(out.structuredContent)).not.toContain(PNG_B64);
    expect(out.content.filter((b) => b.type === 'image')).toHaveLength(0);
    expect(out.content.at(-1).type).toBe('text');
  });

  test('the line says the picture is COMING, never that it has arrived', () => {
    // The images land on the NEXT message — that is how the fold works. A line
    // claiming "here it is" beside no image teaches a being to describe things
    // it has not seen, which is the one habit this platform refuses to build.
    const note = withFileSight(imageResult(), LANE).content.at(-1).text;
    expect(note).toMatch(/next turn/i);
    expect(note).not.toMatch(/you are looking at it now/i);
  });

  test('several images in one read all ride', () => {
    const out = withFileSight(imageResult(3), LANE);
    expect(out.sight.imageIds).toHaveLength(3);
    expect(out.content.at(-1).text).toContain('3 images');
  });

  test('a non-image read is returned UNTOUCHED — this costs ordinary reads nothing', () => {
    const plain = textResult('a config file');
    expect(withFileSight(plain, LANE)).toBe(plain);
    expect(withFileSight(plain, null)).toBe(plain);
  });

  test('other content blocks survive beside the note', () => {
    const mixed = { content: [{ type: 'text', text: 'keep me' }, { type: 'image', data: PNG_B64, mimeType: 'image/png' }] };
    const out = withFileSight(mixed, LANE);
    expect(out.content[0]).toEqual({ type: 'text', text: 'keep me' });
    expect(out.content).toHaveLength(2);
  });
});

describe('the lane is the being’s own, and failure is never fatal', () => {
  test('NO LANE, NO SIGHT — and the unseeable bytes still come out', () => {
    // A tool argument must never be able to name someone else's lane, so the
    // lane comes from the connection or not at all. Without one the being is
    // told plainly it has not seen the picture — and is still not handed a
    // wall of base64.
    const out = withFileSight(imageResult(), null);
    expect(out.sight).toBeUndefined();
    expect(JSON.stringify(out.content)).not.toContain(PNG_B64);
    expect(out.content.at(-1).text).toMatch(/have not seen/i);
  });

  test('a lane the store cannot make sense of costs the LOOK, never the read', () => {
    // registerEphemeralSight throws when a lane sanitizes away to nothing. The
    // read itself succeeded; losing the whole tool call over the picture would
    // be the wrong trade, so the being is simply told it has not seen it.
    for (const lane of ['///', '!!!', '   ']) {
      const out = withFileSight(imageResult(), lane);
      expect(out.sight, lane).toBeUndefined();
      expect(out.content.at(-1).text, lane).toMatch(/have not seen/i);
      expect(() => JSON.parse(JSON.stringify(out))).not.toThrow();
    }
  });

  test('the lane is normalized IDENTICALLY on both sides of the store', () => {
    // The store strips a lane to [A-Za-z0-9_-] rather than rejecting it, and
    // the stamp carries the lane verbatim. That is only safe because the read
    // side normalizes the same way — otherwise a stamped ref could never be
    // taken back out. Pinned because a divergence here would be silent: the
    // picture would simply never arrive.
    const out = withFileSight(imageResult(), 'lane.with/odd-chars');
    expect(out.sight.laneId).toBe('lane.with/odd-chars');
    expect(takeEphemeralSight(out.sight.laneId, out.sight.imageIds[0])).toBeTruthy();
  });

  test('one look is ONE look — the bytes are gone after they are taken', () => {
    // Ephemeral means ephemeral: a second turn cannot re-read the same frame,
    // which is what keeps a file read out of a being's permanent record.
    const out = withFileSight(imageResult(), LANE);
    expect(takeEphemeralSight(LANE, out.sight.imageIds[0])).toBeTruthy();
    expect(takeEphemeralSight(LANE, out.sight.imageIds[0])).toBeFalsy();
  });

  test('the placeholder counts honestly in every case', () => {
    expect(sightPlaceholder(1)).toMatch(/Image read/);
    expect(sightPlaceholder(2)).toMatch(/2 images read/);
    expect(sightPlaceholder(1, 2)).toMatch(/2 could not be carried/);
    expect(sightPlaceholder(0)).toMatch(/have not seen/i);
  });

  test('withoutImageBytes keeps a result JSON-safe and shaped', () => {
    const out = withoutImageBytes(imageResult(2), new Set([0, 1]), 'note');
    expect(out.content).toEqual([{ type: 'text', text: 'note' }]);
    expect(out.structuredContent.content).toEqual([{ type: 'text', text: 'note' }]);
  });
});

describe('the carry — both turn loops must pass `sight` along', () => {
  /**
   * THE GAP THIS CLOSES. The sandbox stamps `sight` onto the tool result, and
   * each loop's return leg reads it back with `sightForResults`. But BOTH
   * loops rebuilt their result entry by hand — `{tool, status, content}` — and
   * dropped it. A being would have been told […] and then handed nothing, which is worse than the silence
   * it replaced: a promise of a look is only worth making if the look arrives.
   *
   * These are impure round-loops with no seam to call directly, so this is a
   * source-level pin — the same tactic websocket-disconnect-intentional.test.js
   * uses for browser-only code. It fails loudly if either loop stops carrying
   * it, which is the one way this breaks silently.
   */
  const loops = [
    ['neuma', 'backend/services/portal-tool-loop.js', "status: 'ok', ...fitRead("],
    ['witness', 'backend/services/witness-tools.js', "status: 'ok', content"],
  ];

  test.each(loops)('the %s loop carries sight onto its ok-result', async (_name, file, anchor) => {
    const src = await readFile(resolve(HERE, '../..', file), 'utf8');
    const at = src.indexOf(anchor);
    expect(at, `${file}: the ok-result shape moved — re-point this net`).toBeGreaterThan(-1);
    const line = src.slice(src.lastIndexOf('\n', at) + 1, src.indexOf('\n', src.indexOf('}', at)));
    expect(line, `${file} drops sight — the image would never arrive`).toContain('sight');
  });

  test('both loops read it back — the fold is on the return leg', async () => {
    for (const file of ['backend/services/portal-turn-rounds.js', 'backend/services/witness-tool-loop.js']) {
      const src = await readFile(resolve(HERE, '../..', file), 'utf8');
      expect(src, file).toContain('sightForResults');
    }
  });
});
