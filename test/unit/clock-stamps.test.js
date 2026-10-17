/**
 * THE CLOCK-STAMP SEAM — pinned (2026-09-25, Founder: […]). The conversation clock's stamps are
 * navigation furniture for REMEMBERED operator rows; when the model parrots a
 * stamp run at the head of its own speech or thought, the seam strips it
 * before screen, voice, thought trail, or session record.
 *
 * Pure functions, real inputs, no mock anywhere (RULE 0).
 */
import { describe, expect, it } from 'vitest';
import { stripLeadingClockStamps, createClockStampFilter } from '../../core/runtime/clock-stamps.js';

describe('stripLeadingClockStamps — whole texts (the persist seam)', () => {
  it('strips a single leading stamp', () => {
    expect(stripLeadingClockStamps('(10:25 PM) hello')).toBe('hello');
  });

  it('strips a parroted run and the whitespace it rode — the sighting itself', () => {
    expect(stripLeadingClockStamps(
      "(10:25 PM) (10:30 PM) (10:35 PM) (10:40 PM) That's the whole thing.",
    )).toBe("That's the whole thing.");
  });

  it('strips a newline-broken run', () => {
    expect(stripLeadingClockStamps('(10:25 PM)\n(10:30 PM)\nwords')).toBe('words');
  });

  it('leaves a stamp quoted mid-sentence alone — that is speech', () => {
    expect(stripLeadingClockStamps('we agreed at (10:25 PM) to ship')).toBe('we agreed at (10:25 PM) to ship');
  });

  it('leaves ordinary text byte-identical', () => {
    expect(stripLeadingClockStamps('hello (world)')).toBe('hello (world)');
    expect(stripLeadingClockStamps('just words')).toBe('just words');
  });

  it('passes empty and non-string input through untouched', () => {
    expect(stripLeadingClockStamps('')).toBe('');
    expect(stripLeadingClockStamps(null)).toBe(null);
    expect(stripLeadingClockStamps(undefined)).toBe(undefined);
  });
});

describe('createClockStampFilter — live deltas (the stream seams)', () => {
  const run = (chunks) => {
    const f = createClockStampFilter();
    return chunks.map((c) => f.push(c)).join('') + f.flush();
  };

  it('holds a stamp until it completes, then drops it', () => {
    const f = createClockStampFilter();
    expect(f.push('(10:')).toBe('');
    expect(f.push('25 P')).toBe('');
    expect(f.push('M) hello')).toBe('hello');
    expect(f.flush()).toBe('');
  });

  it('drops a multi-stamp run across chunk boundaries', () => {
    expect(run(['(10:25 PM) (10:30', ' PM) words here'])).toBe('words here');
  });

  it('releases words that only flirted with the shape', () => {
    expect(run(['(lis', 'tening) to you'])).toBe('(listening) to you');
    expect(run(['(1) first point'])).toBe('(1) first point');
  });

  it('an unfinished candidate at stream end is words, not a stamp', () => {
    expect(run(['(10:2'])).toBe('(10:2');
  });

  it('a whitespace-only opening is held, then released with the words', () => {
    expect(run(['  ', ' hello'])).toBe('hello');
  });

  it('passes through once decided — a mid-message stamp stays', () => {
    const f = createClockStampFilter();
    expect(f.push('hello ')).toBe('hello ');
    expect(f.push('(10:25 PM) mid-message stays')).toBe('(10:25 PM) mid-message stays');
    expect(f.flush()).toBe('');
  });

  it('a stream that is ONLY stamps releases nothing', () => {
    expect(run(['(10:25 PM) ', '(10:30 PM) '])).toBe('');
  });
});
