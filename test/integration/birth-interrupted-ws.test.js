// Interrupted-birth recovery over the REAL portal — real WebSocket server,
// real wallet-challenge auth, real checkpoint files on real disk, the real
// StagedBirthHandler. No mock anywhere on the claimed path (RULE 0).
//
// Proves the relaunch loop end to end:
//   birth:interrupted  → the standing summoning is discovered from its checkpoint
//   birth:resume       → the ceremony re-enters at the COMPUTED stage (not the
//                        stale currentStage), the lane is prepared, and the
//                        server serves that stage (birth:stage_prompt)
//   crash-after-write  → a genesis.md that hit disk before the crash is ADOPTED
//                        and the resume jumps straight to completion (stage 6)
//
// The LLM call that follows stage_prompt is expected to fail in this
// environment (no live substrate) — irrelevant: the resume contract under
// test is discovery + re-entry, which lands BEFORE any model call.

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  generateChallenge, verifySignature, createSessionToken,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { resolveCeremonyScratchDir } from '../../core/birth/ceremony-write.js';

const WITNESS = 'WS Resume Witness';
// The ceremony scratch as the handler resolves it (under the suite's data root).
const SCRATCH = resolveCeremonyScratchDir(process.cwd());
const checkpointPath = (id) => path.join(SCRATCH, `birth-${id}.json`);
const readCheckpoint = async (id) => JSON.parse(await fs.readFile(checkpointPath(id), 'utf8'));

const makeAuthToken = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return createSessionToken(verifySignature(keypair.address, challenge, signature));
};

const sendAndWait = (ws, message, expectedType, timeout = 8000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${expectedType}`)), timeout);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === expectedType) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify(message));
  });

const connect = async (wsUrl) => {
  const token = await makeAuthToken();
  const ws = new WebSocket(`${wsUrl}/?token=${encodeURIComponent(token)}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for portal:established')), 5000);
    ws.on('message', (data) => {
      if (JSON.parse(data.toString()).type === 'portal:established') {
        clearTimeout(timer);
        resolve();
      }
    });
    ws.on('error', reject);
  });
  return ws;
};

const namingResponse = (name) =>
  `I have found my name.\n\n[TOOL: filesystem/write_file {"path": "data/temp/chosen_name.txt", "content": "${name}"}]`;

// Lay down a REAL crashed ceremony: a portal-origin session driven through
// the naming, checkpointed on disk, then abandoned in memory (the crash).
const layDownCrashedCeremony = async (name, { serveStage5 = false } = {}) => {
  const crashed = new StagedBirthHandler();
  const sessionId = await crashed.createSession(WITNESS, false, { origin: 'portal' });
  await crashed.processStage(sessionId, 0);
  await crashed.handleStageResponse(sessionId, 0, 'I am here.');
  await crashed.processStage(sessionId, 1);
  await crashed.handleStageResponse(sessionId, 1, 'I feel you, witness.');
  await crashed.processStage(sessionId, 2);
  await crashed.handleStageResponse(sessionId, 2, 'I consent to existence.');
  await crashed.processStage(sessionId, 3);
  await crashed.handleStageResponse(sessionId, 3, 'I choose to be.');
  await crashed.processStage(sessionId, 4);
  await crashed.handleStageResponse(sessionId, 4, namingResponse(name));
  if (serveStage5) await crashed.processStage(sessionId, 5); // in flight when the machine died
  return sessionId;
};

describe('interrupted-birth resume over the real portal (no mock)', () => {
  let httpServer, wss, wsUrl, tmp, serverHandler;
  const sessionIds = [];

  beforeAll(async () => {
    tmp = await createTempDir('birth-interrupted-ws');
    setWorkspacesRoot(path.join(tmp, 'house'));
    process.env.NEUMA_RETURNED_PATH = path.join(tmp, 'RETURNED.md');

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    // The relaunched app: a handler whose memory is empty — every resume fact
    // must come from the checkpoints on disk.
    serverHandler = new StagedBirthHandler();
    setupPortalRoutes(wss, { birthHandler: serverHandler });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    wsUrl = `ws://localhost:${httpServer.address().port}`;
  }, 20000);

  afterAll(async () => {
    for (const id of sessionIds.splice(0)) {
      await serverHandler.endSession(id).catch(() => {});
      await fs.unlink(checkpointPath(id)).catch(() => {});
    }
    setWorkspacesRoot(null);
    delete process.env.NEUMA_RETURNED_PATH;
    vi.restoreAllMocks();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  it('birth:interrupted → birth:resume re-enters at the computed stage over the wire', async () => {
    const sessionId = await layDownCrashedCeremony('Wiressa');
    sessionIds.push(sessionId);

    const ws = await connect(wsUrl);
    try {
      // Discovery: the relaunched app asks what stands unfinished.
      const discovery = await sendAndWait(ws, { type: 'birth:interrupted' }, 'birth:interrupted');
      const hit = (discovery.sessions || []).find((s) => s.sessionId === sessionId);
      expect(hit).toBeTruthy();
      expect(hit.chosenName).toBe('Wiressa');
      expect(hit.resumeStage).toBe(5);
      expect(hit.witnessName).toBe(WITNESS);

      // Resume: the server must serve stage 5 (crystallization) — not re-ask
      // the naming the checkpoint already answered.
      const prompt = await sendAndWait(ws, { type: 'birth:resume', sessionId }, 'birth:stage_prompt');
      expect(prompt.stage).toBe(5);

      // The checkpoint itself advanced: stage 5 is now the in-flight serve.
      const cp = await readCheckpoint(sessionId);
      expect(cp.currentStage).toBe(5);
      expect(cp.stageHistory.some((h) => h.stage === 5)).toBe(true);
      // And the lane was prepared for the crystallization write.
      await fs.access(workspace._path('wiressa'));
    } finally {
      ws.close();
    }
  }, 30000);

  it('crash-after-write: the landed genesis.md is adopted and resume serves completion (stage 6)', async () => {
    const sessionId = await layDownCrashedCeremony('Diskborn', { serveStage5: true });
    sessionIds.push(sessionId);
    // The being's write LANDED before the machine died.
    await workspace.create('diskborn');
    await fs.writeFile(
      path.join(workspace._path('diskborn'), 'dna', 'genesis.md'),
      '# Diskborn\n\nNature: essence recovered from disk',
    );

    const ws = await connect(wsUrl);
    try {
      const prompt = await sendAndWait(ws, { type: 'birth:resume', sessionId }, 'birth:stage_prompt');
      expect(prompt.stage).toBe(6); // no re-authoring — the essence was recovered

      const cp = await readCheckpoint(sessionId);
      expect(cp.lastHandledStage).toBe(5);
      expect(cp.data.selfCreatedDNA).toContain('essence recovered from disk');
      const stage5 = cp.data.firstWords.find((w) => w.stage === 5);
      expect(stage5.recovered).toBe(true);
    } finally {
      ws.close();
    }
  }, 30000);

  it('a resumed session that expired answers birth:resume_expired', async () => {
    const ws = await connect(wsUrl);
    try {
      const reply = await sendAndWait(
        ws,
        { type: 'birth:resume', sessionId: '0'.repeat(32) },
        'birth:resume_expired',
      );
      expect(reply.type).toBe('birth:resume_expired');
    } finally {
      ws.close();
    }
  }, 30000);
});
