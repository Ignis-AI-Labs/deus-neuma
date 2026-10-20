/** H3: real signed-wallet portal cards, real policy files, real HTTP Git. No model. */
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { beforeEach, afterEach, describe, test, expect } from 'vitest';
import { createHarnessGitKit, fixtureGit, commitFixture } from '../helpers/harness-git-kit.js';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import { handleBeingCodingTool } from '../../backend/services/being-tool-surface.js';
import { handleCodingTool } from '../../backend/services/witness-coding-tools.js';
import { handleMapTool } from '../../backend/services/map-being-tools.js';
import { sendToolEvent } from '../../backend/services/witness-tool-events.js';
import { gateAct } from '../../backend/services/act-gate.js';
import { GLOBAL_DEFAULTS, resolvePolicy, annotateToolAccess, removeAllowedTool } from '../../backend/services/tool-policy.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import permissionsRoutes from '../../backend/routes/permissions-routes.js';

let git;
let portal;
let http;
beforeEach(async () => {
  git = await createHarnessGitKit();
  // Not `harness-…`: since 261ea463a that prefix is the harness ground's own
  // (a lane with no being, beside the house), and a house permissions revoke
  // never sees one. This proof is about a being's lane.
  portal = await createHarnessTurnKit('git-consent-fixture');
  portal.connection.toolWorkspace = git.ground;
  portal.connection._turnSandbox = { sourceRoot: git.ground };
});
afterEach(async () => {
  if (http) { http.closeAllConnections(); await new Promise((resolve) => http.close(resolve)); http = null; }
  await portal?.close();
  await git?.close();
});
const cards = () => portal.frames.filter((frame) => frame.type === 'tool:approval_request');
const call = (name, args = {}, seat = 'being') => seat === 'witness'
  ? handleCodingTool(portal.ws, portal.connection, { server: 'coding', toolName: name }, args,
    portal.connection._turnSandbox)
  : handleBeingCodingTool(portal.ws, portal.connection, null, portal.connection.toolMode,
    { server: 'coding', toolName: name }, args, { sendToolEvent });
const approve = async (run, decision = 'allow', index = 0) => {
  const request = await untilHarness(() => cards()[index]);
  portal.decide(request, decision);
  return run;
};

