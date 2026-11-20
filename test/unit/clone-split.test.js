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

describe('a split in the background outlives its turn', () => {
  it('its frames reach the chip where it stands after the turn settled, and the end says how it went', () => {
    let state = reducer(initialState, { type: 'TOOL_RESULT', data: { tool: CLONE_TOOL, status: 'executing', summary: 'splitting into 2 shadow clones' } });
    state = cloneHandlers.CLONE(state, { frame: frames[0] });
    state = reducer(state, { type: 'TOOL_RESULT', data: { tool: CLONE_TOOL, status: 'ok', summary: '2 shadow clones working in the background', split: {
      splitId: SPLIT, background: true, together: null, seconds: null, record: null,
      clones: [{ index: 1, title: 'Base DeFi teams', task: 'Gather DeFi teams on Base', state: 'waiting', sessionId: null, report: null, acts: [] }, { index: 2, title: 'AI infra funds', task: 'Gather AI infra funds', state: 'waiting', sessionId: null, report: null, acts: [] }],
    } } });
    state = reducer(state, { type: 'COMPLETE', metadata: null });
    const chip = () => state.messages.at(-1).segments.find((s) => s.label === CLONE_TOOL);
    expect(state.messages.at(-1).streaming).toBe(false);
    expect(splitHeadline(chip().split)).toBe('SHADOW CLONES · 2 · 0 WORKING · 0 DONE · IN THE BACKGROUND — THEY REPORT BACK HERE');
    // The chat went on: the operator spoke, and the clones still work and finish under the settled chip.
    state = reducer(state, { type: 'USER_SENT', text: 'meanwhile, draft the post', at: 1 });
    for (const frame of frames.slice(1)) state = cloneHandlers.CLONE(state, { frame });
    const settledChip = () => state.messages.find((m) => m.segments?.some((s) => s.split?.splitId === SPLIT)).segments.find((s) => s.label === CLONE_TOOL);
    expect(splitHeadline(settledChip().split)).toBe('SHADOW CLONES · 2 · 1 WORKING · 0 DONE · IN THE BACKGROUND — THEY REPORT BACK HERE');
    state = cloneHandlers.CLONE(state, { frame: { type: 'clone:end', splitId: SPLIT, clone: { index: 1, state: 'done', report: 'Filed 9.', acts: [], sessionId: 's-1' } } });
    state = cloneHandlers.CLONE(state, { frame: { type: 'clone:end', splitId: SPLIT, clone: { index: 2, state: 'done', report: 'Filed 6.', acts: [], sessionId: 's-2' } } });
    state = cloneHandlers.CLONE(state, { frame: { type: 'clone:done', splitId: SPLIT, together: 2, seconds: 52, record: 'clones/y.md' } });
    expect(splitHeadline(settledChip().split)).toBe('SHADOW CLONES · 2 · 2 REPORTED · 2 AT ONCE · 52S');
    // A frame of a split nobody has on screen goes nowhere.
    expect(cloneHandlers.CLONE(state, { frame: { type: 'clone:text', splitId: 'other', index: 1, chunk: 'x' } })).toBe(state);
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

describe('clones at work are docked at the bottom of the chat (Design note, 2026-11-19', () => {
  it('a split at work is one line where it was called and stands whole in the dock; once done it stands whole in the chat again', async () => {
    const { isSplitRunning, runningSplits } = await import('../../frontend/app/RelinkShell/clone-split.js');
    const { CloneDock } = await import('../../frontend/app/RelinkShell/CloneChannels.jsx');
    const working = { splitId: 'sp-run', background: true, clones: [
      { index: 1, title: 'Neuma funding batch A', task: 'Run the pipeline', state: 'working', acts: [], text: '' },
      { index: 2, title: 'Neuma funding batch B', task: 'Run the pipeline', state: 'waiting', position: 1, acts: [], text: '' },
    ] };
    const finished = { splitId: 'sp-done', together: 2, seconds: 41, clones: [{ index: 1, title: 'Old batch', state: 'done', report: 'Filed 9.', acts: [] }] };
    const messages = [
      { role: 'neuma', segments: [{ kind: 'tool', phase: 'done', label: 'team/shadow_clone', split: finished }] },
      { role: 'neuma', segments: [{ kind: 'speech', text: 'Launching.' }, { kind: 'tool', phase: 'done', label: 'team/shadow_clone', split: working }, { kind: 'speech', text: 'Now the emails.' }] },
    ];
    expect([isSplitRunning(working), isSplitRunning(finished), isSplitRunning({ ...working, cutOff: true }), isSplitRunning(null)]).toEqual([true, false, false, false]);
    expect(runningSplits(messages).map((s) => s.splitId)).toEqual(['sp-run']);
    // Where it was called: one line, saying where it went.
    const inChat = renderToStaticMarkup(createElement(ToolChip, { segment: messages[1].segments[1] }));
    expect(inChat).toContain('data-split-docked="sp-run"');
    expect(inChat).toContain('DOCKED AT THE BOTTOM OF THE CHAT WHILE THEY WORK');
    expect(inChat).not.toContain('role="tablist"');
    // The dock: the whole split, its tabs and where each stands.
    const dock = renderToStaticMarkup(createElement(CloneDock, { messages }));
    expect(dock).toContain('data-clone-dock=""');
    expect(dock).toContain('Neuma funding batch A');
    expect(dock).toContain('WAITING · #1 IN LINE');
    expect(dock).not.toContain('Old batch');
    // Done: nothing docked, and the chip stands whole in the chat again.
    expect(renderToStaticMarkup(createElement(CloneDock, { messages: [messages[0]] }))).toBe('');
    expect(renderToStaticMarkup(createElement(ToolChip, { segment: messages[0].segments[0] }))).toContain('role="tablist"');
  });
});

describe('a stopped clone resumes where it left off, and every clone shows its goal (Design note, 2026-11-19', () => {
  it('a stopped split offers RESUME on each stopped clone (and on all of them); its goal stands above its task; a resume puts them back to work', async () => {
    const { applyCloneFrame } = await import('../../frontend/app/RelinkShell/clone-frames.js');
    const { stoppedClones, isSplitRunning } = await import('../../frontend/app/RelinkShell/clone-split.js');
    const { CloneChannels } = await import('../../frontend/app/RelinkShell/CloneChannels.jsx');
    const stopped = { splitId: 'sp-stop', background: true, stopped: true, seconds: null, clones: [
      { index: 1, title: 'Neuma funding batch A', goal: '10 funding emails staged to named partners', task: 'Run the pipeline', state: 'failed', report: 'DID NOT FINISH — the model server fell over', acts: [], text: '' },
      { index: 2, title: 'Neuma funding batch B', goal: '10 more, none to a fund already emailed', task: 'Run the pipeline', state: 'cut', report: null, acts: [], text: '' },
      { index: 3, title: 'Umbrae funding batch', goal: '10 Umbrae funding emails staged', task: 'Run the pipeline', state: 'done', report: 'Staged 10.', acts: [], text: '' },
    ] };
    expect(stoppedClones(stopped).map((c) => c.index)).toEqual([1, 2]);
    expect(splitHeadline(stopped)).toBe('SHADOW CLONES · 3 · 1 DONE · 2 STOPPED — RESUME THEM WHERE THEY LEFT OFF');
    const html = renderToStaticMarkup(createElement(CloneChannels, { split: stopped }));
    expect(html).toContain('RESUME ALL STOPPED (2)');
    expect(html).toContain('RESUME WHERE IT STOPPED');
    expect(html).toContain('>GOAL</span> 10 funding emails staged to named partners');
    // A resume taken: the stopped ones are back in line, the split at work again; refused, it says why.
    const again = applyCloneFrame(stopped, { type: 'clone:resume', splitId: 'sp-stop', clones: [1, 2] });
    expect(again.clones.map((c) => c.state)).toEqual(['waiting', 'waiting', 'done']);
    expect([again.stopped, isSplitRunning(again), stoppedClones(again)]).toEqual([false, true, []]);
    expect(applyCloneFrame(stopped, { type: 'clone:resume', splitId: 'sp-stop', state: 'refused', reason: 'Split sp-stop is still at work' }).resumeRefused).toBe('Split sp-stop is still at work');
    // A split the app's close cut says so, and that they resume.
    expect(splitHeadline({ ...stopped, stopped: false, cutOff: true })).toBe('SHADOW CLONES · 3 · 1 DONE · CUT OFF WHEN THE APP CLOSED — RESUME THEM WHERE THEY LEFT OFF');
    // The goal rides the split frame into each clone.
    expect(applyCloneFrame(null, { type: 'clone:split', splitId: 's', clones: [{ index: 1, title: 't', goal: 'g is done', task: 'x' }] }).clones[0].goal).toBe('g is done');
  });
});

describe('STOP a clone, or all of them (Design note, 2026-11-19', () => {
  it('a split at work offers STOP on each clone at work and STOP ALL; stopping says so until each ends; one the backend is not running stands stopped at once and leaves the dock', async () => {
    const { applyCloneFrame } = await import('../../frontend/app/RelinkShell/clone-frames.js');
    const { isSplitRunning, runningSplits } = await import('../../frontend/app/RelinkShell/clone-split.js');
    const { CloneChannels } = await import('../../frontend/app/RelinkShell/CloneChannels.jsx');
    const atWork = { splitId: 'sp-work', background: true, seconds: null, clones: [
      { index: 1, title: 'Neuma funding batch A', goal: 'ten staged', task: 't', state: 'working', acts: [], text: '' },
      { index: 2, title: 'Neuma funding batch B', goal: 'ten more', task: 't', state: 'waiting', position: 1, acts: [], text: '' },
      { index: 3, title: 'Umbrae funding batch', goal: 'ten Umbrae', task: 't', state: 'done', report: 'Staged 10.', acts: [], text: '' },
    ] };
    const html = renderToStaticMarkup(createElement(CloneChannels, { split: atWork }));
    expect(html).toContain('STOP ALL (2)');
    expect(html).toContain('STOP THIS CLONE');
    const stopping = applyCloneFrame(atWork, { type: 'clone:stop', splitId: 'sp-work', state: 'stopping', clones: [1] });
    expect(cloneStateWords(stopping.clones[0])).toBe('STOPPING…');
    // Its end arrives: stopped by the operator, resumable.
    const ended = applyCloneFrame(stopping, { type: 'clone:end', splitId: 'sp-work', clone: { index: 1, state: 'failed', report: 'DID NOT FINISH — stopped by the operator' } });
    expect([ended.clones[0].state, ended.clones[0].stopping]).toEqual(['failed', false]);
    // The two splits a restart left "waiting" (2026-11-19): STOP is answered […], and they stand stopped.
    const stale = applyCloneFrame(atWork, { type: 'clone:stop', splitId: 'sp-work', state: 'not-running', reason: 'Split sp-work is not at work here — nothing to stop.' });
    expect(stale.clones.map((c) => c.state)).toEqual(['cut', 'cut', 'done']);
    expect(isSplitRunning(stale)).toBe(false);
    expect(runningSplits([{ segments: [{ kind: 'tool', split: stale }] }])).toEqual([]);
  });
});

describe('following a clone (Design note, 2026-11-19', () => {
  it('its work stands in the order it happened — each act breaks its words — each tab says what its clone is doing now, and the dock draws it whole with EXPAND', async () => {
    const { applyCloneFrame, CLONE_FEED_MAX } = await import('../../frontend/app/RelinkShell/clone-frames.js');
    const { feedOf, nowLine } = await import('../../frontend/app/RelinkShell/clone-split.js');
    const { CloneDock } = await import('../../frontend/app/RelinkShell/CloneChannels.jsx');
    // What the screenshot showed as one run: […]
    const said = [
      { type: 'clone:split', splitId: 'sp-f', clones: [{ index: 1, title: 'AI funds', goal: 'ten AI funds filed', task: 'Gather AI funds' }, { index: 2, title: 'Base teams', goal: 'ten Base teams', task: 'Gather Base teams' }] },
      { type: 'clone:state', splitId: 'sp-f', index: 1, state: 'working' },
      { type: 'clone:text', splitId: 'sp-f', index: 1, chunk: 'Let me get the final chunk.' },
      { type: 'clone:tool', splitId: 'sp-f', index: 1, act: { tool: 'sales/candidates', status: 'executing', summary: '' } },
      { type: 'clone:tool', splitId: 'sp-f', index: 1, act: { tool: 'sales/candidates', status: 'ok', summary: 'read 50 candidates' } },
      { type: 'clone:text', splitId: 'sp-f', index: 1, chunk: 'Found 7 more clear AI funds. ' },
      { type: 'clone:text', splitId: 'sp-f', index: 1, chunk: 'Let me score them.' },
      { type: 'clone:tool', splitId: 'sp-f', index: 1, act: { tool: 'sales/discover', status: 'executing', summary: 'scoring 7 funds' } },
      { type: 'clone:state', splitId: 'sp-f', index: 2, state: 'waiting', position: 1 },
    ];
    let split = null;
    for (const f of said) split = applyCloneFrame(split, f);
    const [one, two] = split.clones;
    expect(feedOf(one)).toEqual([
      { k: 'w', text: 'Let me get the final chunk.' },
      { k: 'a', tool: 'sales/candidates', summary: 'read 50 candidates', status: 'ok' },
      { k: 'w', text: 'Found 7 more clear AI funds. Let me score them.' },
      { k: 'a', tool: 'sales/discover', summary: 'scoring 7 funds', status: 'executing' },
    ]);
    // The words kept whole are broken where an act came between them, never glued.
    expect(one.text).toBe('Let me get the final chunk.\n\nFound 7 more clear AI funds. Let me score them.');
    expect([nowLine(one), nowLine(two)]).toEqual(['⟐ scoring 7 funds', null]);
    const spoke = applyCloneFrame(split, { type: 'clone:text', splitId: 'sp-f', index: 1, chunk: 'Hike, Nexan and Merian are fits.' });
    expect(nowLine(spoke.clones[0])).toBe('Hike, Nexan and Merian are fits.');
    // A clone kept before the feed existed reads as its acts, then its words.
    expect(feedOf({ acts: [{ tool: 'x/y', status: 'ok', summary: 'did y' }], text: 'Done.' })).toEqual([{ k: 'a', tool: 'x/y', summary: 'did y', status: 'ok' }, { k: 'w', text: 'Done.' }]);
    // The newest kept.
    let long = split;
    for (let i = 0; i < CLONE_FEED_MAX + 20; i += 1) long = applyCloneFrame(long, { type: 'clone:tool', splitId: 'sp-f', index: 1, act: { tool: `t/${i}`, status: 'ok', summary: `act ${i}` } });
    expect(long.clones[0].feed.length).toBe(CLONE_FEED_MAX);
    expect(long.clones[0].feed.at(-1).summary).toBe(`act ${CLONE_FEED_MAX + 19}`);

    // Docked, folded by default (Design note, 2026-11-19: […]): each clone one line, with
    // where it stands and what it does now; STOP ALL and OPEN on the head line; no channel drawn.
    const folded = renderToStaticMarkup(createElement(CloneDock, { messages: [{ role: 'neuma', segments: [{ kind: 'tool', label: 'team/shadow_clone', split }] }] }));
    expect(folded).toContain('data-dock-size="line"');
    expect(folded).toContain('data-clone-line="1"');
    expect(folded).toContain('data-clone-line="2"');
    expect(folded).toContain('⟐ scoring 7 funds');
    expect(folded).toContain('WAITING · #1 IN LINE');
    expect(folded).toContain('STOP ALL (2)');
    expect(folded).toContain('OPEN ▴');
    expect(folded).not.toContain('data-clone-feed');
    expect(folded).not.toContain('role="tablist"');
    // Opened: the chosen clone's work in order, the act between its words; each tab's NOW; EXPAND and COLLAPSE.
    const { CloneChannels } = await import('../../frontend/app/RelinkShell/CloneChannels.jsx');
    const dock = renderToStaticMarkup(createElement(CloneChannels, { split, dock: { size: 'open', setSize: () => {} } }));
    expect(dock).toContain('COLLAPSE ▾');
    expect(dock).toContain('data-clone-feed="1"');
    expect(dock.indexOf('final chunk')).toBeLessThan(dock.indexOf('read 50 candidates'));
    expect(dock.indexOf('read 50 candidates')).toBeLessThan(dock.indexOf('Found 7 more clear AI funds'));
    expect(dock).toContain('scoring 7 funds …');
    expect(dock).toContain('data-clone-now="1"');
    expect(dock).toContain('EXPAND');
    expect(dock).toContain('FOLLOWING ▼');
    expect(dock).toContain('ITS TASK');
  });
});
