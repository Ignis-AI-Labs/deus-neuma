// Provider credentials store — the operator's LLM API keys, encrypted at rest.
// RULE 0: real disk, real AES-256-GCM (DNA_ENCRYPTION_KEY comes from
// test/setup.js), no mocks. We assert the key is a sealed envelope on disk,
// round-trips through decrypt, resolves with the store>env>catalog precedence,
// and feeds the registry's configured-provider map.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { encryptEnvelope, deriveKeyFromSecret } from '../../core/workspace/workspace-crypto.js';
import { buildProvidersMap, getProvider, PROVIDER_CATALOG } from '../../backend/services/provider-registry.js';
import {
  credentialsPath, loadCredentials, setCredential, removeCredential,
  mergeCredential, computeCredentialState, maskCredential, resolveCredential, providerStateFrom,
} from '../../backend/services/provider-credentials.js';

// Every provider's key env var — cleared so a developer's own env can't leak
// into buildProvidersMap(...).configured and make a test flakily pass.
const ENV_KEYS = [...new Set(PROVIDER_CATALOG.map((e) => e.keyEnv).filter(Boolean))];
let savedEnv;

beforeEach(async () => {
  savedEnv = { PATH_OVR: process.env.NEUMA_PROVIDER_CREDENTIALS_PATH };
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  const dir = await createTempDir(`provider-creds-${Math.random().toString(36).slice(2)}`);
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(dir, 'provider-credentials.json');
});

