/**
 * ONE LOOP ON THE DESK, NO FLIP-FLOP (desk-loops.js planLoop) — Design note, 2026-11-20, two chats at work at once: […] Pure: which loop the desk
 * plays, and when it hands over. The engine and the timing are proven in a real browser (desk-loops-browser.test.js).
 */
import { describe, it, expect } from 'vitest';
import { planLoop, LOOP_ORDER, HOLD_MS, TAIL_MS } from '../../frontend/app/RelinkShell/desk-loops.js';

describe('which loop the desk plays', () => {
  it('words over an image over thinking; going up is at once', () => {
    expect(LOOP_ORDER).toEqual(['neumaReplying', 'neumaRendering', 'neumaThinking']);
    expect(planLoop({ playing: null, wanted: ['neumaThinking'] })).toEqual({ now: 'neumaThinking' });
    expect(planLoop({ playing: 'neumaThinking', wanted: ['neumaThinking', 'neumaReplying'] })).toEqual({ now: 'neumaReplying' });
    expect(planLoop({ playing: 'neumaThinking', wanted: ['neumaThinking', 'neumaRendering'] })).toEqual({ now: 'neumaRendering' });
    expect(planLoop({ playing: 'neumaReplying', wanted: ['neumaReplying', 'neumaThinking'] })).toEqual({});
  });

  it('going down waits the hold, going silent the tail — a gap between bursts of words never hands the desk over', () => {
    expect(planLoop({ playing: 'neumaReplying', wanted: ['neumaThinking'] })).toEqual({ waitFor: HOLD_MS });
    expect(planLoop({ playing: 'neumaRendering', wanted: ['neumaThinking'] })).toEqual({ waitFor: HOLD_MS });
    expect(planLoop({ playing: 'neumaThinking', wanted: [] })).toEqual({ waitFor: TAIL_MS });
    expect(HOLD_MS).toBeGreaterThan(TAIL_MS);
  });
});
