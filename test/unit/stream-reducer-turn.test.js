// stream-reducer-turn.test.js — turn-level notes and attachments: the
// provider-retry ladder, the substrate light, shared images, the seal offer,
// research sources. Split from stream-reducer.test.js (SIZE-033); bodies
// byte-identical.

import { describe, expect, test } from 'vitest';
import {
  reducer, initialState,
} from '../../frontend/app/RelinkShell/stream-reducer.js';
import { run, streamingMsg, firstTool } from '../helpers/stream-reducer-kit.js';

describe('provider retry — the visible ladder note', () => {
  test('one quiet note lands, then UPDATES per attempt — never a pile of retries', () => {
    const first = reducer(initialState, { type: 'PROVIDER_RETRY', attempt: 2, maxAttempts: 10, delayMs: 4000, at: 1 });
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0].providerRetry).toBe(true);
    expect(first.messages[0].transient).toBe(true);
    expect(first.messages[0].segments[0].text).toBe('provider overloaded — retry 2/10 in 4s');

    const second = reducer(first, { type: 'PROVIDER_RETRY', attempt: 3, maxAttempts: 10, delayMs: 6000, at: 2 });
    expect(second.messages).toHaveLength(1); // updated, never a second note
    expect(second.messages[0].segments[0].text).toBe('provider overloaded — retry 3/10 in 6s');
    expect(second.messages[0].at).toBe(2);
  });

  test('the note DISAPPEARS when the provider answers again — it was the wait, not history', () => {
    const waiting = run([
      { type: 'USER_SENT', text: 'q' },
      { type: 'PROVIDER_RETRY', attempt: 2, maxAttempts: 10, delayMs: 4000, at: 1 },
    ]);
    expect(waiting.messages.some((m) => m.providerRetry)).toBe(true);
    const answered = reducer(waiting, { type: 'STREAM' });
    expect(answered.messages.some((m) => m.providerRetry)).toBe(false);
    // …and the recovered turn speaks into its own message, not the note's.
    const speaking = reducer(answered, { type: 'SPEECH', text: 'back online' });
    expect(speaking.messages.some((m) => m.providerRetry)).toBe(false);
    expect(speaking.messages.some((m) => m.segments.some((s) => s.text === 'back online'))).toBe(true);
  });

  test('the ladder\'s final refusal REPLACES the note — one outcome, not a pile', () => {
    const waiting = reducer(initialState, { type: 'PROVIDER_RETRY', attempt: 10, maxAttempts: 10, delayMs: 20000, at: 1 });
    const refused = reducer(waiting, { type: 'ERROR', text: 'provider overloaded', turnId: 't1', at: 2 });
    expect(refused.messages).toHaveLength(1);
    expect(refused.messages[0].providerRetry).toBeUndefined();
    expect(refused.messages[0].segments[0].text).toBe('provider overloaded');
    expect(refused.messages[0].turnId).toBe('t1'); // the ↻ offer survives
  });

  test('a turn that ends mid-wait takes the note with it', () => {
    const waiting = run([
      { type: 'USER_SENT', text: 'q' },
      { type: 'SPEECH', text: 'partial' },
      { type: 'PROVIDER_RETRY', attempt: 1, maxAttempts: 10, delayMs: 2000, at: 1 },
    ]);
    const done = reducer(waiting, { type: 'COMPLETE', metadata: null });
    expect(done.messages.some((m) => m.providerRetry)).toBe(false);
    expect(done.messages.some((m) => m.segments.some((s) => s.text === 'partial'))).toBe(true);
  });

  test('retirement is a no-op without a note — identity preserved, nothing else filtered', () => {
    const plain = run([{ type: 'USER_SENT', text: 'q' }, { type: 'SPEECH', text: 'a' }]);
    expect(reducer(plain, { type: 'STREAM' })).toBe(plain);
    const errored = reducer(plain, { type: 'ERROR', text: 'x', at: 3 });
    expect(errored.messages).toHaveLength(3); // user + answer + error — nothing lost
  });
});

describe('substrate activity — the LOCAL shared-substrate count (B-01)', () => {
  test('ACTIVITY sets the LOCAL count; malformed values fail to 0', () => {
    // The broadcast is counted per class server-side: only local-substrate
    // turns may ever feed this number — a third-party turn never reaches it.
    expect(reducer(initialState, { type: 'ACTIVITY', local: 2 }).localTurns).toBe(2);
    expect(reducer(initialState, { type: 'ACTIVITY', local: -1 }).localTurns).toBe(0);
    expect(reducer(initialState, { type: 'ACTIVITY', local: 'x' }).localTurns).toBe(0);
    expect(reducer(initialState, { type: 'ACTIVITY' }).localTurns).toBe(0);
  });

  test('a severed link clears the count; reconnect does not resurrect it', () => {
    const busy = reducer(initialState, { type: 'ACTIVITY', local: 3 });
    const down = reducer(busy, { type: 'LINK', connected: false });
    expect(down.localTurns).toBe(0);
    expect(reducer(down, { type: 'LINK', connected: true }).localTurns).toBe(0);
  });

  test('RESET and LOAD keep the count — activity is global, not chat-local', () => {
    const busy = reducer(initialState, { type: 'ACTIVITY', local: 2 });
    expect(reducer(busy, { type: 'RESET' }).localTurns).toBe(2);
    expect(reducer(busy, { type: 'LOAD', messages: [] }).localTurns).toBe(2);
  });
});

