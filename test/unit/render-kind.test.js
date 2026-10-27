/**
 * A VIDEO RENDER SAYS VIDEO (Design note, 2026-10-23: […]). The naming map is
 * pure, so it is proven by calling the real functions with real registry
 * pipelines and reading what they say — no mock anywhere (RULE 0).
 */
import { describe, test, expect } from 'vitest';
import {
  renderKindOf, renderKindOfFiling, renderActName, renderLeaseLabel, renderingLine, readableSize,
  madeLine, madeTally, madeReceiptLine, renderScope, renderNoticeTitle,
} from '../../backend/services/image-forge/render-kind.js';
import { PIPELINES } from '../../backend/services/image-forge/pack-registry.js';
import { imageGenerateIntent } from '../../backend/services/intents/image-generate.js';
import { progressFrom } from '../../frontend/app/RelinkShell/tool-chip-tone.js';
import { reviewFieldsWanting, reviewRefusal } from '../../backend/services/image-forge/image-being-tools.js';

const CLIP = { imageId: 'c1', mime: 'video/mp4', bytes: 4.2 * 1024 * 1024 };
const STILL = { imageId: 's1', mime: 'image/png', bytes: 969 * 1024 };

describe('the kind is the pipeline registry\'s own', () => {
  test('every video pipeline reads video; every other kind (still, portrait, form) reads image', () => {
    const all = Object.values(PIPELINES);
    expect(all.filter((p) => p.kind === 'video').length).toBeGreaterThan(0);
    for (const p of all) expect(renderKindOf(p)).toBe(p.kind === 'video' ? 'video' : 'image');
  });

  test('a filing reads its kind from its pipeline field; none or unknown is the default still', () => {
    expect(renderKindOfFiling({ pipeline: 'video.ltx.i2v' })).toBe('video');
    expect(renderKindOfFiling({ pipeline: 'video.wan.i2v' })).toBe('video');
    expect(renderKindOfFiling({ pipeline: 'still.sdxl.txt2img' })).toBe('image');
    expect(renderKindOfFiling({})).toBe('image');
    expect(renderKindOfFiling({ pipeline: 'no.such.pipeline' })).toBe('image');
    expect(renderKindOfFiling(null)).toBe('image');
  });
});

describe('the words a person reads', () => {
  test('the act\'s name: video/generate for a clip, image/generate for a still', () => {
    expect(renderActName('video')).toBe('video/generate');
    expect(renderActName('image')).toBe('image/generate');
  });

  test('progress says what is rendering, and the chip still reads its percent', () => {
    expect(renderingLine('video', '50%')).toBe('rendering video — 50%');
    expect(renderingLine('image', 'SDXL — text to image')).toBe('rendering image — SDXL — text to image');
    expect(progressFrom(renderingLine('video', '50%'))).toBe(50);
    expect(progressFrom(renderingLine('video', PIPELINES['video.wan.i2v'].label))).toBeNull();
  });

  test('the finished line: a clip by size, length and orientation; a still by size and canvas', () => {
    expect(madeLine('video', [CLIP], { seconds: 5, width: 720, height: 1280 })).toBe('made 1 video — 4.2 MB · 5 s · portrait');
    expect(madeLine('video', [CLIP], { seconds: 3, width: 1280, height: 720 })).toBe('made 1 video — 4.2 MB · 3 s · landscape');
    expect(madeLine('image', [STILL], { width: 1024, height: 1024 })).toBe('made 1 image — 969 KB · 1024×1024');
    expect(madeLine('image', [STILL, STILL], {})).toBe('made 2 images — 969 KB');
  });

  test('sizes read as a person reads them', () => {
    expect(readableSize(969 * 1024)).toBe('969 KB');
    expect(readableSize(4.2 * 1024 * 1024)).toBe('4.2 MB');
    expect(readableSize(10)).toBe('1 KB');
    expect(readableSize(undefined)).toBe('');
  });

  test('the forge row, the machine line and the being\'s receipt name the kind', () => {
    expect(madeTally('video', 1, { seconds: 5, width: 720, height: 1280, seed: 42 })).toBe('1 video · 5 s · portrait · seed 42');
    expect(madeTally('image', 2, { width: 768, height: 768, seed: 7 })).toBe('2 images · 768×768 · seed 7');
    expect(renderLeaseLabel('video', 'LTX-2.5 — image to video, with sound')).toBe('Video Forge — LTX-2.5 — image to video, with sound');
    expect(renderLeaseLabel('image', 'SDXL — text to image')).toBe('Image Forge — SDXL — text to image');
    expect(madeReceiptLine('video', CLIP, { seconds: 5, width: 720, height: 1280 })).toBe('- video id: c1 (video/mp4, 4.2 MB, 5 s, portrait)');
    expect(madeReceiptLine('image', STILL, {})).toBe('- image id: s1 (image/png, 969 KB)');
  });

  test('the card\'s scope says what the yes renders, and from which still', () => {
    expect(renderScope('video', { prompt: 'the water  ripples', pipeline: 'video.ltx.i2v', image: 'abc' }))
      .toBe('render a video from image abc: "the water ripples" (video.ltx.i2v)');
    expect(renderScope('image', { prompt: 'a lighthouse' })).toBe('render an image: "a lighthouse"');
  });

  test('the desk notice names a video as a video', () => {
    expect(renderNoticeTitle({ phase: 'done', kind: 'video', beingName: 'Umbrae' })).toBe('Umbrae finished a video');
    expect(renderNoticeTitle({ phase: 'error', kind: 'video' })).toBe('A being could not finish a video');
    expect(renderNoticeTitle({ phase: 'stopped', beingName: 'Umbrae' })).toBe('Umbrae stopped an image');
    expect(renderNoticeTitle({ phase: 'done' })).toBe('A being finished an image');
  });
});

