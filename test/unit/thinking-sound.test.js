/**
 * THE THINKING LOOP (thinking-sound.js, cue `neumaThinking`) — Design note, 2026-11-19: […] His own sound (frontend/sounds-own/thinking.wav), cleaned of
 * its ambient wash, baked into the sprite like every cue. It plays from the send until words start to appear, and
 * while reasoning streams; it steps aside for the typing bed and stays silent in a spoken sitting. The decisions are
 * pure and tested as such; the sprite and the cleaned file are read for real.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { spawnSync } from 'node:child_process';

let isThinkingNow, shouldThinkingSound, boardGroups, cueLabel, SOUND_MANIFEST;
beforeAll(async () => {
  // sound-engine.js listens on `window` at import time — the browser global, stubbed at the same boundary typing-sound.test.js stubs it.
  globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
  ({ isThinkingNow, shouldThinkingSound } = await import('../../frontend/app/RelinkShell/thinking-sound.js'));
  ({ boardGroups, cueLabel } = await import('../../frontend/services/sound-board.js'));
  ({ SOUND_MANIFEST } = await import('../../frontend/services/sound-manifest.js'));
});

describe('when a being is thinking', () => {
  it('from the send until words appear, and while its reasoning streams; not once it speaks, acts or is done', () => {
    expect(isThinkingNow({ thinking: true, messages: [] })).toBe(true);
    const turn = (segments, streaming = true) => ({ thinking: false, messages: [{ role: 'user' }, { role: 'neuma', streaming, segments }] });
    expect(isThinkingNow(turn([{ kind: 'thought', text: 'hm' }]))).toBe(true);
    expect(isThinkingNow(turn([{ kind: 'thought' }, { kind: 'speech', text: 'Hi' }]))).toBe(false);
    expect(isThinkingNow(turn([{ kind: 'tool' }]))).toBe(false);
    expect(isThinkingNow(turn([{ kind: 'thought' }], false))).toBe(false);
    expect(isThinkingNow(undefined)).toBe(false);
  });

  it('is wanted while a chat thinks and silent in a talk; the desk plays one loop at a time (desk-loops.js), words over it', () => {
    expect(shouldThinkingSound({ holders: 1 })).toBe(true);
    expect(shouldThinkingSound({ holders: 1, sittingActive: true })).toBe(false);
    expect(shouldThinkingSound({ holders: 0 })).toBe(false);
  });
});

describe('the sound itself', () => {
  it('is Founder\'s own, read from the tracked folder, baked into the sprite, and on the soundboard by name', () => {
    expect(SOUND_MANIFEST.neumaThinking).toBe('own/thinking.wav');
    const sprite = JSON.parse(readFileSync(new URL('../../frontend/sounds-baked/sprite.json', import.meta.url), 'utf8'));
    expect(sprite.events.neumaThinking.duration).toBeCloseTo(9.76, 2);
    expect(cueLabel('neumaThinking')).toBe('A being is thinking (loop)');
    expect(boardGroups(['neumaThinking', 'neumaReplying']).find((g) => g.id === 'notices').cues).toEqual(['neumaThinking', 'neumaReplying']);
  });

  it('is clean: the ambient wash between the blips is gone (measured, not assumed)', () => {
    const rms = (from, to) => {
      const out = spawnSync('ffmpeg', ['-v', 'info', '-i', new URL('../../frontend/sounds-own/thinking.wav', import.meta.url).pathname,
        '-af', `atrim=${from}:${to},astats=measure_overall=RMS_level:measure_perchannel=none`, '-f', 'null', '-'], { encoding: 'utf8' });
      return Number(/RMS level dB: (-?[\d.]+)/.exec(out.stderr)?.[1]);
    };
    expect(rms(3.7, 5.1)).toBeLessThan(-55); // the wash-only stretch: it was −37.6 dBFS in the original
    expect(rms(0, 1.2)).toBeGreaterThan(-25); // the blips keep their level (−21.4 in the original)
  });
});
