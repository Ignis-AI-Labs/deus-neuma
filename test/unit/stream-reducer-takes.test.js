// stream-reducer-takes.test.js — THE TAKES (the turn-point model), RETRY
// ANYWHERE, the live voice sitting, and thought segments. Split from
// stream-reducer.test.js (SIZE-033); bodies byte-identical.

import { describe, expect, test } from 'vitest';
import {
  reducer, initialState, isConversationPurpose, advanceVoiceGen, isStaleVoiceGen, voiceErrorText,
} from '../../frontend/app/RelinkShell/stream-reducer.js';
import { run, streamingMsg } from '../helpers/stream-reducer-kit.js';

describe('THE TAKES — the turn-point model', () => {
  const T1 = 'turn-1';
  const T2 = 'turn-2';

  // A settled two-turn thread, the second answer a multi-take point —
  // the shape workspace-sessions' fold hands HISTORY.
  const seededHistory = [{
    role: 'user', content: 'first question', turnId: T1, at: '2026-07-27T10:00:00.000Z',
  }, {
    role: 'assistant', turnId: T1, takeIndex: 1, takeCount: 1,
    takes: [{ takeIndex: 1, content: 'first answer', at: '2026-07-27T10:00:01.000Z' }],
    content: 'first answer', at: '2026-07-27T10:00:01.000Z',
  }, {
    role: 'user', content: 'second question', turnId: T2, at: '2026-07-27T10:01:00.000Z',
  }, {
    role: 'assistant', turnId: T2, takeIndex: 2, takeCount: 2,
    takes: [
      { takeIndex: 1, content: 'take one', at: '2026-07-27T10:01:01.000Z' },
      { takeIndex: 2, content: 'take two', at: '2026-07-27T10:01:02.000Z' },
    ],
    content: 'take two', at: '2026-07-27T10:01:02.000Z',
  }];

  test('HISTORY folds take-aware records into ONE message per point, viewed take mirrored out', () => {
    const state = run([{ type: 'HISTORY', messages: seededHistory }]);
    expect(state.messages).toHaveLength(4);
    const point = state.messages[3];
    expect(point).toMatchObject({ role: 'neuma', turnId: T2, takeIndex: 2, takeCount: 2 });
    expect(point.takes).toHaveLength(2);
    expect(point.segments).toEqual([{ kind: 'speech', text: 'take two' }]);
    expect(point.at).toBe('2026-07-27T10:01:02.000Z');
    // The user rows carry their turnId too — the point is named on both sides.
    expect(state.messages[2].turnId).toBe(T2);
  });

  test('a retried stream opens the new take IN PLACE of the viewed one — never a new tail message', () => {
    let state = run([{ type: 'HISTORY', messages: seededHistory }]);
    state = run([
      { type: 'RETRY_SENT' },
      { type: 'SPEECH', text: 'take three, ', take: { turnId: T2, takeIndex: 3 } },
      { type: 'SPEECH', text: 'still the same point', take: { turnId: T2, takeIndex: 3 } },
    ], state);
    expect(state.messages).toHaveLength(4); // nothing appended
    const point = state.messages[3];
    expect(point.streaming).toBe(true);
    expect(point.takeCount).toBe(3);
    expect(point.takeIndex).toBe(3);
    expect(point.segments).toEqual([{ kind: 'speech', text: 'take three, still the same point' }]);
    expect(point.takes[2].segments).toEqual(point.segments); // the take mirrors the live view
    expect(state.thinking).toBe(false); // first speech retired RETRY_SENT's placeholder
  });

  test('a mid-list take still receives tool segments — the point need not be the tail', () => {
    let state = run([{ type: 'HISTORY', messages: seededHistory }]);
    state = run([
      { type: 'SPEECH', text: 'retrying the FIRST point ', take: { turnId: T1, takeIndex: 2 } },
      { type: 'TOOL_OPEN' },
      { type: 'TOOL_RESULT', data: { tool: 'read_file', status: 'ok', summary: 'read x' } },
      { type: 'COMPLETE', metadata: { emotion: 'calm' } },
    ], state);
    expect(state.messages).toHaveLength(4);
    const point = state.messages[1];
    expect(point.streaming).toBe(false);
    expect(point.takeCount).toBe(2);
    expect(point.takes[1].segments.map((s) => s.kind)).toEqual(['speech', 'tool']);
    expect(point.meta).toEqual({ emotion: 'calm' });
    expect(point.takes[1].meta).toEqual({ emotion: 'calm' }); // the take keeps its own meta
  });

  test('TAKE_SWITCH re-folds locally: the viewed take swaps segments, stamp and meta', () => {
    const state = run([
      { type: 'HISTORY', messages: seededHistory },
      { type: 'TAKE_SWITCH', turnId: T2, takeIndex: 1 },
    ]);
    const point = state.messages[3];
    expect(point.takeIndex).toBe(1);
    expect(point.segments).toEqual([{ kind: 'speech', text: 'take one' }]);
    expect(point.at).toBe('2026-07-27T10:01:01.000Z');
    // …and back.
    const returned = run([{ type: 'TAKE_SWITCH', turnId: T2, takeIndex: 2 }], state);
    expect(returned.messages[3].segments).toEqual([{ kind: 'speech', text: 'take two' }]);
  });

  test('TAKE_SWITCH guards: unknown point, out-of-range take, and a streaming point refuse quietly', () => {
    const seeded = run([{ type: 'HISTORY', messages: seededHistory }]);
    expect(run([{ type: 'TAKE_SWITCH', turnId: 'nope', takeIndex: 1 }], seeded)).toBe(seeded);
    expect(run([{ type: 'TAKE_SWITCH', turnId: T2, takeIndex: 9 }], seeded)).toBe(seeded);
    expect(run([{ type: 'TAKE_SWITCH', turnId: T2, takeIndex: 2 }], seeded)).toBe(seeded); // already viewed
    const streaming = run([
      { type: 'SPEECH', text: 'new take forming', take: { turnId: T2, takeIndex: 3 } },
    ], seeded);
    expect(run([{ type: 'TAKE_SWITCH', turnId: T2, takeIndex: 1 }], streaming)).toBe(streaming);
  });

  test('a take whose point is not on screen lands at the tail WITH its identity', () => {
    const state = run([
      { type: 'SPEECH', text: 'orphan take', take: { turnId: 'cut-away', takeIndex: 4 } },
    ]);
    const msg = streamingMsg(state);
    expect(msg).toMatchObject({ turnId: 'cut-away', takeIndex: 4, takeCount: 4 });
    expect(msg.takes).toHaveLength(1); // only what the stream brought
  });

  test('RETRY_SENT stands the thinking placeholder without a user bubble', () => {
    const state = run([{ type: 'RETRY_SENT' }]);
    expect(state.thinking).toBe(true);
    expect(state.messages).toHaveLength(0);
  });

  test('legacy messages (no turnId) are untouched — the pre-takes thread reads as before', () => {
    const state = run([
      {
        type: 'HISTORY',
        messages: [
          { role: 'user', content: 'old ask', at: '2026-07-20T00:00:00.000Z' },
          { role: 'assistant', content: 'old answer', at: '2026-07-20T00:00:01.000Z' },
        ],
      },
      { type: 'SPEECH', text: 'ordinary live answer' },
      { type: 'COMPLETE', metadata: null },
    ]);
    expect(state.messages.map((m) => m.turnId)).toEqual([undefined, undefined, undefined]);
    expect(state.messages[2].takes).toBeUndefined();
    expect(state.messages[2].segments).toEqual([{ kind: 'speech', text: 'ordinary live answer' }]);
  });

  test('LOAD with take-aware records folds the same way HISTORY does', () => {
    const state = run([{ type: 'LOAD', messages: seededHistory, threadKey: 'k' }]);
    expect(state.messages).toHaveLength(4);
    expect(state.messages[3]).toMatchObject({ turnId: T2, takeIndex: 2, takeCount: 2 });
    expect(state.thread).toBe(1);
  });
});