describe('the image/generate intent speaks the map (the real type module)', () => {
  test('displayName and the card summary follow the pipeline', () => {
    expect(imageGenerateIntent.name).toBe('image/generate'); // the wire type never moved
    expect(imageGenerateIntent.policyTool).toBe('image.generate'); // a still's grant row never moved
    // A clip asks on its own row (2026-10-23): ALWAYS for stills never covers it.
    expect(imageGenerateIntent.policyToolFor({ pipeline: 'video.ltx.i2v', prompt: 'x', image: 'i1' })).toBe('video.generate');
    expect(imageGenerateIntent.policyToolFor({ pipeline: 'video.wan.i2v', prompt: 'x', image: 'i1' })).toBe('video.generate');
    expect(imageGenerateIntent.policyToolFor({ prompt: 'x' })).toBe('image.generate');
    expect(imageGenerateIntent.policyToolFor({ pipeline: 'no.such.pipeline', prompt: 'x' })).toBe('image.generate');
    expect(imageGenerateIntent.displayName({ pipeline: 'video.wan.i2v', prompt: 'x', image: 'i1' })).toBe('video/generate');
    expect(imageGenerateIntent.displayName({ prompt: 'x' })).toBe('image/generate');
    expect(imageGenerateIntent.summarize({ pipeline: 'video.wan.i2v', prompt: 'slow push in', image: 'i1' }))
      .toBe('render a video from image i1: "slow push in" (video.wan.i2v)');
    expect(imageGenerateIntent.summarize({ prompt: 'a lighthouse' })).toBe('render an image: "a lighthouse"');
  });
});

describe('review_image names every required field it is missing, by the name the call uses', () => {
  test('a call without matches is told matches, its values, and the whole required set', () => {
    const wanting = reviewFieldsWanting({ imageId: 'i1', matches: null, verdict: 'keep' }, { imageId: 'i1', verdict: 'keep' });
    expect(wanting.map((w) => w.field)).toEqual(['matches']);
    const said = reviewRefusal(wanting);
    expect(said).toContain('review_image needs matches (missing): one of yes, partial, no');
    expect(said).toContain('{imageId, matches, verdict}');
    expect(said).not.toContain('adherence');
  });

  test('a wrong value is quoted back; several wrong fields are named in one refusal', () => {
    const wanting = reviewFieldsWanting({ imageId: '', matches: null, verdict: null }, { matches: 'maybe' });
    expect(wanting.map((w) => w.field)).toEqual(['imageId', 'matches', 'verdict']);
    const said = reviewRefusal(wanting);
    expect(said).toContain('matches (was "maybe")');
    expect(said).toContain('verdict (missing): one of keep, redo, discard');
    expect(said).toContain('imageId (missing)');
  });

  test('a whole call wants nothing', () => {
    expect(reviewFieldsWanting({ imageId: 'i1', matches: 'yes', verdict: 'keep' }, {})).toEqual([]);
  });
});
