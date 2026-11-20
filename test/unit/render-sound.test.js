/**
 * THE MAKING-AN-IMAGE LOOP (render-sound.js, cue `neumaRendering`) — Design note, 2026-11-20: […] While an image or video act of the reply in progress has not finished, its
 * own loop plays and the thinking loop steps aside; never the two together. The decisions are pure and tested as
 * such; the baked sprite is read for real, its level measured.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { spawnSync } from 'node:child_process';

let isRenderingNow, shouldRenderSound, acquireRenderSound, releaseRenderSound, playingLoop, isThinkingNow, boardGroups, cueLabel, SOUND_MANIFEST;
beforeAll(async () => {
  // sound-engine.js listens on `window` at import time — the browser global, stubbed at the boundary thinking-sound.test.js stubs it.
  globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
  ({ isRenderingNow, shouldRenderSound, acquireRenderSound, releaseRenderSound } = await import('../../frontend/app/RelinkShell/render-sound.js'));
  ({ playingLoop } = await import('../../frontend/app/RelinkShell/desk-loops.js'));
  ({ isThinkingNow } = await import('../../frontend/app/RelinkShell/thinking-sound.js'));
  ({ boardGroups, cueLabel } = await import('../../frontend/services/sound-board.js'));
  ({ SOUND_MANIFEST } = await import('../../frontend/services/sound-manifest.js'));
});

const turn = (segments, streaming = true) => ({ thinking: false, messages: [{ role: 'user' }, { role: 'neuma', streaming, segments }] });

describe('when a being is making an image', () => {
  it('while an image or video act of the reply in progress is under way — however its chip is named — and not once it is done', () => {
    expect(isRenderingNow(turn([{ kind: 'tool', label: 'image/generate', phase: 'resolved', status: 'running', summary: 'rendering image — FLUX.2 klein' }]))).toBe(true);
    expect(isRenderingNow(turn([{ kind: 'tool', label: 'intents/image.generate', phase: 'acting' }]))).toBe(true);
    expect(isRenderingNow(turn([{ kind: 'tool', label: 'video/generate', phase: 'resolved', status: 'running' }]))).toBe(true);
    // A thought that streams while the render works keeps it a render.
    expect(isRenderingNow(turn([{ kind: 'tool', label: 'image/generate', status: 'running' }, { kind: 'thought', text: 'waiting on it' }]))).toBe(true);
    expect(isRenderingNow(turn([{ kind: 'tool', label: 'image/generate', phase: 'resolved', status: 'ok' }]))).toBe(false);
    expect(isRenderingNow(turn([{ kind: 'tool', label: 'files/read', phase: 'acting' }]))).toBe(false);
    expect(isRenderingNow(turn([{ kind: 'tool', label: 'image/generate', status: 'running' }], false))).toBe(false);
    expect(isRenderingNow(undefined)).toBe(false);
  });

  it('sounds while a chat renders, silent in a talk; the thinking loop steps aside for it', () => {
    expect(shouldRenderSound({ holders: 1 })).toBe(true);
    expect(shouldRenderSound({ holders: 1, sittingActive: true })).toBe(false);
    expect(shouldRenderSound({ holders: 0 })).toBe(false);
    // The chat's own choice (ChatApp.jsx): a render is not thinking, even with a thought streaming beside it.
    const rendering = turn([{ kind: 'tool', label: 'image/generate', status: 'running' }, { kind: 'thought', text: 'hm' }]);
    expect(isRenderingNow(rendering) && isThinkingNow(rendering)).toBe(true);
    // …and across chats the desk plays the render loop, one loop at a time (desk-loops.js).
    acquireRenderSound();
    expect(playingLoop()).toBe('neumaRendering');
    releaseRenderSound();
  });
});

describe('the sound itself', () => {
  it('is its own cue, baked into the sprite, on the soundboard beside thinking by name, at the thinking loop\'s level', () => {
    expect(SOUND_MANIFEST.neumaRendering).toMatch(/DataReadout_BW\.44595\.wav$/);
    const sprite = JSON.parse(readFileSync(new URL('../../frontend/sounds-baked/sprite.json', import.meta.url), 'utf8'));
    const cue = sprite.events.neumaRendering;
    expect(cue.duration).toBeCloseTo(1.4987, 3);
    expect(cueLabel('neumaRendering')).toBe('A being is making an image (loop)');
    expect(boardGroups(['neumaThinking', 'neumaRendering', 'neumaReplying']).find((g) => g.id === 'notices').cues).toEqual(['neumaThinking', 'neumaRendering', 'neumaReplying']);
    // Measured in the baked sprite: within 2 dB of the thinking loop's mean.
    const meanOf = ({ start, duration }) => {
      const out = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(start), '-t', String(duration), '-i', new URL('../../frontend/sounds-baked/sprite.wav', import.meta.url).pathname, '-af', 'volumedetect', '-f', 'null', '/dev/null'], { encoding: 'utf8' });
      return Number(/mean_volume: (-?[\d.]+) dB/.exec(out.stderr)[1]);
    };
    expect(Math.abs(meanOf(cue) - meanOf(sprite.events.neumaThinking))).toBeLessThan(2);
  });
});
