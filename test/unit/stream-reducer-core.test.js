// stream-reducer-core.test.js — the core fold: message accumulation, speech
// merging, the tool segment lifecycle (acting → resolved / orphaned),
// completion metadata, history prepending, acts-on-marks rebuild, and link
// state. Split from stream-reducer.test.js (SIZE-033); bodies byte-identical.

import { describe, expect, test } from 'vitest';
import {
  reducer, initialState,
} from '../../frontend/app/RelinkShell/stream-reducer.js';
import { run, streamingMsg, firstTool } from '../helpers/stream-reducer-kit.js';

describe('stream-reducer', () => {
  test('USER_SENT carries shared files as named doc chips (2026-09-17)', () => {
    const state = run([{ type: 'USER_SENT', text: 'see attached', docs: [{ name: 'brief.md' }] }]);
    const msg = state.messages[state.messages.length - 1];
    expect(msg.segments).toEqual([
      { kind: 'doc', name: 'brief.md' },
      { kind: 'speech', text: 'see attached' },
    ]);
  });

  test('USER_SENT appends a user message and marks thinking', () => {
    const state = run([{ type: 'USER_SENT', text: 'hello' }]);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: 'user', streaming: false });
    expect(state.messages[0].segments).toEqual([{ kind: 'speech', text: 'hello' }]);
    expect(state.thinking).toBe(true);
  });

  test('message ids are unique across turns', () => {
    const state = run([
      { type: 'USER_SENT', text: 'a' },
      { type: 'SPEECH', text: 'reply' },
      { type: 'COMPLETE', metadata: null },
      { type: 'USER_SENT', text: 'b' },
    ]);
    const ids = state.messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('SPEECH opens a live neuma message, merges speech, and clears thinking', () => {
    const state = run([
      { type: 'USER_SENT', text: 'q' },
      { type: 'SPEECH', text: 'Hel' },
      { type: 'SPEECH', text: 'lo there' },
    ]);
    const msg = streamingMsg(state);
    expect(msg).toBeDefined();
    expect(msg.role).toBe('neuma');
    expect(msg.segments).toEqual([{ kind: 'speech', text: 'Hello there' }]);
    expect(state.thinking).toBe(false);
  });

  test('STREAM activity retires the thinking placeholder; no-op once cleared', () => {
    const seeded = run([{ type: 'USER_SENT', text: 'q' }]);
    expect(seeded.thinking).toBe(true);
    const cleared = reducer(seeded, { type: 'STREAM' });
    expect(cleared.thinking).toBe(false);
    // already clear → same reference, so React skips the re-render
    expect(reducer(cleared, { type: 'STREAM' })).toBe(cleared);
  });

  test('tool lifecycle: open → label → raw → result resolves the same segment', () => {
    const state = run([
      { type: 'SPEECH', text: 'let me check ' },
      { type: 'TOOL_OPEN' },
      { type: 'TOOL_RAW', raw: '[TOOL: fs/read_file {"path":"x"}]', label: 'read_file' },
      { type: 'TOOL_RESULT', data: { tool: 'read_file', status: 'ok', summary: 'read x' } },
    ]);
    const msg = streamingMsg(state);
    const tools = msg.segments.filter((s) => s.kind === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ phase: 'resolved', status: 'ok', summary: 'read x' });
    // raw call survives as the expandable detail
    expect(tools[0].detail).toContain('[TOOL:');
  });

  // WHAT THE BEING MADE reaches the chip. This was dropped in TOOL_RESULT, so a
  // generated image existed on disk, in the gallery and in the activity rail —
  // everywhere except the conversation it was made in.
  // ONE ROW PER ACTION. A render reports progress repeatedly and each report
  // used to append a segment — seven rows for one image (Design note, 2026-08-02:
  // […]).
  test('repeat progress reports UPDATE one row instead of stacking rows', () => {
    const state = run([
      { type: 'TOOL_OPEN' },
      { type: 'TOOL_RESULT', data: { tool: 'image/generate_image', status: 'running', summary: 'rendering — SDXL' } },
      { type: 'TOOL_RESULT', data: { tool: 'image/generate_image', status: 'running', summary: 'rendering — 25%' } },
      { type: 'TOOL_RESULT', data: { tool: 'image/generate_image', status: 'running', summary: 'rendering — 75%' } },
    ]);
    const tools = streamingMsg(state).segments.filter((s) => s.kind === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0].summary).toBe('rendering — 75%');
  });
  test('the terminal result REPLACES the live row, becoming the finished thing', () => {
    const state = run([
      { type: 'TOOL_OPEN' },
      { type: 'TOOL_RESULT', data: { tool: 'image/generate_image', status: 'running', summary: 'rendering — 50%' } },
      { type: 'TOOL_RESULT', data: { tool: 'image/generate_image', status: 'ok', summary: 'generated 1 image(s)', images: [{ imageId: 'i1' }] } },
    ]);
    const tools = streamingMsg(state).segments.filter((s) => s.kind === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ status: 'ok' });
    expect(tools[0].images).toHaveLength(1);
  });

  test('two DIFFERENT tools each keep their own row', () => {
    const state = run([
      { type: 'TOOL_OPEN' },
      { type: 'TOOL_RESULT', data: { tool: 'image/generate_image', status: 'running', summary: 'rendering — 10%' } },
      { type: 'TOOL_RESULT', data: { tool: 'fs/read_file', status: 'executing', summary: 'reading' } },
      { type: 'TOOL_RESULT', data: { tool: 'image/generate_image', status: 'running', summary: 'rendering — 90%' } },
    ]);
    const tools = streamingMsg(state).segments.filter((s) => s.kind === 'tool');
    expect(tools).toHaveLength(2);
    expect(tools.find((t) => t.label === 'image/generate_image').summary).toBe('rendering — 90%');
  });

  test('a SETTLED row is never reopened by a later call to the same tool', () => {
    // Two separate uses of one tool in a turn must not collapse into each other.
    const state = run([
      { type: 'TOOL_OPEN' },
      { type: 'TOOL_RESULT', data: { tool: 'fs/read_file', status: 'ok', summary: 'read a' } },
      { type: 'TOOL_RESULT', data: { tool: 'fs/read_file', status: 'ok', summary: 'read b' } },
    ]);
    const tools = streamingMsg(state).segments.filter((s) => s.kind === 'tool');
    expect(tools).toHaveLength(2);
  });

  test('a generated image rides TOOL_RESULT onto the chip, with its file location', () => {
    const IMAGES = [{
      imageId: 'dc1b7cc9', url: '/api/v1/image-forge/images/dc1b7cc9', mime: 'image/png',
      bytes: 862000, laneId: 'kagipem', path: '/data/image-forge/images/kagipem/dc1b7cc9.png',
    }];
    const state = run([
      { type: 'TOOL_OPEN' },
      { type: 'TOOL_RESULT', data: { tool: 'image/generate_image', status: 'ok', summary: 'generated 1 image(s)', images: IMAGES } },
    ]);
    const tool = firstTool(streamingMsg(state));
    expect(tool.images).toHaveLength(1);
    // laneId is what the auth-gated image route scopes by; path is the
    // operator's answer to […].
    expect(tool.images[0]).toMatchObject({ imageId: 'dc1b7cc9', laneId: 'kagipem' });
    expect(tool.images[0].path).toContain('kagipem');
  });

  test('a result with no images carries an empty list, never undefined', () => {
    const state = run([
      { type: 'TOOL_OPEN' },
      { type: 'TOOL_RESULT', data: { tool: 'fs/read_file', status: 'ok', summary: 'read' } },
    ]);
    expect(firstTool(streamingMsg(state)).images).toEqual([]);
  });

  test('TOOL_RESULT with no acting chip appends a resolved segment', () => {
    const state = run([
      { type: 'SPEECH', text: 'done' },
      { type: 'TOOL_RESULT', data: { tool: 'write_file', status: 'error', detail: 'boom' } },
    ]);
    const tool = firstTool(streamingMsg(state));
    expect(tool).toMatchObject({ phase: 'resolved', status: 'error', label: 'write_file', detail: 'boom' });
  });

  test('COMPLETE clears streaming, attaches metadata, orphans unresolved tools', () => {
    const state = run([
      { type: 'SPEECH', text: 'working' },
      { type: 'TOOL_OPEN' },
      { type: 'COMPLETE', metadata: { emotion: 'curious', memoriesUsed: [{ excerpt: 'm' }] } },
    ]);
    expect(streamingMsg(state)).toBeUndefined();
    const msg = state.messages[state.messages.length - 1];
    expect(msg.streaming).toBe(false);
    expect(msg.meta).toEqual({ emotion: 'curious', memoriesUsed: [{ excerpt: 'm' }] });
    expect(firstTool(msg).phase).toBe('orphaned');
    expect(state.thinking).toBe(false);
  });

  test('COMPLETE closes a streaming message even when an error follows it', () => {
    // A late error chunk appends an error message after the live neuma one;
    // the trailing complete must still settle the neuma message (no stuck cursor).
    const state = run([
      { type: 'USER_SENT', text: 'go' },
      { type: 'SPEECH', text: 'partial answer' },
      { type: 'ERROR', text: 'disrupted' },
      { type: 'COMPLETE', metadata: null },
    ]);
    const neuma = state.messages.find((m) => m.role === 'neuma');
    expect(neuma.streaming).toBe(false);
    expect(state.messages.some((m) => m.streaming)).toBe(false);
  });

  test('ERROR appends an error message and stops thinking', () => {
    const state = run([
      { type: 'USER_SENT', text: 'hi' },
      { type: 'ERROR', text: 'portal disrupted' },
    ]);
    const last = state.messages[state.messages.length - 1];
    expect(last).toMatchObject({ role: 'error' });
    expect(last.segments[0].text).toBe('portal disrupted');
    expect(state.thinking).toBe(false);
  });

  test('messages carry their moment (`at`) from the action; absent reads null', () => {
    const AT = 1770000000000;
    const state = run([
      { type: 'USER_SENT', text: 'hello', at: AT },
      { type: 'SPEECH', text: 'reply', at: AT + 500 },
    ]);
    expect(state.messages[0].at).toBe(AT);          // the witness's word, at send
    expect(streamingMsg(state).at).toBe(AT + 500);  // the live message, at mint
    // A clock-free action mints without a stamp — never NaN or undefined.
    const bare = run([{ type: 'USER_SENT', text: 'x' }]);
    expect(bare.messages[0].at).toBeNull();
  });

  test('the live message keeps its mint moment across later chunks', () => {
    const state = run([
      { type: 'SPEECH', text: 'first ', at: 1000 },
      { type: 'SPEECH', text: 'second', at: 9999 },
    ]);
    expect(streamingMsg(state).at).toBe(1000);
  });

  test('HISTORY keeps shared files on the operator\'s own bubble (2026-09-17)', () => {
    const state = run([{ type: 'HISTORY', messages: [
      { role: 'user', content: 'see attached', docs: [{ name: 'campaign-brief.md', text: '…' }] },
      { role: 'assistant', content: 'read it' },
    ] }]);
    const mine = state.messages.find((m) => m.role === 'user');
    expect(mine.segments).toContainEqual({ kind: 'doc', name: 'campaign-brief.md' });
  });

  test('HISTORY carries each record\'s own `at` into the display', () => {
    const state = run([
      { type: 'HISTORY', messages: [
        { role: 'user', content: 'earlier q', at: '2026-07-20T14:00:00.000Z' },
        { role: 'assistant', content: 'earlier a' },
      ] },
    ]);
    expect(state.messages[0].at).toBe('2026-07-20T14:00:00.000Z');
    expect(state.messages[1].at).toBeNull(); // a record predating the stamp
  });

  test('HISTORY prepends display-ready messages ahead of live ones', () => {
    const state = run([
      { type: 'USER_SENT', text: 'now' },
      { type: 'HISTORY', messages: [
        { role: 'user', content: 'earlier q' },
        { role: 'assistant', content: 'earlier a' },
      ] },
    ]);
    expect(state.messages[0]).toMatchObject({ role: 'user', isHistory: true });
    expect(state.messages[1]).toMatchObject({ role: 'neuma', isHistory: true });
    expect(state.messages[2]).toMatchObject({ role: 'user', isHistory: false });
    const ids = state.messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('LOAD replaces the thread with a past session, all marked history', () => {
    const seeded = run([
      { type: 'USER_SENT', text: 'live turn' },
      { type: 'LINK', connected: true },
      { type: 'LOCAL', reachable: true },
      { type: 'ROUTE', live: true, provider: 'kimi-for-coding' },
    ]);
    const state = reducer(seeded, { type: 'LOAD', messages: [
      { role: 'user', content: 'past q' },
      { role: 'assistant', content: 'past a' },
    ] });
    expect(state.messages).toHaveLength(2);
    expect(state.messages.every((m) => m.isHistory)).toBe(true);
    expect(state.messages[0]).toMatchObject({ role: 'user', isHistory: true });
    expect(state.messages[1]).toMatchObject({ role: 'neuma', isHistory: true });
    expect(state.connected).toBe(true); // link survives a resume
    expect(state.local.reachable).toBe(true); // both lights survive a resume too
    expect(state.route).toEqual({ live: true, provider: 'kimi-for-coding' });
    expect(state.thinking).toBe(false);
    expect(new Set(state.messages.map((m) => m.id)).size).toBe(2);
    expect(state.thread).toBe(seeded.thread + 1);
  });

  test('LOAD keys differ across selected sessions so completed rows remount settled', () => {
    const rows = [{ role: 'assistant', content: 'same row, different thread' }];
    const first = reducer(initialState, { type: 'LOAD', messages: rows, threadKey: 'lane:session-a:1' });
    const second = reducer(first, { type: 'LOAD', messages: rows, threadKey: 'lane:session-b:2' });
    expect(first.messages[0].id).not.toBe(second.messages[0].id);
    expect(second.thread).toBe(first.thread + 1);
  });

  test('history from before marks existed keeps its old shape — chips ahead of the speech', () => {
    const state = run([
      { type: 'HISTORY', messages: [
        { role: 'user', content: 'research it' },
        { role: 'assistant', content: 'here is what I found',
          tools: [
            { tool: 'web/web_search', status: 'ok', summary: '"LLM news" — 5 results (duckduckgo)' },
            { tool: 'web/web_fetch', status: 'ok', summary: 'https://example.com — HTTP 200' },
            { tool: 'web/web_fetch', status: 'error', summary: 'web_fetch — failed', detail: 'target refused (forbidden-host)' },
          ] },
      ] },
    ]);
    const msg = state.messages[1];
    expect(msg.role).toBe('neuma');
    const tools = msg.segments.filter((s) => s.kind === 'tool');
    expect(tools).toHaveLength(3);
    // Settled chips, never re-executed: resolved phase, status preserved.
    expect(tools[0]).toMatchObject({ kind: 'tool', phase: 'resolved', label: 'web/web_search', status: 'ok', summary: '"LLM news" — 5 results (duckduckgo)' });
    expect(tools[2]).toMatchObject({ phase: 'resolved', status: 'error', detail: 'target refused (forbidden-host)' });
    // The speech follows the acts it came from.
    const last = msg.segments[msg.segments.length - 1];
    expect(last).toMatchObject({ kind: 'speech', text: 'here is what I found' });
    // A user record never gains tool segments.
    expect(state.messages[0].segments.every((s) => s.kind !== 'tool')).toBe(true);
  });

  // Design note, 2026-08-05: […]
  test('a resumed turn rebuilds its acts BETWEEN the words they interrupted', () => {
    const content = 'Let me look at that.\n\nThe file says forty-two.\n\nThat settles it.';
    const state = run([
      { type: 'HISTORY', messages: [
        { role: 'user', content: 'what does it say' },
        { role: 'assistant', content, tools: [
          { tool: 'filesystem/read_file', status: 'ok', summary: 'read a.js', mark: 20 },
          { tool: 'tasks/task_add', status: 'ok', summary: 'noted', mark: 48 },
        ] },
      ] },
    ]);
    const msg = state.messages[1];
    expect(msg.segments.map((s) => (s.kind === 'tool' ? `tool:${s.label}` : s.text))).toEqual([
      'Let me look at that.',
      'tool:filesystem/read_file',
      'The file says forty-two.',
      'tool:tasks/task_add',
      'That settles it.',
    ]);
  });

  test('an act before the first word rebuilds ahead of the whole answer', () => {
    const state = run([
      { type: 'HISTORY', messages: [
        { role: 'assistant', content: 'Here is the plan.', tools: [
          { tool: 'skill/sc-plan', status: 'ok', summary: 'summoned sc-plan (operator)', mark: 0 },
        ] },
      ] },
    ]);
    expect(state.messages[0].segments.map((s) => s.kind)).toEqual(['tool', 'speech']);
  });

  test('acts at the end of a turn rebuild after the words, with no empty speech', () => {
    const state = run([
      { type: 'HISTORY', messages: [
        { role: 'assistant', content: 'Done.', tools: [
          { tool: 'tasks/task_done', status: 'ok', summary: 'closed', mark: 5 },
        ] },
      ] },
    ]);
    expect(state.messages[0].segments.map((s) => s.kind)).toEqual(['speech', 'tool']);
  });

  test('a render kept on the record is still on the chip after a restart', () => {
    const state = run([
      { type: 'HISTORY', messages: [
        { role: 'assistant', content: 'Here it is.', tools: [
          { tool: 'image/generate_image', status: 'ok', summary: 'generated 1 image(s)', mark: 0,
            images: [{ imageId: 'img-1', url: '/api/v1/image-forge/images/img-1', mime: 'image/png' }] },
        ] },
      ] },
    ]);
    const [chip] = state.messages[0].segments.filter((s) => s.kind === 'tool');
    expect(chip.images).toEqual([{ imageId: 'img-1', url: '/api/v1/image-forge/images/img-1', mime: 'image/png' }]);
  });

  test('a mark past the end of the speech clamps instead of losing the chip', () => {
    const state = run([
      { type: 'HISTORY', messages: [
        { role: 'assistant', content: 'short', tools: [
          { tool: 'web/web_search', status: 'ok', summary: 'found', mark: 9000 },
        ] },
      ] },
    ]);
    expect(state.messages[0].segments.map((s) => s.kind)).toEqual(['speech', 'tool']);
  });

  test('a LOADED take rebuilds its own acts in its own order', () => {
    const state = run([
      { type: 'LOAD', threadKey: 'lane:s1:1', messages: [
        { role: 'user', content: 'q', turnId: 't1' },
        { role: 'assistant', turnId: 't1', takeIndex: 2, takeCount: 2,
          content: 'Looking now.\n\nAll clear.',
          tools: [{ tool: 'web/web_search', status: 'ok', summary: 'searched', mark: 12 }],
          takes: [
            { takeIndex: 1, content: 'first go', tools: [] },
            { takeIndex: 2, content: 'Looking now.\n\nAll clear.',
              tools: [{ tool: 'web/web_search', status: 'ok', summary: 'searched', mark: 12 }] },
          ] },
      ] },
    ]);
    const msg = state.messages[1];
    expect(msg.segments.map((s) => (s.kind === 'tool' ? 'tool' : s.text)))
      .toEqual(['Looking now.', 'tool', 'All clear.']);
  });

  test('RESET clears the thread for a fresh chat but keeps link state', () => {
    const seeded = run([
      { type: 'USER_SENT', text: 'old' },
      { type: 'SPEECH', text: 'reply' },
      { type: 'LINK', connected: true },
      { type: 'LOCAL', reachable: false, standby: true },
      { type: 'ROUTE', live: false, provider: 'xai' },
    ]);
    const state = reducer(seeded, { type: 'RESET' });
    expect(state.messages).toHaveLength(0);
    expect(state.connected).toBe(true);
    expect(state.local).toEqual({ reachable: false, standby: true }); // both lights survive a fresh chat
    expect(state.route).toEqual({ live: false, provider: 'xai' });
    expect(state.thinking).toBe(false);
    expect(state.seq).toBe(0);
  });

  test('LOCAL sets the substrate light without touching messages; unknown until probed', () => {
    expect(initialState.local).toEqual({ reachable: null, standby: false }); // not yet probed
    const seeded = run([{ type: 'USER_SENT', text: 'x' }]);
    const off = reducer(seeded, { type: 'LOCAL', reachable: false, standby: true });
    expect(off.local).toEqual({ reachable: false, standby: true });
    expect(off.messages).toBe(seeded.messages); // pure status flip, no message churn
    expect(reducer(off, { type: 'LOCAL', reachable: false, standby: true })).toBe(off); // repeated readings are no-ops
    const on = reducer(off, { type: 'LOCAL', reachable: true });
    expect(on.local).toEqual({ reachable: true, standby: false }); // a wake clears the rest flag
  });

  test('ROUTE sets the lane light by its provider; each field holds independently', () => {
    expect(initialState.route).toEqual({ live: null, provider: null });
    const named = reducer(initialState, { type: 'ROUTE', provider: 'kimi-for-coding' });
    expect(named.route).toEqual({ live: null, provider: 'kimi-for-coding' }); // identity before health
    const live = reducer(named, { type: 'ROUTE', live: true });
    expect(live.route).toEqual({ live: true, provider: 'kimi-for-coding' }); // health never costs identity
    expect(reducer(live, { type: 'ROUTE', live: true })).toBe(live); // repeated readings are no-ops
    const down = reducer(live, { type: 'ROUTE', live: false });
    expect(down.route).toEqual({ live: false, provider: 'kimi-for-coding' });
  });

  test('LINK toggles connection without touching messages', () => {
    const seeded = run([{ type: 'USER_SENT', text: 'x' }]);
    const up = reducer(seeded, { type: 'LINK', connected: true });
    expect(up.connected).toBe(true);
    expect(up.messages).toBe(seeded.messages);
    const down = reducer(up, { type: 'LINK', connected: false });
    expect(down.connected).toBe(false);
  });

  test('reducer never mutates the input state', () => {
    const frozen = Object.freeze({ ...initialState, messages: Object.freeze([]) });
    expect(() => reducer(frozen, { type: 'USER_SENT', text: 'x' })).not.toThrow();
    expect(frozen.messages).toHaveLength(0);
  });
});

