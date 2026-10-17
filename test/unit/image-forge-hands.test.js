import { describe, test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'fs';
import os from 'os';
import path from 'path';
import { toSlotArgs, renderPipelines, IMAGE_TOOLS, isImageTool } from '../../backend/services/image-forge/image-being-tools.js';
import { imageRefsFrom, containedPath, safeLaneSegment } from '../../backend/services/image-forge/image-store.js';
import { catalogForCaller } from '../../backend/services/image-forge/pack-registry.js';
import { GLOBAL_DEFAULTS, resolvePolicy, checkToolAccess } from '../../backend/services/tool-policy.js';

// Regression guards for three defects the LIVE run exposed that every unit
// test had passed straight over (2026-07-29). Each is a seam between two
// modules — exactly what unit tests of either side alone cannot see.

describe('toSlotArgs — the caller/slot name seam', () => {
  // The original spread used `prompt: undefined, pipeline: undefined`, which
  // CREATES those keys rather than removing them. resolveSlots refuses unknown
  // keys, so every single call was refused.
  test('strips the caller-facing names instead of setting them undefined', () => {
    const out = toSlotArgs({ prompt: 'a lighthouse', pipeline: 'still.sdxl.txt2img', steps: 20 });
    expect(Object.prototype.hasOwnProperty.call(out, 'prompt')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'pipeline')).toBe(false);
    expect(out).toEqual({ positive: 'a lighthouse', steps: 20 });
  });

  test('maps prompt onto the positive slot', () => {
    expect(toSlotArgs({ prompt: 'x' }).positive).toBe('x');
  });

  test('passes the other slots through untouched', () => {
    expect(toSlotArgs({ prompt: 'x', negative: 'blur', width: 768, seed: 5 }))
      .toEqual({ positive: 'x', negative: 'blur', width: 768, seed: 5 });
  });

  test('a missing prompt does not invent a positive key', () => {
    expect(Object.prototype.hasOwnProperty.call(toSlotArgs({ steps: 4 }), 'positive')).toBe(false);
  });

  test('survives a null or non-object args', () => {
    expect(toSlotArgs(null)).toEqual({});
    expect(toSlotArgs(undefined)).toEqual({});
  });
});

describe('imageRefsFrom — the job-lane/store shape seam', () => {
  // runJob FLATTENS history into an array of refs; getHistory returns the raw
  // node-keyed map. The collector assumed only the map, so a successful render
  // collected nothing.
  test('accepts the FLAT array runJob actually returns', () => {
    const refs = imageRefsFrom([{ filename: 'a_00001_.png', subfolder: 'neuma', type: 'output' }]);
    expect(refs).toEqual([{ filename: 'a_00001_.png', subfolder: 'neuma' }]);
  });

  test('accepts the node-keyed map getHistory returns', () => {
    const refs = imageRefsFrom({ 9: { images: [{ filename: 'b.png', subfolder: '', type: 'output' }] } });
    expect(refs).toEqual([{ filename: 'b.png', subfolder: '' }]);
  });

  test('collects gifs alongside images', () => {
    expect(imageRefsFrom({ 9: { gifs: [{ filename: 'c.gif', subfolder: '' }] } })).toHaveLength(1);
  });

  test('skips temp previews — only outputs are results', () => {
    expect(imageRefsFrom([{ filename: 'p.png', subfolder: '', type: 'temp' }])).toHaveLength(0);
  });

  test('skips malformed refs rather than throwing', () => {
    expect(imageRefsFrom([{ subfolder: 'x' }, null, { filename: '' }])).toHaveLength(0);
    expect(imageRefsFrom(null)).toEqual([]);
  });
});

