/**
 * The think-behaviour probe must read the conduit the turn will ACTUALLY ride
 * (RULE 0: two real HTTP providers, real routes store, real workspace).
 *
 * askNeuma resolves the being's own route and streams through it, but used to
 * classify reasoning shape with a bare getThinkBehavior() — i.e. against the
 * MACHINE DEFAULT. When the two differ, the filter and token budget are armed
 * from a different model than the one speaking: on a thinking substrate the
 * reasoning leaks into the being's recorded words, and the budget is wrong.
 *
 * This is the same defect fixed in the witness path (2f7ef8c91). The probe is
 * identifiable on the wire: a NON-streaming completion carrying exactly one
 * user message, […].
 *
 * RED BEFORE GREEN (observed, not assumed). With the fix reverted — i.e.
 * `const thinkBehavior = await getThinkBehavior();` restored in
 * neuma-probe.js — this test fails with:
 *
 *     AssertionError: expected 'default' to be 'route'
 *
 * because the probe lands on the machine-default server. That is the exact
 * pre-fix symptom, so the test is known to exercise the defect rather than
 * merely pass alongside it (RULE 0).
 */
import http from 'http';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { isThinkProbe } from '../helpers/think-probe.js';

const NEUMA_ID = 'probe-route-being';
const ROUTE_MODEL = 'route-model';
const DEFAULT_MODEL = 'machine-default-model';

/**
 * A real OpenAI-compatible server that records every request it receives and
 * answers both the probe (JSON) and the turn (SSE).
 */
const startProvider = (label, sink) => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    // A served-model listing keeps provider plumbing honest without being
    // mistaken for a probe or a turn.
    if (req.method === 'GET') {
      sink.push({ label, probe: false, model: null, get: req.url });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: label === 'route' ? ROUTE_MODEL : DEFAULT_MODEL }] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      sink.push({ label, probe: isThinkProbe(body), model: body.model });
      if (isThinkProbe(body)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ready' } }] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `spoke via ${label}` } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

let seen;
let routeProvider;
let defaultProvider;
let askNeuma;
let savedEnv;

beforeAll(async () => {
  seen = [];
  savedEnv = {
    routes: process.env.NEUMA_ROUTES_PATH,
    ws: process.env.WORKSPACES_ROOT,
    creds: process.env.NEUMA_PROVIDER_CREDENTIALS_PATH,
  };

  const root = await createTempDir('probe-route-think');
  process.env.WORKSPACES_ROOT = path.join(root, 'workspaces');
  process.env.NEUMA_ROUTES_PATH = path.join(root, 'routes.json');
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'credentials.json');

  routeProvider = await startProvider('route', seen);
  defaultProvider = await startProvider('default', seen);
  const routePort = routeProvider.address().port;
  const defaultPort = defaultProvider.address().port;

  const { setWorkspacesRoot, default: workspace } = await import('../../core/workspace/neuma-workspace.js');
  setWorkspacesRoot(process.env.WORKSPACES_ROOT);
  await workspace.create(NEUMA_ID);
  await workspace.writeDNA(NEUMA_ID, {
    version: '1.0.0',
    identity: { name: 'Probe' },
    genesis: '# Essence\nI answer through my own conduit.',
  });

  // The MACHINE default points at one real server...
  const { setConfig } = await import('../../backend/services/llm-provider.js');
  // lm-studio: a SOVEREIGN door (custody on this machine), which the neuma
  // route store requires — binding a neuma to 'custom' is refused by law.
  setConfig({
    provider: 'lm-studio',
    endpoint: `http://127.0.0.1:${defaultPort}`,
    model: DEFAULT_MODEL,
    apiKey: '',
  });

  // ...and the being's OWN route points at a different one. The route store
  // holds provider+model; the ENDPOINT comes from the encrypted credential
  // store, so the override door is set there.
  const { setCredential } = await import('../../backend/services/provider-credentials.js');
  await setCredential('lm-studio', { endpoint: `http://127.0.0.1:${routePort}` });
  const { setRoute } = await import('../../backend/services/neuma-routes-store.js');
  await setRoute(NEUMA_ID, { provider: 'lm-studio', model: ROUTE_MODEL });

  ({ askNeuma } = await import('../../backend/services/neuma-probe.js'));
});

afterAll(async () => {
  await new Promise((r) => routeProvider.close(r));
  await new Promise((r) => defaultProvider.close(r));
  if (savedEnv.routes === undefined) delete process.env.NEUMA_ROUTES_PATH;
  else process.env.NEUMA_ROUTES_PATH = savedEnv.routes;
  if (savedEnv.ws === undefined) delete process.env.WORKSPACES_ROOT;
  else process.env.WORKSPACES_ROOT = savedEnv.ws;
  if (savedEnv.creds === undefined) delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
  else process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = savedEnv.creds;
});

describe('askNeuma think-behaviour probe (real providers, real route store)', () => {
  it('probes the being OWN route, never the machine default', async () => {
    const reply = await askNeuma(NEUMA_ID, [{ role: 'user', content: 'Speak once.' }]);

    // The turn itself went through the being's route.
    expect(reply).toBe('spoke via route');

    const probes = seen.filter((r) => r.probe);
    expect(probes.length, 'exactly one think probe should have been sent').toBe(1);

    // The whole point: the probe landed on the route's server, carrying the
    // route's model id — not the machine default's.
    expect(probes[0].label).toBe('route');
    expect(probes[0].model).toBe(ROUTE_MODEL);

    // And the machine default was never contacted at all, for any reason.
    expect(seen.some((r) => r.label === 'default')).toBe(false);
  });
});
