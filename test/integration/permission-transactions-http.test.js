// Real signed-wallet portal approvals + authenticated HTTP revoke + encrypted IO.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { beforeEach, afterEach, expect, test } from 'vitest';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import permissionsRoutes from '../../backend/routes/permissions-routes.js';
import { gateAct } from '../../backend/services/act-gate.js';
import { addAllowedTool } from '../../backend/services/tool-policy.js';
import { readActs } from '../../backend/services/act-ledger.js';
import { captureShellNetwork, requestShellNetwork, clearShellNetwork } from '../../backend/services/shell-network-grants.js';
import { witnessPathScopeGate } from '../../backend/services/witness-path-grants.js';
import { handleAccessRequestTool } from '../../backend/services/access-request-being-tools.js';

let kit, server, url, token, oldKey, cards;
const descriptor = Object.freeze({ kind: 'act', server: 'coding', tool: 'execute' });
const input = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const policyFile = () => path.join(workspace.pathFor(kit.laneId), 'config', 'tool-policy.json');
const revoke = (row = descriptor, bearer = token) => fetch(`${url}/${kit.laneId}/revoke`, {
  method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(row),
});
const ask = () => gateAct(kit.connection, {
  // Resident execution is now autonomous by default. These transaction cases
  // exercise an explicitly approval-required tool, not that default policy.
  server: 'coding', tool: 'execute', mode: 'ask',
  lanePolicy: { coding: { requireApproval: ['execute'] } }, emit: kit.emit,
});

