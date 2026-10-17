/**
 * THE COMFY VIEWPORT — the activity record's state law.
 *
 * `foldActivity` and `percentOf` are pure: real inputs, real outputs, no mock
 * anywhere in the path (RULE 0). The impure shell is exercised through its own
 * real module state — `publishActivity` really writes and `activitySnapshot`
 * really reads it; nothing is stubbed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  foldActivity, isLive, percentOf, publishActivity, activitySnapshot, _resetActivity, RECENT_CAP,
} from '../../backend/services/image-forge/forge-activity.js';

const T = 1_000_000;

describe('foldActivity — pure', () => {
  it('prepends an unseen job with defaults', () => {
    const out = foldActivity([], { jobId: 'a', laneId: 'fenna' }, T);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ jobId: 'a', laneId: 'fenna', phase: 'queued', startedAt: T, updatedAt: T });
  });

  it('merges a known job IN PLACE, so a rendering row never jumps', () => {
    const first = foldActivity([], { jobId: 'a' }, T);
    const second = foldActivity(first, { jobId: 'b' }, T + 1);
    // 'a' is now second. Patching it must not move it back to the front.
    const third = foldActivity(second, { jobId: 'a', phase: 'rendering', percent: 40 }, T + 2);
    expect(third.map((r) => r.jobId)).toEqual(['b', 'a']);
    expect(third[1]).toMatchObject({ phase: 'rendering', percent: 40, startedAt: T, updatedAt: T + 2 });
  });

  it('does not mutate the input list', () => {
    const before = foldActivity([], { jobId: 'a' }, T);
    const snapshot = JSON.stringify(before);
    foldActivity(before, { jobId: 'a', phase: 'done' }, T + 1);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('ignores a patch with no jobId, returning a copy', () => {
    const before = foldActivity([], { jobId: 'a' }, T);
    const after = foldActivity(before, { phase: 'done' }, T + 1);
    expect(after).toEqual(before);
    expect(after).not.toBe(before);
  });

  it('caps settled rows but never drops a live one', () => {
    // One live job, then cap+3 finished ones.
    let rows = foldActivity([], { jobId: 'live', phase: 'rendering' }, T);
    for (let i = 0; i < RECENT_CAP + 3; i += 1) {
      rows = foldActivity(rows, { jobId: `done-${i}`, phase: 'done' }, T + i + 1);
    }
    const live = rows.filter(isLive);
    const settled = rows.filter((r) => !isLive(r));
    expect(live.map((r) => r.jobId)).toEqual(['live']);
    expect(settled).toHaveLength(RECENT_CAP);
    // Newest survive, oldest evicted.
    expect(settled[0].jobId).toBe(`done-${RECENT_CAP + 2}`);
    expect(settled.some((r) => r.jobId === 'done-0')).toBe(false);
  });

  it('treats queued and rendering as live; every terminal phase as settled', () => {
    expect(isLive({ phase: 'queued' })).toBe(true);
    expect(isLive({ phase: 'rendering' })).toBe(true);
    for (const phase of ['done', 'error', 'refused', 'stopped']) {
      expect(isLive({ phase })).toBe(false);
    }
  });
});

describe('percentOf — pure', () => {
  it('computes a rounded percent', () => {
    expect(percentOf({ value: 5, max: 20 })).toBe(25);
    expect(percentOf({ value: 1, max: 3 })).toBe(33);
  });

  it('returns null when the engine has no meaningful max yet', () => {
    // ComfyUI sends max:0 before sampling begins — a 0/0 bar is a lie.
    expect(percentOf({ value: 0, max: 0 })).toBeNull();
    expect(percentOf(undefined)).toBeNull();
    expect(percentOf({ value: 1 })).toBeNull();
  });

  it('clamps out-of-range engine values instead of overflowing the bar', () => {
    expect(percentOf({ value: 40, max: 20 })).toBe(100);
    expect(percentOf({ value: -5, max: 20 })).toBe(0);
  });
});

describe('the impure shell — real module state, no stubs', () => {
  beforeEach(() => { _resetActivity(); });

  it('starts empty', () => {
    expect(activitySnapshot()).toMatchObject({ live: [], recent: [] });
  });

  it('splits a real published job into live, then into recent', () => {
    publishActivity({ jobId: 'j1', laneId: 'fenna', pipelineLabel: 'SDXL', phase: 'rendering', percent: 58 });
    const mid = activitySnapshot();
    expect(mid.live).toHaveLength(1);
    expect(mid.live[0]).toMatchObject({ jobId: 'j1', pipelineLabel: 'SDXL', percent: 58 });
    expect(mid.recent).toHaveLength(0);

    publishActivity({ jobId: 'j1', phase: 'done', percent: 100, images: [{ imageId: 'x' }] });
    const end = activitySnapshot();
    expect(end.live).toHaveLength(0);
    expect(end.recent[0]).toMatchObject({ jobId: 'j1', phase: 'done', pipelineLabel: 'SDXL' });
    // The patch merged onto the original record rather than replacing it.
    expect(end.recent[0].laneId).toBe('fenna');
  });

  it('carries a refusal as a terminal row naming the class, never the term', () => {
    publishActivity({ jobId: 'j2', laneId: 'fenna', phase: 'refused', detail: 'refused by content law (minor_sexual)' });
    const snap = activitySnapshot();
    expect(snap.live).toHaveLength(0);
    expect(snap.recent[0]).toMatchObject({ phase: 'refused' });
    expect(snap.recent[0].detail).toContain('minor_sexual');
  });
});
