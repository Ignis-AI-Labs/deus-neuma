/**
 * A shadow clone split, filed into sub-channels of the chat (Design note, 2026-11-16: […]). The stream reducer's CLONE family, the settled chip, the reopened chat, and
 * the drawn sub-channels — pure functions and a static render, nothing mocked.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyCloneFrame, cloneHandlers, cloneStateWords, splitHeadline, CLONE_TOOL } from '../../frontend/app/RelinkShell/clone-split.js';
import { reducer, initialState } from '../../frontend/app/RelinkShell/stream-reducer.js';
import { toHistoryMessages } from '../../frontend/app/RelinkShell/stream-reducer-messages.js';

let ToolChip;
beforeAll(async () => {
  globalThis.window = globalThis.window ?? { addEventListener: () => {}, dispatchEvent: () => true, requestIdleCallback: () => {} };
  ({ ToolChip } = await import('../../frontend/app/RelinkShell/ToolChip.jsx'));
});

const SPLIT = 'split-1';
const frames = [
  { type: 'clone:split', splitId: SPLIT, clones: [{ index: 1, title: 'Base DeFi teams', task: 'Gather DeFi teams on Base' }, { index: 2, title: 'AI infra funds', task: 'Gather AI infra funds' }] },
  { type: 'clone:state', splitId: SPLIT, index: 1, state: 'working' },
  { type: 'clone:state', splitId: SPLIT, index: 2, state: 'waiting', position: 1 },
  { type: 'clone:tool', splitId: SPLIT, index: 1, act: { tool: 'research/web_search', status: 'executing', summary: '' } },
  { type: 'clone:tool', splitId: SPLIT, index: 1, act: { tool: 'research/web_search', status: 'ok', summary: 'searched "defi teams base"' } },
  { type: 'clone:text', splitId: SPLIT, index: 1, chunk: 'Found 12 teams. ' },
  { type: 'clone:text', splitId: SPLIT, index: 1, chunk: 'Filed 9 as prospects.' },
];

describe('the CLONE family files each clone under its own sub-channel', () => {
  it('a split, its places in line, its acts and words, its reports', () => {
    let split = null;
    for (const f of frames) split = applyCloneFrame(split, f);
    const [one, two] = split.clones;
    expect(one).toMatchObject({ state: 'working', text: 'Found 12 teams. Filed 9 as prospects.', acting: null });
    expect(one.acts).toEqual([{ tool: 'research/web_search', status: 'ok', summary: 'searched "defi teams base"' }]);
    expect(two).toMatchObject({ state: 'waiting', position: 1, text: '' });
    expect(cloneStateWords(two)).toBe('WAITING · #1 IN LINE');
    expect(splitHeadline(split)).toBe('SHADOW CLONES · 2 · 1 WORKING · 0 DONE');
    // A frame of another split is never filed here.
    expect(applyCloneFrame(split, { type: 'clone:text', splitId: 'other', index: 1, chunk: 'x' })).toBe(null);

    split = applyCloneFrame(split, { type: 'clone:end', splitId: SPLIT, clone: { index: 1, state: 'done', report: 'Filed 9 prospects: …', acts: one.acts, sessionId: 's-1' } });
    expect(split.clones[0]).toMatchObject({ state: 'done', report: 'Filed 9 prospects: …', text: 'Found 12 teams. Filed 9 as prospects.', sessionId: 's-1' });
  });

  it('lands on the turn\'s shadow_clone chip, and the settled chip keeps the sub-channels with their words', () => {
    let state = reducer(initialState, { type: 'TOOL_RESULT', data: { tool: CLONE_TOOL, status: 'executing', summary: 'splitting into 2 shadow clones' } });
    for (const frame of frames) state = cloneHandlers.CLONE(state, { frame });
    const chip = () => state.messages.at(-1).segments.find((s) => s.label === CLONE_TOOL);
    expect(chip().split.clones[0].text).toBe('Found 12 teams. Filed 9 as prospects.');

    const kept = { splitId: SPLIT, together: 2, seconds: 41, record: 'clones/x.md', clones: [
      { index: 1, title: 'Base DeFi teams', task: 'Gather DeFi teams on Base', state: 'done', report: 'Filed 9 prospects.', acts: [], sessionId: 's-1' },
      { index: 2, title: 'AI infra funds', task: 'Gather AI infra funds', state: 'done', report: 'Filed 6 funds.', acts: [], sessionId: 's-2' },
    ] };
    state = reducer(state, { type: 'TOOL_RESULT', data: { tool: CLONE_TOOL, status: 'ok', summary: '2 of 2 shadow clones reported · 2 at once · 41s', split: kept } });
    expect(chip().split.clones.map((c) => [c.state, c.report, c.text])).toEqual([
      ['done', 'Filed 9 prospects.', 'Found 12 teams. Filed 9 as prospects.'], ['done', 'Filed 6 funds.', ''],
    ]);
    expect(splitHeadline(chip().split)).toBe('SHADOW CLONES · 2 · 2 REPORTED · 2 AT ONCE · 41S');
  });

  it('a frame with no reply on screen goes nowhere', () => {
    expect(cloneHandlers.CLONE(initialState, { frame: frames[0] })).toBe(initialState);
  });
});

describe('a reopened chat draws the sub-channels again from its record', () => {
  it('the persisted chip carries every clone\'s report and acts, and the tabs draw them', () => {
    const record = { role: 'assistant', content: 'Here is what my clones found.', tools: [{
      tool: CLONE_TOOL, status: 'ok', summary: '2 of 2 shadow clones reported · 2 at once · 41s', mark: 0,
      split: { splitId: SPLIT, together: 2, seconds: 41, record: 'clones/x.md', clones: [
        { index: 1, title: 'Base DeFi teams', task: 'Gather DeFi teams on Base', state: 'done', report: 'Filed **9** prospects.', acts: [{ tool: 'sales/prospect', status: 'ok', summary: 'filed a prospect' }], sessionId: 's-1' },
        { index: 2, title: 'AI infra funds', task: 'Gather AI infra funds', state: 'failed', report: 'DID NOT FINISH — stopped by the operator', acts: [], sessionId: null },
      ] },
    }] };
    const [message] = toHistoryMessages([record], 0, 'h');
    const chip = message.segments.find((s) => s.kind === 'tool');
    expect(chip.split.clones.map((c) => c.state)).toEqual(['done', 'failed']);

    const html = renderToStaticMarkup(createElement(ToolChip, { segment: chip }));
    expect(html).toContain('SHADOW CLONES · 2 · 1 REPORTED · 2 AT ONCE · 41S');
    expect(html).toContain('role="tab" aria-selected="true"');
    expect(html).toContain('Base DeFi teams');
    expect(html).toContain('DID NOT FINISH');
    expect(html).toContain('ITS REPORT');
    expect(html).toContain('<strong>9</strong>');
    expect(html).toContain('filed a prospect');
  });
});
