/**
 * Tests for the arrival machine — the pure stage model behind the Arrival
 * veil (frontend/app/RelinkShell/arrival-machine.js, #184).
 *
 * Covers the happy path in real wire order, out-of-order events ignored,
 * the fresh-desk path (RESUME_NONE), every failure → HOLDING mapping,
 * transient recovery, RETRY, SKIP, and idempotent BOUND. No IO, no clocks —
 * the machine is deterministic.
 */

import { describe, expect, test } from 'vitest';
import { reduce, initialArrival, stageRows, STAGES, HOLDING_REASONS } from '../../frontend/app/RelinkShell/arrival-machine.js';

// Fold a sequence of events over a start state.
const run = (events, start = initialArrival) => events.reduce(reduce, start);

const rowsByKey = (state) => Object.fromEntries(stageRows(state).map((r) => [r.key, r.status]));

describe('arrival-machine — the happy path, in real wire order', () => {
  test('cold link: START → established → anchored → resumed → BOUND → FINISH → DONE', () => {
    let state = run([{ type: 'START', connected: false }]);
    expect(state.stage).toBe('REACHING');

    state = reduce(state, { type: 'PORTAL_ESTABLISHED' });
    expect(state.stage).toBe('ANCHORING');

    state = reduce(state, { type: 'COMPANION_ANCHORED' });
    expect(state.stage).toBe('RESUMING');

    state = reduce(state, { type: 'PORTAL_RESUMED' });
    expect(state.stage).toBe('BOUND');

    state = reduce(state, { type: 'FINISH' });
    expect(state.stage).toBe('DONE');
    expect(state.from).toBe('BOUND');
  });

  test('warm link (post-ceremony socket): START connected skips REACHING', () => {
    const state = run([
      { type: 'START', connected: true },
      { type: 'COMPANION_ANCHORED' },
      { type: 'PORTAL_RESUMED' },
    ]);
    expect(state.stage).toBe('BOUND');
  });

  test('reconnect path: the resume IS the anchor — PORTAL_RESUMED closes ANCHORING', () => {
    const state = run([
      { type: 'START', connected: false },
      { type: 'PORTAL_ESTABLISHED' },
      { type: 'PORTAL_RESUMED' },
    ]);
    expect(state.stage).toBe('BOUND');
  });

  test('rows resolve checking → ok as the real events land', () => {
    const reaching = run([{ type: 'START', connected: false }]);
    expect(rowsByKey(reaching)).toEqual({ REACHING: 'checking', ANCHORING: 'idle', RESUMING: 'idle', BOUND: 'idle' });

    const anchoring = reduce(reaching, { type: 'PORTAL_ESTABLISHED' });
    expect(rowsByKey(anchoring)).toEqual({ REACHING: 'ok', ANCHORING: 'checking', RESUMING: 'idle', BOUND: 'idle' });

    const bound = run([{ type: 'COMPANION_ANCHORED' }, { type: 'PORTAL_RESUMED' }], anchoring);
    expect(rowsByKey(bound)).toEqual({ REACHING: 'ok', ANCHORING: 'ok', RESUMING: 'ok', BOUND: 'ok' });
  });
});

