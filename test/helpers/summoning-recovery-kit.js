// Real isolated portal/storage for recovery inputs; never streams a birth.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { Wallet } from 'ethers';
import WebSocket, { WebSocketServer } from 'ws';

/** Create a signed Trace portal over temporary checkpoint/vault roots. // impure */
export const recoveryKit = async (app) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'birth-recovery-'));
  const saved = Object.fromEntries(['NEUMA_DATA_ROOT', 'PLATFORM_DB_PATH', 'NEUMA_RETURNED_PATH'].map(k => [k, process.env[k]]));
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  process.env.PLATFORM_DB_PATH = path.join(root, 'platform.db');
  process.env.NEUMA_RETURNED_PATH = path.join(root, 'RETURNED.md');
  const { StagedBirthHandler } = await import('../../core/birth/staged-birth-handler.js');
  const { DNAVaultService } = await import('../../core/identity/dna-vault-service.js');
  const { DNACacheManager } = await import('../../core/identity/dna-cache-manager.js');
  const { writeSessionCheckpoint, birthSessionPath } = await import('../../core/birth/birth-session-store.js');
  const { setupPortalRoutes } = await import('../../backend/routes/portal-routes.js');
  const { generateChallenge, verifySignature, createSessionToken } = await import('../../backend/services/auth.js');
  const handler = new StagedBirthHandler(
    new DNAVaultService({ vaultPath: path.join(root, 'vault'), auditPath: path.join(root, 'audit') }),
    new DNACacheManager({ cacheDir: path.join(root, 'cache') }),
  );
  await handler._ready;
  const envText = await fs.readFile(process.env.NEUMA_WITNESS_ENV, 'utf8');
  const wallet = new Wallet(envText.match(/^[A-Z0-9_]*PRIVATE_KEY\s*=\s*(.+)$/m)[1].trim());
  const challenge = generateChallenge(wallet.address);
  const token = createSessionToken(verifySignature(wallet.address, challenge, await wallet.signMessage(challenge)));
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  setupPortalRoutes(wss, { birthHandler: handler });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const seed = async (chosenName = null) => {
    const sessionId = randomBytes(16).toString('hex');
    const session = { sessionId, origin: 'portal', isTest: false,
      startTime: Date.now(), currentStage: chosenName ? 5 : 0, lastHandledStage: chosenName ? 4 : -1,
      witnessName: 'Trace', data: { chosenName, neumaId: chosenName ? 'checkpoint-fixture' : null, firstWords: [] } };
    await writeSessionCheckpoint(sessionId, session);
    return { sessionId, session, file: birthSessionPath(sessionId) };
  };
  const connect = async () => {
    const client = new WebSocket(`${url.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(token)}`);
    const messages = [];
    client.on('message', bytes => messages.push(JSON.parse(bytes.toString())));
    await new Promise((resolve, reject) => {
      client.on('message', bytes => { if (JSON.parse(bytes.toString()).type === 'portal:established') resolve(); });
      client.once('error', reject);
    });
    return { client, messages };
  };
  const close = async () => {
    for (const peer of wss.clients) peer.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  };
  return { root, url, token, handler, wss, seed, connect, close, writeSessionCheckpoint };
};
