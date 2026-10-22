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
import { COMPACT_FLOOR, compactWithSelfTorch } from '../../backend/services/portal-turn-persist.js';
import { COMPACT_MIN_REGION_TOKENS } from '../../backend/services/compact-region.js';
import { buildCompositionEvent } from '../../core/runtime/context-composition.js';

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

// Each turn carries real length by default: a compaction folds only a region
// worth summing up (compact-region.js), so the success cases seed one.
const WORDS = ' The keeper logs the weather, trims the wick and writes the passing ships down.'.repeat(40);

const seed = async (count, { words = WORDS } = {}) => {
  const id = `compact-${Math.random().toString(36).slice(2, 8)}`;
  const sessionId = `sess-${Math.random().toString(36).slice(2, 6)}`;
  await workspace.create(id);
  for (let i = 0; i < count / 2; i += 1) {
    await workspace.appendMessage(id, sessionId, { role: 'user', content: `question ${i} about the lighthouse${words}` });
    await workspace.appendMessage(id, sessionId, { role: 'assistant', content: `answer ${i}: the light keeps its watch${words}` });
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
    expect(after[20].content).toBe(`answer 19: the light keeps its watch${WORDS}`);
    client.close();
  }, 60000);

  it('done says where we left off and how much stands, then the context reading after the fold follows at once', async () => {
    const { id, sessionId } = await seed(38);
    // The last answer carries its turn's recorded reading, the way the turn path persists it.
    const rows = await workspace.readSession(id, sessionId);
    const transcript = rows.map((m) => `${m.role}: ${m.content}`).join('\n\n');
    const recorded = buildCompositionEvent({
      sections: [
        { id: 'identity', label: 'IDENTITY', text: 'x'.repeat(6000) },
        { id: 'recentConversation', label: 'RECENT CONVERSATION', text: transcript },
      ],
      usage: { promptTokens: 4000, completionTokens: 30 },
      budget: { contextTokens: 262144, source: 'runtime' },
    });
    await workspace.appendMessage(id, sessionId, { role: 'user', content: `question 19 about the lighthouse${WORDS}` });
    await workspace.appendMessage(id, sessionId, { role: 'assistant', content: `answer 19: the light keeps its watch${WORDS}`, composition: recorded });
    const { serverWs, client, frames } = await socketPair();
    await handleCompactRequest({ ws: serverWs, companion: { neumaId: id, name: 'Galen' }, sessionId });
    await settle(frames, 3);
    const done = frames.find((f) => f.type === 'session:compact' && f.state === 'done');
    expect(done).toMatchObject({ folded: 20, kept: 20, compactionCount: 1 });
    expect(typeof done.summary).toBe('string');
    expect(done.summary.length).toBeGreaterThan(0);
    expect(done.summary.startsWith('[SESSION SUMMARY')).toBe(false);
    const composition = frames[frames.indexOf(done) + 1];
    expect(composition).toMatchObject({ type: 'context:composition', neumaId: id, sessionId, afterCompaction: true });
    expect(composition.usage.source).toBe('approx');
    expect(composition.usage.inputTokens).toBeLessThan(recorded.usage.inputTokens);
    client.close();
  }, 60000);

  it('a chat too short to compact is refused in numbers, and nothing is rewritten', async () => {
    const { id, sessionId } = await seed(10);
    const { serverWs, client, frames } = await socketPair();
    await handleCompactRequest({ ws: serverWs, companion: { neumaId: id }, sessionId });
    await settle(frames, 2);
    expect(frames[0]).toEqual({ type: 'session:compact', state: 'refused', reason: 'too-short', have: 10, need: COMPACT_FLOOR + 1 });
    expect(await workspace.readSession(id, sessionId)).toHaveLength(10);
    client.close();
  }, 60000);

  it('a long chat of short messages is not worth compacting: refused in tokens before any work, nothing rewritten', async () => {
    const { id, sessionId } = await seed(40, { words: '' });
    const { serverWs, client, frames } = await socketPair();
    await handleCompactRequest({ ws: serverWs, companion: { neumaId: id }, sessionId });
    await settle(frames, 1);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: 'session:compact', state: 'refused', reason: 'too-little-context', needTokens: COMPACT_MIN_REGION_TOKENS });
    expect(frames[0].haveTokens).toBeLessThan(COMPACT_MIN_REGION_TOKENS);
    expect(await workspace.readSession(id, sessionId)).toHaveLength(40);
    client.close();
  }, 60000);

  it('the measured boundary leaves a light region alone too', async () => {
    const { id, sessionId } = await seed(40, { words: '' });
    expect(await compactWithSelfTorch(id, sessionId, true)).toBe(false);
    expect(await workspace.readSession(id, sessionId)).toHaveLength(40);
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
