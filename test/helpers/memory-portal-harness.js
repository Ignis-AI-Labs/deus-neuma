/**
 * The real-portal harness the memory suites run on: a real WebSocket pair, a
 * real workspace on real disk, a real recall engine, real archive segments,
 * real policy cascade. NO mock anywhere on the claimed path (RULE 0).
 *
 * Extracted so the memory suites stay under the size law and so the next
 * intent-path migration does not rebuild this by hand. The harness owns the
 * plumbing only — every assertion lives in the suite.
 */
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from './temp-fs.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaRecall } from '../../core/index.js';
import { makeAnchor } from '../../core/workspace/archive-codec.js';
import { formatMemoryRef } from '../../core/memory/memory-query.js';

export const FULL_THOUGHT = 'I keep returning to the observatory night — why does that telescope moment hold so much meaning for me?';
export const FULL_REPLY = 'Because the observatory was the first time you saw your own smallness and loved it entirely.';

/**
 * Stand the harness up. Returns the live handles plus the seeded `anchoredRef`.
 * @param {{neumaId: string, otherId: string, key: string, label: string}} spec
 */
export const openMemoryPortal = async ({ neumaId, otherId, key, label }) => {
  const priorKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = key;

  const house = await createTempDir(label);
  const origRoot = getWorkspacesRoot();
  setWorkspacesRoot(house);
  await workspace.create(neumaId);
  await workspace.create(otherId);

  // The remembered moment: full-fidelity session rows + an anchored
  // observation minted from those exact rows.
  const userRow = await workspace.appendMessage(neumaId, 'sess-live', { role: 'user', content: FULL_THOUGHT });
  const assistantRow = await workspace.appendMessage(neumaId, 'sess-live', { role: 'assistant', content: FULL_REPLY });
  const anchor = makeAnchor({ sessionId: 'sess-live', userMessage: userRow, assistantMessage: assistantRow });
  await workspace.addObservation(neumaId, {
    type: 'exchange',
    userMessage: FULL_THOUGHT.slice(0, 300),
    response: FULL_REPLY.slice(0, 500),
    significance: 0.8,
    anchor,
  });
  // And one pre-archive (anchorless) memory beside it.
  await workspace.addObservation(neumaId, {
    type: 'exchange',
    userMessage: 'an elder observatory note from before the archive existed',
    response: 'kept only as its truncated self',
    significance: 0.8,
  });
  neumaRecall.invalidate(neumaId);

  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;

  const state = { serverWs: null, clientLog: [], decide: null };
  const linked = new Promise((resolve) => {
    wss.on('connection', (ws) => { state.serverWs = ws; resolve(); });
  });
  const client = new WebSocket(`ws://localhost:${port}`);
  client.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    state.clientLog.push(msg);
    if (msg.type === 'tool:approval_request' && state.decide) {
      client.send(JSON.stringify({ type: 'tool:approval_response', id: msg.id, decision: state.decide(msg) }));
    }
  });
  await linked;

  return {
    state,
    anchoredRef: formatMemoryRef(anchor),

    /** Every leg owns EXACTLY its own approval resolver — no listener residue. */
    reset: () => {
      state.serverWs?.removeAllListeners('message');
      state.decide = null;
      state.clientLog.length = 0;
    },

    armResolver: (connection) => {
      state.serverWs.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'tool:approval_response') resolveToolApproval(connection, m.id, m.decision);
      });
    },

    resetPolicy: (id) =>
      fs.rm(path.join(workspace._path(id), 'config', 'tool-policy.json'), { force: true }),

    untilClient: (pred, ms = 5000) => new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        const found = state.clientLog.find(pred);
        if (found) return resolve(found);
        if (Date.now() - started > ms) return reject(new Error('client message never arrived'));
        setTimeout(tick, 20);
      };
      tick();
    }),

    close: async () => {
      client.close();
      wss.close();
      httpServer.close();
      setWorkspacesRoot(origRoot);
      if (priorKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
      else process.env.DNA_ENCRYPTION_KEY = priorKey;
      await fs.rm(house, { recursive: true, force: true });
    },
  };
};
