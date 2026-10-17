/**
 * The team/run intent kit — the real ground both team/run suites stand on:
 * a REAL WebSocket pair the operator's frames cross, the REAL intent sweep,
 * isolated stores (workspaces, run records, deliveries, the CoS seat), and
 * the declared seams (conduit, substrate probe, capacity) — never a mock of
 * the path under proof. Extracted from team-run-tool.test.js (size law).
 *
 * impure — opens sockets and temp roots; close() releases them.
 */
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from './temp-fs.js';
import { neumaWorkspace } from '../../core/index.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { setTeamRunSeams } from '../../backend/services/intents/team-run.js';

export const APPROVED_PLAN = Object.freeze({
  name: 'HERALD CREW',
  goal: 'Ship a week of posts.',
  steps: Object.freeze([
    Object.freeze({ id: 'research', neumaId: 'aethon', role: 'HELM', task: 'find themes', needs: Object.freeze([]) }),
    Object.freeze({ id: 'draft', neumaId: 'boreas', task: 'write posts', needs: Object.freeze(['research']) }),
  ]),
  memberNames: Object.freeze({ aethon: 'Aethon', boreas: 'Boreas' }),
  approvedAt: '2026-07-06T18:00:00.000Z',
});

export const SEAMS = Object.freeze({
  checkSubstrate: async () => true,
  getCapacity: async () => ({ maxParallel: 2 }),
  ask: async (neumaId, _messages, step) => `part from ${neumaId}: ${step.id}\nSTATUS:\n${step.id} complete`,
  // The rig's pause before a part that stopped short is continued
  // (team-part.js) — real timers, quicker than a house's.
  continueWaits: Object.freeze([5, 5, 5]),
});

/**
 * @param {string} label - temp-dir label
 * @returns {Object} the kit: open/close, freshConnection, fileRun, runIntent,
 *   report, untilClient, and `log` (every frame the operator's socket received)
 */
export const createTeamIntentKit = (label) => {
  let httpServer, wss, serverWs, client, priorRealm;
  const log = [];
  let settled = null;

  const open = async () => {
    // The scripted suites journal FICTIONAL plan members (the memory
    // write-back runs for real) — never into the live workspace root
    // (2026-07-09: aethon/boreas dirs leaked into a real house realm).
    setWorkspacesRoot(path.join(await createTempDir(label), 'workspaces'));
    process.env.NEUMA_TEAM_RUN_PATH = path.join(await createTempDir(`${label}-records`), 'runs');
    process.env.NEUMA_TEAM_DELIVERY_PATH = path.join(await createTempDir(`${label}-deliveries`), 'deliveries');
    // The Optio dispatch gate reads the REAL designation store — each house's
    // seat in its own realm, and the legacy machine seat, both isolated, so
    // the operator's live seats are never consulted.
    process.env.NEUMA_STAFF_COS_PATH = path.join(await createTempDir(`${label}-cos`), 'staff-cos.json');
    priorRealm = getRealmRoot();
    setRealmRoot(path.join(await createTempDir(`${label}-realm`), 'realm'));
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => { wss.on('connection', (ws) => { serverWs = ws; resolve(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
    client.on('message', (data) => log.push(JSON.parse(data.toString())));
    await linked;
  };

  const close = async () => {
    setWorkspacesRoot(null);
    if (priorRealm) setRealmRoot(priorRealm);
    delete process.env.NEUMA_TEAM_RUN_PATH;
    delete process.env.NEUMA_TEAM_DELIVERY_PATH;
    delete process.env.NEUMA_STAFF_COS_PATH;
    setTeamRunSeams(null);
    client?.close();
    wss?.close();
    httpServer?.close();
  };

  const freshConnection = () => ({
    ws: serverWs,
    companion: { name: 'Aethon', neumaId: 'aethon' },
    walletAddress: '0x1111111111111111111111111111111111111111',
    _approvedPlan: APPROVED_PLAN,
  });

  // File the team/run intent exactly as the being does.
  const fileRun = async (connection, name = 'the-run') => {
    const dir = path.join(neumaWorkspace.pathFor(connection.companion.neumaId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ type: 'team/run' }));
  };

  // Settle it through the REAL sweep with the declared seams; the background
  // run's settle promise is captured (onSettled) so a test can await it.
  const runIntent = async (connection, seams = SEAMS, mode = 'auto') => {
    settled = null;
    setTeamRunSeams({ ...seams, onSettled: (p) => { settled = p; } });
    const receipts = await sweepIntents(connection, {
      mode, lanePolicy: null,
      emit: (event) => log.push({ type: 'tool:usage', ...event }),
    });
    setTeamRunSeams(null);
    return receipts[0] || null;
  };

  // The run's outcome and the lead's report text.
  const report = async () => {
    const outcome = await settled;
    return { ...outcome, text: outcome.report ? await fs.readFile(outcome.report, 'utf8') : '' };
  };

  // Frames cross a real socket — wait for them, never poll once.
  const untilClient = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = log.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('client message never arrived'));
      setTimeout(tick, 20);
    };
    tick();
  });

  return { open, close, freshConnection, fileRun, runIntent, report, untilClient, log, socket: () => serverWs };
};
