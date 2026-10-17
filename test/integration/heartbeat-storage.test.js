/**
 * Heartbeat storage duties — REAL workspace on a temp root, REAL encrypted
 * tool-result files, REAL statfs, REAL WS broadcast (RULE 0).
 *
 * Proves the two runtime storage duties the 2026-07-04 isolation audit found
 * missing: the heartbeat cycle measures real disk headroom every pulse, and
 * sweepToolResults — dead code until now — actually removes expired logs
 * while sparing fresh ones.
 *
 * HONEST GAP: the low/critical WARNING firing inside a cycle cannot be
 * forced on a healthy disk without mocking statfs (forbidden). The pure
 * threshold logic is proven in storage-health.test.js; the wiring from a
 * warning to the desks is proven here by driving broadcastStorageWarning
 * over a real WS; the composition (cycle → notifier) is code-reviewed.
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { neumaWorkspace } from '../../core/index.js';
import { mintToolResultRef } from '../../core/workspace/neuma-workspace.js';
import { runHeartbeatCycle } from '../../backend/services/heartbeat.js';
import {
  generateChallenge, verifySignature, createSessionToken,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setupPortalRoutes, broadcastStorageWarning } from '../../backend/routes/portal-routes.js';

const NEUMA_ID = 'hb-storage-proof';
const DAY_MS = 24 * 3600 * 1000;

describe('heartbeat storage duties (real disk, real cycle, real WS)', () => {
  let tempDir, originalRoot;

  beforeAll(async () => {
    tempDir = await createTempDir('heartbeat-storage');
    originalRoot = neumaWorkspace.root;
    neumaWorkspace.root = tempDir;
    await neumaWorkspace.create(NEUMA_ID);
  });

  afterAll(() => {
    neumaWorkspace.root = originalRoot;
  });

  test('a cycle measures real headroom and sweeps only the expired tool-result log', async () => {
    // Two REAL encrypted tool-result logs through the production append path.
    const staleRef = mintToolResultRef('stale-session', 1);
    const freshRef = mintToolResultRef('fresh-session', 1);
    await neumaWorkspace.appendToolResult(NEUMA_ID, 'stale-session', {
      ref: staleRef, seq: 1, tool: 'filesystem/read_file', status: 'ok', content: 'old', chars: 3,
    });
    await neumaWorkspace.appendToolResult(NEUMA_ID, 'fresh-session', {
      ref: freshRef, seq: 1, tool: 'filesystem/read_file', status: 'ok', content: 'new', chars: 3,
    });

    // Age the stale log past the 30-day TTL — mtime is the real age signal.
    const dir = path.join(tempDir, NEUMA_ID, 'tool-results');
    const old = new Date(Date.now() - 31 * DAY_MS);
    await fs.utimes(path.join(dir, 'stale-session.jsonl'), old, old);

    const results = await runHeartbeatCycle();

    // The pulse measured the real disk under the workspace root.
    expect(results.storage).toBeTruthy();
    expect(['ok', 'low', 'critical', 'unknown']).toContain(results.storage.level);
    if (results.storage.level !== 'unknown') {
      expect(results.storage.freeGB).toBeGreaterThan(0);
    }

    // The sweep removed exactly the expired log and spared the fresh one.
    expect(results.swept).toBe(1);
    const remaining = await fs.readdir(dir);
    expect(remaining).toContain('fresh-session.jsonl');
    expect(remaining).not.toContain('stale-session.jsonl');

    // The fresh record is still fully readable through the production path.
    const record = await neumaWorkspace.readToolResult(NEUMA_ID, 'fresh-session', freshRef);
    expect(record?.content).toBe('new');
  }, 30000);

  test('broadcastStorageWarning delivers a storage:warning frame to a real desk', async () => {
    const httpServer = createServer();
    const wss = new WebSocketServer({ server: httpServer });
    setupPortalRoutes(wss, { birthHandler: null });
    const port = await new Promise((res) => httpServer.listen(0, () => res(httpServer.address().port)));

    const keypair = generateKeypair();
    const challenge = generateChallenge(keypair.address);
    const signature = await signMessage(keypair.privateKey, challenge);
    const token = createSessionToken(verifySignature(keypair.address, challenge, signature));

    const ws = new WebSocket(`ws://localhost:${port}/?token=${encodeURIComponent(token)}`);
    const warning = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for storage:warning')), 5000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'portal:established') {
          broadcastStorageWarning({ level: 'low', freeGB: 4.2, minGB: 1, recommendedGB: 10 });
        }
        if (msg.type === 'storage:warning') {
          clearTimeout(timer);
          resolve(msg);
        }
      });
      ws.on('error', reject);
    });

    expect(warning.level).toBe('low');
    expect(warning.freeGB).toBe(4.2);
    expect(warning.recommendedGB).toBe(10);

    ws.close();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  }, 20000);
});
