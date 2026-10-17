import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The credential store is REAL and ENCRYPTED, and on a dev box it holds the
// operator's own provider keys. Point it at a private file BEFORE the module
// loads (the path is resolved at import) so this test writes its own store and
// can never read, rewrite, or corrupt Founder's. The store itself stays real —
// real AES envelope, real disk — only its location is ours.
const CRED_DIR = mkdtempSync(path.join(os.tmpdir(), 'neuma-cred-'));
process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(CRED_DIR, 'provider-credentials.json');

const { probeUrl, probeProviders, parseOllamaTags, parseLmStudioModels } =
  await import('../../backend/services/substrate-setup.js');
const { setCredential, removeCredential } =
  await import('../../backend/services/provider-credentials.js');

/**
 * A LOCAL PROVIDER ON A PORT WE DID NOT PICK (RULE 0).
 *
 * Reported from the community 2026-08-02:
 *   […]
 *
 * The option DID exist — Settings → Models stores an endpoint per provider, and
 * every inference path already resolves it through resolveUsableCredential.
 * probeProviders() was the one place still hardcoding localhost:11434 and
 * localhost:1234, so the first-run flight check reported "not running" no
 * matter what the operator configured. The app contradicted its own settings.
 *
 * Nothing here is mocked. A REAL http server speaks the real Ollama /api/tags
 * shape on a REAL non-default port, the endpoint goes through the REAL
 * credential store, and probeProviders makes a REAL request to find it.
 */
describe('a local provider on a non-default port', () => {
  let server;
  let port;
  let hits = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(req.url);
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'gemma-4-31b' }, { name: 'qwen3.5' }] }));
        return;
      }
      res.writeHead(404); res.end('{}');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });

  afterAll(async () => {
    await removeCredential('ollama').catch(() => {});
    await new Promise((r) => server.close(r));
    rmSync(CRED_DIR, { recursive: true, force: true });
  });

  test('REPRODUCES the report: with no endpoint set, the default port is probed and finds nothing', async () => {
    await removeCredential('ollama').catch(() => {});
    hits = [];
    const providers = await probeProviders();

    // 11434 is almost certainly empty on this box — the point is WHICH address
    // was tried, which the result now states.
    expect(providers.ollama.endpoint).toBe('http://localhost:11434');
    // Our real server on the other port was never contacted.
    expect(hits).toEqual([]);
  });

  test('THE FIX: the operator\'s endpoint is what gets probed, and the models are found', async () => {
    await setCredential('ollama', { endpoint: `http://127.0.0.1:${port}` });
    hits = [];

    const providers = await probeProviders();

    expect(providers.ollama.endpoint).toBe(`http://127.0.0.1:${port}`);
    expect(providers.ollama.running).toBe(true);
    expect(providers.ollama.models).toEqual(['gemma-4-31b', 'qwen3.5']);
    // Proof it really reached OUR server rather than answering from anywhere else.
    expect(hits).toContain('/api/tags');
  });

  test('the probe reports the address it tried, so "not running" is actionable', async () => {
    // A port nothing listens on: the operator must still learn WHERE we looked.
    await setCredential('ollama', { endpoint: 'http://127.0.0.1:1' });
    const providers = await probeProviders();

    expect(providers.ollama.running).toBe(false);
    expect(providers.ollama.endpoint).toBe('http://127.0.0.1:1');
  });
});

describe('probeUrl (pure)', () => {
  test('joins a bare base', () => {
    expect(probeUrl('http://localhost:11434', '/api/tags')).toBe('http://localhost:11434/api/tags');
  });

  test('a trailing slash does not produce a double slash', () => {
    expect(probeUrl('http://localhost:11434/', '/api/tags')).toBe('http://localhost:11434/api/tags');
    expect(probeUrl('http://localhost:11434///', '/api/tags')).toBe('http://localhost:11434/api/tags');
  });

  test('a custom host and path prefix survive intact', () => {
    expect(probeUrl('http://192.168.1.50:11500', '/api/tags')).toBe('http://192.168.1.50:11500/api/tags');
  });

  test('empty input does not throw', () => {
    expect(probeUrl('', '/api/tags')).toBe('/api/tags');
    expect(probeUrl(undefined, '/v1/models')).toBe('/v1/models');
  });
});

describe('provider payload parsers (pure)', () => {
  test('ollama /api/tags → names', () => {
    expect(parseOllamaTags({ models: [{ name: 'a' }, { name: 'b' }] })).toEqual(['a', 'b']);
  });

  test('lm studio /v1/models → ids', () => {
    expect(parseLmStudioModels({ data: [{ id: 'x' }] })).toEqual(['x']);
  });

  test('junk payloads are empty lists, never throws', () => {
    for (const bad of [null, undefined, {}, { models: 'nope' }, { data: 5 }]) {
      expect(parseOllamaTags(bad)).toEqual([]);
      expect(parseLmStudioModels(bad)).toEqual([]);
    }
  });
});
