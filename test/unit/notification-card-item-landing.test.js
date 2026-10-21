/**
 * A card lands on its EXACT item — the task in TASKS, the run in TEAMS and
 * WORKFLOW, the image in the GALLERY.
 *
 * The window manager carries no object payload, so the item rides each app's
 * latch (card-landing.js) beside the OPEN the reducer runs. Proven through the
 * real pieces: real records, the real target map, the real window-manager
 * reducer, the real latch, the apps' real selection functions, and the real
 * WORKFLOW window and TASKS ledger row rendered from real state.
 */

import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KIND, STANDING, makeRecord } from '../../core/runtime/notification-record.js';
import {
  cardLanding, cardOpenActions,
} from '../../frontend/app/RelinkShell/NotificationTray/notification-target.js';
import { appIdOf, hydrate, reducer } from '../../frontend/app/windowing/window-manager-reducer.js';
import { requestCardLanding, takeCardLanding } from '../../frontend/app/RelinkShell/card-landing.js';
import { teamRunsReducer, initialTeamRuns, TEAM_RUN_FRAMES } from '../../frontend/app/RelinkShell/team-runs-reducer.js';
import { TeamRunsContext, createTeamRunsStore } from '../../frontend/app/RelinkShell/team-runs-context.js';
import { workflowApp } from '../../frontend/app/RelinkShell/WorkflowApp.jsx';
import { pastRunsShown } from '../../frontend/app/RelinkShell/TeamsApp.jsx';
import { itemOfImage } from '../../frontend/app/RelinkShell/gallery/gallery-view.js';
import { LedgerRow } from '../../frontend/app/RelinkShell/TodoAppRows.jsx';

const IMAGE = '6f0c1d2e-8a4b-4c3d-9e1f-2a3b4c5d6e7f';

const card = (kind, ref, over = {}) => makeRecord({
  id: `card-${kind}`, ts: 1_754_400_000_000, kind, standing: STANDING.neuma,
  title: 'a card', actor: { id: 'lane-1', name: 'Fenna' }, ref, ...over,
});

// The tray's click, whole: the window actions through the real reducer, then
// the app's latch — exactly what NotificationTray.activate does.
const click = (record, state) => {
  const after = cardOpenActions(record, state.windows).reduce(reducer, state);
  const landing = cardLanding(record);
  if (landing) requestCardLanding(landing.appId, landing.item);
  return after;
};

describe('each card opens its app and latches its exact item for that app', () => {
  const cases = [
    [card(KIND.taskClosed, { taskId: 'T-9', status: 'done' }), 'todo', { scope: 'lane-1', ids: ['T-9'] }],
    [card(KIND.assignmentClosed, { taskId: 'T-9', assignedId: 'A-3' }), 'todo', { scope: 'lane-1', ids: ['T-9', 'A-3'] }],
    [card(KIND.runDone, { runId: 'live-7', status: 'done', record: 'rec-42' }), 'teams', { recordId: 'rec-42' }],
    [card(KIND.runCheckIn, { runId: 'live-7' }), 'workflow', { runId: 'live-7' }],
    [card(KIND.runAlert, { runId: 'live-7' }), 'workflow', { runId: 'live-7' }],
    [card(KIND.renderDone, { jobId: 'j1', imageId: IMAGE, phase: 'done' }), 'gallery', { imageId: IMAGE }],
  ];
  for (const [record, appId, item] of cases) {
    test(`${record.kind} -> ${appId} on ${JSON.stringify(item)}`, () => {
      for (const start of [hydrate([]), hydrate([{ id: 'chat' }, { id: appId }])]) {
        const after = click(record, start);
        expect(appIdOf(after.focusedId)).toBe(appId);
        expect(takeCardLanding(appId)).toEqual(item);
        // consumed once: a later plain open of the app lands on nothing
        expect(takeCardLanding(appId)).toBeNull();
      }
    });
  }

  test("one app's landing is never taken by another", () => {
    click(card(KIND.renderDone, { imageId: IMAGE }), hydrate([]));
    expect(takeCardLanding('teams')).toBeNull();
    expect(takeCardLanding('gallery')).toEqual({ imageId: IMAGE });
  });

  test('a card that names no item latches nothing', () => {
    expect(cardLanding(card(KIND.runDone, { runId: 'live-7' }))).toBeNull();
    expect(cardLanding(card(KIND.renderDone, { imageId: null }))).toBeNull();
    expect(cardLanding(card(KIND.taskClosed, {}))).toBeNull();
    expect(cardLanding(card(KIND.turnDone, { sessionId: 's-1' }))).toBeNull();
  });
});

describe('each app selects the latched item', () => {
  const START = (id, name) => ({
    type: 'operator:team_start', id, background: true, lead: 'Zezebur', laneId: 'zezebur', name, goal: 'g',
    board: [{ id: 'v1', neumaId: 'zezebur', member: 'Zezebur', state: 'working', status: null }],
  });
  const runs = [START('live-7', 'FIRST SPRINT'), START('live-8', 'SECOND SPRINT')]
    .reduce((state, f) => teamRunsReducer(state, { ...f, type: TEAM_RUN_FRAMES[f.type] }), initialTeamRuns);
  const renderWorkflow = () => renderToStaticMarkup(
    createElement(TeamRunsContext.Provider, { value: createTeamRunsStore(runs) }, createElement(workflowApp.Body)),
  );
  const picked = (html) => /workflow-run-pick label-data is-picked[^"]*">([A-Z]+ SPRINT)/.exec(html)?.[1];

  test('WORKFLOW opens on the card\'s run, not the newest', () => {
    expect(picked(renderWorkflow())).toBe('SECOND SPRINT');
    click(card(KIND.runCheckIn, { runId: 'live-7' }), hydrate([]));
    expect(picked(renderWorkflow())).toBe('FIRST SPRINT');
  });

  test('TEAMS shows the card\'s run among PAST RUNS even when it is older than the newest six', () => {
    const past = Array.from({ length: 9 }, (_, i) => ({ id: `rec-${i}` }));
    expect(pastRunsShown(past, null).map((r) => r.id)).toEqual(['rec-0', 'rec-1', 'rec-2', 'rec-3', 'rec-4', 'rec-5']);
    expect(pastRunsShown(past, 'rec-8').map((r) => r.id).slice(-1)).toEqual(['rec-8']);
    expect(pastRunsShown(past, 'rec-2')).toHaveLength(6);
    expect(pastRunsShown(past, 'rec-gone')).toHaveLength(6);
  });

  test('the GALLERY finds the render the card names in its own art folder', () => {
    const items = [
      { rootId: 'comfy-output', rel: 'ComfyUI_0001.png', name: 'ComfyUI_0001.png' },
      { rootId: 'being-lane-1', rel: `images/${IMAGE}.png`, name: `${IMAGE}.png` },
    ];
    expect(itemOfImage(items, IMAGE)).toBe(items[1]);
    expect(itemOfImage(items, IMAGE.slice(0, 8))).toBeNull();
    expect(itemOfImage(items, '')).toBeNull();
    expect(itemOfImage(null, IMAGE)).toBeNull();
  });

  test('TASKS marks the landed row', () => {
    const task = { id: 'T-9', title: 'Write the brief', status: 'done' };
    expect(renderToStaticMarkup(createElement(LedgerRow, { task, settled: true, landed: true }))).toContain('is-landed');
    expect(renderToStaticMarkup(createElement(LedgerRow, { task, settled: true }))).not.toContain('is-landed');
  });
});
