/**
 * THE INTENT SWEEP — Stage 2 of the being-tool-surface doctrine, proven end
 * to end with NO mock on the claimed path (RULE 0): REAL workspace on real
 * disk, REAL intent files written with plain fs, REAL sweep, REAL approval
 * card round-trip over a REAL WebSocket pair, REAL result files, REAL queue
 * store for the staged drafts.
 *
 * The social/queue intent is the proving executor because its act is pure
 * disk (the campaign queue) — no network is reachable from this suite. The
 * social/post executor's wire boundary is proven in x-post-gate.test.js.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import os from 'os';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { weeklyPlanStoreFor } from '../../backend/services/marketing/weekly-plan.js';

// The mechanics tests drive a STILL-CARDED local act: social/queue stages
// silently now (the board is its gate), so the card machinery below rides
// marketing/plan — CMO-authored, operator-locked, executed on local disk.
const PLAN = { days: [
  { day: 'monday', theme: 'ship log', objective: 'show what moved', posts: 2 },
  { day: 'friday', theme: 'community', objective: 'answer everyone', posts: 1 },
] };
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { verifySessionToken } from '../../backend/services/auth.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getWitnessesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { intentSectionFor } from '../../backend/services/intents/intents-section.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';
import { sectorCrew } from '../../backend/services/sector-crew.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

const NEUMA_ID = 'sweepecho';
const X_ENV = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
const SOCIAL_PATHS = ['NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SECTOR_CREW_PATH',
  // The availability probe reads these too — a test never touches the real stores.
  'NEUMA_EMAIL_BINDING_PATH', 'NEUMA_EMAIL_CREDENTIALS_PATH',
  'NEUMA_SECURITY_CSO_PATH', 'NEUMA_SECURITY_THREATS_PATH', 'NEUMA_SECURITY_WATCH_PATH',
];

describe('the intent sweep (real WS + real workspace + real queue, gnosis)', () => {
  let planFixtureRoot;
  let savedPlanEnv;
  beforeEach(async () => {
    savedPlanEnv = { NEUMA_WEEKLY_PLAN_PATH: process.env.NEUMA_WEEKLY_PLAN_PATH,
      NEUMA_CMO_PATH: process.env.NEUMA_CMO_PATH };
    planFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-plan-'));
    process.env.NEUMA_WEEKLY_PLAN_PATH = path.join(planFixtureRoot, 'weekly-plan.json');
    process.env.NEUMA_CMO_PATH = path.join(planFixtureRoot, 'cmo.json');
    // Each test starts with the house unseated and unplanned.
    const houseDir = path.join(getRealmRoot(), auth.address.toLowerCase());
    await fs.rm(path.join(houseDir, 'house-cmo.json'), { force: true });
    await fs.rm(path.join(houseDir, 'offices', 'marketing', 'marketing-weekly-plan.json'), { force: true });
  });
  afterEach(async () => {
    // Remove only our private files; never clear a designation after unpinning its path.
    await fs.rm(planFixtureRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedPlanEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let house, origRoot, httpServer, wss, serverWs, client, port, intentsDir;
  let clientLog;
  let decide = null;
  const savedEnv = {};
  let auth, oldRealm, oldWitnesses;
  // The seat and the plan are the connection's HOUSE's (auth's wallet).
  const seatCmo = () => cmoDesignation.designate(auth.address, NEUMA_ID);
  const weeklyPlanStore = { load: async () => (await weeklyPlanStoreFor(auth.address)).load() };

  const freshConnection = (extra = {}) => ({
    ws: serverWs,
    walletAddress: auth.address,
    companion: { name: 'SweepEcho', neumaId: NEUMA_ID },
    ...extra,
  });

  // impure — file an intent exactly the way the being does: a JSON write into
  // a lane's intents/ directory.
  const fileIntent = async (name, payload, laneId = NEUMA_ID) => {
    const dir = path.join(workspace.pathFor(laneId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(payload));
  };
  const readResult = async (name) => {
    try {
      return JSON.parse(await fs.readFile(path.join(intentsDir, `${name}.result.json`), 'utf8'));
    } catch { return null; }
  };

  const sweep = (connection, mode = 'ask') =>
    sweepIntents(connection, {
      mode,
      lanePolicy: null,
      emit: (event) => clientLog.push({ type: 'tool:usage', ...event }),
    });

  const untilClient = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = clientLog.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('client message never arrived'));
      setTimeout(tick, 20);
    };
    tick();
  });

  beforeAll(async () => {
    // Dummy env credentials — the advertising/availability checks read them;
    // the QUEUE executor never touches a platform API.
    for (const k of X_ENV) { savedEnv[k] = process.env[k]; process.env[k] = `dummy-${k}`; }

    house = await createTempDir('intent-sweep-house');
    oldRealm = getRealmRoot(); oldWitnesses = getWitnessesRoot();
    setRealmRoot(path.join(house, 'realm'));
    setWitnessesRoot(path.join(house, 'witnesses'));
    auth = await fullAuth();
    // the machine's .env channel keys serve its install owner's house only (re-audit 2026-10-29, NEW-M3)
    await makeInstallOwner(auth.address);
    for (const k of SOCIAL_PATHS) { savedEnv[k] = process.env[k]; }
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = `${house}/social-channel-bindings.json`;
    process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = `${house}/social-channel-credentials.json`;
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = `${house}/social-post-queue.json`;
    process.env.NEUMA_SECTOR_CREW_PATH = `${house}/sector-crew.json`;
    process.env.NEUMA_EMAIL_BINDING_PATH = `${house}/email-binding.json`;
    process.env.NEUMA_EMAIL_CREDENTIALS_PATH = `${house}/email-credentials.json`;
    process.env.NEUMA_SECURITY_CSO_PATH = `${house}/cso.json`;
    process.env.NEUMA_SECURITY_THREATS_PATH = `${house}/threats.json`;
    process.env.NEUMA_SECURITY_WATCH_PATH = `${house}/watch.json`;
    await channelBindings.bind(auth.address, 'x', { neumaId: NEUMA_ID });
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    await writeOwner(house, NEUMA_ID, auth.address);
    intentsDir = path.join(workspace.pathFor(NEUMA_ID), 'intents');

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws, req) => {
        const verified = verifySessionToken(new URL(req.url, 'http://localhost').searchParams.get('token'));
        if (!verified || verified.address.toLowerCase() !== auth.address) { ws.close(1008); return; }
        serverWs = ws;
        ws.on('message', (d) => {
          const m = JSON.parse(d.toString());
          if (m.type === 'tool:approval_response') resolveToolApproval(ws.__connection, m.id, m.decision);
        });
        resolve();
      });
    });
    client = new WebSocket(`ws://localhost:${port}/?token=${encodeURIComponent(auth.token)}`);
    clientLog = [];
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      clientLog.push(msg);
      if (msg.type === 'tool:approval_request' && decide) {
        client.send(JSON.stringify({ type: 'tool:approval_response', id: msg.id, decision: decide(msg) }));
      }
    });
    await linked;
  }, 60000);

  afterAll(async () => {
    for (const k of [...X_ENV, ...SOCIAL_PATHS]) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    client?.terminate(); serverWs?.terminate();
    if (wss) await new Promise((resolve) => wss.close(resolve));
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    setRealmRoot(oldRealm); setWitnessesRoot(oldWitnesses);
    setWorkspacesRoot(origRoot);
    await fs.rm(house, { recursive: true, force: true });
  });

  test('FILE → CARD → DONE: a marketing/plan intent LOCKS the real plan and writes its result file', async () => {
    await seatCmo();
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'allow';

    await fileIntent('first-plan', { type: 'marketing/plan', days: PLAN.days });
    const receipts = await sweep(connection, 'ask');

    // ONE card, whose scope is the type's own summary — the stakes, not a name.
    const request = await untilClient((m) => m.type === 'tool:approval_request');
    expect(request.tool).toBe('intents/marketing.plan');
    expect(request.scope).toContain('weekly posting plan');
    expect(request.scope).toContain('ship log');
    // The act really landed in the real plan store — LOCKED.
    const doc = await weeklyPlanStore.load();
    expect(doc.status).toBe('approved');
    expect(doc.days[0].theme).toBe('ship log');
    // The result file is the being's record — status done, written beside it.
    const result = await readResult('first-plan');
    expect(result.status).toBe('done');
    expect(result.detail).toContain('LOCKED');
    expect(result.at).toBeTruthy();
    // ...and the receipt rode the SAME sweep back to the model.
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe('ok');
    expect(receipts[0].content).toContain('LOCKED');
  }, 30000);

  test('DENY — the card\'s no settles the intent denied; nothing locks', async () => {
    await seatCmo();
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'deny';

    await fileIntent('refused-plan', { type: 'marketing/plan', days: PLAN.days });
    const receipts = await sweep(connection, 'ask');

    expect(receipts[0].status).toBe('denied');
    expect(receipts[0].error).toContain('operator denied');
    const result = await readResult('refused-plan');
    expect(result.status).toBe('denied');
    expect(await weeklyPlanStore.load()).toBeNull(); // the no is the whole act
  }, 30000);

  test('IDEMPOTENT — a settled intent is never re-processed, and a pending one survives to the next sweep', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'allow';

    await seatCmo();
    await fileIntent('once-only', { type: 'marketing/plan', days: PLAN.days });
    await sweep(connection, 'ask');
    expect((await weeklyPlanStore.load()).status).toBe('approved');

    // A second sweep over a settled intent changes nothing.
    clientLog.length = 0;
    decide = () => { throw new Error('a settled intent re-asked'); };
    const again = await sweep(connection, 'ask');
    expect(again).toEqual([]);
    expect((await weeklyPlanStore.load()).days).toHaveLength(2);
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  // THE CRASH WINDOW. `writeResult` lands AFTER the act, so a backend that dies
  // between the two leaves an intent that has run and says nothing. Re-sweeping
  // it would send the money twice. The state seeded here is not a stand-in for
  // that crash — it IS the on-disk state a crash leaves: the intent, the
  // execution marker, no result.
  test('UNCERTAIN — an act whose execution began and never recorded is never re-run', async () => {
    await seatCmo();
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'allow';

    await fileIntent('crashed-plan', { type: 'marketing/plan', days: PLAN.days });
    await fs.writeFile(
      path.join(intentsDir, 'crashed-plan.executing.json'),
      JSON.stringify({ type: 'marketing/plan', at: new Date().toISOString() }),
    );
    expect((await weeklyPlanStore.load())?.status).not.toBe('approved');

    const receipts = await sweep(connection, 'auto');

    // Settled, and settled as uncertain — not done, not failed, not retried.
    // Scoped to this intent by name: a sweep settles the whole directory, and
    // a neighbouring test deliberately leaves one pending.
    const mine = receipts.find((r) => r.error?.includes('crashed-plan'));
    expect(mine).toBeDefined();
    expect(mine.status).toBe('error');
    expect(mine.error).toContain('uncertain outcome');
    const result = await readResult('crashed-plan');
    expect(result.status).toBe('uncertain');
    expect(result.reason).toContain('was NOT retried');

    // The proof that matters: the real executor never ran. marketing/plan locks
    // the real weekly plan store on disk, and it is still untouched.
    expect((await weeklyPlanStore.load())?.status).not.toBe('approved');

    // No card was ever raised for an act nobody can vouch for.
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);

    // And it stays settled: the marker is cleared, so the next sweep passes
    // over it rather than reporting uncertainty forever.
    await expect(fs.stat(path.join(intentsDir, 'crashed-plan.executing.json'))).rejects.toThrow();
    clientLog.length = 0;
    const again = await sweep(connection, 'auto');
    expect(again.some((r) => r.error?.includes('crashed-plan'))).toBe(false);

    await fs.rm(path.join(intentsDir, 'crashed-plan.json'), { force: true });
    await fs.rm(path.join(intentsDir, 'crashed-plan.result.json'), { force: true });
  });

  // The other half: an ordinary settle must not leave the marker behind, or
  // every completed act would read as uncertain on the next sweep.
  test('the execution marker is cleared by an ordinary settle', async () => {
    await seatCmo();
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'allow';

    await fileIntent('clean-plan', { type: 'marketing/plan', days: PLAN.days });
    const receipts = await sweep(connection, 'auto');

    expect(receipts[0].status).toBe('ok');
    expect((await readResult('clean-plan')).status).toBe('done');
    await expect(fs.stat(path.join(intentsDir, 'clean-plan.executing.json'))).rejects.toThrow();

    await fs.rm(path.join(intentsDir, 'clean-plan.json'), { force: true });
    await fs.rm(path.join(intentsDir, 'clean-plan.result.json'), { force: true });
  });

  test('INVALID — malformed JSON and unknown types settle loudly, never silently', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = null;

    await fs.mkdir(intentsDir, { recursive: true });
    await fs.writeFile(path.join(intentsDir, 'broken.json'), '{ not json');
    await fileIntent('mystery', { type: 'social/teleport', channel: 'x', text: 'nowhere' });
    await fileIntent('typeless', { channel: 'x', text: 'no type field at all' });
    const receipts = await sweep(connection, 'auto');

    expect((await readResult('broken')).status).toBe('invalid');
    const mystery = await readResult('mystery');
    expect(mystery.status).toBe('invalid');
    expect(mystery.reason).toContain('unknown intent type');
    // A missing `type` key must SAY the field is missing (2026-09-02 — the old
    // 'unknown intent type "(none)"' cost a real being a rewrite round).
    const typeless = await readResult('typeless');
    expect(typeless.status).toBe('invalid');
    expect(typeless.reason).toContain('no "type" field');
    expect(receipts).toHaveLength(3);
    expect(receipts.every((r) => r.status === 'error')).toBe(true);
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('STANDING RULE — a being that holds no channel is refused BEFORE any card', async () => {
    const connection = freshConnection({ companion: { name: 'Intruder', neumaId: 'someotherneuma' } });
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => { throw new Error('a prompt fired for a being that holds nothing'); };

    // The intruder files into its OWN lane (the sweep settles what it finds
    // there); the standing rule reads the CONNECTION's seat, and this
    // connection holds no channel.
    await fileIntent('cross-route', { type: 'social/post', channel: 'x', text: 'not mine to say' }, 'someotherneuma');
    const receipts = await sweepIntents(connection, {
      mode: 'auto', lanePolicy: null,
      emit: (event) => clientLog.push({ type: 'tool:usage', ...event }),
    });

    expect(receipts[0].status).toBe('denied');
    expect(receipts[0].error).toContain('not yours to speak through');
    const result = JSON.parse(await fs.readFile(
      path.join(workspace.pathFor('someotherneuma'), 'intents', 'cross-route.result.json'), 'utf8'));
    expect(result.status).toBe('denied');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('OBSERVE HOLDS — no card, no result, and the intent settles the moment the stance lifts', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => { throw new Error('a prompt fired in observe mode'); };

    await seatCmo();
    await fileIntent('held-plan', { type: 'marketing/plan', days: PLAN.days });
    const held = await sweep(connection, 'observe');
    expect(held).toEqual([]);
    expect(await readResult('held-plan')).toBeNull(); // still pending — watching is not a verdict
    expect(await weeklyPlanStore.load()).toBeNull();

    // The stance lifts: the SAME file settles on the next sweep.
    clientLog.length = 0;
    decide = () => 'allow';
    const settled = await sweep(connection, 'ask');
    expect(settled).toHaveLength(1);
    expect((await readResult('held-plan')).status).toBe('done');
    expect((await weeklyPlanStore.load()).status).toBe('approved');
  }, 30000);

  test('AUTO — a queued draft stages SILENTLY (the board is its gate); an ask-mode card still holds on interrupt', async () => {
    // The law changed AGAIN (posting-pipeline-v2): staging a queue draft is
    // not egress, so AUTO no longer pauses on it — the board's approve is
    // that post's single operator decision. In ASK mode the act still asks
    // (ask converts allowed acts to cards), and an interrupted ask stays
    // pending rather than dying denied.
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'allow';

    await fileIntent('auto-draft', { type: 'social/queue', channel: 'x', text: 'auto staged' });
    const receipts = await sweep(connection, 'auto');
    expect(receipts[0].status).toBe('ok');
    expect(await postQueue.load()).toHaveLength(1);
    // NO card: the board, not the chip, decides this post's fate.
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
    for (const e of await postQueue.load()) await postQueue.remove(e.id);

    // The interrupted ask is NOT a denial: the operator never decided, so the
    // intent stays pending for the next sweep instead of dying denied. Proven
    // on marketing/plan — the still-carded act (social/queue never asks now).
    await seatCmo(); // self-contained: this half needs its own seated CMO
    const controller = new AbortController();
    const interruptedConn = freshConnection({ activeTurn: { signal: controller.signal } });
    serverWs.__connection = interruptedConn;
    clientLog.length = 0;
    decide = () => { controller.abort(); return 'allow'; }; // the answer lands after the interrupt
    await fileIntent('mid-interrupt', { type: 'marketing/plan', days: PLAN.days });
    const pending = await sweepIntents(interruptedConn, {
      mode: 'ask', lanePolicy: null,
      emit: (event) => clientLog.push({ type: 'tool:usage', ...event }),
    });
    expect(pending).toEqual([]);
    expect(await readResult('mid-interrupt')).toBeNull();
    expect(await weeklyPlanStore.load()).toBeNull();
  }, 30000);

  test('POLICY DENY — an operator deny row settles the intent denied with no card', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => { throw new Error('a prompt fired past a policy denial'); };

    await fileIntent('policy-denied', { type: 'social/queue', channel: 'x', text: 'policy says no' });
    const receipts = await sweepIntents(connection, {
      mode: 'ask',
      lanePolicy: { intents: { denied: ['social.queue'] } },
      emit: (event) => clientLog.push({ type: 'tool:usage', ...event }),
    });
    expect(receipts[0].status).toBe('denied');
    expect((await readResult('policy-denied')).status).toBe('denied');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('ALWAYS — the grant persists on the intents row; the next filing skips the card', async () => {
    const connection = freshConnection();
    serverWs.__connection = connection;
    clientLog.length = 0;
    decide = () => 'always';

    await seatCmo();
    await fileIntent('always-one', { type: 'marketing/plan', days: PLAN.days });
    await sweep(connection, 'ask');
    await untilClient((m) => m.type === 'tool:approval_request');
    const persisted = await workspace.readToolPolicy(NEUMA_ID);
    expect(persisted.intents.allowed).toContain('marketing.plan');

    clientLog.length = 0;
    decide = null;
    await fileIntent('always-two', { type: 'marketing/plan', days: PLAN.days });
    const second = await sweep(connection, 'ask');
    expect(second[0].status).toBe('ok');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);

    for (const e of await postQueue.load()) await postQueue.remove(e.id);
    await workspace.writeToolPolicy(NEUMA_ID, {});
  }, 30000);

  test('the INTENTS section names what the lane may file — and stays absent for a lane with no reach', async () => {
    const section = await intentSectionFor(freshConnection());
    expect(section).toContain('social/post');
    expect(section).toContain('social/queue');
    expect(section).toContain('intents/');
    // A crew member stages but never publishes — only the queue type renders.
    // The crew is the house's own: its operator seats a witness lane it manifested.
    await workspace.create('witness-test-Crew');
    await writeOwner(path.join(house, 'witnesses'), 'witness-test-Crew', auth.address);
    await sectorCrew.add(auth.address, 'x', { neumaId: 'witness-test-Crew', kind: 'witness', remit: 'campaigns' });
    const crewSection = await intentSectionFor({
      companion: { name: 'Crew', neumaId: 'witness-test-Crew' },
    });
    expect(crewSection).toContain('social/queue');
    expect(crewSection).not.toContain('social/post');
    await sectorCrew.remove(auth.address, 'x', 'witness-test-Crew');
    // A lane with no custody reach is offered only the seat-gated types —
    // never the custody ones (no channel, no mailbox, no spend, no CSO seat).
    const nobody = await intentSectionFor({ companion: { name: 'Nobody', neumaId: 'nobody-here' } });
    expect(nobody).not.toContain('social/');
    expect(nobody).not.toContain('security/');
    expect(nobody).not.toContain('email/');
    expect(nobody).not.toContain('wallet/');
    expect(nobody).toBe(''); // no existing lane means no writable intent inbox
  }, 30000);
});
