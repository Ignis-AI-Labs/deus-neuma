/**
 * What a part is asked on each attempt (team-continue.js), and one id per
 * sitting (session-id.js) — the pure halves of […] (2026-10-12). The impure half is proven on real turns in
 * test/integration/team-part-continue.test.js.
 */
import { describe, test, expect } from 'vitest';
import { attemptMessages, continuationNote, CONTINUE_ACTS_MAX } from '../../backend/services/team-continue.js';
import { mintSessionId } from '../../core/workspace/session-id.js';

const BRIEF = Object.freeze([Object.freeze({ role: 'user', content: 'Your part: map the gap.' })]);

describe('attemptMessages — the brief once, then the note', () => {
  test('a first attempt reads its brief untouched — or with the guidance given while it waited', () => {
    expect(attemptMessages({ messages: BRIEF })).toBe(BRIEF);
    const [m] = attemptMessages({ messages: BRIEF, notes: [{ note: 'Only paying buyers.' }] });
    expect(m.content).toBe("Your part: map the gap.\n\nYOUR OPERATOR'S GUIDANCE for this part — it outranks the brief where they differ:\n— Only paying buyers.");
  });

  test('a continuation in its own sitting reads ONLY the note — the brief is already in that conversation', () => {
    const asked = attemptMessages({ messages: BRIEF, continuation: { kind: 'failed', why: 'the stream stalled' }, sitting: true });
    expect(asked).toHaveLength(1);
    expect(asked[0].content).not.toContain('map the gap');
    expect(asked[0].content).toMatch(/^YOUR PART CONTINUES\. Your part stopped before you finished — the stream stalled\./);
  });

  test('a conduit with no sitting reads the brief again, the note after it', () => {
    const [m] = attemptMessages({ messages: BRIEF, continuation: { kind: 'steered' }, notes: [{ note: 'Go deeper.' }] });
    expect(m.content.startsWith('Your part: map the gap.\n\nYOUR PART CONTINUES. Your operator paused you mid-work to guide you.')).toBe(true);
    expect(m.content).toContain('— Go deeper.');
  });
});

describe('continuationNote — why it stopped, what it did, what is new', () => {
  test('each way a part stops is said plainly', () => {
    expect(continuationNote({ kind: 'unfinished', why: 'it carried no work product — only a sign-off' }))
      .toContain('Your answer did not finish your part — it carried no work product — only a sign-off.');
    expect(continuationNote({ kind: 'resumed' })).toContain('This run stopped and has been picked up again.');
    expect(continuationNote({ kind: 'resumed', why: 'the operator stopped the run' })).toContain('This run stopped (the operator stopped the run) and has been picked up again.');
  });

  test('its acts are listed back — the newest when there are many', () => {
    const acts = Array.from({ length: CONTINUE_ACTS_MAX + 5 }, (_, i) => ({ tool: 'web/web_search', status: 'ok', summary: `query ${i}` }));
    const note = continuationNote({ kind: 'failed', why: 'x', acts });
    expect(note).toContain(`The last ${CONTINUE_ACTS_MAX} of the ${CONTINUE_ACTS_MAX + 5} acts you took:`);
    expect(note).toContain(`— web/web_search OK: query ${CONTINUE_ACTS_MAX + 4}`);
    expect(note).not.toContain('— web/web_search OK: query 4\n');
    expect(note.trim().endsWith('Finish your part and sign off as your brief asks.')).toBe(true);
  });
});

describe('mintSessionId — one sitting, one id', () => {
  test('two sittings minted in the same millisecond never share a name — and the id still reads as a time', () => {
    const now = Date.now() + 10_000; // ahead of every id minted so far
    const ids = [mintSessionId(now), mintSessionId(now), mintSessionId(now)];
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe(`session-${now}`);
    for (const id of ids) expect(Number(id.replace('session-', '')) - now).toBeLessThan(3);
  });
});
