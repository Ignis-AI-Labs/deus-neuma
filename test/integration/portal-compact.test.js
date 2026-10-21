// /COMPACT on the portal — the operator's compaction runs the boundary's own
// torch-passing path on a REAL workspace on REAL disk, and answers over a REAL
// websocket (a local server on an ephemeral port; the client reads the frames
// the handler actually sent). The substrate is cold here, so the being's torch
// ask falls back extractively — the same dev-box shape the boundary lane's own
// test proves (recall-invalidate-on-compact.test.js). No mocks (RULE 0).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { handleCompactRequest, compactRefusal } from '../../backend/services/portal-compact.js';
import { COMPACT_FLOOR } from '../../backend/services/portal-turn-persist.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
let server;

beforeAll(async () => {
  process.env.DNA_ENCRYPTION_KEY = 'portal-compact-test-key';
  setWorkspacesRoot(path.join(await createTempDir('portal-compact'), 'workspaces'));
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => server.once('listening', resolve));
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  setWorkspacesRoot(null);
  if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
});

// impure — a real socket pair: the handler writes on the server side, the client collects.
const socketPair = async () => {
  const accepted = new Promise((resolve) => server.once('connection', resolve));
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`);
  const frames = [];
  client.on('message', (raw) => frames.push(JSON.parse(String(raw))));
  await new Promise((resolve) => client.once('open', resolve));
  return { serverWs: await accepted, client, frames };
};

const settle = async (frames, n) => {
  for (let i = 0; i < 100 && frames.length < n; i += 1) await new Promise((r) => setTimeout(r, 20));
  return frames;
};

const seed = async (count) => {
  const id = `compact-${Math.random().toString(36).slice(2, 8)}`;
  const sessionId = `sess-${Math.random().toString(36).slice(2, 6)}`;
  await workspace.create(id);
  for (let i = 0; i < count / 2; i += 1) {
    await workspace.appendMessage(id, sessionId, { role: 'user', content: `question ${i} about the lighthouse` });
    await workspace.appendMessage(id, sessionId, { role: 'assistant', content: `answer ${i}: the light keeps its watch` });
  }
  return { id, sessionId };
};

describe('/compact — the operator compacts the bound sitting now', () => {
  it('a 40-message chat compacts: the earlier 20 fold into one summary, the latest 20 stay word for word', async () => {
    const { id, sessionId } = await seed(40);
    const { serverWs, client, frames } = await socketPair();
    await handleCompactRequest({ ws: serverWs, companion: { neumaId: id, name: 'Galen' }, sessionId });
    await settle(frames, 2);
    expect(frames[0]).toEqual({ type: 'session:compact', state: 'running' });
    expect(frames[1]).toMatchObject({ type: 'session:compact', state: 'done', folded: 20, compactionCount: 1 });
    expect(typeof frames[1].selfAuthored).toBe('boolean');
    const after = await workspace.readSession(id, sessionId);
    expect(after).toHaveLength(21);
    expect(after[0]).toMatchObject({ role: 'system', compacted: true, originalCount: 20 });
    expect(after[20].content).toBe('answer 19: the light keeps its watch');
    client.close();
  }, 60000);

  it('a chat too short to compact is refused in numbers, and nothing is rewritten', async () => {
    const { id, sessionId } = await seed(10);
    const { serverWs, client, frames } = await socketPair();
    await handleCompactRequest({ ws: serverWs, companion: { neumaId: id }, sessionId });
    await settle(frames, 2);
    expect(frames[1]).toEqual({ type: 'session:compact', state: 'refused', reason: 'too-short', have: 10, need: COMPACT_FLOOR + 1 });
    expect(await workspace.readSession(id, sessionId)).toHaveLength(10);
    client.close();
  }, 60000);

  it('refusals that stand before anything is read', () => {
    expect(compactRefusal({})).toBe('no-sitting');
    expect(compactRefusal({ companion: { neumaId: 'a' } })).toBe('no-sitting');
    expect(compactRefusal({ companion: { neumaId: 'a' }, sessionId: 's', _benchmarkControls: {} })).toBe('ephemeral');
    expect(compactRefusal({ companion: { neumaId: 'a' }, sessionId: 's', turnPromise: Promise.resolve() })).toBe('turn-in-flight');
    expect(compactRefusal({ companion: { neumaId: 'a' }, sessionId: 's', compacting: true })).toBe('already-compacting');
    expect(compactRefusal({ companion: { neumaId: 'a' }, sessionId: 's' })).toBeNull();
  });
});
