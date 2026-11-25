/**
 * THE TURN KEPT AS IT GOES — the pure half (turn-keep-record.js) and what the desk draws from it.
 * Design note, 2026-11-16: […]
 *
 * Pure functions over real frame shapes, the real display fold and history mapping, and a real
 * server render of the stream (the stream-panel-retry.test.js pattern). Nothing mocked.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  worthKeeping, freshKept, foldFrame, hasWork, keptSnapshot, catchUpFrames, cutRecord, resumeThought, CUT_MARK,
} from '../../backend/services/turn-keep-record.js';
import { applyCloneFrame, CLONE_TOOL } from '../../frontend/app/RelinkShell/clone-split.js';
import { toDisplayMessages } from '../../frontend/app/RelinkShell/workspace-sessions.js';
import { toHistoryMessages } from '../../frontend/app/RelinkShell/stream-reducer-messages.js';

let StreamPanel;
beforeAll(async () => {
  // The import graph's module-level browser facts (sound engine's listener, storage reads) — provisioned, never exercised.
  globalThis.window = globalThis.window ?? { addEventListener: () => {}, dispatchEvent: () => true, requestIdleCallback: () => {} };
  globalThis.localStorage = globalThis.localStorage ?? { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  ({ StreamPanel } = await import('../../frontend/app/RelinkShell/StreamPanel.jsx'));
});

const TAKE = { turnId: 'point-1', takeIndex: 1 };
const SPLIT = 'split-9';
const frames = [
  { type: 'consciousness:thinking', content: 'Four lists. ' },
  { type: 'consciousness:thinking', content: 'Split them.' },
  { type: 'consciousness:stream', content: 'Gathering ', turnId: 'point-1', takeIndex: 1 },
  { type: 'consciousness:stream', content: 'the four lists.', turnId: 'point-1', takeIndex: 1 },
  { type: 'tool:usage', tool: 'research/web_search', status: 'executing', summary: '' },
  { type: 'tool:usage', tool: 'research/web_search', status: 'ok', summary: 'searched "defi teams"' },
  { type: 'consciousness:stream', content: ' Splitting now.', turnId: 'point-1', takeIndex: 1 },
  { type: 'tool:usage', tool: CLONE_TOOL, status: 'executing', summary: 'splitting into 2 shadow clones' },
  { type: 'clone:split', splitId: SPLIT, clones: [{ index: 1, title: 'Base teams', task: 'Gather Base teams' }, { index: 2, title: 'AI funds', task: 'Gather AI funds' }] },
  { type: 'clone:state', splitId: SPLIT, index: 1, state: 'working' },
  { type: 'clone:state', splitId: SPLIT, index: 2, state: 'waiting', position: 1 },
  { type: 'clone:tool', splitId: SPLIT, index: 1, act: { tool: 'sales/prospect', status: 'ok', summary: 'filed a prospect' } },
  { type: 'clone:text', splitId: SPLIT, index: 1, chunk: 'Filed 3 so far.' },
  { type: 'clone:end', splitId: SPLIT, clone: { index: 2, state: 'done', report: 'Filed 6 funds.', acts: [], sessionId: 's-2' } },
];
const kept = () => frames.reduce(foldFrame, freshKept({ neumaId: 'kaito', sessionId: 'chat-1', take: TAKE, startedAt: '2026-11-16T20:00:00.000Z' }));

describe('a turn folds into what it has said and done so far', () => {
  it('reads only its own frames', () => {
    expect(worthKeeping(JSON.stringify(frames[2]))).toBe(true);
    expect(worthKeeping(JSON.stringify({ type: 'clone:text', chunk: 'x' }))).toBe(true);
    expect(worthKeeping(JSON.stringify({ type: 'substrate:activity', local: 1 }))).toBe(false);
    expect(worthKeeping(Buffer.from('x'))).toBe(false);
  });

  it('words, thoughts and acts in order, each stream merged; what still runs; the split', () => {
    const k = kept();
    expect(k.words).toBe('Gathering the four lists. Splitting now.');
    expect(k.frames.map((f) => f.type)).toEqual([
      'consciousness:thinking', 'consciousness:stream', 'tool:usage', 'tool:usage', 'consciousness:stream', 'tool:usage',
    ]);
    expect(k.frames[0].content).toBe('Four lists. Split them.');
    expect(k.acting).toEqual([CLONE_TOOL]);
    expect(k.split.clones.map((c) => c.state)).toEqual(['working', 'done']);
    expect(foldFrame(k, { type: 'consciousness:complete' }).settled).toBe(true);
    // An error bubble is not the being's words; an unrelated frame changes nothing.
    expect(foldFrame(k, { type: 'consciousness:stream', content: '[Connection to the void disrupted]', error: true })).toBe(k);
    expect(foldFrame(k, { type: 'substrate:line', state: 'waiting' })).toBe(k);
  });

  it('a progress report keeps one running act; the result closes it', () => {
    let k = freshKept({ neumaId: 'a', sessionId: 'b', take: TAKE, startedAt: null });
    k = foldFrame(k, { type: 'tool:usage', tool: 'forge/image', status: 'executing' });
    k = foldFrame(k, { type: 'tool:usage', tool: 'forge/image', status: 'running', summary: '40%' });
    expect(k.acting).toEqual(['forge/image']);
    k = foldFrame(k, { type: 'tool:usage', tool: 'forge/image', status: 'ok' });
    expect(k.acting).toEqual([]);
    expect(hasWork(k)).toBe(false); // no words and nothing running: nothing to keep yet
  });
});

describe('a desk that comes back mid-turn is drawn the turn so far', () => {
  it('the catch-up is the merged frames, then the running split redrawn to the same sub-channels', () => {
    const k = kept();
    const caught = catchUpFrames(k);
    expect(caught.every((f) => f.catchUp)).toBe(true);
    expect(caught.filter((f) => f.type === 'consciousness:stream').map((f) => f.content)).toEqual(['Gathering the four lists.', ' Splitting now.']);
    let split = null;
    for (const f of caught.filter((x) => x.type.startsWith('clone:'))) split = applyCloneFrame(split, f);
    expect(split.clones).toEqual(k.split.clones);
  });

  it('a split that already reported is not redrawn over its settled chip', () => {
    const k = foldFrame(kept(), { type: 'tool:usage', tool: CLONE_TOOL, status: 'ok', summary: '2 of 2 reported' });
    expect(catchUpFrames(k).some((f) => f.type.startsWith('clone:'))).toBe(false);
  });
});

describe('a turn the app closed on becomes the take it was', () => {
  const snap = () => keptSnapshot(kept(), {
    tools: [{ tool: 'research/web_search', status: 'ok', summary: 'searched "defi teams"', mark: 26 }],
    thoughts: [{ text: 'Four lists. Split them.', mark: 0 }],
    savedAt: '2026-11-16T20:01:30.000Z',
  });

  it('words exactly as far as they got, the mark, the finished act, the running split cut where it was', () => {
    const record = cutRecord(snap());
    expect(record.content).toBe(`Gathering the four lists. Splitting now.\n\n${CUT_MARK}`);
    expect(record.cutOff).toEqual({ at: '2026-11-16T20:01:30.000Z', startedAt: '2026-11-16T20:00:00.000Z' });
    expect(record.thoughts).toEqual([{ text: 'Four lists. Split them.', mark: 0 }]);
    const [done, running] = record.tools;
    expect(done).toMatchObject({ tool: 'research/web_search', status: 'ok' });
    expect(running).toMatchObject({ tool: CLONE_TOOL, status: 'error', mark: 'Gathering the four lists. Splitting now.'.length });
    expect(running.summary).toMatch(/cut off/);
    expect(running.split.cutOff).toBe(true);
    expect(running.split.clones.map((c) => [c.state, c.report])).toEqual([['cut', 'Filed 3 so far.'], ['done', 'Filed 6 funds.']]);
  });

  it('the chat comes back with the cut take where it was, marked, and CONTINUE on it', () => {
    const rows = [
      { role: 'user', content: 'Gather the four lists.', turnId: 'point-1', timestamp: '2026-11-16T20:00:00.000Z' },
      { ...cutRecord(snap()), turnId: 'point-1', takeIndex: 1, timestamp: '2026-11-16T20:05:00.000Z' },
    ];
    const history = toHistoryMessages(toDisplayMessages(rows), 0, 'h');
    expect(history.map((m) => m.role)).toEqual(['user', 'neuma']);
    expect(history[1].takes[0].cutOff.at).toBe('2026-11-16T20:01:30.000Z');
    const pressed = [];
    const html = renderToStaticMarkup(createElement(StreamPanel, {
      messages: history, thread: 0, thinking: false, connected: true, onContinue: (id) => pressed.push(id),
    }));
    expect(html).toContain('CUT OFF WHEN THE APP CLOSED');
    expect(html).toContain('>CONTINUE</button>');
    expect(html).toContain('SHADOW CLONES · 2 · 1 DONE · CUT OFF WHEN THE APP CLOSED');
    expect(html).toContain('WHAT IT HAD SAID WHEN THE APP CLOSED');
    // Not on a cut take that is no longer the chat's last word.
    const later = [...history, { id: 'm9', role: 'user', streaming: false, isHistory: false, at: null, segments: [{ kind: 'speech', text: 'next' }], meta: null }];
    const after = renderToStaticMarkup(createElement(StreamPanel, { messages: later, thread: 0, thinking: false, connected: true, onContinue: () => {} }));
    expect(after).toContain('CUT OFF WHEN THE APP CLOSED');
    expect(after).not.toContain('>CONTINUE</button>');
  });

  it('the turn that picks it up is the platform\'s line, never the operator\'s bubble', () => {
    const thought = resumeThought('Nov 16, 3:01 PM');
    expect(thought).toMatch(/^\[THE APP CLOSED MID-REPLY — the platform, not your operator\] Your reply above was cut off at Nov 16, 3:01 PM/);
    const [line] = toHistoryMessages(toDisplayMessages([{ role: 'user', content: thought, turnId: 'point-2', origin: 'resume' }]), 0, 'h');
    expect(line.role).toBe('resume');
    const html = renderToStaticMarkup(createElement(StreamPanel, { messages: [line], thread: 0, thinking: false, connected: true }));
    expect(html).toContain('PICKED UP');
    expect(html).toContain('Your reply above was cut off');
    expect(html).not.toContain('[THE APP CLOSED MID-REPLY');
  });
});