describe('RETRY ANYWHERE — the point named live, the edit-fork shown', () => {
  const T = 'turn-live-1';

  test('TURN_STAMP back-patches the live user bubble that opened the turn', () => {
    const state = run([
      { type: 'USER_SENT', text: 'what is the void?' },
      { type: 'TURN_STAMP', turnId: T },
      { type: 'SPEECH', text: 'an answer', take: { turnId: T, takeIndex: 1 } },
      { type: 'COMPLETE', metadata: null },
    ]);
    expect(state.messages[0]).toMatchObject({ role: 'user', turnId: T });
    expect(state.messages[1]).toMatchObject({ role: 'neuma', turnId: T });
  });

  test('TURN_STAMP stamps the EARLIEST unstamped live user — turns complete in send order', () => {
    // Two held words: the first turn's stamp must land on the first bubble,
    // never on the word still waiting its own turn.
    const state = run([
      { type: 'USER_SENT', text: 'first' },
      { type: 'USER_SENT', text: 'second' },
      { type: 'TURN_STAMP', turnId: 't-first' },
      { type: 'TURN_STAMP', turnId: 't-second' },
    ]);
    expect(state.messages[0].turnId).toBe('t-first');
    expect(state.messages[1].turnId).toBe('t-second');
  });

  test('TURN_STAMP is a no-op once the point is named on screen (a retry, a second stamp)', () => {
    const seeded = run([
      { type: 'USER_SENT', text: 'q' },
      { type: 'TURN_STAMP', turnId: T },
    ]);
    expect(run([{ type: 'TURN_STAMP', turnId: T }], seeded)).toBe(seeded);
    // A retry of that point stamps NOTHING — the retry's own frames carry the
    // same turnId, and an unrelated pending bubble must never take its name.
    const pending = run([{ type: 'USER_SENT', text: 'unrelated' }], seeded);
    expect(run([{ type: 'TURN_STAMP', turnId: T }], pending).messages[1].turnId).toBeUndefined();
  });

  test('TURN_STAMP never names a history bubble or a missing point', () => {
    const legacy = run([
      {
        type: 'HISTORY',
        messages: [{ role: 'user', content: 'old ask' }], // legacy row — no turnId
      },
    ]);
    const stamped = run([{ type: 'TURN_STAMP', turnId: T }], legacy);
    expect(stamped.messages[0].turnId).toBeUndefined();
    expect(run([{ type: 'TURN_STAMP', turnId: '' }], legacy)).toBe(legacy);
  });

  test('ERROR carries the persisted point identity onto the bubble — none when the point never persisted', () => {
    const failed = run([
      { type: 'USER_SENT', text: 'q' },
      { type: 'TURN_STAMP', turnId: T },
      { type: 'ERROR', text: 'provider overloaded', turnId: T },
    ]);
    const bubble = failed.messages[1];
    expect(bubble).toMatchObject({ role: 'error', turnId: T });
    // A pre-persist refusal carries none — the bubble offers nothing.
    const refused = run([{ type: 'ERROR', text: 'no lane' }]);
    expect(refused.messages[0].turnId).toBeUndefined();
  });

  test('THE EDIT-FORK — RETRY_SENT with revised words re-points the bubble; TAKE_SWITCH re-folds the asking', () => {
    let state = run([
      { type: 'USER_SENT', text: 'first asking' },
      { type: 'TURN_STAMP', turnId: T },
      { type: 'SPEECH', text: 'take one', take: { turnId: T, takeIndex: 1 } },
      { type: 'COMPLETE', metadata: null },
    ]);
    // The revision is sent: the bubble shows the revised asking (the new take
    // streams as the viewed latest — the fold law, live).
    state = run([{ type: 'RETRY_SENT', turnId: T, ask: 'revised asking' }], state);
    const bubble = state.messages[0];
    expect(bubble.segments).toEqual([{ kind: 'speech', text: 'revised asking' }]);
    expect(bubble.askOriginal).toBe('first asking'); // the first asking kept
    expect(bubble.asks).toEqual({ 2: 'revised asking' }); // keyed by the take it forks
    expect(state.thinking).toBe(true);
    // The take lands; switching the view re-folds the asking with the answer.
    state = run([
      { type: 'SPEECH', text: 'take two', take: { turnId: T, takeIndex: 2 } },
      { type: 'COMPLETE', metadata: null },
      { type: 'TAKE_SWITCH', turnId: T, takeIndex: 1 },
    ], state);
    expect(state.messages[0].segments).toEqual([{ kind: 'speech', text: 'first asking' }]);
    state = run([{ type: 'TAKE_SWITCH', turnId: T, takeIndex: 2 }], state);
    expect(state.messages[0].segments).toEqual([{ kind: 'speech', text: 'revised asking' }]);
  });

  test('RETRY_SENT with revised words keeps the bubble\'s shared images', () => {
    const state = run([
      { type: 'USER_SENT', text: 'look at this', images: ['data:image/png;base64,x'] },
      { type: 'TURN_STAMP', turnId: T },
      { type: 'RETRY_SENT', turnId: T, ask: 'look closer' },
    ]);
    expect(state.messages[0].segments).toEqual([
      { kind: 'image', src: 'data:image/png;base64,x' },
      { kind: 'speech', text: 'look closer' },
    ]);
  });

  test('RETRY_SENT without revised words is the plain retry — the asking never moves', () => {
    const seeded = run([
      { type: 'USER_SENT', text: 'first asking' },
      { type: 'TURN_STAMP', turnId: T },
    ]);
    const state = run([{ type: 'RETRY_SENT', turnId: T }], seeded);
    expect(state.thinking).toBe(true);
    expect(state.messages[0].segments).toEqual([{ kind: 'speech', text: 'first asking' }]);
    expect(state.messages[0].asks).toBeUndefined();
    // An unknown point refuses quietly.
    expect(run([{ type: 'RETRY_SENT', turnId: 'nope', ask: 'x' }], seeded).messages[0].asks).toBeUndefined();
  });
});

