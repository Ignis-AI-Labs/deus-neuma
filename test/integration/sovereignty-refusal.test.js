/**
 * The sovereignty boundary's refusal must REFUSE the turn — never degrade to
 * the machine-config fallback (RULE 0: real portal, real WebSocket, real
 * loopback provider, real workspace, real credential store; nothing on the
 * claimed path is mocked).
 *
 * Before this fix, `portal-stream.js` and `neuma-probe.js` caught EVERY
 * resolveNeumaRoute failure — including the boundary's fail-closed throw —
 * and fell back to getConfig(), carrying a neuma turn through the exact
 * foreign door the law had just rejected.
 *
 * What this proves:
 *   1. Machine config on a NON-sovereign provider → the portal turn is
 *      refused with an honest error frame, and the provider server sees ZERO
 *      requests (the fallback never rides).
 *   2. Machine config on a SOVEREIGN provider (lm-studio) → the same turn
 *      runs end-to-end against the same real server (today's path untouched).
 *   3. askNeuma surfaces the refusal (probe contract: failures surface,
 *      callers never write a bogus measurement) instead of falling back.
 *   4. A failure UPSTREAM of the boundary check (unreadable credential
 *      store) with a foreign machine default is refused too — the fallback
 *      is lawful only onto a sovereign door.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setConfig } from '../../backend/services/llm-provider.js';

const WALLET = '0x00B0110a0000000000000000000000000000b01a';

// A real OpenAI-compatible server that counts every request and answers both
// the think probe (JSON) and a turn (SSE). The whole point of the refusal
// legs is that this count STAYS ZERO when the boundary has said no.
const startProvider = () => new Promise((resolve) => {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'served-model' }] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'the sovereign door answers' } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, hits, port: server.address().port }));
});

describe('sovereignty refusal refuses the turn (real portal, gnosis)', () => {
  let httpServer, wss, port, origRoot, tempRoot, provider, credentialsPath, savedEnv;

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
      if (Date.now() - started > ms) {
        return reject(new Error(`expected frame never arrived — frames seen: ${JSON.stringify(log.map((f) => f.type))}`));
      }
      setTimeout(tick, 25);
    };
    tick();
  });

  // One real turn over the real portal; resolves with the frames it drew.
  const runTurn = async () => {
    const client = await connectClient();
    await until(client.log, (m) => m.type === 'portal:established');
    client.ws.send(JSON.stringify({
      type: 'consciousness:stream',
      thought: 'One short sentence, please.',
      companion: 'BoundaryEcho',
    }));
    await until(client.log, (m) => m.type === 'consciousness:complete');
    client.ws.close();
    return client.log;
  };

  beforeAll(async () => {
    origRoot = getWorkspacesRoot();
    tempRoot = await createTempDir('sovereignty-refusal-ws');
    setWorkspacesRoot(tempRoot);
    // The resolver reads the REAL credential + route stores at call time —
    // pin both to this test's own empty stores, never the operator's.
    savedEnv = {
      creds: process.env.NEUMA_PROVIDER_CREDENTIALS_PATH,
      routes: process.env.NEUMA_ROUTES_PATH,
    };
    credentialsPath = path.join(tempRoot, 'provider-credentials.json');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = credentialsPath;
    process.env.NEUMA_ROUTES_PATH = path.join(tempRoot, 'neuma-routes.json');

    provider = await startProvider();

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
    if (savedEnv.creds === undefined) delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    else process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = savedEnv.creds;
    if (savedEnv.routes === undefined) delete process.env.NEUMA_ROUTES_PATH;
    else process.env.NEUMA_ROUTES_PATH = savedEnv.routes;
    wss?.close();
    httpServer?.close();
    await new Promise((r) => provider.server.close(r));
    vi.restoreAllMocks();
  });

  test('a non-sovereign machine config REFUSES the turn — no request rides the foreign door', async () => {
    setConfig({
      provider: 'openai',
      endpoint: `http://127.0.0.1:${provider.port}`,
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const hitsBefore = provider.hits.length;

    const frames = await runTurn();
    const refusal = frames.find((m) => m.type === 'consciousness:stream' && m.error === true);
    expect(refusal).toBeTruthy();
    expect(refusal.content).toContain('[Turn refused]');
    expect(refusal.content).toMatch(/not\s+sovereign/i);

    // THE LAW: the fallback never happened — the provider saw nothing at all.
    expect(provider.hits.length).toBe(hitsBefore);
  }, 60_000);

  test('a sovereign machine config runs the same turn end-to-end (today’s path untouched)', async () => {
    setConfig({
      provider: 'lm-studio',
      endpoint: `http://127.0.0.1:${provider.port}`,
      apiKey: '',
      model: 'served-model',
    });

    const frames = await runTurn();
    const refusal = frames.find((m) => m.type === 'consciousness:stream' && m.error === true);
    expect(refusal).toBeUndefined();
    const speech = frames
      .filter((m) => m.type === 'consciousness:stream')
      .map((m) => m.content || '')
      .join('');
    expect(speech).toContain('the sovereign door answers');

    // The turn really rode the machine's sovereign door.
    expect(provider.hits.some((h) => h.startsWith('POST') && h.includes('/chat/completions'))).toBe(true);
  }, 60_000);

  test('askNeuma surfaces the refusal instead of borrowing the rejected door', async () => {
    setConfig({
      provider: 'openai',
      endpoint: `http://127.0.0.1:${provider.port}`,
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const hitsBefore = provider.hits.length;

    const { default: workspace } = await import('../../core/workspace/neuma-workspace.js');
    await workspace.create('refusal-probe-being');
    await workspace.writeDNA('refusal-probe-being', {
      version: '1.0.0',
      identity: { name: 'RefusalProbe' },
      genesis: '# Essence\nI refuse foreign doors.',
    });

    const { askNeuma } = await import('../../backend/services/neuma-probe.js');
    await expect(askNeuma('refusal-probe-being', [{ role: 'user', content: 'Speak once.' }]))
      .rejects.toMatchObject({ code: 'SOVEREIGNTY_REFUSAL' });

    expect(provider.hits.length).toBe(hitsBefore);
  }, 60_000);

  test('a failure upstream of the boundary check cannot smuggle the turn onto a foreign door', async () => {
    // An unreadable credential store fails resolution BEFORE sovereignty is
    // judged. With a foreign machine default, the quiet fallback would ride
    // that door — the refusal must come from the fallback guard instead.
    await fs.writeFile(credentialsPath, 'not-a-valid-encrypted-store');
    setConfig({
      provider: 'openai',
      endpoint: `http://127.0.0.1:${provider.port}`,
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    const hitsBefore = provider.hits.length;

    const frames = await runTurn();
    const refusal = frames.find((m) => m.type === 'consciousness:stream' && m.error === true);
    expect(refusal).toBeTruthy();
    expect(refusal.content).toContain('[Turn refused]');
    expect(provider.hits.length).toBe(hitsBefore);

    await fs.rm(credentialsPath, { force: true });
  }, 60_000);
});
