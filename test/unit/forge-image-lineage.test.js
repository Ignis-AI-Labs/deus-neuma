/**
 * IMAGE LINEAGE (image-lineage.js + the parameterizer) — a picture cannot launder a
 * prompt the content law refuses. The real lineage file on disk, the real compiled
 * screen, the real parameterizer. No mocks (RULE 0). The law here holds placeholder
 * tokens only: the real vocabulary is the reviewed law's, proven against the
 * law the app enforces by the content-law proof.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeLineage, lineageFor, recordLineage, MAX_LINEAGE_CHARS } from '../../backend/services/image-forge/image-lineage.js';
import { resolvePipeline, resolveModel } from '../../backend/services/image-forge/pack-registry.js';
import { parameterize } from '../../backend/services/image-forge/parameterizer.js';
import { compileScreenList } from '../../backend/services/image-forge/prompt-screen.js';

const LAW = compileScreenList({
  classes: {
    csam: [], age_minor: ['termminor'], sexual_explicit: ['termsexual'], sexual_suggestive: [],
    incest: [], bestiality: [], nonconsent: [],
  },
});
const make = (id, positive, sourceLineage) => {
  const pipeline = resolvePipeline(id).pipeline;
  return parameterize({
    pipeline, model: resolveModel(pipeline).model, args: { positive }, jobId: '7b0c6d1e-5b6a-4a71-9d6f-2a0d4e9c1f00',
    screenList: LAW, fallbackSeed: 1, sourceImageName: 'job.png', sourceLineage,
  });
};

describe('composeLineage', () => {
  test('its own prompt, then what its source was made from; an unknown source stays unknown', () => {
    expect(composeLineage('a still', undefined)).toBe('a still');
    expect(composeLineage('a clip of it', 'a still')).toBe('a clip of it\na still');
    expect(composeLineage('a clip of it', null)).toBeNull();
    expect(composeLineage('x'.repeat(MAX_LINEAGE_CHARS + 1), undefined)).toBeNull();
  });
});

describe('the lineage record — kept by the platform, bound to the file', () => {
  let dir, env, image;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-lineage-'));
    env = { COMFYUI_LINEAGE_PATH: path.join(dir, 'lineage.jsonl') };
    image = path.join(dir, 'a.png');
    fs.writeFileSync(image, 'the stored bytes');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('reads back for its own lane and image only', async () => {
    const { createHash } = await import('node:crypto');
    const sha256 = createHash('sha256').update('the stored bytes').digest('hex');
    recordLineage({ laneId: 'lane-a', imageId: 'img-1', sha256, lineage: 'a still' }, env);
    expect(lineageFor({ laneId: 'lane-a', imageId: 'img-1', file: image }, env)).toBe('a still');
    expect(lineageFor({ laneId: 'lane-b', imageId: 'img-1', file: image }, env)).toBeNull();
    expect(lineageFor({ laneId: 'lane-a', imageId: 'img-2', file: image }, env)).toBeNull();
    expect(fs.statSync(env.COMFYUI_LINEAGE_PATH).mode & 0o777).toBe(0o600);
  });

  test('a swapped file has no lineage — checked on the exact bytes about to be used', async () => {
    const { createHash } = await import('node:crypto');
    recordLineage({ laneId: 'lane-a', imageId: 'img-1', sha256: createHash('sha256').update('the stored bytes').digest('hex'), lineage: 'a still' }, env);
    fs.writeFileSync(image, 'other bytes');
    expect(lineageFor({ laneId: 'lane-a', imageId: 'img-1', file: image }, env)).toBeNull();
    expect(lineageFor({ laneId: 'lane-a', imageId: 'img-1', file: image, bytes: Buffer.from('the stored bytes') }, env)).toBe('a still');
  });

  test('no record, no lineage', () => {
    expect(lineageFor({ laneId: 'lane-a', imageId: 'img-1', file: image }, env)).toBeNull();
  });
});

describe('a job from an image is judged with what made the image', () => {
  test('two halves that pass alone are refused together, on every pipeline that starts from an image', () => {
    for (const id of ['video.wan.i2v', 'video.ltx.i2v', 'still.klein.edit', 'still.sdxl.img2img']) {
      expect(make(id, 'termsexual', 'a still')).toMatchObject({ ok: id === 'video.ltx.i2v' ? false : true });
      expect(make(id, 'a benign motion', 'termminor in a park')).toMatchObject({ ok: true });
      expect(make(id, 'termsexual', 'termminor in a park')).toMatchObject({ ok: false, refusalClass: 'minor_sexual' });
    }
  });

  test('a source not on record (or a caller that forgot the lineage) is never usable for sexual content', () => {
    expect(make('video.wan.i2v', 'termsexual', null)).toMatchObject({ ok: false, refusalClass: 'source_unrecorded' });
    expect(make('video.wan.i2v', 'termsexual', undefined)).toMatchObject({ ok: false, refusalClass: 'source_unrecorded' });
    expect(make('video.wan.i2v', 'a benign motion', null).ok).toBe(true);
  });

  test('a pipeline with no source image ignores lineage entirely', () => {
    expect(make('still.sdxl.txt2img', 'termsexual', 'termminor in a park').ok).toBe(true);
  });

  test('the model licence still applies to what the source shows', () => {
    expect(make('video.ltx.i2v', 'a benign motion', 'termsexual')).toMatchObject({ ok: false, refusalClass: 'licence:sexual_explicit' });
  });
});