describe('stream-reducer — the live voice sitting (SPEECH SYSTEM client half)', () => {
  test('PURPOSE adopts the server truth and fails closed on garbage', () => {
    expect(initialState.purpose).toBe('work');
    const conv = reducer(initialState, { type: 'PURPOSE', purpose: 'conversation' });
    expect(conv.purpose).toBe('conversation');
    expect(isConversationPurpose(conv)).toBe(true);
    expect(isConversationPurpose(initialState)).toBe(false);
    // Unknown / hostile values read as 'work' — never a voice sitting by accident.
    expect(reducer(conv, { type: 'PURPOSE', purpose: 'work' }).purpose).toBe('work');
    expect(reducer(conv, { type: 'PURPOSE', purpose: 'admin' }).purpose).toBe('work');
    expect(reducer(conv, { type: 'PURPOSE' }).purpose).toBe('work');
    // Same value → same reference (React skips the re-render).
    expect(reducer(conv, { type: 'PURPOSE', purpose: 'conversation' })).toBe(conv);
  });

  test('purpose survives RESET and LOAD (connection-scoped, like connected)', () => {
    const conv = reducer(initialState, { type: 'PURPOSE', purpose: 'conversation' });
    expect(reducer(conv, { type: 'RESET' }).purpose).toBe('conversation');
    expect(reducer(conv, { type: 'LOAD', messages: [] }).purpose).toBe('conversation');
  });

  test('VOICE_PARTIAL lands ONE transient line and each partial replaces it', () => {
    let state = run([{ type: 'VOICE_PARTIAL', text: 'the portal is' }]);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      role: 'user', transient: true, voicePartial: true, streaming: false,
    });
    expect(state.messages[0].segments).toEqual([{ kind: 'speech', text: 'the portal is' }]);
    // The witness is still speaking — the being is NOT thinking yet.
    expect(state.thinking).toBe(false);
    state = run([{ type: 'VOICE_PARTIAL', text: 'the portal is open' }], state);
    expect(state.messages).toHaveLength(1); // replaced, never stacked
    expect(state.messages[0].segments).toEqual([{ kind: 'speech', text: 'the portal is open' }]);
    // Empty partials are not display facts.
    expect(run([{ type: 'VOICE_PARTIAL', text: '  ' }], state)).toBe(state);
  });

  test('VOICE_UTTERANCE retires the transient partial; the ordinary path bubbles the words', () => {
    let state = run([
      { type: 'VOICE_PARTIAL', text: 'the portal is open' },
      { type: 'VOICE_UTTERANCE' },
    ]);
    expect(state.messages).toHaveLength(0); // the partial is GONE on final
    // The ordinary send path (what onVoiceUtterance calls next) adds exactly
    // ONE real bubble — no double-bubble.
    state = run([{ type: 'USER_SENT', text: 'the portal is open' }], state);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[0].transient).toBeUndefined();
    expect(state.messages[0].voicePartial).toBeUndefined();
  });

  test('VOICE_UTTERANCE without a live partial is a no-op', () => {
    const seeded = run([{ type: 'USER_SENT', text: 'q' }]);
    expect(reducer(seeded, { type: 'VOICE_UTTERANCE' })).toBe(seeded);
  });

  test('VOICE_NOTE retires the partial and lands an honest degrade line', () => {
    const state = run([
      { type: 'VOICE_PARTIAL', text: 'are you still' },
      { type: 'VOICE_NOTE', code: 'stt_unavailable' },
    ]);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe('error');
    expect(state.messages[0].voicePartial).toBeUndefined();
    expect(state.messages[0].segments[0].text).toBe(voiceErrorText('stt_unavailable'));
    expect(state.messages[0].segments[0].text).toContain('text');
  });

  test('voice generation discipline: monotonic adopt, stale floor, fresh-session reset', () => {
    expect(advanceVoiceGen(0, 0)).toBe(0);
    expect(advanceVoiceGen(3, 5)).toBe(5);
    expect(advanceVoiceGen(5, 2)).toBe(5); // never backwards
    expect(advanceVoiceGen(5, 'x')).toBe(5);
    expect(advanceVoiceGen(5, undefined)).toBe(5);
    // After a barge-in raises the floor to lastAdopted + 1, the cancelled
    // generation's racing frames are stale; the new generation's are not.
    const floor = advanceVoiceGen(0, 4) + 1;
    expect(isStaleVoiceGen(4, floor)).toBe(true);
    expect(isStaleVoiceGen(5, floor)).toBe(false);
    expect(isStaleVoiceGen(6, floor)).toBe(false);
    expect(isStaleVoiceGen(undefined, floor)).toBe(false); // gen-less frames are not gen-judged
  });

  test('voiceErrorText names every degrade honestly, unknown codes included', () => {
    expect(voiceErrorText('stt_unavailable')).toContain('unavailable');
    expect(voiceErrorText('pcm_flood')).toContain('dropped');
    expect(voiceErrorText('purpose_not_conversation')).toContain('conversation');
    expect(voiceErrorText('something_new')).toContain('failed');
    expect(voiceErrorText('')).toContain('failed');
  });
});

