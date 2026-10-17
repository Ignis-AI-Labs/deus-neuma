// Keyed services (Tavily web search) in the provider credential store.
// RULE 0: real disk, real AES-256-GCM (DNA_ENCRYPTION_KEY comes from
// test/setup.js), the real broker, no mocks. Proves the two halves of the
// contract: a service key round-trips through the encrypted store and the
// broker the benchmarks relay calls, and a service is invisible to every chat
// listing (catalog, lookups, providers map, route and connection validation).
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import process from 'node:process';
import { createTempDir } from '../helpers/temp-fs.js';
import { withEnv } from '../helpers/with-env.js';
import {
  PROVIDER_CATALOG, SERVICE_CATALOG, getProvider, getService, getCredentialEntry,
  localProviders, sovereignProviders, isLocalProvider, isSovereignProvider, buildProvidersMap,
} from '../../backend/services/provider-registry.js';
import {
  credentialsPath, loadCredentials, setCredential, removeCredential, providerStateFrom,
} from '../../backend/services/provider-credentials.js';
import { resolveUsableCredential } from '../../backend/services/oauth-token-broker.js';
import { normalizeRoute } from '../../backend/services/neuma-routes-store.js';

const KEY = 'tvly-test-SECRET-0123456789';
let savedPath;

beforeEach(async () => {
  savedPath = process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
  const dir = await createTempDir(`service-creds-${Math.random().toString(36).slice(2)}`);
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(dir, 'provider-credentials.json');
});

afterEach(() => {
  if (savedPath === undefined) delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
  else process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = savedPath;
});

describe('the tavily service entry', () => {
  test('is a keyed non-chat web-search service with no chat fields', () => {
    const tavily = getService('tavily');
    expect(tavily).toEqual({
      id: 'tavily', name: 'Tavily', kind: 'service', service: 'web-search',
      endpoint: 'https://api.tavily.com', keyEnv: null, requiresKey: true,
    });
    expect(Object.isFrozen(tavily)).toBe(true);
    expect(getCredentialEntry('tavily')).toBe(tavily);
    expect(getCredentialEntry('anthropic')).toBe(getProvider('anthropic'));
    expect(getCredentialEntry('nope')).toBeNull();
  });

  test('service ids never collide with a provider id', () => {
    const providerIds = new Set(PROVIDER_CATALOG.map((e) => e.id));
    for (const s of SERVICE_CATALOG) expect(providerIds.has(s.id)).toBe(false);
  });
});

describe('store + broker round trip', () => {
  test('setCredential persists the key sealed on disk, and the broker returns it', async () => {
    await setCredential('tavily', { apiKey: KEY });

    const onDisk = await fs.readFile(credentialsPath(), 'utf8');
    expect(onDisk).not.toContain(KEY);
    expect((await loadCredentials()).tavily).toEqual({ apiKey: KEY });

    expect(await resolveUsableCredential('tavily'))
      .toEqual({ apiKey: KEY, endpoint: 'https://api.tavily.com' });
  });

  test('a replaced key wins; a removed key resolves empty', async () => {
    await setCredential('tavily', { apiKey: KEY });
    await setCredential('tavily', { apiKey: `${KEY}-2` });
    expect((await resolveUsableCredential('tavily')).apiKey).toBe(`${KEY}-2`);

    expect(await removeCredential('tavily')).toBe(true);
    expect(await resolveUsableCredential('tavily'))
      .toEqual({ apiKey: '', endpoint: 'https://api.tavily.com' });
  });

  test('the store is the only home: TAVILY_API_KEY in the env is never a fallback', async () => {
    await withEnv('TAVILY_API_KEY', 'tvly-from-env', async () => {
      expect((await resolveUsableCredential('tavily')).apiKey).toBe('');
      await setCredential('tavily', { apiKey: KEY });
      expect((await resolveUsableCredential('tavily')).apiKey).toBe(KEY);
    });
  });

  test('an unknown id is still refused before anything is written', async () => {
    await expect(setCredential('tavily-typo', { apiKey: KEY })).rejects.toThrow(/Unknown provider/);
    await expect(fs.access(credentialsPath())).rejects.toThrow();
  });
});

describe('a service never surfaces as a chat provider', () => {
  test('absent from the catalog, every chat lookup and every catalog subset', () => {
    expect(PROVIDER_CATALOG.some((e) => e.id === 'tavily' || e.kind === 'service')).toBe(false);
    expect(getProvider('tavily')).toBeNull();
    expect(isLocalProvider('tavily')).toBe(false);
    expect(isSovereignProvider('tavily')).toBe(false);
    expect(localProviders().some((e) => e.id === 'tavily')).toBe(false);
    expect(sovereignProviders().some((e) => e.id === 'tavily')).toBe(false);
  });

  test('absent from the providers map the route resolvers build, even with its key stored', async () => {
    await setCredential('tavily', { apiKey: KEY });
    const map = buildProvidersMap(providerStateFrom(await loadCredentials()));
    expect(map.tavily).toBeUndefined();
    expect(Object.keys(map)).toHaveLength(PROVIDER_CATALOG.length);
  });

  test('a route naming it is refused at the route store (neuma and witness lanes alike)', () => {
    expect(() => normalizeRoute({ provider: 'tavily', model: 'search' })).toThrow(/Unknown provider: tavily/);
  });
});