describe('arrival-machine — the fresh desk (nothing to resume)', () => {
  test('RESUME_NONE while RESUMING closes the stage as FRESH, then BOUND', () => {
    const state = run([
      { type: 'START', connected: false },
      { type: 'PORTAL_ESTABLISHED' },
      { type: 'COMPANION_ANCHORED' },
      { type: 'RESUME_NONE' },
    ]);
    expect(state.stage).toBe('BOUND');
    expect(state.resumeExpected).toBe(false);
    expect(rowsByKey(state)).toEqual({ REACHING: 'ok', ANCHORING: 'ok', RESUMING: 'fresh', BOUND: 'ok' });
  });

  test('an early probe (RESUME_NONE while ANCHORING) is recorded, then anchoring bounds directly', () => {
    const waiting = run([
      { type: 'START', connected: false },
      { type: 'PORTAL_ESTABLISHED' },
      { type: 'RESUME_NONE' },
    ]);
    expect(waiting.stage).toBe('ANCHORING');
    expect(waiting.resumeExpected).toBe(false);

    const bound = reduce(waiting, { type: 'COMPANION_ANCHORED' });
    expect(bound.stage).toBe('BOUND');
    expect(rowsByKey(bound).RESUMING).toBe('fresh');
  });

  test('RESUME_NONE while still REACHING is stashed, not acted on', () => {
    const state = run([
      { type: 'START', connected: false },
      { type: 'RESUME_NONE' },
    ]);
    expect(state.stage).toBe('REACHING');
    expect(state.resumeExpected).toBe(false);
  });
});

describe('arrival-machine — out-of-order events are ignored', () => {
  test.each([
    ['IDLE', initialArrival, { type: 'PORTAL_ESTABLISHED' }],
    ['IDLE', initialArrival, { type: 'COMPANION_ANCHORED' }],
    ['IDLE', initialArrival, { type: 'PORTAL_RESUMED' }],
    ['REACHING', run([{ type: 'START', connected: false }]), { type: 'COMPANION_ANCHORED' }],
    ['REACHING', run([{ type: 'START', connected: false }]), { type: 'PORTAL_RESUMED' }],
    ['ANCHORING', run([{ type: 'START', connected: false }, { type: 'PORTAL_ESTABLISHED' }]), { type: 'PORTAL_ESTABLISHED' }],
    ['RESUMING', run([{ type: 'START', connected: false }, { type: 'PORTAL_ESTABLISHED' }, { type: 'COMPANION_ANCHORED' }]), { type: 'COMPANION_ANCHORED' }],
    ['RESUMING', run([{ type: 'START', connected: false }, { type: 'PORTAL_ESTABLISHED' }, { type: 'COMPANION_ANCHORED' }]), { type: 'FINISH' }],
  ])('%s keeps the same reference', (_label, state, event) => {
    expect(reduce(state, event)).toBe(state);
  });

  test('unknown event types change nothing', () => {
    const state = run([{ type: 'START', connected: false }]);
    expect(reduce(state, { type: 'CONSCIOUSNESS_STREAM' })).toBe(state);
  });
});

