/**
 * The served-model truth names what the SUPERVISED server serves — never the
 * machine provider's list. Real loopback servers on ephemeral ports stand in
 * for the supervised llama-server (health + /v1/models) and for each machine
 * provider (ollama's /api/tags, an OpenAI-compatible /v1/models), so every
 * read crosses a real socket. The machine's own :8089 is never asked.
 */
import { createServer } from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { liveServedKey, expireServedTruth } from '../../backend/services/served-model-truth.js';
import { getConfig, setConfig } from '../../backend/services/llm-selection.js';
import { getSubstrateProfile } from '../../backend/services/substrate-detector.js';
import { resolveNeumaRoute } from '../../backend/services/neuma-route-resolver.js';
import { createTempDir } from '../helpers/temp-fs.js';

const SUPERVISED_MODEL = 'supervised-served-model';
const servers = [];
let previousConfig;
let previousUrl;
let previousEnv;
const ISOLATED = ['NEUMA_PROVIDER_CREDENTIALS_PATH', 'SUBSTRATE_MODEL'];

const standIn = async (routes) => {
  const server = createServer((req, res) => {
    const body = routes[req.url];
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body ?? {}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
};
const supervised = (status = 'ok') => standIn({
  '/health': { status },
  '/v1/models': { data: [{ id: SUPERVISED_MODEL }] },
});
const ollama = () => standIn({ '/api/tags': { models: [{ name: 'ollama-held-model' }] } });
const openAiCompatible = () => standIn({ '/v1/models': { data: [{ id: 'custom-endpoint-model' }] } });

beforeEach(() => {
  previousConfig = getConfig();
  previousUrl = process.env.LLAMA_SERVER_URL;
  previousEnv = Object.fromEntries(ISOLATED.map((k) => [k, process.env[k]]));
});
afterEach(async () => {
  setConfig(previousConfig);
  if (previousUrl === undefined) delete process.env.LLAMA_SERVER_URL;
  else process.env.LLAMA_SERVER_URL = previousUrl;
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.closeAllConnections(); server.close(resolve);
  })));
  expireServedTruth();
});

describe('liveServedKey reads the supervised server itself', () => {
  test('an ollama machine provider never lends its model to the supervised truth', async () => {
    const url = await supervised();
    setConfig({ provider: 'ollama', endpoint: await ollama(), model: 'ollama-held-model' });
    expect(await liveServedKey({ LLAMA_SERVER_URL: url })).toBe(SUPERVISED_MODEL);
  });

  test('a custom OpenAI-compatible machine provider never lends its model either', async () => {
    const url = await supervised();
    setConfig({ provider: 'custom', endpoint: await openAiCompatible(), model: 'custom-endpoint-model' });
    expect(await liveServedKey({ LLAMA_SERVER_URL: url })).toBe(SUPERVISED_MODEL);
  });

  test('a llama-server machine provider on the supervised endpoint reads the same server', async () => {
    const url = await supervised();
    setConfig({ provider: 'llama-server', endpoint: url, model: 'local-model' });
    expect(await liveServedKey({ LLAMA_SERVER_URL: url })).toBe(SUPERVISED_MODEL);
  });

  test('an unhealthy supervised server is no live answer, whatever the provider holds', async () => {
    const url = await supervised('loading');
    setConfig({ provider: 'ollama', endpoint: await ollama(), model: 'ollama-held-model' });
    expect(await liveServedKey({ LLAMA_SERVER_URL: url })).toBeNull();
  });
});

describe('machine-provider readers take the supervised truth only from a llama-server provider', () => {
  test('the substrate profile of an ollama machine names the ollama model, not the supervised one', async () => {
    process.env.LLAMA_SERVER_URL = await supervised();
    setConfig({ provider: 'ollama', endpoint: await ollama(), model: 'ollama-held-model' });
    const profile = await getSubstrateProfile();
    expect(profile.llm.provider).toBe('ollama');
    expect(profile.llm.model).toBe('ollama-held-model');
  });

  test('the substrate profile of a llama-server machine names what the server serves', async () => {
    const url = await supervised();
    process.env.LLAMA_SERVER_URL = url;
    setConfig({ provider: 'llama-server', endpoint: url, model: 'local-model' });
    expect((await getSubstrateProfile()).llm.model).toBe(SUPERVISED_MODEL);
  });
});

describe('the machine-default route takes the served model only from a llama-server provider', () => {
  const ollamaMachine = async () => {
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(await createTempDir('served-truth-creds'), 'creds.json');
    setConfig({ provider: 'ollama', endpoint: await ollama(), model: 'ollama-held-model' });
  };

  test('an ollama machine rides its own model while the supervised server serves another', async () => {
    process.env.LLAMA_SERVER_URL = await supervised();
    await ollamaMachine();
    const route = await resolveNeumaRoute(null, null);
    expect(route.provider).toBe('ollama');
    expect(route.model).toBe('ollama-held-model');
  });

  test('an ollama machine never inherits the supervised resting target when nothing serves', async () => {
    process.env.LLAMA_SERVER_URL = await supervised('loading');
    process.env.SUBSTRATE_MODEL = 'supervised-resting-target';
    await ollamaMachine();
    expect((await resolveNeumaRoute(null, null)).model).toBe('ollama-held-model');
  });
});
