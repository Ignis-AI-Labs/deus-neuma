/**
 * The operator WATCHES a member work (Design note, 2026-10-10: […]), on the REAL path: the team/run intent
 * with the default conduit — real askNeuma — streaming from a real local
 * OpenAI-wire server that sends a reasoning channel and words in timed
 * chunks, through the real live registry, over a real WebSocket.
 *
 * Under proof: while the member is still decoding, the live snapshot (what
 * GET /api/v1/team/live serves a late window) already holds its reasoning and
 * its words; the portal carries them as batched team_stream frames, never one
 * per token; the finished part arrives as a team_part frame with the check-in
 * stripped; the reasoning never leaks into the part.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { isThinkProbe } from '../helpers/think-probe.js';

const WALLET = '0x4444444444444444444444444444444444444444';
const MEMBER = 'stream-member';
const LEAD = 'stream-lead';
const CHUNKS = 12;
const CHUNK_MS = 80;

// A real chat-completions server: reasoning first, then the words, a chunk
// every CHUNK_MS — slow enough that the run can be read mid-decode.
const startProvider = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'stream-model' }] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      const body = raw ? JSON.parse(raw) : {};
      if (isThinkProbe(body)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ready' } }] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`);
      for (let i = 0; i < CHUNKS; i += 1) {
        send(i < CHUNKS / 2 ? { reasoning_content: `think${i} ` } : { content: `word${i} ` });
        await new Promise((r) => setTimeout(r, CHUNK_MS));
      }
      send({ content: '\nSTATUS:\nsaid my part' });
      send({}, 'stop');
      res.end('data: [DONE]\n\n');
    });
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

describe('team/run on the real conduit — the operator watches the member work', () => {
  let provider, httpServer, wss, serverWs, client, clientLog, prevRealm, saved;
  let sweepIntents, setTeamRunSeams, liveRunsFor, setRealmRoot, setWorkspacesRoot, neumaWorkspace;

  beforeAll(async () => {
    const root = await createTempDir('team-run-stream');
    saved = { ...process.env };
    process.env.WORKSPACES_ROOT = path.join(root, 'workspaces');
    process.env.NEUMA_ROUTES_PATH = path.join(root, 'routes.json');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'credentials.json');
    process.env.NEUMA_TEAM_RUN_PATH = path.join(root, 'runs');
    process.env.NEUMA_TEAM_DELIVERY_PATH = path.join(root, 'deliveries');
    process.env.NEUMA_STAFF_COS_PATH = path.join(root, 'staff-cos.json');
    const realm = await import('../../backend/services/user-realm.js');
    setRealmRoot = realm.setRealmRoot;
    prevRealm = realm.getRealmRoot();
    setRealmRoot(path.join(root, 'realm'));
    const ws = await import('../../core/workspace/neuma-workspace.js');
    setWorkspacesRoot = ws.setWorkspacesRoot;
    neumaWorkspace = ws.default;
    setWorkspacesRoot(process.env.WORKSPACES_ROOT);
    for (const id of [MEMBER, LEAD]) {
      await neumaWorkspace.create(id);
      await neumaWorkspace.writeDNA(id, { version: '1.0.0', identity: { name: id }, genesis: '# Essence\nI answer through my own conduit.' });
    }
    provider = await startProvider();
    const { setConfig } = await import('../../backend/services/llm-provider.js');
    setConfig({ provider: 'lm-studio', endpoint: `http://127.0.0.1:${provider.address().port}`, model: 'stream-model', apiKey: '' });
    ({ sweepIntents } = await import('../../backend/services/intents/intent-sweep.js'));
    ({ setTeamRunSeams } = await import('../../backend/services/intents/team-run.js'));
    ({ liveRunsFor } = await import('../../backend/services/team-run-live.js'));

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

  test('mid-decode the snapshot holds the reasoning and the words; frames are batched; the part arrives stripped', async () => {
    const connection = {
      ws: serverWs,
      companion: { name: LEAD, neumaId: LEAD },
      walletAddress: WALLET,
      _approvedPlan: Object.freeze({
        name: 'WATCHED CREW',
        goal: 'Be watched while working.',
        steps: Object.freeze([Object.freeze({ id: 'speak', neumaId: MEMBER, task: 'say your part', needs: Object.freeze([]) })]),
        memberNames: Object.freeze({ [MEMBER]: 'Speaker' }),
        approvedAt: new Date().toISOString(),
      }),
    };
    const dir = path.join(neumaWorkspace.pathFor(LEAD), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'watched-run.json'), JSON.stringify({ type: 'team/run' }));
    let settled = null;
    setTeamRunSeams({ checkSubstrate: async () => true, getCapacity: async () => ({ maxParallel: 1 }), onSettled: (p) => { settled = p; } });
    await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: () => {} });
    setTeamRunSeams(null);

    // Mid-decode: the words have begun, so the reasoning is complete and
    // some words are in — a window opening NOW would see both.
    let snapshot = null;
    for (let i = 0; i < 100 && !snapshot; i += 1) {
      const [run] = liveRunsFor(WALLET);
      if (run?.streams?.speak?.text) snapshot = run;
      else await new Promise((r) => setTimeout(r, 20));
    }
    expect(snapshot, 'the live snapshot must carry the member\'s words while it decodes').toBeTruthy();
    expect(snapshot.streams.speak.thought).toContain('think0');
    expect(snapshot.parts).toEqual({}); // not finished yet

    const outcome = await settled;
    expect(outcome.status).toBe('done');

    const streamed = clientLog.filter((m) => m.type === 'operator:team_stream' && m.stepId === 'speak');
    const thought = streamed.map((m) => m.thought || '').join('');
    const words = streamed.map((m) => m.text || '').join('');
    expect(thought).toBe(Array.from({ length: CHUNKS / 2 }, (_, i) => `think${i} `).join(''));
    expect(words).toContain('word6 ');
    expect(words).toContain(`word${CHUNKS - 1} `);
    // Batched: fewer frames than chunks the model sent.
    expect(streamed.length).toBeLessThan(CHUNKS);

    const part = clientLog.find((m) => m.type === 'operator:team_part' && m.stepId === 'speak');
    expect(part.output).toBe(Array.from({ length: CHUNKS / 2 }, (_, i) => `word${i + CHUNKS / 2}`).join(' '));
    expect(part.output).not.toContain('think');
    expect(part.output).not.toContain('STATUS');
    // The part frame lands after every stream frame for that step.
    expect(clientLog.indexOf(part)).toBeGreaterThan(clientLog.indexOf(streamed.at(-1)));
  }, 60000);
});
