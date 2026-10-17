// Pacing math for the live text reveal — pure functions, real values.
// The bursty-delivery regression feeds REAL recorded provider traces
// (test/fixtures/stream-trace-*.json) through the pacer — no simulated
// network, this is what the providers actually sent.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPacer, paceStep, isRevealing } from '../../frontend/app/RelinkShell/stream-reveal.js';

const FRAME_MS = 1000 / 60;
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');

/** Replay a real chunk trace through the pacer at 60fps; return per-frame visible/target. */
const replay = (trace) => {
  const lastAt = trace[trace.length - 1].at;
  const totalChars = trace.reduce((n, c) => n + c.len, 0);
  let pacer = createPacer(0);
  let visible = 0;
  let cursor = 0;
  let target = 0;
  const frames = [];
  for (let t = 0; t <= lastAt + 60_000; t += FRAME_MS) {
    while (cursor < trace.length && trace[cursor].at <= t) {
      target += trace[cursor].len;
      cursor++;
    }
    const step = paceStep(pacer, visible, target, t, cursor < trace.length);
    pacer = step.state;
    visible = step.next;
    frames.push({ visible, target });
    if (cursor >= trace.length && visible >= totalChars) break;
  }
  return { frames, lastAt, totalChars };
};

/** % of mid-stream frames where the display is caught up and frozen (starved). */
const starvationPct = ({ frames, lastAt, totalChars }) => {
  const lastFrame = Math.ceil(lastAt / FRAME_MS);
  // Only count frames after the first content arrives — the pre-first-chunk
  // window is TTFT, not pacing.
  const firstContent = frames.findIndex((f) => f.target > 0);
  let starved = 0;
  let counted = 0;
  for (let f = Math.max(1, firstContent); f < Math.min(frames.length, lastFrame); f++) {
    counted++;
    if (frames[f].visible === frames[f].target && frames[f].target < totalChars) starved++;
  }
  return (starved / Math.max(1, counted)) * 100;
};

describe('paceStep', () => {
  it('advances monotonically and never passes the target', () => {
    let pacer = createPacer(0);
    let v = 0;
    for (let t = 0; t <= 3200; t += 16) {
      const step = paceStep(pacer, v, 100, t, true);
      pacer = step.state;
      expect(step.next).toBeGreaterThanOrEqual(v);
      expect(step.next).toBeLessThanOrEqual(100);
      v = step.next;
    }
    expect(v).toBe(100);
  });

  it('at or past the target it stays put', () => {
    const pacer = createPacer(0);
    expect(paceStep(pacer, 100, 100, 16, true).next).toBe(100);
    expect(paceStep(pacer, 150, 100, 16, true).next).toBe(100);
  });

  it('always moves at least one character per step', () => {
    expect(paceStep(createPacer(0), 0, 100, 16, true).next).toBeGreaterThan(0);
  });

  it('a completed stream drains faster than a live one', () => {
    // Mid-stream state with an established cushion — the step where live
    // pacing and drain pacing genuinely diverge.
    let pacer = createPacer(0);
    let visible = 0;
    let target = 0;
    for (let t = 0; t <= 1000; t += 100) {
      target += 10;
      const step = paceStep(pacer, visible, target, t, true);
      pacer = step.state;
      visible = step.next;
    }
    const live = paceStep(pacer, visible, target + 100, 1100, true).next;
    const drain = paceStep(pacer, visible, target + 100, 1100, false).next;
    expect(drain).toBeGreaterThan(live);
  });

  it('snaps the last few characters instead of trickling', () => {
    let pacer = createPacer(0);
    let v = 0;
    for (let t = 0; t <= 3200; t += 16) {
      const step = paceStep(pacer, v, 100, t, true);
      pacer = step.state;
      v = step.next;
    }
    expect(paceStep(pacer, 99, 100, 4000, true).next).toBe(100);
  });

  it('reveals the first content immediately (no cushion before any gap is measured)', () => {
    // First chunk arrived at t=16: nothing may hold it back — perceived TTFT
    // is sacred.
    const step = paceStep(createPacer(0), 0, 20, 16, true);
    expect(step.next).toBeGreaterThan(0);
  });

  it('a steady fast substrate (450 cps metronome) stays at the frontier — no added lag', () => {
    let pacer = createPacer(0);
    let visible = 0;
    let target = 0;
    let maxLag = 0;
    for (let frame = 0; frame < 600; frame++) {
      const t = frame * FRAME_MS;
      target += 450 / 60;
      const step = paceStep(pacer, visible, Math.floor(target), t, true);
      pacer = step.state;
      visible = step.next;
      maxLag = Math.max(maxLag, Math.floor(target) - visible);
    }
    // Steady delivery ⇒ near-zero cushion: no more than one display frame
    // behind plus the steady-state cushion (gap-sized, ~8 chars at 450cps).
    expect(maxLag).toBeLessThanOrEqual(Math.ceil(450 / 60) + 9);
  });

  it('real bursty kimi-k3 trace: display starvation stays bounded', () => {
    const { trace } = JSON.parse(readFileSync(join(FIXTURES, 'stream-trace-kimi-k3.json'), 'utf8'));
    const pct = starvationPct(replay(trace));
    // Measured 2026-07-28: the old frontier-chaser starved the display for
    // 84% of this exact stream (e2e: 33-41 visible freezes >100ms per turn).
    // The jitter buffer holds it far below; guard the regression with slack.
    expect(pct).toBeLessThan(35);
  });

  it('real gpt-5.6-sol trace: display starvation stays bounded', () => {
    const { trace } = JSON.parse(readFileSync(join(FIXTURES, 'stream-trace-gpt-5.6-sol.json'), 'utf8'));
    const pct = starvationPct(replay(trace));
    expect(pct).toBeLessThan(35);
  });

  it('real bursty trace: median perceived lag stays under 2s', () => {
    const { trace } = JSON.parse(readFileSync(join(FIXTURES, 'stream-trace-kimi-k3.json'), 'utf8'));
    const { frames, totalChars } = replay(trace);
    const mid = Math.floor(totalChars / 2);
    const arrived = frames.findIndex((f) => f.target >= mid);
    const revealed = frames.findIndex((f) => f.visible >= mid);
    expect((revealed - arrived) * FRAME_MS).toBeLessThan(2000);
  });
});

describe('isRevealing', () => {
  it('true only while behind the target', () => {
    expect(isRevealing(0, 10)).toBe(true);
    expect(isRevealing(10, 10)).toBe(false);
  });
});