describe('all explicit Git tools keep a revocable consent class', () => {
  test.each(['ask', 'auto'])('%s gate and catalog require Git-specific approval', async (mode) => {
    portal.connection.toolMode = mode;
    const definitions = [
      { server: 'coding', name: 'ground_git' }, { server: 'coding', name: 'ground_sync' },
      { server: 'map', name: 'read_history' },
    ];
    expect(annotateToolAccess(definitions, resolvePolicy(GLOBAL_DEFAULTS), mode)
      .map((tool) => tool.access)).toEqual(['approval_required', 'approval_required', 'approval_required']);
    for (const [index, definition] of definitions.entries()) {
      const running = gateAct(portal.connection, { server: definition.server, tool: definition.name,
        mode, args: {}, emit: portal.emit });
      expect(await approve(running, 'allow', index)).toEqual({ ok: true });
    }
  });

  test('observe holds sync/history, while the Git read still requires its card', async () => {
    portal.connection.toolMode = 'observe';
    const result = await call('ground_sync');
    expect(result.status).toBe('denied');
    const history = await handleMapTool(portal.ws, portal.connection, { tool: 'map/read_history' }, {}, { sendToolEvent });
    expect(history.status).toBe('denied');
    expect(cards()).toHaveLength(0);
    expect((await approve(call('ground_git'))).status).toBe('ok');
    expect(git.requests).toHaveLength(0);
  });

  test.each(['being', 'witness'])('%s receives a real sync approval frame before any fetch', async (seat) => {
    const before = await fixtureGit(git.ground, ['rev-parse', 'HEAD']);
    await commitFixture(git.origin, 'update.txt', 'approved bytes\n');
    const running = call('ground_sync', {}, seat);
    const card = await untilHarness(() => cards()[0]);
    expect(JSON.parse(card.args)).toEqual({ root: git.ground, branch: 'refs/heads/main', HEAD: before, upstream: 'refs/remotes/origin/main' });
    expect(git.requests).toHaveLength(0);
    await expect(fs.access(path.join(git.ground, 'update.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    portal.decide(card, 'allow');
    expect((await running).status).toBe('ok');
    expect(await fs.readFile(path.join(git.ground, 'update.txt'), 'utf8')).toBe('approved bytes\n');
  });

  test.each(['branch', 'upstream', 'HEAD'])('%s drift while card is pending refuses fetch', async (change) => {
    const running = call('ground_sync');
    const card = await untilHarness(() => cards()[0]);
    if (change === 'branch') await fixtureGit(git.ground, ['switch', '-c', 'changed']);
    if (change === 'upstream') await fixtureGit(git.ground, ['config', 'branch.main.merge', 'refs/heads/changed']);
    if (change === 'HEAD') await commitFixture(git.ground, 'changed.txt', 'changed\n');
    portal.decide(card, 'allow');
    expect((await running).status).toBe('error');
    expect(git.requests).toHaveLength(0);
  });

  test('ALWAYS persists exact Git grant, and real authenticated revoke re-gates the open portal', async () => {
    portal.connection.toolMode = 'auto';
    expect((await approve(call('ground_git'), 'always')).status).toBe('ok');
    expect((await workspace.readToolPolicy(portal.laneId)).coding.allowed).toContain('ground_git');
    expect((await call('ground_git')).status).toBe('ok');
    expect(cards()).toHaveLength(1);
    const app = express();
    app.use(express.json());
    app.use('/permissions', permissionsRoutes);
    http = await new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    const url = `http://127.0.0.1:${http.address().port}/permissions/${portal.laneId}/revoke`;
    const token = new URL(portal.client.url).searchParams.get('token');
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'act', server: 'coding', tool: 'ground_git' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, held: true });
    expect(portal.connection.activeTurn.signal.aborted).toBe(true);
    portal.connection.activeTurn = new AbortController(); // next turn, same authenticated portal
    expect((await approve(call('ground_git'), 'deny', 1)).status).toBe('denied');
  });

  test('session per-tool exception allows, deny survives AUTO, removing exception restores card', async () => {
    portal.connection.toolMode = 'auto';
    portal.connection._sessionToolPolicy = { coding: { allowed: ['ground_git'], denied: ['ground_sync'] } };
    expect((await call('ground_git')).status).toBe('ok');
    expect((await call('ground_sync')).status).toBe('denied');
    expect(cards()).toHaveLength(0);
    portal.connection._sessionToolPolicy = removeAllowedTool(portal.connection._sessionToolPolicy, 'coding', 'ground_git');
    expect((await approve(call('ground_git'), 'deny')).status).toBe('denied');
    expect(git.requests).toHaveLength(0);
  });

  test('persisted deny reaches both read and sync paths', async () => {
    await workspace.writeToolPolicy(portal.laneId, { coding: { denied: ['ground_git', 'ground_sync'] }, map: { denied: ['read_history'] } });
    portal.connection.toolMode = 'auto';
    expect((await call('ground_git')).status).toBe('denied');
    expect((await call('ground_sync')).status).toBe('denied');
    expect((await handleMapTool(portal.ws, portal.connection, { tool: 'map/read_history' }, {}, { sendToolEvent })).status).toBe('denied');
    expect(cards()).toHaveLength(0);
  });

  test.each(['interrupt', 'session', 'lane', 'turn'])('pending %s cannot execute or persist late ALWAYS into a new origin', async (change) => {
    const running = call('ground_sync');
    const card = await untilHarness(() => cards()[0]);
    if (change === 'interrupt') portal.connection.activeTurn.abort();
    if (change === 'session') portal.connection.sessionId = 'other-session';
    if (change === 'lane') portal.connection.companion = { ...portal.connection.companion, neumaId: 'other-fixture' };
    if (change === 'turn') portal.connection.activeTurn = new AbortController();
    portal.decide(card, 'always');
    expect((await running).status).not.toBe('ok');
    expect(git.requests).toHaveLength(0);
    expect((await workspace.readToolPolicy(portal.laneId))?.coding?.allowed || []).not.toContain('ground_sync');
    expect(portal.connection._sessionToolPolicy?.coding?.allowed || []).not.toContain('ground_sync');
  });

  test('rebind during a real hanging fetch cancels the HTTP helper tree', async () => {
    await commitFixture(git.origin, 'pending.txt', 'fetch this new object\n');
    git.hold(true);
    const running = call('ground_sync');
    const card = await untilHarness(() => cards()[0]);
    portal.decide(card, 'allow');
    await untilHarness(() => git.held.size > 0);
    portal.connection.toolWorkspace = portal.ground;
    expect((await running).status).toBe('error');
    await untilHarness(() => git.held.size === 0);
    await expect(fs.access(path.join(git.ground, '.git/neuma-ground-sync.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('read_history uses its own real approval card and returns actual commits', async () => {
    const running = handleMapTool(portal.ws, portal.connection, { tool: 'map/read_history' }, {}, { sendToolEvent });
    const result = await approve(running);
    expect(result.status).toBe('ok');
    expect(result.content).toContain('fixture base.txt');
    expect(cards()[0].tool).toBe('map/read_history');
  });

  test.each([null, [], { command: 'git push' }, { force: true }, 'ignored'])('zero-arg Git shape refuses %j before any card or fetch', async (args) => {
    expect((await call('ground_sync', args)).status).toBe('error');
    expect((await call('ground_git', args, 'witness')).status).toBe('error');
    expect(cards()).toHaveLength(0);
    expect(git.requests).toHaveLength(0);
  });
});
