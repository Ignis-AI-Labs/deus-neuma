/**
 * EACH SITTING READS ITS OWN CONTEXT — the gauge is per-chat, not per-desk.
 *
 * Design note, 2026-08-30: […]
 *
 * The context gauge was subscribed ONCE at desk level and provided to every
 * pane at once, so four open sittings all showed the anchor tab's numbers.
 * Not stale numbers — ANOTHER CHAT'S numbers, which is worse: a gauge that is
 * merely behind at least still describes the thing you are looking at.
 *
 * Each portal now reports its own anatomy on its own socket; `focusedComposition`
 * is the pure decision about which one the frame shows, and it lives here
 * rather than in tabs-model.test.js because it is a question about telemetry
 * scope, not about tab state — and because that file is at the size cap.
 */
import { describe, expect, test } from 'vitest';
import { focusedComposition } from '../../core/runtime/tabs-model.js';

describe('EACH SITTING READS ITS OWN CONTEXT — Design note, 2026-08-30', () => {
  // […] The gauge was
  // subscribed once at desk level and handed to every pane, so open sittings
  // all showed the anchor's numbers — another chat's numbers, not stale ones.
  const A = { type: 'context:composition', neumaId: 'fenna', sessionId: 's-a', used: 1000 };
  const B = { type: 'context:composition', neumaId: 'fenna', sessionId: 's-b', used: 9000 };
  const ANCHOR = { type: 'context:composition', neumaId: 'fenna', sessionId: 's-anchor', used: 50 };

  test('two sittings never share one anatomy — each focus reads its own', () => {
    const byTab = { 't-a': A, 't-b': B };
    expect(focusedComposition('t-a', byTab, ANCHOR)).toBe(A);
    expect(focusedComposition('t-b', byTab, ANCHOR)).toBe(B);
    // The whole bug in one line: focusing the second chat must not answer with
    // the first chat's usage.
    expect(focusedComposition('t-b', byTab, ANCHOR)).not.toBe(A);
  });

  test('the ANCHOR tab reads the window it rides — it has no portal of its own', () => {
    // The anchor sits on the window's own socket, so nothing reports for it and
    // the enclosing host's anatomy is the correct answer.
    expect(focusedComposition('t-anchor', { 't-a': A }, ANCHOR)).toBe(ANCHOR);
    expect(focusedComposition(null, { 't-a': A }, ANCHOR)).toBe(ANCHOR);
  });

  test('A TAB THAT REPORTED NULL KEEPS ITS NULL — it does not borrow the anchor\'s', () => {
    // THE TRAP. A portal that is connected but has seen no turn reports null,
    // and that null is this tab's real answer: […].
    // Treating it as absent and falling through to the anchor reinstates the
    // original bug in miniature — and does it exactly when a fresh chat is
    // most likely to be mistaken for a broken gauge.
    expect(focusedComposition('t-fresh', { 't-fresh': null }, ANCHOR)).toBe(null);
    expect(focusedComposition('t-fresh', { 't-fresh': null, 't-a': A }, ANCHOR)).not.toBe(ANCHOR);
  });

  test('a tab that has not reported at all still falls back, and junk never throws', () => {
    // Not reported ≠ reported null: before a portal mounts there is no entry,
    // and the anchor is the only anatomy that exists.
    expect(focusedComposition('t-unmounted', { 't-a': A }, ANCHOR)).toBe(ANCHOR);
    expect(focusedComposition('t-a', null, ANCHOR)).toBe(ANCHOR);
    expect(focusedComposition('t-a', undefined, null)).toBe(null);
  });

  test('an inherited key can never answer for a tab', () => {
    // `in` would say true for 'toString'; a tab id is data and must only ever
    // match something actually reported.
    expect(focusedComposition('toString', {}, ANCHOR)).toBe(ANCHOR);
  });
});
