import { readFileSync } from 'node:fs';
import { describe, test, expect } from 'vitest';
import { SOFT_PACK } from '../../frontend/services/soft-sound/soft-cues.js';
import { cueSpanMs, hzOf, notesOf, renderCue } from '../../frontend/services/soft-sound/soft-render.js';
import { UI_SOUND } from '../../frontend/services/ui-sound-map.js';
import { ACT_CUES } from '../../frontend/services/act-sound-map.js';
import { boardGroups, cueLabel } from '../../frontend/services/sound-board.js';

// Pure data + pure functions — real cues rendered to real samples; no mock,
// no Web Audio. These are THE SOFT PACK's own laws (soft-cues.js header).

const SR = 48000;
const CUES = Object.keys(SOFT_PACK.cues);
const SPRITE = JSON.parse(readFileSync(new URL('../../frontend/sounds-baked/sprite.json', import.meta.url), 'utf8'));
const D_PENTATONIC = new Set([2, 4, 6, 9, 11]); // D E F♯ A B as semitones above C
const pitchClass = (hz) => ((Math.round(12 * Math.log2(hz / 440)) + 9) % 12 + 12) % 12;
const pitchesOf = (cue) => notesOf(SOFT_PACK.cues[cue]).flatMap((n) => (n.to ? [n.note, n.to] : [n.note])).map(hzOf);

describe('the soft pack', () => {
  test('note names read as concert pitch (A4 = 440)', () => {
    expect(hzOf('A4')).toBeCloseTo(440, 6);
    expect(hzOf('D5')).toBeCloseTo(587.3295, 3);
    expect(hzOf('F#4')).toBeCloseTo(369.9944, 3);
    expect(hzOf('Bb3')).toBeCloseTo(233.0819, 3);
    expect(() => hzOf('H2')).toThrow('Unknown note');
  });

  test('ONE KEY — every pitch is D major pentatonic, so overlapping cues always agree', () => {
    for (const cue of CUES) {
      for (const hz of pitchesOf(cue)) expect(D_PENTATONIC.has(pitchClass(hz)), `${cue} ${hz.toFixed(1)} Hz`).toBe(true);
    }
  });

  test('NO RUMBLE — nothing sounds below 250 Hz', () => {
    for (const cue of CUES) {
      for (const hz of pitchesOf(cue)) expect(hz, cue).toBeGreaterThanOrEqual(250);
    }
  });

  test('NO BITE — every cue renders finite, gentle samples that start and end in silence', () => {
    for (const cue of CUES) {
      const s = renderCue(cue, SR);
      expect(s.length, cue).toBeGreaterThan(0);
      let peak = 0;
      for (const x of s) {
        expect(Number.isFinite(x), cue).toBe(true);
        peak = Math.max(peak, Math.abs(x));
      }
      expect(peak, `${cue} is heard`).toBeGreaterThan(0.05);
      expect(peak, `${cue} stays gentle`).toBeLessThan(0.6);
      expect(Math.abs(s[0]), `${cue} starts silent`).toBeLessThan(1e-3);
      if (Array.isArray(SOFT_PACK.cues[cue])) expect(Math.abs(s.at(-1)), `${cue} ends silent`).toBeLessThan(1e-3);
    }
  });

  test('the typing bed is one exact cycle that wraps without a seam', () => {
    const bed = SOFT_PACK.cues.neumaReplying;
    const s = renderCue('neumaReplying', SR);
    expect(s.length).toBe(Math.round((bed.loop * SR) / 1000));
    // the jump across the wrap is no bigger than the largest step inside it
    let step = 0;
    for (let i = 1; i < s.length; i++) step = Math.max(step, Math.abs(s[i] - s[i - 1]));
    expect(Math.abs(s[0] - s.at(-1))).toBeLessThanOrEqual(step);
  });

  test('a render is deterministic, and the same at another sample rate in length', () => {
    expect(renderCue('confirm', SR)).toEqual(renderCue('confirm', SR));
    expect(renderCue('neumaReplying', 44100).length).toBe(Math.round((2400 * 44100) / 1000));
    expect(renderCue('noSuchCue', SR)).toBeNull();
  });

  test('a cue says how long it plays — the board shows it', () => {
    expect(cueSpanMs(SOFT_PACK.cues.confirm)).toBe(410);
    expect(cueSpanMs(SOFT_PACK.cues.neumaReplying)).toBe(2400);
  });

  test('every cue the desk plays has a soft voice, under the SCI-FI sprite\'s own names', () => {
    for (const cue of [...Object.values(UI_SOUND), ...ACT_CUES]) expect(SOFT_PACK.cues[cue], cue).toBeDefined();
    for (const cue of CUES) expect(SPRITE.events[cue], `${cue} exists in SCI-FI too`).toBeDefined();
  });
});

describe('the soundboard', () => {
  test('groups by who acts, drops what nothing plays, never shows an empty group', () => {
    const groups = boardGroups(Object.keys(SPRITE.events));
    expect(groups.map((g) => g.id)).toEqual(['desk', 'notices', 'execution', 'acts']);
    const shown = groups.flatMap((g) => g.cues);
    for (const unused of ['klaxon', 'dataTypeOn', 'levelUp']) expect(shown).not.toContain(unused);
    expect(new Set(shown).size).toBe(shown.length);
    expect(boardGroups(['confirm']).map((g) => g.id)).toEqual(['desk']);
  });

  test('the soft board shows every soft cue, each by a plain name — never its id', () => {
    const shown = boardGroups(CUES).flatMap((g) => g.cues);
    expect([...shown].sort()).toEqual([...CUES].sort());
    for (const cue of shown) expect(cueLabel(cue), cue).not.toBe(cue);
  });
});
