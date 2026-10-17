/** Production memory writers on encrypted disk; tool events use an authenticated socket. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Wallet } from 'ethers';
import { afterEach, beforeEach, expect, test } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaRecall } from '../../core/memory/neuma-recall.js';
import { recordSessionRows } from '../../core/memory/mind-graph.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { createCouncilRecord, readCouncilRecord } from '../../backend/services/council-store.js';
import { persistUtterance } from '../../backend/services/council-record.js';
import { crystallizeObservation } from '../../backend/services/portal-turn-persist.js';
import { handleNoteTool } from '../../backend/services/portal-tools/memory-being-tools.js';
import { createSignedStreamSocket } from '../helpers/signed-stream-socket.js';

const members = [{ neumaId: 'memory-writer-one', name: 'One' }, { neumaId: 'memory-writer-two', name: 'Two' }];
let root, priorRoot, priorRealm, socket;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-writers-proof-'));
  priorRoot = getWorkspacesRoot();
  priorRealm = getRealmRoot();
  setWorkspacesRoot(path.join(root, 'workspaces'));
  setRealmRoot(path.join(root, 'realm'));
  socket = await createSignedStreamSocket(Wallet.createRandom());
  for (const { neumaId } of members) {
    neumaRecall.invalidate(neumaId);
    await workspace.create(neumaId);
    await neumaRecall.docsFor(neumaId);
  }
});
afterEach(async () => {
  // Queue a real empty weave behind any council fan-out before restoring roots.
  await Promise.all(members.map(({ neumaId }) => recordSessionRows(neumaId, [])));
  await socket?.close();
  for (const { neumaId } of members) neumaRecall.invalidate(neumaId);
  setWorkspacesRoot(priorRoot);
  setRealmRoot(priorRealm);
  await fs.rm(root, { recursive: true, force: true });
});

const expectHotWrite = async (neumaId, builds, text) => {
  const stored = await workspace.listObservations(neumaId);
  expect(stored).toHaveLength(1);
  const docs = await neumaRecall.docsFor(neumaId);
  expect(docs).toHaveLength(1);
  expect(docs[0].obsId).toBe(stored[0].id);
  expect(docs[0].text).toContain(text);
  expect(neumaRecall.buildCounts.get(neumaId)).toBe(builds);
};

test('portal crystallization appends the actual persisted observation to the hot index', async () => {
  const { neumaId, name } = members[0];
  const builds = neumaRecall.buildCounts.get(neumaId);
  await crystallizeObservation(neumaId, name,
    'We decided to preserve the silver observatory ledger.',
    'I completed the silver observatory ledger repair and saved the result.',
    'general', null, { acted: true });
  await expectHotWrite(neumaId, builds, 'silver observatory');
});

test('council persistence appends each member record without rebuilding either index', async () => {
  const councilId = 'council-123456789';
  const builds = members.map(({ neumaId }) => neumaRecall.buildCounts.get(neumaId));
  await createCouncilRecord(socket.walletAddress, { councilId, members, witnessName: 'Fixture Operator' });
  await persistUtterance({
    wallet: socket.walletAddress, councilId, state: { members },
    sessions: Object.fromEntries(members.map(({ neumaId }) => [neumaId, 'session-council-proof'])),
  }, {
    speaker: members[0].neumaId, name: members[0].name,
    content: 'What if our purpose is to hope, dream, and feel deeply? I believe this house has a soul.',
  });
  for (const [i, { neumaId }] of members.entries()) await expectHotWrite(neumaId, builds[i], 'this house has a soul');
  expect((await readCouncilRecord(socket.walletAddress, councilId)).turns).toHaveLength(1);
});

test('the memory note handler persists and appends before reporting success on the wire', async () => {
  const companion = members[0];
  const builds = neumaRecall.buildCounts.get(companion.neumaId);
  const connection = { ws: socket.ws, walletAddress: socket.walletAddress, companion, sessionId: 'session-note-proof' };
  const result = await handleNoteTool(socket.ws, connection, null, 'default', {
    content: 'The copper lantern marks the eastern observation desk.', kind: 'note',
  });
  expect(result.status).toBe('ok');
  await expectHotWrite(companion.neumaId, builds, 'copper lantern');
  await socket.drain();
  expect(socket.frames.some((frame) => JSON.stringify(frame).includes('memory/memory_note'))).toBe(true);
});