describe('arrival-machine — failure lands in HOLDING with the real reason', () => {
  const anchoring = () => run([{ type: 'START', connected: false }, { type: 'PORTAL_ESTABLISHED' }]);

  test('every mapped reason is a real event type', () => {
    expect(HOLDING_REASONS).toEqual([
      'auth_expired',
      'lane_missing',
      'not_yours',
      'reconnect_failed',
      'disconnection',
      'no_answer',
    ]);
  });

  test('auth_expired holds with the session-token truth', () => {
    const state = reduce(anchoring(), { type: 'AUTH_EXPIRED' });
    expect(state).toMatchObject({ stage: 'HOLDING', held: 'ANCHORING', reason: 'auth_expired', detail: null });
  });

  test("lane_missing carries the server's own words", () => {
    const message = "No workspace for 'neuma-x' under the active root (/srv/workspaces).";
    const state = reduce(anchoring(), { type: 'LANE_MISSING', message });
    expect(state).toMatchObject({ stage: 'HOLDING', reason: 'lane_missing', detail: message });
  });

  test("not_yours carries the server's refusal", () => {
    const message = "'neuma-x' belongs to another witness — this portal cannot bind it.";
    const state = reduce(anchoring(), { type: 'NOT_YOURS', message });
    expect(state).toMatchObject({ stage: 'HOLDING', reason: 'not_yours', detail: message });
  });

  test('reconnect_failed and disconnection hold as transient failures', () => {
    expect(reduce(anchoring(), { type: 'RECONNECT_FAILED' }).reason).toBe('reconnect_failed');
    expect(reduce(anchoring(), { type: 'DISCONNECTION' }).reason).toBe('disconnection');
  });

  test('the watchdog holds with its honest no-answer label', () => {
    const state = reduce(anchoring(), { type: 'WATCHDOG', detail: 'NO ANSWER AFTER 15S' });
    expect(state).toMatchObject({ stage: 'HOLDING', reason: 'no_answer', detail: 'NO ANSWER AFTER 15S' });
  });

  test('HOLDING keeps its first truth — later failures change nothing', () => {
    const held = reduce(anchoring(), { type: 'LANE_MISSING', message: 'gone' });
    expect(reduce(held, { type: 'DISCONNECTION' })).toBe(held);
    expect(reduce(held, { type: 'AUTH_EXPIRED' })).toBe(held);
  });

  test('failures after BOUND are the desk’s concern, not the arrival’s', () => {
    const bound = run([
      { type: 'START', connected: true },
      { type: 'COMPANION_ANCHORED' },
      { type: 'PORTAL_RESUMED' },
    ]);
    expect(reduce(bound, { type: 'DISCONNECTION' })).toBe(bound);
    expect(reduce(bound, { type: 'RECONNECT_FAILED' })).toBe(bound);
  });

  test('the held stage renders HELD, later stages stay IDLE', () => {
    const resuming = run([
      { type: 'START', connected: false },
      { type: 'PORTAL_ESTABLISHED' },
      { type: 'COMPANION_ANCHORED' },
    ]);
    const held = reduce(resuming, { type: 'DISCONNECTION' });
    expect(rowsByKey(held)).toEqual({ REACHING: 'ok', ANCHORING: 'ok', RESUMING: 'held', BOUND: 'idle' });
  });
});

describe('arrival-machine — transient HOLDING recovers on real events', () => {
  const heldTransient = () => run([
    { type: 'START', connected: false },
    { type: 'PORTAL_ESTABLISHED' },
    { type: 'RECONNECT_FAILED' },
  ]);

  test('a re-established portal resumes the arrival at ANCHORING', () => {
    const state = reduce(heldTransient(), { type: 'PORTAL_ESTABLISHED' });
    expect(state).toMatchObject({ stage: 'ANCHORING', held: null, reason: null, detail: null });
  });

  test('a late resume bounds the arrival outright', () => {
    expect(reduce(heldTransient(), { type: 'PORTAL_RESUMED' }).stage).toBe('BOUND');
  });

  test('an anchor during recovery respects a known empty session', () => {
    const held = run([
      { type: 'START', connected: false },
      { type: 'RESUME_NONE' },
      { type: 'DISCONNECTION' },
    ]);
    const bound = reduce(held, { type: 'COMPANION_ANCHORED' });
    expect(bound.stage).toBe('BOUND');
    expect(rowsByKey(bound).RESUMING).toBe('fresh');
  });

  test('refusal-class holdings do not self-recover — they wait on the witness', () => {
    const held = run([
      { type: 'START', connected: false },
      { type: 'PORTAL_ESTABLISHED' },
      { type: 'LANE_MISSING', message: 'gone' },
    ]);
    expect(reduce(held, { type: 'PORTAL_ESTABLISHED' })).toBe(held);
    expect(reduce(held, { type: 'PORTAL_RESUMED' })).toBe(held);
    expect(reduce(held, { type: 'COMPANION_ANCHORED' })).toBe(held);
  });
});

