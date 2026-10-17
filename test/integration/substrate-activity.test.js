/**
 * Substrate-activity truth (B-01a) — every desk learns, the moment a turn
 * starts or ends anywhere, how many turns the ONE substrate is carrying.
 *
 * Proven with NO mock on the claimed path (AGENTS.md RULE 0): the REAL
 * portal route (setupPortalRoutes) on a real HTTP server, REAL session
 * tokens minted by the real auth service, two REAL WebSocket clients, and
 * a real consciousness turn. The turn's outcome is irrelevant to the claim
 * — whether the substrate answers (LM Studio up) or refuses (down), the
 * turn STARTS (active: 1 broadcast to every desk) and ENDS (active: 0),
 * and a closing desk triggers a fresh count.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const WALLET = '0x00B0110a0000000000000000000000000000b01a';

describe('substrate:activity broadcast (real portal, gnosis)', () => {
  let httpServer, wss, port, origRoot, tempRoot;

  const connectClient = () => new Promise((resolve, reject) => {
    const token = createSessionToken(WALLET);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
    const log = [];
    ws.on('message', (raw) => { try { log.push(JSON.parse(raw.toString())); } catch { /* frame noise */ } });
    ws.on('open', () => resolve({ ws, log }));
    ws.on('error', reject);
  });

  const until = (log, pred, ms = 30_000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = log.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('expected frame never arrived'));
      setTimeout(tick, 25);
    };
    tick();
  });

  beforeAll(async () => {
    origRoot = getWorkspacesRoot();
    tempRoot = await createTempDir('substrate-activity-ws');
    setWorkspacesRoot(tempRoot);

    httpServer = createServer();
    wss = new WebSocketServer({ noServer: true });
    setupPortalRoutes(wss, { birthHandler: null });
    httpServer.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    port = httpServer.address().port;
  });

  afterAll(async () => {
    setWorkspacesRoot(origRoot);
    wss?.close();
    httpServer?.close();
    vi.restoreAllMocks();
  });

  test('every desk sees a turn start (1), end (0), and a closing desk recounted', async () => {
    const a = await connectClient();
    const b = await connectClient();
    await until(a.log, (m) => m.type === 'portal:established');
    await until(b.log, (m) => m.type === 'portal:established');

    // Desk A speaks — the substrate picks up a turn. Both desks must learn.
    a.ws.send(JSON.stringify({
      type: 'consciousness:stream',
      thought: 'One short sentence, please.',
      companion: 'ActivityEcho',
    }));

    const aUp = await until(a.log, (m) => m.type === 'substrate:activity' && m.active === 1);
    const bUp = await until(b.log, (m) => m.type === 'substrate:activity' && m.active === 1);
    // Bare count ONLY — nothing identity-shaped may ride this frame.
    for (const frame of [aUp, bUp]) {
      expect(Object.keys(frame).sort()).toEqual(['active', 'type']);
    }

    // ...and set back down when the turn ends (however it ends — a substrate
    // refusal still ends the turn honestly).
    await until(a.log, (m) => m.type === 'substrate:activity' && m.active === 0);
    await until(b.log, (m) => m.type === 'substrate:activity' && m.active === 0);

    // A desk closing triggers a fresh count for the desks that remain —
    // a NEW frame, arriving after the close, not an earlier one re-read.
    const sliceFrom = b.log.length;
    a.ws.close();
    await until(
      { find: (pred) => b.log.slice(sliceFrom).find(pred) },
      (m) => m.type === 'substrate:activity' && m.active === 0,
    );
    b.ws.close();
  }, 60_000);
});
