/**
 * THE NO-FLASH LAW (frontend/utils/no-flash.js) — Design note, 2026-10-04: […] Light never
 * jumps: it rises over a beat. Proven on the real timelines (no mocks): the
 * envelope itself, GENESIS's glow across its whole film, the birth art's
 * response to a fast stream of speech, and the CSS light-ups that used to
 * switch on at full in one frame.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { swell, NO_FLASH } from '../../frontend/utils/no-flash.js';
import { sceneAt } from '../../frontend/app/Genesis/genesis-state.js';
import { GENESIS_MS } from '../../frontend/app/Genesis/genesis-timeline.js';
import { ceremonyAt } from '../../frontend/app/BirthArt/birth-art-ceremony.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const FRAME = 16; // ms
const maxStep = (f, from, to) => {
  let worst = 0;
  for (let t = from; t < to; t += FRAME) worst = Math.max(worst, Math.abs(f(t + FRAME) - f(t)));
  return worst;
};

describe('the envelope never jumps', () => {
  it('a swell starts dark, rises no faster than the law allows, and settles', () => {
    expect(swell(0)).toBe(0);
    expect(swell(-5)).toBe(0);
    expect(maxStep((t) => swell(t, 0, 300), 0, 2000)).toBeLessThan(0.2); // a zero rise is clamped up to the law's floor
    expect(swell(NO_FLASH.RISE_MS, 0, 300)).toBeCloseTo(1, 9);
  });
});

describe('GENESIS: its one light never steps', () => {
  it('across the whole film, the glow changes by under a fifth per frame', () => {
    expect(maxStep((t) => sceneAt(t).glow, 0, GENESIS_MS)).toBeLessThan(0.2);
  });
});

describe('the birth art breathes with speech — it never flickers', () => {
  it('a fast stream (8 chunks a second) moves the rhythm by under a fifth per frame', () => {
    const events = [{ type: 'birth:stage_prompt', stage: 0, at: 0 }];
    for (let at = 100; at < 3000; at += 125) events.push({ type: 'birth:stream', stage: 0, at });
    expect(maxStep((t) => ceremonyAt(events, t).rhythm, 0, 3200)).toBeLessThan(0.2);
  });
});

describe('the CSS light-ups rise instead of switching on', () => {
  const css = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const firstFrame = (src, name) => {
    const block = src.slice(src.indexOf(`@keyframes ${name}`));
    return block.slice(block.indexOf('{') + 1, block.indexOf('}') + 1);
  };
  it.each([
    ['frontend/app/windowing/FloatingWindow.css', 'fwin-line'],
    ['frontend/app/windowing/FloatingWindow.css', 'fwin-arrive'],
    ['frontend/app/windowing/FloatingWindow.css', 'fwin-sever'],
    ['frontend/app/RelinkShell/ArrivalVeil.css', 'arrivalLine'],
    ['frontend/app/windowing/Taskbar.css', 'taskbar-rise'],
  ])('%s @keyframes %s begins dark', (file, name) => {
    expect(firstFrame(css(file), name)).toMatch(/opacity:\s*0\s*;/);
  });
  it('no light-up steps (steps() timing) — it eases', () => {
    expect(css('frontend/components/WitnessCommitment/WitnessCommitment.css')).not.toMatch(/attention-flash[^;]*steps\(/);
  });
});