describe('containedPath — realpath containment on engine-supplied names', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'forge-contain-'));
  const outputDir = path.join(root, 'output');
  mkdirSync(path.join(outputDir, 'neuma'), { recursive: true });
  writeFileSync(path.join(outputDir, 'neuma', 'ok.png'), 'x');
  writeFileSync(path.join(root, 'outside.png'), 'x');

  test('resolves a real file inside the tree', () => {
    expect(containedPath(outputDir, { filename: 'ok.png', subfolder: 'neuma' })).toContain('ok.png');
  });

  test('refuses a traversing subfolder', () => {
    expect(containedPath(outputDir, { filename: 'outside.png', subfolder: '../' })).toBeNull();
  });

  test('refuses a traversing filename', () => {
    expect(containedPath(outputDir, { filename: '../outside.png', subfolder: '' })).toBeNull();
  });

  // The check is on the REALPATH, so a symlink planted in the output tree
  // cannot be followed out of it.
  test('refuses a symlink that escapes the tree', () => {
    symlinkSync(path.join(root, 'outside.png'), path.join(outputDir, 'escape.png'));
    expect(containedPath(outputDir, { filename: 'escape.png', subfolder: '' })).toBeNull();
  });

  test('a missing file resolves to null, never a throw', () => {
    expect(containedPath(outputDir, { filename: 'nope.png', subfolder: '' })).toBeNull();
  });
});

describe('lane segments reaching the filesystem', () => {
  test('a traversing lane id is reduced to a safe segment', () => {
    expect(safeLaneSegment('../../etc')).toBe('etc');
    expect(safeLaneSegment('witness-anthropic-Claude')).toBe('witness-anthropic-Claude');
  });

  test('a lane id that reduces to nothing is empty, so the caller must refuse', () => {
    expect(safeLaneSegment('../..')).toBe('');
    expect(safeLaneSegment(null)).toBe('');
  });
});

describe('the advertised family and its gate', () => {
  // Two tools now (Stage 3): reading the catalog and judging what came out.
  // MAKING the image is the image/generate intent — filed, carded by the
  // sweep, executed against the real engine.
  test('exactly two tools, on the image namespace', () => {
    expect(IMAGE_TOOLS.map((t) => t.name)).toEqual(['list_pipelines', 'review_image']);
    expect(IMAGE_TOOLS.every((t) => t.server === 'image')).toBe(true);
  });

  test('review_image asks for the two columns a judgment cannot omit', () => {
    // Adherence and verdict are required; the craft and preference columns are
    // optional because not every image has a defect or invites an opinion.
    const review = IMAGE_TOOLS.find((t) => t.name === 'review_image');
    expect(review.inputSchema.required).toEqual(['imageId', 'matches', 'verdict']);
    expect(review.inputSchema.properties.verdict.enum).toEqual(['keep', 'redo', 'discard']);
    expect(review.inputSchema.properties.matches.enum).toEqual(['yes', 'partial', 'no']);
  });

  test('recognizes both the namespaced and bare call spellings — never the retired act', () => {
    expect(isImageTool({ toolName: 'image__generate_image' })).toBe(false);
    expect(isImageTool({ tool: 'image/list_pipelines' })).toBe(true);
    expect(isImageTool({ toolName: 'media_save' })).toBe(false);
  });

  // Reading the catalog is observation; generating is the image/generate
  // intent — it seizes the GPU and authors something the house may publish,
  // so its intents row carries the card.
  test('the default policy reads freely and asks before generating', () => {
    const policy = resolvePolicy(GLOBAL_DEFAULTS, null, null);
    expect(checkToolAccess(policy, 'image', 'list_pipelines')).toBe('allowed');
    expect(checkToolAccess(policy, 'intents', 'image.generate')).toBe('approval_required');
    // A being does not ask permission to hold an opinion about its own work.
    expect(checkToolAccess(policy, 'image', 'review_image')).toBe('allowed');
  });

  test('an unknown image tool still resolves fail-closed', () => {
    const policy = resolvePolicy(GLOBAL_DEFAULTS, null, null);
    expect(checkToolAccess(policy, 'image', 'delete_everything')).toBe('approval_required');
  });
});

describe('renderPipelines', () => {
  test('names every pipeline with its bounds so a caller need not guess', () => {
    const text = renderPipelines(catalogForCaller());
    expect(text).toContain('still.sdxl.txt2img');
    expect(text).toContain('[required]');
    expect(text).toContain('requires a source image');
    expect(text).toMatch(/steps: 1–60/);
  });
});
