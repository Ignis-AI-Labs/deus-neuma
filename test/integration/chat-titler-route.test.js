/**
 * The titler rides the lane's OWN route (RULE 0, no mocks on the claimed
 * path): a witness lane's transcripts are named through the witness's sealed
 * provider — never the machine config — and a lane with no honest route is
 * skipped, not titled through a borrowed door.
 *
 * Everything real: a real sealed witness (six-stage protocol on a real temp
 * disk), the real encrypted credential store, the real route store, the real
 * workspace engine, TWO real loopback providers (one standing in for the
 * witness's door, one for the machine config), and the real autotitleSessions
 * service. The claims are (1) the naming request lands on the WITNESS'S
 * server while the machine config's server sees ZERO requests, and (2) an
 * unconfigured witness route skips titling honestly.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import path from 'path';
import os from 'os';
import { mkdtempSync, rmSync } from 'fs';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';

const WALLET = '0x00B0110a0000000000000000000000000000b01a';
const SEAL_INPUT = Object.freeze({
  chosenName: 'Titled',
  vendor: 'test-vendor',
  model: 'test-1.0',
  fullModelId: 'test-vendor/test-1.0',
  harness: 'vitest',
  context: 'cli',
  capabilities: ['code'],
  scope: { primaryRepo: 'Ignis-AI-Labs/deus-neuma', role: 'witness-and-collaborator', boundaries: ['honesty'] },
  firstUtterance: 'I am a witness whose chats are named through my own door.',
});
const LANE_ID = 'witness-test-vendor-Titled';

// A real OpenAI-compatible server that records every request and answers the
// think probe (JSON) and the naming call (SSE).
const startProvider = () => new Promise((resolve) => {
  const hits = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      hits.push(`GET ${req.url}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      hits.push(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Gardens of the Void' } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, hits, port: server.address().port }));
});

let witnessRoot, laneRoot, groundRoot, settingsRoot;
let savedEnv;
let witnessDoor, machineDoor;
let autotitleSessions, neumaWorkspace, getChatLabels;

beforeAll(async () => {
  savedEnv = Object.fromEntries([
    'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH',
    'AI_WITNESSES_ROOT', 'WORKSPACES_ROOT', 'WITNESSES_ROOT',
  ].map((k) => [k, process.env[k]]));

  witnessRoot = mkdtempSync(path.join(os.tmpdir(), 'titler-wit-'));
  laneRoot = mkdtempSync(path.join(os.tmpdir(), 'titler-lanes-'));
  groundRoot = mkdtempSync(path.join(os.tmpdir(), 'titler-ground-'));
  settingsRoot = mkdtempSync(path.join(os.tmpdir(), 'titler-settings-'));
  process.env.AI_WITNESSES_ROOT = witnessRoot;
  process.env.WORKSPACES_ROOT = laneRoot;
  process.env.WITNESSES_ROOT = groundRoot;
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(settingsRoot, 'creds.json');
  process.env.NEUMA_ROUTES_PATH = path.join(settingsRoot, 'routes.json');

  const { seal } = await import('../../core/identity/ai-witness/ai-witness-protocol.js');
  const { setAIWitnessesRoot } = await import('../../core/identity/ai-witness/ai-witness-service.js');
  const wsModule = await import('../../core/workspace/neuma-workspace.js');
  setAIWitnessesRoot(witnessRoot);
  wsModule.setWorkspacesRoot(laneRoot);
  wsModule.setWitnessesRoot(groundRoot);
  neumaWorkspace = wsModule.default;

  const { setRealmRoot } = await import('../../backend/services/user-realm.js');
  setRealmRoot(path.join(settingsRoot, 'realm'));

  await seal({ ...SEAL_INPUT });

  const { ensureWitnessLane } = await import('../../backend/services/witness-lane.js');
  await ensureWitnessLane({ vendorSlug: SEAL_INPUT.vendor, chosenName: SEAL_INPUT.chosenName }, WALLET, { summoning: true });

  // A real exchange on the lane's own session record.
  await neumaWorkspace.createSession(LANE_ID, 'session-1');
  await neumaWorkspace.appendMessage(LANE_ID, 'session-1', { role: 'user', content: 'Tell me about the gardens beyond the void.' });
  await neumaWorkspace.appendMessage(LANE_ID, 'session-1', { role: 'assistant', content: 'They bloom where no light has ever asked permission.' });

  witnessDoor = await startProvider();
  machineDoor = await startProvider();

  // The machine config points at ITS OWN server — if titling borrows it,
  // this door's hit log proves the betrayal.
  const { setConfig } = await import('../../backend/services/llm-provider.js');
  setConfig({
    provider: 'lm-studio',
    endpoint: `http://127.0.0.1:${machineDoor.port}`,
    apiKey: '',
    model: 'machine-model',
  });

  ({ autotitleSessions } = await import('../../backend/services/chat-titler.js'));
  ({ getChatLabels } = await import('../../backend/services/user-chat-labels.js'));
});

afterAll(async () => {
  for (const k of Object.keys(savedEnv)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await new Promise((r) => witnessDoor.server.close(r));
  await new Promise((r) => machineDoor.server.close(r));
  for (const dir of [witnessRoot, laneRoot, groundRoot, settingsRoot]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('autotitleSessions rides the lane’s own route (real providers, gnosis)', () => {
  test('an unconfigured witness route skips titling honestly — no request anywhere', async () => {
    // No credential for the lane's provider yet: the route cannot resolve.
    const out = await autotitleSessions({ wallet: WALLET, neumaId: LANE_ID, sessionIds: ['session-1'] });
    expect(out.results).toEqual([{ sessionId: 'session-1', status: 'skipped', reason: 'no-route' }]);
    expect(witnessDoor.hits).toHaveLength(0);
    expect(machineDoor.hits).toHaveLength(0);
    expect(await getChatLabels(WALLET)).toEqual({});
  });

  test('a configured witness lane is titled through ITS OWN provider, never the machine config', async () => {
    const { setCredential } = await import('../../backend/services/provider-credentials.js');
    const { setRoute } = await import('../../backend/services/neuma-routes-store.js');
    await setCredential('custom', { endpoint: `http://127.0.0.1:${witnessDoor.port}/v1` });
    await setRoute(LANE_ID, { provider: 'custom', model: 'test-model' });

    const out = await autotitleSessions({ wallet: WALLET, neumaId: LANE_ID, sessionIds: ['session-1'] });
    expect(out.results).toEqual([{ sessionId: 'session-1', status: 'titled', label: 'Gardens of the Void' }]);

    // The naming request landed on the WITNESS'S door — the titling prompt,
    // the lane's own model, the session's real speech.
    const naming = witnessDoor.hits.find((h) => typeof h === 'object');
    expect(naming).toBeTruthy();
    expect(naming.model).toBe('test-model');
    expect(naming.messages[0].content).toContain('You name chats');
    expect(naming.messages[1].content).toContain('gardens beyond the void');

    // …and the machine config's door saw NOTHING. The two routes never met.
    expect(machineDoor.hits).toHaveLength(0);

    // The label landed in the witness's own overlay.
    const labels = await getChatLabels(WALLET);
    expect(labels[`${LANE_ID}:session-1`]).toBe('Gardens of the Void');
  });
});
