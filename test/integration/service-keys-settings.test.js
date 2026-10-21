/**
 * Keys most people never set in an env file (web search, page reader, model
 * downloads, chain RPC) are saved in Settings → API instead. Integration: real
 * Express, the real routing router behind a real witness session and the install
 * owner gate, the real encrypted credential store (temp path), and the real
 * readers (chain registry, page reader, the image engine's env) taking the saved
 * value. RULE 0: no mocks. Proves:
 *   saved wins, the env is the fallback, and the desk says which is in use;
 *   a value of the wrong shape is refused before it is stored;
 *   the value is never echoed and never written in the clear;
 *   only the install owner can save or remove.
 */
import express from 'express';
import request from 'supertest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

const ENV_NAMES = ['ETH_RPC_URL', 'ETH_SEPOLIA_RPC_URL', 'BASE_MAINNET_RPC_URL', 'BASE_SEPOLIA_RPC_URL', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN',
  'EXA_API_KEY', 'BRAVE_SEARCH_API_KEY', 'SEARXNG_URL', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
const RPC_SECRET = 'k3y-in-the-url-0123456789';
let app; let saved; let owner; let mods;

beforeEach(async () => {
  vi.resetModules();
  saved = { creds: process.env.NEUMA_PROVIDER_CREDENTIALS_PATH };
  for (const k of ENV_NAMES) { saved[k] = process.env[k]; delete process.env[k]; }
  const dir = await createTempDir(`service-keys-${Math.random().toString(36).slice(2)}`);
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(dir, 'creds.json');
  const { strangerWitness } = await import('../helpers/witness.js');
  owner = strangerWitness();
  await makeInstallOwner(owner.address);
  mods = {
    witness: strangerWitness,
    secrets: await import('../../backend/services/stored-secrets.js'),
    chains: await import('../../backend/services/chain/chain-registry.js'),
    browserRun: await import('../../backend/services/browser-run.js'),
    comfy: await import('../../backend/services/image-forge/comfyui-supervisor.js'),
  };
  await mods.secrets.hydrateStoredSecrets();
  const { default: router } = await import('../../backend/routes/routing-routes.js');
  app = express();
  app.use(express.json());
  app.use('/api/v1/routing', router);
});

afterEach(() => {
  if (saved.creds === undefined) delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
  else process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = saved.creds;
  for (const k of ENV_NAMES) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const list = async () => (await request(app).get('/api/v1/routing/services').set(owner.header)).body.services;
const row = async (id) => (await list()).find((s) => s.id === id);

describe('Settings → API: the keys an env file used to hold', () => {
  test('listed under their headings, each naming the env setting it stands in for', async () => {
    const services = await list();
    const groups = [...new Set(services.map((s) => s.group))];
    expect(groups).toEqual(expect.arrayContaining(['Web search', 'Page reader', 'Model downloads', 'Chain RPC']));
    expect(services.find((s) => s.id === 'rpc-base')).toMatchObject({ keyEnv: 'BASE_MAINNET_RPC_URL', format: 'url', source: null, hasKey: false });
  });

  test('saved wins over the env, the desk says which is in use, removing falls back to the env', async () => {
    process.env.BASE_MAINNET_RPC_URL = 'https://env-node.example/v2/from-env';
    expect(await row('rpc-base')).toMatchObject({ source: 'env', hasKey: true });
    expect(mods.chains.chainEntry('base').rpcUrl()).toBe('https://env-node.example/v2/from-env');

    const url = `https://base-mainnet.g.alchemy.com/v2/${RPC_SECRET}`;
    const put = await request(app).put('/api/v1/routing/services/rpc-base/key').set(owner.header).send({ apiKey: url });
    expect(put.status).toBe(200);
    expect(JSON.stringify(put.body)).not.toContain(RPC_SECRET); // never echoed
    expect(put.body.service).toMatchObject({ source: 'stored', hasKey: true });
    expect(mods.chains.chainEntry('base').rpcUrl()).toBe(url); // the chain reads the saved address at once
    expect(mods.chains.isConfigured('base')).toBe(true);
    // Sealed on disk: the address (and the key inside it) is never written in the clear.
    expect(await fs.readFile(process.env.NEUMA_PROVIDER_CREDENTIALS_PATH, 'utf8')).not.toContain(RPC_SECRET);

    const del = await request(app).delete('/api/v1/routing/services/rpc-base/key').set(owner.header);
    expect(del.status).toBe(200);
    expect(del.body.service).toMatchObject({ source: 'env' });
    expect(mods.chains.chainEntry('base').rpcUrl()).toBe('https://env-node.example/v2/from-env');
  });

  test('a value of the wrong shape is refused before anything is stored', async () => {
    for (const [id, bad] of [['rpc-ethereum', 'http://node.example/v2/x'], ['rpc-ethereum', 'not a url'], ['searxng', 'ftp://search.example'],
      ['cloudflare-account', 'my account!'], ['exa', 'key with spaces'], ['exa', 'line\nbreak']]) {
      const res = await request(app).put(`/api/v1/routing/services/${id}/key`).set(owner.header).send({ apiKey: bad });
      expect(res.status, `${id} ${JSON.stringify(bad)}`).toBe(400);
    }
    expect((await row('rpc-ethereum')).source).toBeNull();
    // A node on this machine may be plain http.
    expect((await request(app).put('/api/v1/routing/services/rpc-ethereum/key').set(owner.header).send({ apiKey: 'http://127.0.0.1:8545' })).status).toBe(200);
    expect((await request(app).put('/api/v1/routing/services/nope/key').set(owner.header).send({ apiKey: 'x' })).status).toBe(404);
  });

  test('the page reader and the image engine take saved values; the engine gets the HF token and nothing else secret', async () => {
    await request(app).put('/api/v1/routing/services/cloudflare-token/key').set(owner.header).send({ apiKey: 'cf-token-abc123' });
    await request(app).put('/api/v1/routing/services/cloudflare-account/key').set(owner.header).send({ apiKey: 'a1b2c3d4e5f6' });
    expect(mods.browserRun.browserRunConfig()).toEqual({ accountId: 'a1b2c3d4e5f6', apiToken: 'cf-token-abc123' });

    await request(app).put('/api/v1/routing/services/hf-downloads/key').set(owner.header).send({ apiKey: 'hf_saved_token_123' });
    const engineEnv = mods.comfy.comfyEngineEnvironment(mods.secrets.withStoredHfToken({ ...process.env, ANTHROPIC_API_KEY: 'sk-never-to-the-engine' }));
    expect(engineEnv.HF_TOKEN).toBe('hf_saved_token_123');
    expect(engineEnv.ANTHROPIC_API_KEY).toBeUndefined();
    expect(mods.secrets.withStoredHfToken({ HF_TOKEN: 'from-env' }).HF_TOKEN).toBe('from-env'); // a developer's env token is left alone
  });

  test('only the install owner saves or removes', async () => {
    const other = mods.witness();
    expect((await request(app).put('/api/v1/routing/services/exa/key').set(other.header).send({ apiKey: 'exa-key-1' })).status).toBe(403);
    expect((await request(app).delete('/api/v1/routing/services/exa/key').set(other.header)).status).toBe(403);
    expect((await row('exa')).source).toBeNull();
  });
});
