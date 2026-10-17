/**
 * frontend/app/Ignition/ignition-timeline.js — THE IGNITION's law: the
 * still point opens only once the mark is whole AND every instrument has
 * truly declared (or the witness skips); a verdict never shows before its
 * check has been seen; every install's axis rests in its own place and wakes
 * to Earth's true tilt. Pure; real values.
 */
import { describe, it, expect } from 'vitest';
import {
  ignitionAt, shownAt, openAtOf, cuesOf, restingLeanOf, checkAt, IGNITION, AXIAL_TILT_DEG,
} from '../../frontend/app/Ignition/ignition-timeline.js';

const verdict = (key, at, state = 'ok') => ({ key, state, text: state.toUpperCase(), at });

describe('the opening waits for the truth', () => {
  it('stays shut while any instrument is out, and opens a held beat after the last', () => {
    expect(openAtOf([verdict('PLATFORM', 1400), verdict('BEING', null)])).toBeNull();
    const late = openAtOf([verdict('PLATFORM', 1400), verdict('BEING', 5200)]);
    expect(late).toBe(5200 + IGNITION.HOLD_MS);
    // fast answers still wait for the mark to be whole
    const fast = openAtOf([verdict('PLATFORM', 1400)]);
    expect(fast).toBe(Math.max(IGNITION.EQUATOR[1], IGNITION.NAME[1]) + IGNITION.HOLD_MS);
  });

  it('a skip opens at once, whatever is still out', () => {
    const s = ignitionAt(2000, { verdicts: [verdict('BEING', null)], skipAt: 1000 });
    expect(s.openAt).toBe(1000);
    expect(s.open).toBeGreaterThan(0);
    expect(ignitionAt(1000 + IGNITION.OPEN_MS, { verdicts: [verdict('BEING', null)], skipAt: 1000 }).done).toBe(true);
  });

  it('a verdict is never shown before its check has been seen running', () => {
    expect(shownAt(0, 5)).toBe(checkAt(0) + IGNITION.MIN_CHECK_MS);
    expect(shownAt(2, 4000)).toBe(4000);
    const s = ignitionAt(checkAt(1) + 50, { verdicts: [verdict('A', shownAt(0, 5)), verdict('B', shownAt(1, 5))] });
    expect(s.instruments[1]).toMatchObject({ checking: true, state: null });
  });
});

describe('the mark wakes true', () => {
  it('every install rests in its own place, within 40° of the tilt, and wakes to 23.44°', () => {
    const a = restingLeanOf('00000000ffff');
    const b = restingLeanOf('ffffffff0000');
    expect(a).not.toBe(b);
    [a, b].forEach((lean) => expect(Math.abs(lean - AXIAL_TILT_DEG)).toBeLessThanOrEqual(40));
    expect(restingLeanOf(null)).toBe(AXIAL_TILT_DEG);
    expect(ignitionAt(IGNITION.EQUATOR[1], { verdicts: [], restingLean: a }).lean).toBeCloseTo(AXIAL_TILT_DEG, 6);
  });

  it('declares its cues for sound on its own clock', () => {
    const verdicts = [verdict('PLATFORM', 1400)];
    const cues = cuesOf(verdicts, openAtOf(verdicts)).map((c) => c.cue);
    expect(cues).toEqual(['IGNITE', 'AXIS', 'MERIDIAN', 'EQUATOR', 'FIGURES', 'VERDICT PLATFORM', 'NAME', 'OPEN']);
  });
});