beforeEach(async () => {
  oldKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  resetWorkspaceCryptoKey();
  kit = await createHarnessTurnKit('permission-http-fixture');
  cards = 0;
  kit.client.on('message', (raw) => {
    if (JSON.parse(raw.toString()).type === 'tool:approval_request') cards++;
  });
  const app = express();
  app.use(express.json()); app.use('/permissions', permissionsRoutes);
  server = await new Promise((resolve) => { const live = app.listen(0, '127.0.0.1', () => resolve(live)); });
  url = `http://127.0.0.1:${server.address().port}/permissions`;
  token = new URL(kit.client.url).searchParams.get('token');
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  clearShellNetwork(kit.connection);
  // Approval receipts append asynchronously; keep roots isolated until they land.
  await untilHarness(async () => (await readActs()).length >= cards);
  await kit.close();
  if (oldKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = oldKey;
  resetWorkspaceCryptoKey();
});

test('signed revoke excludes a racing grant writer and new-turn read until runtime cleanup is complete', async () => {
  await workspace.writeToolPolicy(kit.laneId, { coding: { allowed: ['execute', 'ground_git'] } });
  kit.connection._sessionToolPolicy = { coding: { allowed: ['execute', 'inspect'] } };
  await workspace.readToolPolicy(kit.laneId); // cached prior authority
  let newTurnRead, concurrentGrant;
  kit.connection.activeTurn.signal.addEventListener('abort', () => {
    // A turn reacting to interruption uses the real reader, not a cached input.
    newTurnRead = workspace.readToolPolicy(kit.laneId).then((policy) => ({
      policy, session: kit.connection._sessionToolPolicy,
    }));
    concurrentGrant = workspace.updateToolPolicy(kit.laneId,
      (current) => addAllowedTool(current, 'web', 'web_search'));
  }, { once: true });
  const parallel = Array.from({ length: 12 }, (_, i) => workspace.updateToolPolicy(kit.laneId,
    (current) => addAllowedTool(current, 'fixture', `parallel-${i}`)));
  const response = await revoke();
  expect(response.status).toBe(200);
  expect((await response.json()).held).toBe(true);
  expect(newTurnRead).toBeDefined();
  const read = await newTurnRead;
  expect(read.policy.coding.allowed).not.toContain('execute');
  expect(read.session.coding.allowed).toEqual(['inspect']);
  await Promise.all([...parallel, concurrentGrant]);
  const policy = await workspace.readToolPolicy(kit.laneId);
  expect(policy.coding.allowed).toEqual(['ground_git']);
  expect(policy.web.allowed).toContain('web_search');
  expect(policy.fixture.allowed).toHaveLength(12);
});

test('an authenticated revoke cancels an outstanding ALWAYS even when there is no persisted row', async () => {
  const pending = ask();
  const card = await untilHarness(() => kit.frames.find((f) => f.type === 'tool:approval_request'));
  const response = await revoke();
  expect(response.status).toBe(200);
  expect((await response.json()).held).toBe(false);
  expect((await pending).ok).toBe(false);
  kit.decide(card, 'always'); // a late, real portal response cannot revive a settled card
  await untilHarness(() => kit.handled.find((frame) => frame.id === card.id));
  expect(await workspace.readToolPolicy(kit.laneId)).toBeNull();
  expect(kit.connection._sessionToolPolicy?.coding?.allowed || []).not.toContain('execute');
});

test.each(['abort', 'rebind', 'lane-mutation', 'session'])('real ALWAYS queued behind a policy transaction cannot persist after %s', async (action) => {
  const pending = ask();
  const card = await untilHarness(() => kit.frames.find((f) => f.type === 'tool:approval_request'));
  const supplied = input(), started = input();
  const blocker = workspace.updateToolPolicy(kit.laneId, async (current) => {
    started.resolve(); return { ...current, fixture: await supplied.promise };
  });
  await started.promise;
  kit.decide(card, 'always');
  await untilHarness(() => kit.handled.find((frame) => frame.id === card.id));
  const companion = kit.connection.companion;
  if (action === 'abort') {
    const originalTurn = kit.connection.activeTurn;
    kit.connection.activeTurn = new AbortController();
    originalTurn.abort();
  }
  if (action === 'rebind') kit.connection.companion = { neumaId: 'other-fixture' };
  if (action === 'lane-mutation') companion.neumaId = 'other-fixture';
  if (action === 'session') kit.connection.sessionId = 'different-session';
  supplied.resolve('kept');
  await blocker;
  expect((await pending).ok).toBe(false);
  expect(await workspace.readToolPolicy(kit.laneId)).toEqual({ fixture: 'kept' });
  expect(await workspace.readToolPolicy('other-fixture')).toBeNull();
  expect(kit.connection._sessionToolPolicy?.coding?.allowed || []).not.toContain('execute');
  // Restore the fixture binding for broker/fixture teardown, never a real lane.
  companion.neumaId = kit.laneId;
  kit.connection.companion = companion;
});

test('parallel real tool, path, sensitive and network approvals keep each others policy rows', async () => {
  const readDir = path.join(kit.root, 'read-scope');
  const writeDir = path.join(kit.root, 'write-scope');
  await fs.mkdir(readDir); await fs.mkdir(writeDir);
  const readFile = path.join(readDir, 'input.txt');
  await fs.writeFile(readFile, 'fixture input');
  const secret = path.join(readDir, '.env');
  await fs.writeFile(secret, 'FIXTURE_ONLY=true');
  kit.client.on('message', (raw) => {
    const frame = JSON.parse(raw.toString());
    if (frame.type === 'tool:approval_request') kit.decide(frame, 'always');
  });
  // Scope gates receive public identities BEFORE withFsRouting reaches the organ.
  // Settle every parallel path before asserting, so a failure cannot escape teardown.
  const settled = await Promise.allSettled([
    ask(),
    witnessPathScopeGate(kit.ws, kit.connection, { server: 'fs', toolName: 'read' }, { path: readFile }),
    witnessPathScopeGate(kit.ws, kit.connection, { server: 'fs', toolName: 'write' },
      { path: path.join(writeDir, 'output.txt'), content: 'fixture' }),
    handleAccessRequestTool(kit.ws, kit.connection, null, 'ask', {},
      { path: secret, tier: 'read', reason: 'inspect fixture configuration' }, { sendToolEvent: (_ws, _companion, event) => kit.emit(event) }),
    requestShellNetwork(kit.connection, captureShellNetwork(kit.connection, kit.connection.activeTurn.signal), kit.emit),
  ]);
  expect(settled.filter((result) => result.status === 'rejected')).toEqual([]);
  const results = settled.map((result) => result.value);
  expect(results[0].ok).toBe(true);
  expect(results[1]).toBe(true); expect(results[2]).toBe(true);
  expect(results[3].status).toBe('ok');
  const requests = kit.frames.filter((frame) => frame.type === 'tool:approval_request');
  expect(requests).toContainEqual(expect.objectContaining({ tool: 'fs/read', scope: `read access to ${readDir}` }));
  expect(requests).toContainEqual(expect.objectContaining({ tool: 'fs/write', scope: `write access to ${writeDir}` }));
  const policy = await workspace.readToolPolicy(kit.laneId);
  expect(policy.coding.allowed).toContain('execute');
  expect(policy.pathGrants.read).toContain(readDir);
  expect(policy.pathGrants.write).toContain(writeDir);
  expect(policy.sensitiveGrants.read).toContain(secret);
  expect(policy.shellNetwork).toBe(true);
  expect(JSON.parse(await fs.readFile(policyFile(), 'utf8'))._enc).toBe(1);
  expect(cards).toBe(5);
});

test('only the signed owner can revoke; unreadable policy fails without replacing it', async () => {
  await workspace.writeToolPolicy(kit.laneId, { coding: { allowed: ['execute'] } });
  const foreign = await fullAuth();
  await writeOwner(workspace.root, 'foreign-fixture', foreign.address);
  await workspace.writeToolPolicy('foreign-fixture', { coding: { allowed: ['execute'] } });
  expect((await revoke(descriptor, '')).status).toBe(401);
  expect((await revoke(descriptor, foreign.token)).status).toBe(404);
  expect(kit.connection.activeTurn.signal.aborted).toBe(false);
  await fs.writeFile(policyFile(), '{invalid-envelope');
  expect((await revoke()).status).toBe(500);
  expect(await fs.readFile(policyFile(), 'utf8')).toBe('{invalid-envelope');
  expect((await workspace.readToolPolicy('foreign-fixture')).coding.allowed).toContain('execute');
});
