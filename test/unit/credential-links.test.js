/**
 * CREDENTIAL LINKS (credential-links.js + the desk's linksFor) — every key the
 * platform can ask for has a page that makes it. Judged against the REAL
 * registries: the provider catalog, the keyed services, the posting channels.
 * Whether each page answers is checked by hand at the time a link is added
 * (2026-10-20); a unit test does not depend on the network.
 */
import { describe, expect, test } from 'vitest';
import { CREDENTIAL_LINKS, credentialLinksPayload, providerKeyLink } from '../../backend/services/credential-links.js';
import { PROVIDER_CATALOG, SERVICE_CATALOG } from '../../backend/services/provider-registry.js';
import { CHANNEL_CATALOG } from '../../backend/services/social/channel-registry.js';
import { linksFor } from '../../frontend/services/credential-links.js';

// Providers with no page that answered when links were checked (crof.ai: 502).
const NO_KNOWN_PAGE = new Set(['crof']);
const providers = Array.isArray(PROVIDER_CATALOG) ? PROVIDER_CATALOG : Object.values(PROVIDER_CATALOG);

describe('coverage — every credential the platform asks for', () => {
  test('every cloud provider that needs a key has a link', () => {
    const missing = providers.filter((p) => p.requiresKey && p.kind !== 'local' && !NO_KNOWN_PAGE.has(p.id) && !providerKeyLink(p.id));
    expect(missing.map((p) => p.id)).toEqual([]);
  });

  test('every keyed service and every posting channel has a link', () => {
    for (const s of SERVICE_CATALOG) expect(CREDENTIAL_LINKS.service[s.id], s.id).toBeTruthy();
    for (const c of CHANNEL_CATALOG) expect(CREDENTIAL_LINKS.channel[c.id], c.id).toBeTruthy();
  });

  test('the env-only families are covered: chain RPC, web search, page reading, downloads, git, voice, research', () => {
    expect(CREDENTIAL_LINKS.chain.rpc.length).toBeGreaterThanOrEqual(3);
    for (const id of ['exa', 'brave', 'searxng', 'cloudflare']) expect(CREDENTIAL_LINKS.web[id], id).toBeTruthy();
    expect(CREDENTIAL_LINKS.downloads.huggingface).toBeTruthy();
    expect(CREDENTIAL_LINKS.git.github).toBeTruthy();
    for (const id of ['cartesia', 'elevenlabs', 'hume']) expect(CREDENTIAL_LINKS.voice[id], id).toBeTruthy();
    for (const id of ['courtlistener', 'api-data-gov', 'openstates']) expect(CREDENTIAL_LINKS.research[id], id).toBeTruthy();
  });
});

describe('the links themselves', () => {
  test('every link is https with a label — the desk renders nothing else', () => {
    const all = Object.values(credentialLinksPayload()).flatMap((family) => Object.values(family)).flatMap((l) => (Array.isArray(l) ? l : [l]));
    expect(all.length).toBeGreaterThan(150);
    for (const l of all) {
      expect(l.url).toMatch(/^https:\/\//);
      expect(l.label.length).toBeGreaterThan(0);
    }
  });

  test('a provider\'s own key page wins over its docs link', () => {
    expect(providerKeyLink('cerebras').url).toBe('https://cloud.cerebras.ai/');
    expect(providerKeyLink('302ai').url).toMatch(/^https:\/\//);
    expect(providerKeyLink('no-such-provider')).toBeNull();
  });
});

describe('linksFor — the desk\'s read of the map', () => {
  const map = credentialLinksPayload();
  test('a provider, a channel, and a family with several choices', () => {
    expect(linksFor(map, { provider: 'openai' })[0].url).toBe('https://platform.openai.com/api-keys');
    expect(linksFor(map, { family: 'channel', id: 'bluesky' })[0].url).toBe('https://bsky.app/settings/app-passwords');
    expect(linksFor(map, { family: 'chain', id: 'rpc' }).length).toBe(CREDENTIAL_LINKS.chain.rpc.length);
  });
  test('no map yet, or an unknown credential: nothing, never a broken link', () => {
    expect(linksFor(null, { provider: 'openai' })).toEqual([]);
    expect(linksFor(map, { family: 'channel', id: 'myspace' })).toEqual([]);
    expect(linksFor({ providers: { evil: { url: 'javascript:alert(1)', label: 'x' } } }, { provider: 'evil' })).toEqual([]);
  });
});
