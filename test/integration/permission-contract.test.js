// Real signed approval, command execution, persistent grant and authenticated revoke.
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { beingCodingToolsFor, stashBeingTurnCatalog } from '../../backend/services/being-tool-surface.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';
import permissionsRoutes from '../../backend/routes/permissions-routes.js';
import { applyProtocolGuard } from '../../backend/services/protocol-guard.js';

let kit, server;
beforeEach(async () => { kit = await createHarnessTurnKit(); kit.connection.toolWorkspace = kit.ground; });
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); server = null; }
  await kit?.close();
});
const prepare = async () => stashBeingTurnCatalog(kit.connection, await beingCodingToolsFor(kit.connection), []);
const execute = (command) => processToolCalls(kit.ws, '', kit.connection,
  [{ server: 'coding', toolName: 'execute', tool: 'coding/execute', args: { command } }]);

test('ALWAYS runs subsequent AUTO commands without another card; revoke stops running work and next turn asks', async () => {
  await workspace.writeToolPolicy(kit.laneId, { coding: { allowed: ['ground_git'] } });
  kit.connection.toolMode = 'auto';
  let allow = true;
  kit.client.on('message', (data) => {
    const frame = JSON.parse(data.toString());
    if (frame.type !== 'tool:approval_request') return;
    if (frame.tool === 'coding/shell_network') kit.decide(frame, 'deny');
    else if (allow && frame.tool === 'coding/execute') kit.decide(frame, 'always');
  });
  await prepare();
  expect((await execute('echo first'))[0].status).toBe('ok');
  expect((await workspace.readToolPolicy(kit.laneId)).coding.allowed).toContain('execute');
  expect((await prepare()).find((tool) => tool.name === 'execute').access).toBe('allowed');
  expect((await execute('echo second'))[0].status).toBe('ok');
  const cards = () => kit.frames.filter((frame) => frame.type === 'tool:approval_request' && frame.tool === 'coding/execute');
  expect(cards()).toHaveLength(1);

  allow = false;
  const running = execute('printf RUNNING; sleep 30; touch must-not-land');
  await untilHarness(() => kit.frames.find((frame) => frame.type === 'tool:usage'
    && frame.tool === 'coding/execute' && frame.status === 'executing' && frame.detail?.includes('RUNNING')));
  const app = express();
  app.use(express.json()); app.use('/permissions', permissionsRoutes);
  server = await new Promise((resolve) => { const live = app.listen(0, '127.0.0.1', () => resolve(live)); });
  const token = new URL(kit.client.url).searchParams.get('token');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/permissions/${kit.laneId}/revoke`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'act', server: 'coding', tool: 'execute' }),
  });
  expect(response.status).toBe(200);
  expect((await response.json()).held).toBe(true);
  expect(kit.connection.activeTurn.signal.aborted).toBe(true);
  expect((await running)[0].status).toBe('interrupted');
  expect(kit.connection._sessionToolPolicy?.coding?.allowed || []).not.toContain('execute');
  const policy = await workspace.readToolPolicy(kit.laneId);
  expect(policy.coding.allowed).not.toContain('execute');
  expect(policy.coding.allowed).toContain('ground_git');
  await expect(fs.stat(path.join(kit.connection._turnSandbox.workspace, 'must-not-land'))).rejects.toMatchObject({ code: 'ENOENT' });

  kit.connection.activeTurn = new AbortController(); // a new turn on the same authenticated portal
  expect((await prepare()).find((tool) => tool.name === 'execute').access).toBe('approval_required');
  const next = execute('touch denied-command');
  const card = await untilHarness(() => cards()[1]);
  kit.decide(card, 'deny');
  expect((await next)[0].status).toBe('denied');
  await expect(fs.stat(path.join(kit.connection._turnSandbox.workspace, 'denied-command'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(kit.ws.readyState).toBe(kit.ws.OPEN);
}, 30000);

test('AUTO itself is not an explicit grant, and an explicit denial cannot be overridden', () => {
  for (const [serverName, tool] of [['coding', 'execute'], ['intents', 'wallet.send'], ['filesystem', 'delete_file']]) {
    expect(applyProtocolGuard('allowed', 'auto', serverName, tool, false)).toBe('approval_required');
    expect(applyProtocolGuard('allowed', 'auto', serverName, tool, true)).toBe('allowed');
    expect(applyProtocolGuard('denied', 'auto', serverName, tool, true)).toBe('denied');
  }
});