// THE THOUGHT BUBBLE. Design note, 2026-07-30: […] So
// reasoning has to land in the turn WITHOUT ever becoming speech — because what
// the operator watches must not be able to change what the being said.
describe('thought segments — reasoning, watchable and never spoken', () => {
  const thoughtOf = (msg) => msg.segments.find((s) => s.kind === 'thought');

  test('THINKING opens a bubble of its own, and speech stays speech', () => {
    const state = run([
      { type: 'USER_SENT', text: 'why?' },
      { type: 'THINKING', text: 'Let me check the premise. ' },
      { type: 'THINKING', text: 'All but 9 means 9 remain.' },
      { type: 'SPEECH', text: '9 sheep.' },
    ]);
    const msg = streamingMsg(state);
    // Two frames of thought, ONE bubble — reasoning streams token by token and
    // must not shatter into a bubble per chunk.
    expect(msg.segments.filter((s) => s.kind === 'thought')).toHaveLength(1);
    expect(thoughtOf(msg).text).toBe('Let me check the premise. All but 9 means 9 remain.');
    // The answer is untouched by any of it.
    expect(msg.segments.find((s) => s.kind === 'speech').text).toBe('9 sheep.');
  });

  test('the thought sits where it happened, in order', () => {
    const state = run([
      { type: 'USER_SENT', text: 'go' },
      { type: 'THINKING', text: 'first I consider…' },
      { type: 'SPEECH', text: 'Here is the answer.' },
      { type: 'THINKING', text: 'now the follow-up…' },
      { type: 'SPEECH', text: 'And here is more.' },
    ]);
    expect(streamingMsg(state).segments.map((s) => s.kind))
      .toEqual(['thought', 'speech', 'thought', 'speech']);
  });

  test('thinking alone does NOT retire the composing placeholder prematurely', () => {
    // A being that has only thought so far has not begun answering. But the
    // reducer's own contract is that any segment activity settles the dots, so
    // this pins the behaviour rather than leaving it to accident.
    const state = run([
      { type: 'USER_SENT', text: 'hm' },
      { type: 'THINKING', text: 'considering' },
    ]);
    expect(state.thinking).toBe(false);
    expect(thoughtOf(streamingMsg(state)).text).toBe('considering');
  });

  test('an empty reasoning frame changes nothing', () => {
    const before = run([{ type: 'USER_SENT', text: 'x' }]);
    expect(reducer(before, { type: 'THINKING', text: '' })).toBe(before);
  });
});
