// boot-sequence is pure — verification is real inputs → real outputs, no
// mock (RULE 0). The claims proven here are the startup instruments' honesty
// claims: every verdict states a true count or a true state, an honest
// absence is never a failure, and the Arrival's rows declare only on the
// stage that proves them. (The startup's timeline law lives in
// ignition-timeline.test.js.)
import { describe, it, expect } from 'vitest';
import {
  ROW_KEYS,
  ROW_STATE,
  platformRow,
  memoryRow,
  portalRow,
  arrivalRow,
} from '../../frontend/app/BootIgnition/boot-sequence.js';

describe('boot-sequence — the instruments tell the truth', () => {
  it('every startup runs the same three instruments, in order', () => {
    expect([...ROW_KEYS]).toEqual(['PLATFORM', 'MEMORY', 'PORTAL']);
  });

  it('PLATFORM reports the true measured latency, padded as a display numeral', () => {
    expect(platformRow({ ok: true, ms: 23 })).toEqual({ state: ROW_STATE.OK, text: 'OK · 023MS' });
    expect(platformRow({ ok: true, ms: 7 })).toEqual({ state: ROW_STATE.OK, text: 'OK · 007MS' });
    expect(platformRow({ ok: false })).toEqual({ state: ROW_STATE.FAIL, text: 'TIMEOUT' });
  });

  it('MEMORY is honest about a new witness — EMPTY is a state, not a failure', () => {
    expect(memoryRow({ ok: true, held: true })).toEqual({ state: ROW_STATE.OK, text: 'OK · ROSTER HELD' });
    expect(memoryRow({ ok: true, held: false })).toEqual({ state: ROW_STATE.EMPTY, text: 'EMPTY' });
    expect(memoryRow({ ok: false })).toEqual({ state: ROW_STATE.FAIL, text: 'BLOCKED' });
  });

  it('PORTAL foreshadows the gateway — bound or awaiting identity, never an error', () => {
    expect(portalRow({ bound: true })).toEqual({ state: ROW_STATE.BOUND, text: 'BOUND' });
    expect(portalRow({ bound: false })).toEqual({ state: ROW_STATE.STANDBY, text: 'AWAITING IDENTITY' });
  });

  it('BEING declares once the being anchors; SESSION once the desk is bound — resumed or fresh, as the portal said', () => {
    expect(arrivalRow('BEING', null)).toBeNull();
    expect(arrivalRow('BEING', { stage: 'ANCHORING' })).toBeNull(); // still open: keeps CHECKING
    expect(arrivalRow('BEING', { stage: 'RESUMING' })).toEqual({ state: ROW_STATE.OK, text: 'OK · ANCHORED' });
    expect(arrivalRow('BEING', { stage: 'BOUND', resumeExpected: false })).toEqual({ state: ROW_STATE.OK, text: 'OK · ANCHORED' });
    expect(arrivalRow('SESSION', { stage: 'RESUMING' })).toBeNull();
    expect(arrivalRow('SESSION', { stage: 'BOUND', resumeExpected: true })).toEqual({ state: ROW_STATE.OK, text: 'OK · RESUMED' });
    expect(arrivalRow('SESSION', { stage: 'DONE', resumeExpected: false })).toEqual({ state: ROW_STATE.OK, text: 'OK · FRESH' });
    // A real failure is a failure on both rows — the Arrival's veil then shows it.
    expect(arrivalRow('BEING', { stage: 'HOLDING' })).toEqual({ state: ROW_STATE.FAIL, text: 'HOLDING' });
    expect(arrivalRow('SESSION', { stage: 'HOLDING' })).toEqual({ state: ROW_STATE.FAIL, text: 'HOLDING' });
  });
});