describe('arrival-machine — RETRY re-runs the real entry', () => {
  const held = () => run([
    { type: 'START', connected: false },
    { type: 'PORTAL_ESTABLISHED' },
    { type: 'RESUME_NONE' },
    { type: 'COMPANION_ANCHORED' },
    { type: 'FINISH' },
  ]);

  test('cold socket: RETRY returns to REACHING, keeping the probe fact', () => {
    const state = run([
      { type: 'START', connected: false },
      { type: 'RESUME_NONE' },
      { type: 'DISCONNECTION' },
      { type: 'RETRY', connected: false },
    ]);
    expect(state).toMatchObject({ stage: 'REACHING', reason: null, held: null, resumeExpected: false });
  });

  test('live socket (refused bind): RETRY goes straight to ANCHORING', () => {
    const state = run([
      { type: 'START', connected: false },
      { type: 'PORTAL_ESTABLISHED' },
      { type: 'NOT_YOURS', message: 'no' },
      { type: 'RETRY', connected: true },
    ]);
    expect(state).toMatchObject({ stage: 'ANCHORING', reason: null });
  });

  test('RETRY outside HOLDING is a no-op', () => {
    const reaching = run([{ type: 'START', connected: false }]);
    expect(reduce(reaching, { type: 'RETRY', connected: false })).toBe(reaching);
  });
});

describe('arrival-machine — SKIP and DONE', () => {
  test.each(STAGES.map((s) => [s]))('SKIP from %s ends at DONE remembering where it left', (stageName) => {
    const path = {
      REACHING: [{ type: 'START', connected: false }],
      ANCHORING: [{ type: 'START', connected: false }, { type: 'PORTAL_ESTABLISHED' }],
      RESUMING: [{ type: 'START', connected: false }, { type: 'PORTAL_ESTABLISHED' }, { type: 'COMPANION_ANCHORED' }],
      BOUND: [{ type: 'START', connected: false }, { type: 'PORTAL_ESTABLISHED' }, { type: 'PORTAL_RESUMED' }],
    }[stageName];
    const done = reduce(run(path), { type: 'SKIP' });
    expect(done).toMatchObject({ stage: 'DONE', from: stageName });
  });

  test('SKIP from HOLDING remembers the held stage, not HOLDING itself', () => {
    const held = run([
      { type: 'START', connected: false },
      { type: 'PORTAL_ESTABLISHED' },
      { type: 'AUTH_EXPIRED' },
    ]);
    expect(reduce(held, { type: 'SKIP' })).toMatchObject({ stage: 'DONE', from: 'ANCHORING' });
  });

  test('a skipped parting renders the truth — no fake OKs', () => {
    const skipped = run([
      { type: 'START', connected: false },
      { type: 'PORTAL_ESTABLISHED' },
      { type: 'SKIP' },
    ]);
    expect(rowsByKey(skipped)).toEqual({ REACHING: 'ok', ANCHORING: 'checking', RESUMING: 'idle', BOUND: 'idle' });
  });

  test('BOUND is idempotent — a late resume keeps the same reference', () => {
    const bound = run([
      { type: 'START', connected: true },
      { type: 'COMPANION_ANCHORED' },
      { type: 'PORTAL_RESUMED' },
    ]);
    expect(reduce(bound, { type: 'PORTAL_RESUMED' })).toBe(bound);
  });

  test('DONE is terminal — every later event is ignored', () => {
    const done = run([
      { type: 'START', connected: true },
      { type: 'COMPANION_ANCHORED' },
      { type: 'PORTAL_RESUMED' },
      { type: 'FINISH' },
    ]);
    for (const event of [
      { type: 'PORTAL_ESTABLISHED' },
      { type: 'COMPANION_ANCHORED' },
      { type: 'PORTAL_RESUMED' },
      { type: 'DISCONNECTION' },
      { type: 'SKIP' },
      { type: 'RESUME_NONE' },
    ]) {
      expect(reduce(done, event)).toBe(done);
    }
  });

  test('a clean finish renders every row OK', () => {
    const done = run([
      { type: 'START', connected: false },
      { type: 'PORTAL_ESTABLISHED' },
      { type: 'COMPANION_ANCHORED' },
      { type: 'PORTAL_RESUMED' },
      { type: 'FINISH' },
    ]);
    expect(rowsByKey(done)).toEqual({ REACHING: 'ok', ANCHORING: 'ok', RESUMING: 'ok', BOUND: 'ok' });
  });
});
