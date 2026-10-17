/**
 * A team run tells the truth about what did NOT happen (2026-10-10).
 *
 * A real house run marked four blank parts "done", fed them to the step that
 * depended on them, and kept no record of why they were blank or of the run
 * itself had it failed. This proves the lead lane end to end on the REAL
 * path — no seam on the member conduit: real askNeuma, a real local
 * OpenAI-wire server the real provider client streams from, the real intent
 * sweep, a real WebSocket pair, the real run store on disk.
 *
 * The server answers member A with NO words and finish_reason "length" (a
 * reply budget spent thinking), member B with a real part. C depends on A.
 * The contract: the run RESPONDS to A stopping short — it continues A on its
 * own, told why, until A has failed three times in a row without an act or a
 * word (team-part.js, 2026-10-12) — then A is FAILED with its finish reason,
 * B's independent part still lands, C never starts, the record is on disk
 * while the run moves and settles `failed` with its true start time, and the
 * lead reads the failure first.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { isThinkProbe } from '../helpers/think-probe.js';

const WALLET = '0x3333333333333333333333333333333333333333';
const MEMBERS = Object.freeze({ a: 'honest-a', b: 'honest-b', c: 'honest-c', lead: 'honest-lead' });

// A real chat-completions server. Each being's genesis carries a marker, so
// the request's system prompt says who is speaking.
const startProvider = (asked) => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'honest-model' }] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (isThinkProbe(body)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ready' } }] }));
        return;
      }
      const system = String(body.messages?.[0]?.content ?? '');
      const who = ['MARK-A', 'MARK-B', 'MARK-C'].find((m) => system.includes(m)) ?? 'unknown';
      asked.push(who);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (who === 'MARK-A') {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `the part from ${who}\nSTATUS:\n${who} complete` } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      }
      res.end('data: [DONE]\n\n');
    });
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

describe('team/run on the real conduit — failure is said, never dressed as done', () => {
  const asked = [];
  let provider, httpServer, wss, serverWs, client, clientLog, prevRealm, saved;
  let sweepIntents, setTeamRunSeams, readRun, listRuns, setRealmRoot, setWorkspacesRoot, neumaWorkspace;

  beforeAll(async () => {
    const root = await createTempDir('team-run-honest');
    saved = { ...process.env };
    process.env.WORKSPACES_ROOT = path.join(root, 'workspaces');
    process.env.NEUMA_ROUTES_PATH = path.join(root, 'routes.json');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'credentials.json');
    process.env.NEUMA_TEAM_RUN_PATH = path.join(root, 'runs');
    process.env.NEUMA_TEAM_DELIVERY_PATH = path.join(root, 'deliveries');
    process.env.NEUMA_STAFF_COS_PATH = path.join(root, 'staff-cos.json');

    ({ setRealmRoot } = await import('../../backend/services/user-realm.js'));
    const { getRealmRoot } = await import('../../backend/services/user-realm.js');
    prevRealm = getRealmRoot();
    setRealmRoot(path.join(root, 'realm'));

    const ws = await import('../../core/workspace/neuma-workspace.js');
    setWorkspacesRoot = ws.setWorkspacesRoot;
    neumaWorkspace = ws.default;
    setWorkspacesRoot(process.env.WORKSPACES_ROOT);
    for (const [key, id] of Object.entries(MEMBERS)) {
      await neumaWorkspace.create(id);
      await neumaWorkspace.writeDNA(id, {
        version: '1.0.0',
        identity: { name: id },
        genesis: `# Essence\nMARK-${key.toUpperCase()} — I answer through my own conduit.`,
      });
    }

    provider = await startProvider(asked);
    const { setConfig } = await import('../../backend/services/llm-provider.js');
    setConfig({ provider: 'lm-studio', endpoint: `http://127.0.0.1:${provider.address().port}`, model: 'honest-model', apiKey: '' });

    ({ sweepIntents } = await import('../../backend/services/intents/intent-sweep.js'));
    ({ setTeamRunSeams } = await import('../../backend/services/intents/team-run.js'));
    ({ readRun, listRuns } = await import('../../backend/services/team-run-store.js'));

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((r) => httpServer.listen(0, () => r(httpServer.address().port)));
    const linked = new Promise((r) => { wss.on('connection', (s) => { serverWs = s; r(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
    clientLog = [];
    client.on('message', (d) => clientLog.push(JSON.parse(d.toString())));
    await linked;
  }, 60000);

  afterAll(async () => {
    setTeamRunSeams?.(null);
    setWorkspacesRoot?.(null);
    setRealmRoot?.(prevRealm);
    client?.close();
    wss?.close();
    httpServer?.close();
    await new Promise((r) => provider?.close(r));
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  const until = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = clientLog.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('frame never arrived'));
      setTimeout(tick, 20);
    };
    tick();
  });

  test('a blank part FAILS with its finish reason; independent work lands; dependents never start', async () => {
    const connection = {
      ws: serverWs,
      companion: { name: MEMBERS.lead, neumaId: MEMBERS.lead },
      walletAddress: WALLET,
      _approvedPlan: Object.freeze({
        name: 'HONEST CREW',
        goal: 'Prove a blank part is never a finished part.',
        steps: Object.freeze([
          Object.freeze({ id: 'v1', neumaId: MEMBERS.a, task: 'research the first gap', needs: Object.freeze([]) }),
          Object.freeze({ id: 'v2', neumaId: MEMBERS.b, task: 'research the second gap', needs: Object.freeze([]) }),
          Object.freeze({ id: 'v3', neumaId: MEMBERS.c, task: 'score both gaps', needs: Object.freeze(['v1', 'v2']) }),
        ]),
        memberNames: Object.freeze({ [MEMBERS.a]: 'Alpha', [MEMBERS.b]: 'Beta', [MEMBERS.c]: 'Gamma' }),
        approvedAt: new Date().toISOString(),
      }),
    };
    const dir = path.join(neumaWorkspace.pathFor(MEMBERS.lead), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'honest-run.json'), JSON.stringify({ type: 'team/run' }));

    // Only rig configuration is provided — the member conduit is the real
    // one. onSettled hands the test the background run it started.
    let settled = null;
    // The rig's pause before a continuation is shortened: the waits are real
    // timers, only quicker than a house's.
    setTeamRunSeams({ checkSubstrate: async () => true, getCapacity: async () => ({ maxParallel: 1 }), continueWaits: [20, 20, 20], onSettled: (p) => { settled = p; } });
    const startedAt = Date.now();
    const receipts = await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: () => {} });
    setTeamRunSeams(null);
    const receipt = receipts.find((r) => r.tool === 'intents/team.run');
    expect(receipt.status).toBe('ok'); // the run started; how it ENDED is below
    const outcome = await settled;
    expect(outcome.status).toBe('failed');

    // The real conduit was asked for A — once, then three continuations the
    // run sent on its own — and B; never for C, which stood on A.
    expect(asked.filter((who) => who === 'MARK-A')).toHaveLength(4);
    expect(asked).toContain('MARK-B');
    expect(asked).not.toContain('MARK-C');

    // The lead reads the failure FIRST, with the reason the reply ended — in
    // the report file in its own lane.
    expect(outcome.report.startsWith(neumaWorkspace.pathFor(MEMBERS.lead))).toBe(true);
    const text = await fs.readFile(outcome.report, 'utf8');
    expect(text).toMatch(/^Your team did not finish: 1 of 3 steps completed/);
    expect(text).toContain('v1 (Alpha): FAILED');
    expect(text).toContain('finish: length');
    expect(text).toContain('v3: NEVER STARTED');
    expect(text).toContain('the part from MARK-B');

    // The operator's board said FAILED as it happened, and WORKING before.
    const start = await until((m) => m.type === 'operator:team_start');
    await until((m) => m.type === 'operator:team_board' && m.board.find((e) => e.id === 'v1')?.state === 'working');
    await until((m) => m.type === 'operator:team_board' && m.board.find((e) => e.id === 'v1')?.state === 'failed');
    const done = await until((m) => m.type === 'operator:team_done');
    expect(done.status).toBe('error');
    expect(Object.keys(done.failures)).toEqual(['v1']);
    expect(done.skipped).toEqual(['v3']);
    // One run, one name: the portal id IS the record id.
    expect(done.record).toBe(start.id);

    // The record stands on disk, settled failed, with its TRUE start time.
    const record = await readRun(done.record, WALLET);
    expect(record.status).toBe('failed');
    expect(record.completed).toEqual({ v2: 'the part from MARK-B' });
    expect(record.failures.v1).toContain('finish: length');
    expect(Date.parse(record.runAt)).toBeGreaterThanOrEqual(startedAt - 1000);
    expect(Date.parse(record.finishedAt)).toBeGreaterThanOrEqual(Date.parse(record.runAt));
    expect((await listRuns(WALLET)).length).toBe(1);
  }, 60000);
});