afterEach(() => {
  if (savedEnv.PATH_OVR === undefined) delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
  else process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = savedEnv.PATH_OVR;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe('mergeCredential (pure)', () => {
  test('adds a key + endpoint', () => {
    expect(mergeCredential(undefined, { apiKey: 'sk-1', endpoint: 'https://x' }))
      .toEqual({ apiKey: 'sk-1', endpoint: 'https://x' });
  });
  test('an empty-string apiKey clears a stored key', () => {
    expect(mergeCredential({ apiKey: 'sk-1', endpoint: 'https://x' }, { apiKey: '' }))
      .toEqual({ endpoint: 'https://x' });
  });
  test('an entry that ends up empty collapses to null (drop it)', () => {
    expect(mergeCredential({ apiKey: 'sk-1' }, { apiKey: '' })).toBeNull();
  });
});

describe('computeCredentialState (pure)', () => {
  test('key present from store OR env; endpoint prefers store over catalog default', () => {
    const anthropic = getProvider('anthropic');
    expect(computeCredentialState(anthropic, { apiKey: 'sk-ant' }, undefined))
      .toEqual({ keyPresent: true, endpoint: 'https://api.anthropic.com' });
    expect(computeCredentialState(anthropic, undefined, 'env-key'))
      .toEqual({ keyPresent: true, endpoint: 'https://api.anthropic.com' });
    expect(computeCredentialState(anthropic, undefined, undefined))
      .toEqual({ keyPresent: false, endpoint: 'https://api.anthropic.com' });
    expect(computeCredentialState(getProvider('custom'), { endpoint: 'https://api.z.ai/api/paas/v4' }, undefined))
      .toEqual({ keyPresent: false, endpoint: 'https://api.z.ai/api/paas/v4' });
  });
});

describe('maskCredential (pure)', () => {
  test('never exposes the raw key', () => {
    const m = maskCredential(getProvider('anthropic'), { keyPresent: true, endpoint: 'https://api.anthropic.com' });
    expect(m).toEqual({
      id: 'anthropic', name: 'Anthropic', kind: 'cloud', sovereign: false, requiresKey: true,
      // Static catalog fact, not a secret: whether this door accepts a raw API
      // key at all. OAuth-only providers (openai-chatgpt) carry false so the
      // desk never offers a key field that could not work.
      allowsApiKey: true,
      endpoint: 'https://api.anthropic.com', hasKey: true, keyMasked: '***',
      credentialKind: 'key', account: null, oauth: [],
    });
  });

  test('an oauth credential masks to its kind + account, never the token', () => {
    const m = maskCredential(
      getProvider('xai'),
      { keyPresent: true, endpoint: 'https://api.x.ai' },
      { type: 'oauth', access: 'SECRET-TOKEN', refresh: 'SECRET-REFRESH', expiresAt: 1, account: 'xai' },
    );
    expect(m).toMatchObject({ credentialKind: 'oauth', account: 'xai', oauth: ['browser', 'device'] });
    expect(JSON.stringify(m)).not.toContain('SECRET');
  });
});

describe('persistence (real disk + real encryption)', () => {
  test('a stored key is a sealed envelope on disk, unreadable, and round-trips', async () => {
    await setCredential('anthropic', { apiKey: 'sk-ant-SECRET-123' });

    const raw = await fs.readFile(credentialsPath(), 'utf8');
    expect(JSON.parse(raw)._enc).toBe(1);            // envelope, not plaintext
    expect(raw).not.toContain('sk-ant-SECRET-123');  // key not readable on disk
    expect(raw).not.toContain('anthropic');

    const store = await loadCredentials();
    expect(store.anthropic.apiKey).toBe('sk-ant-SECRET-123');
  });

  test('the store file is written 0600', async () => {
    await setCredential('openai', { apiKey: 'sk-openai' });
    const st = await fs.stat(credentialsPath());
    expect(st.mode & 0o777).toBe(0o600);
  });

  test('0600 is enforced even on a pre-existing loose-perms file (backup/copy-in)', async () => {
    await setCredential('openai', { apiKey: 'sk-x' });          // real store, created 0600
    await fs.chmod(credentialsPath(), 0o644);                    // simulate a copy-in / restore loosening perms
    expect((await fs.stat(credentialsPath())).mode & 0o777).toBe(0o644);
    await setCredential('anthropic', { apiKey: 'sk-test' });     // next save must re-tighten
    expect((await fs.stat(credentialsPath())).mode & 0o777).toBe(0o600);
  });

  test('0700 is enforced on a pre-existing loose settings dir', async () => {
    const dir = path.dirname(credentialsPath());
    await fs.mkdir(dir, { recursive: true });
    await fs.chmod(dir, 0o755);
    await setCredential('openai', { apiKey: 'sk-x' });
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
  });

  test('a store that decrypts to a non-object is surfaced, not swallowed as {}', async () => {
    // A valid envelope (default test key) wrapping a string — decrypts fine but
    // is not a credentials object. Swallowing it would wipe keys on next save.
    const badEnvelope = encryptEnvelope('not-a-store-object');
    await fs.mkdir(path.dirname(credentialsPath()), { recursive: true });
    await fs.writeFile(credentialsPath(), JSON.stringify(badEnvelope));
    await expect(loadCredentials()).rejects.toThrow(/not an object/);
  });

  test('loadCredentials on a missing file is empty, not an error', async () => {
    expect(await loadCredentials()).toEqual({});
  });

  test('a store sealed under a DIFFERENT master key surfaces an error (never silently wiped)', async () => {
    const wrongEnvelope = encryptEnvelope({ anthropic: { apiKey: 'sk' } }, { key: deriveKeyFromSecret('a-different-master') });
    await fs.mkdir(path.dirname(credentialsPath()), { recursive: true });
    await fs.writeFile(credentialsPath(), JSON.stringify(wrongEnvelope));
    await expect(loadCredentials()).rejects.toThrow();
  });

  test('removeCredential deletes the entry', async () => {
    await setCredential('openai', { apiKey: 'sk-openai' });
    expect(await removeCredential('openai')).toBe(true);
    expect(await loadCredentials()).toEqual({});
    expect(await removeCredential('openai')).toBe(false); // idempotent
  });

  test('setCredential rejects an unknown provider', async () => {
    await expect(setCredential('not-a-provider', { apiKey: 'x' })).rejects.toThrow(/Unknown provider/);
  });

  test('concurrent key writes for different providers all persist (no TOCTOU loss)', async () => {
    await Promise.all([
      setCredential('anthropic', { apiKey: 'sk-ant' }),
      setCredential('openai', { apiKey: 'sk-oai' }),
      setCredential('z-ai', { apiKey: 'sk-zai' }),
    ]);
    const store = await loadCredentials();
    expect(store.anthropic.apiKey).toBe('sk-ant');
    expect(store.openai.apiKey).toBe('sk-oai');
    expect(store['z-ai'].apiKey).toBe('sk-zai');
  });
});

describe('resolveCredential (store > env > catalog)', () => {
  test('the stored key wins over an env var', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key';
    await setCredential('anthropic', { apiKey: 'store-key' });
    expect(await resolveCredential('anthropic')).toEqual({ apiKey: 'store-key', endpoint: 'https://api.anthropic.com' });
  });
  test('falls back to the env var when nothing is stored', async () => {
    process.env.OPENAI_API_KEY = 'env-openai';
    expect(await resolveCredential('openai')).toEqual({ apiKey: 'env-openai', endpoint: 'https://api.openai.com' });
  });
  test('a custom endpoint overrides the (null) catalog endpoint', async () => {
    await setCredential('custom', { apiKey: 'k', endpoint: 'https://my-llm.example/v1' });
    expect(await resolveCredential('custom')).toEqual({ apiKey: 'k', endpoint: 'https://my-llm.example/v1' });
  });
});

describe('providerStateFrom → buildProvidersMap (end to end)', () => {
  test('a stored key makes a cloud provider configured in the resolver map', async () => {
    await setCredential('anthropic', { apiKey: 'sk-ant' });
    await setCredential('custom', { endpoint: 'https://my-llm.example/v1' });
    const store = await loadCredentials();
    const map = buildProvidersMap(providerStateFrom(store));
    expect(map.anthropic.configured).toBe(true);
    expect(map.openai.configured).toBe(false);           // no key
    expect(map.ollama.configured).toBe(true);            // keyless local
    expect(map.custom).toEqual({ kind: 'cloud', endpoint: 'https://my-llm.example/v1', configured: true });
  });
  test('an env-only key also counts as configured', async () => {
    process.env.OPENAI_API_KEY = 'env-openai';
    const map = buildProvidersMap(providerStateFrom(await loadCredentials()));
    expect(map.openai.configured).toBe(true);
  });
});