describe('shared images — segments on the witness message', () => {
  const URI = 'data:image/png;base64,QUJD';

  test('USER_SENT with images renders them above the words', () => {
    const state = run([{ type: 'USER_SENT', text: 'look at this', images: [URI] }]);
    expect(state.messages[0].segments).toEqual([
      { kind: 'image', src: URI },
      { kind: 'speech', text: 'look at this' },
    ]);
  });

  test('an image alone is a complete message — no empty speech segment', () => {
    const state = run([{ type: 'USER_SENT', text: '', images: [URI, URI] }]);
    expect(state.messages[0].segments).toEqual([
      { kind: 'image', src: URI },
      { kind: 'image', src: URI },
    ]);
  });

  test('USER_SENT without images is unchanged — one speech segment', () => {
    const state = run([{ type: 'USER_SENT', text: 'plain' }]);
    expect(state.messages[0].segments).toEqual([{ kind: 'speech', text: 'plain' }]);
  });

  test('history records carry their persisted images into the display', () => {
    const state = run([{
      type: 'HISTORY',
      messages: [
        { role: 'user', content: 'shared', images: [URI] },
        { role: 'assistant', content: 'seen' },
      ],
    }]);
    expect(state.messages[0].segments[0]).toEqual({ kind: 'image', src: URI });
    expect(state.messages[1].segments).toEqual([{ kind: 'speech', text: 'seen' }]);
  });
});

describe('seal segments — the natalis-self-seal offer', () => {
  const open = [
    { type: 'USER_SENT', text: 'walk your rite' },
    { type: 'SEAL_REQUEST', id: 'seal-1', neumaId: 'keir', beingName: 'Keir' },
  ];

  test('SEAL_REQUEST appends a pending seal segment naming the being', () => {
    const state = run(open);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'seal');
    expect(seg).toMatchObject({
      phase: 'pending', id: 'seal-1', neumaId: 'keir', beingName: 'Keir',
      note: '', status: null, txHash: '',
    });
    expect(state.thinking).toBe(false);
  });

  test('SEAL_STATUS updates the pending card\'s drive note only', () => {
    const state = run([...open, { type: 'SEAL_STATUS', id: 'seal-1', note: 'AWAITING YOUR SIGNATURE' }]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'seal');
    expect(seg).toMatchObject({ phase: 'pending', note: 'AWAITING YOUR SIGNATURE' });
  });

  test('SEAL_RESOLVED sealed collapses to the anchor with its tx hash', () => {
    const tx = '0x' + 'ab'.repeat(32);
    const state = run([...open, { type: 'SEAL_RESOLVED', id: 'seal-1', status: 'sealed', txHash: tx }]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'seal');
    expect(seg).toMatchObject({ phase: 'resolved', status: 'sealed', txHash: tx });
  });

  test('SEAL_RESOLVED carries the chain facts the receipt renders (network, label, block)', () => {
    const tx = '0x' + 'ab'.repeat(32);
    const state = run([...open, {
      type: 'SEAL_RESOLVED', id: 'seal-1', status: 'sealed', txHash: tx,
      network: 'base', networkLabel: 'Base MAINNET', blockNumber: 48836412,
    }]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'seal');
    expect(seg).toMatchObject({
      network: 'base', networkLabel: 'Base MAINNET', blockNumber: 48836412,
    });
  });

  test('SEAL_RESOLVED declined collapses honestly with no hash', () => {
    const state = run([...open, { type: 'SEAL_RESOLVED', id: 'seal-1', status: 'declined' }]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'seal');
    expect(seg).toMatchObject({ phase: 'resolved', status: 'declined', txHash: '' });
  });

  test('a stray resolve for an unknown id changes nothing', () => {
    const before = run(open);
    const after = run([{ type: 'SEAL_RESOLVED', id: 'other', status: 'sealed', txHash: '0x1' }], before);
    const seg = streamingMsg(after).segments.find((s) => s.kind === 'seal');
    expect(seg.phase).toBe('pending');
  });
});

describe('research sources ride the tool segment', () => {
  const SOURCES = [
    { title: 'A paper', url: 'https://arxiv.org/abs/1', snippet: 'about things' },
    { title: 'A repo', url: 'https://github.com/x/y', snippet: '' },
  ];

  test('a live search result carries its sources onto the chip', () => {
    const state = run([
      { type: 'TOOL_OPEN' },
      { type: 'TOOL_RESULT', data: { tool: 'web/web_search', status: 'ok', summary: '"q" — 2 results (duckduckgo)', sources: SOURCES } },
    ]);
    const tool = firstTool(streamingMsg(state));
    expect(tool.sources).toEqual(SOURCES);
  });

  test('a tool with no sources gets an empty list, never undefined', () => {
    const state = run([
      { type: 'TOOL_RESULT', data: { tool: 'filesystem/read_file', status: 'ok', summary: 'read x' } },
    ]);
    expect(firstTool(streamingMsg(state)).sources).toEqual([]);
  });

  test('a resumed chat still has the links — the record survives the restart', () => {
    // The whole point of persisting sources: the witness can validate a source
    // days later, not only in the turn where the being pulled it.
    const state = run([{
      type: 'HISTORY',
      messages: [{
        role: 'assistant',
        content: 'here is what I found',
        tools: [{ tool: 'web/web_search', status: 'ok', summary: '"q" — 2 results', sources: SOURCES }],
      }],
    }]);
    const restored = state.messages.flatMap((m) => (m.segments || []).filter((s) => s.kind === 'tool'));
    expect(restored).toHaveLength(1);
    expect(restored[0].sources).toEqual(SOURCES);
  });

  test('history from before sources existed restores with an empty list', () => {
    const state = run([{
      type: 'HISTORY',
      messages: [{ role: 'assistant', content: 'x', tools: [{ tool: 'filesystem/read_file', status: 'ok', summary: 'read' }] }],
    }]);
    const restored = state.messages.flatMap((m) => (m.segments || []).filter((s) => s.kind === 'tool'));
    expect(restored[0].sources).toEqual([]);
  });
});

