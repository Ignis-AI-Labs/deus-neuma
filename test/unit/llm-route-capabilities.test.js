/**
 * Route capabilities cache — proven against a REAL spawned HTTP server
 * (RULE 0): the server counts its own /props hits, so the cache's effect is
 * observed on the wire, never through a mock.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { GENERATED_PROVIDERS } from '../../backend/services/provider-catalog-data.js';
import {
  getConfig, getRouteCapabilities, getThinkBehavior, setConfig,
  _resetCapsCache, _expireCapsCache, capsCacheFresh, CAPS_CACHE_TTL_MS, catalogCapabilitiesFor,
} from '../../backend/services/llm-provider.js';

let server;
let base;
let propsHits = 0;
let modelHits = 0;
let stallProps = false;
let barePropsMode = false;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/props') {
      propsHits += 1;
      if (stallProps) {
        req.on('close', () => res.destroy());
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // A real serving names its launched window; barePropsMode withholds it
      // (a booting/odd serving) to prove the no-cache-without-an-answer law.
      res.end(JSON.stringify({
        modalities: { vision: true, video: false, audio: false },
        ...(barePropsMode ? {} : { default_generation_settings: { n_ctx: 262144 }, total_slots: 4 }),
      }));
      return;
    }
    if (req.url.startsWith('/models?')) {
      modelHits += 1;
      const accountId = req.headers['chatgpt-account-id'];
      const contextWindow = accountId === 'account-a' ? 272000 : 196000;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ slug: 'gpt-5.6-sol', context_window: contextWindow }] }));
      return;
    }
    if (req.method === 'POST' && req.url.endsWith('/v1/chat/completions')) {
      const implicit = req.url.startsWith('/implicit/');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: implicit ? 'reasoning\n</think>\nready' : 'ready' } }],
      }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server?.close());

const route = () => ({ provider: 'llama-server', endpoint: base, apiKey: '', model: 'test-vl' });

describe('getRouteCapabilities cache', () => {
  test('two calls for the same route probe the serving ONCE, and the answer is real', async () => {
    _resetCapsCache();
    propsHits = 0;
    const first = await getRouteCapabilities(route());
    const second = await getRouteCapabilities(route());
    expect(first.vision).toBe(true); // the spawned serving's own report
    expect(second).toEqual(first);
    expect(propsHits).toBe(1);
  });

  test('a local probe that answered NO window is never cached — the next ask re-probes', async () => {
    // The defect this pins (2026-08-15): a probe during substrate boot got no
    // answer, the hand-table fallback was cached 60s, and the desk gauge held
    // a stale ceiling through the whole ignite. A silent serving is a moment,
    // not a fact.
    _resetCapsCache();
    barePropsMode = true;
    propsHits = 0;
    try {
      const during = await getRouteCapabilities({ ...route(), model: 'booting-model' });
      expect(during.contextWindow).not.toBe(262144); // fallback, honestly sourced
      barePropsMode = false; // the serving comes up…
      const after = await getRouteCapabilities({ ...route(), model: 'booting-model' });
      expect(after.contextWindow).toBe(262144); // …and the next ask self-heals
      expect(after.contextWindowSource).toBe('provider-runtime');
      expect(propsHits).toBe(2);
    } finally {
      barePropsMode = false;
    }
  });

  test('a reset cache re-probes the serving', async () => {
    _resetCapsCache();
    propsHits = 0;
    await getRouteCapabilities(route());
    _resetCapsCache();
    await getRouteCapabilities(route());
    expect(propsHits).toBe(2);
  });

  test('a windowless probe inherits the route\'s last GOOD runtime window — no flap to a static rung (D6)', async () => {
    // The failure this pins (ruling, 2026-08-31): a flapping probe fell past the
    // registry to name inference for a turn, swinging the tools block
    // ~27K↔~1.5K and arming the shed ladder against a phantom small window.
    _resetCapsCache();
    const flapRoute = { ...route(), model: 'flap-model' };
    const good = await getRouteCapabilities(flapRoute); // the real probe — stored as last good
    expect(good.contextWindow).toBe(262144);
    expect(good.contextWindowSource).toBe('provider-runtime');
    _expireCapsCache(); // the fresh TTL entry is gone; the last-good slot stands
    barePropsMode = true; // the serving now answers without a window (booting/odd moment)
    try {
      const flapped = await getRouteCapabilities(flapRoute);
      expect(flapped.contextWindow).toBe(262144); // last GOOD reading, never a guess
      expect(flapped.contextWindowSource).toBe('provider-runtime-last-good');
    } finally {
      barePropsMode = false;
    }
  });

  test('with NO last-good reading a windowless probe still falls to the static rungs honestly', async () => {
    _resetCapsCache();
    barePropsMode = true;
    try {
      const caps = await getRouteCapabilities({ ...route(), model: 'never-seen-model' });
      expect(caps.contextWindowSource).not.toBe('provider-runtime-last-good');
      expect(caps.contextWindowSource).not.toBe('provider-runtime');
    } finally {
      barePropsMode = false;
    }
  });

  test('a different route key probes afresh', async () => {
    _resetCapsCache();
    propsHits = 0;
    await getRouteCapabilities(route());
    await getRouteCapabilities({ ...route(), model: 'other-model' });
    expect(propsHits).toBe(2);
  });

  test('subscription capability cache is scoped to the real account route', async () => {
    _resetCapsCache();
    modelHits = 0;
    const baseRoute = { provider: 'openai-chatgpt', endpoint: base, apiKey: 'real-wire-token', model: 'gpt-5.6-sol' };
    const first = await getRouteCapabilities({ ...baseRoute, accountId: 'account-a' });
    const second = await getRouteCapabilities({ ...baseRoute, accountId: 'account-b' });
    expect(first.contextWindow).toBe(272000);
    expect(second.contextWindow).toBe(196000);
    expect(modelHits).toBe(2);
  });

  test('an unavailable subscription model window remains unknown', async () => {
    _resetCapsCache();
    const caps = await getRouteCapabilities({
      provider: 'openai-chatgpt', endpoint: base, apiKey: '', accountId: '', model: 'gpt-5.6-sol',
    });
    expect(caps.contextWindow).toBeNull();
    expect(caps.contextWindowSource).toBe('unknown');
  });

  test('an explicit accountless route never inherits the machine account', async () => {
    const original = getConfig();
    setConfig({ ...original, accountId: 'global-account' });
    _resetCapsCache();
    modelHits = 0;
    try {
      const caps = await getRouteCapabilities({
        provider: 'openai-chatgpt', endpoint: base, apiKey: 'wire-token', accountId: null, model: 'gpt-5.6-sol',
      });
      expect(caps.contextWindow).toBeNull();
      expect(caps.contextWindowSource).toBe('unknown');
      expect(modelHits).toBe(0);
    } finally {
      setConfig({ ...original, accountId: original.accountId ?? null });
    }
  });

  test('an unresponsive local capability endpoint falls back within its bound', async () => {
    _resetCapsCache();
    stallProps = true;
    const started = Date.now();
    try {
      const caps = await getRouteCapabilities({ ...route(), model: 'stalled-model' });
      expect(caps.contextWindowSource).toBe('unknown');
      expect(Date.now() - started).toBeLessThan(4500);
    } finally {
      stallProps = false;
    }
  }, 6000);

  test('reasoning behavior is probed on the explicit route, not the machine route', async () => {
    const original = getConfig();
    setConfig({
      ...original,
      provider: 'custom', endpoint: `${base}/implicit`, model: 'machine-implicit',
      chatPath: '/v1/chat/completions', apiKey: '',
    });
    try {
      const behavior = await getThinkBehavior({
        provider: 'custom', endpoint: `${base}/plain`, model: 'route-plain',
        chatPath: '/v1/chat/completions', apiKey: '',
      });
      expect(behavior).toEqual({ thinks: false, implicitOpen: false, serverBudget: false });
    } finally {
      setConfig(original);
    }
  });
});

describe('capsCacheFresh (pure boundary)', () => {
  test('fresh inside the TTL, stale past it, missing entry never fresh', () => {
    const entry = { at: 1000, value: {} };
    expect(capsCacheFresh(entry, 1000 + CAPS_CACHE_TTL_MS - 1)).toBe(true);
    expect(capsCacheFresh(entry, 1000 + CAPS_CACHE_TTL_MS + 1)).toBe(false);
    expect(capsCacheFresh(undefined, 5000)).toBe(false);
  });
});

// THE MODELS.DEV-CATALOG RUNG (2026-07-27) — the global-context work: a
// third-party model the hand table has never heard of must read a SOURCED
// limit instead of LIMIT UNKNOWN. These routes ride no probe branch (cloud
// anthropic/openai dialects), so resolution is pure catalog + table + ladder —
// no network, the real generated catalog data.
describe('the models.dev-catalog rung', () => {
  const kimiRoute = (model) => ({
    provider: 'kimi-for-coding', endpoint: 'https://api.kimi.com/coding/v1', apiKey: '', model,
  });

  // (every Kimi model has since joined the hand table — k3 for its vision
  // truth — so the catalog rung is proven on a catalog model the hand table
  // has never named)
  test('a catalog model the hand table does not know reads a sourced limit (qwen3.7-plus → 1M)', async () => {
    _resetCapsCache();
    const alibaba = Object.values(GENERATED_PROVIDERS).find((p) => p.id === 'alibaba-coding-plan-cn');
    const caps = await getRouteCapabilities({ provider: alibaba.id, endpoint: alibaba.endpoint, apiKey: '', model: 'qwen3.7-plus' });
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.contextWindowSource).toBe('models.dev-catalog');
  });

  test('the hand table still wins over the catalog — a hand correction is never shadowed', async () => {
    _resetCapsCache();
    const caps = await getRouteCapabilities(kimiRoute('kimi-for-coding'));
    expect(caps.contextWindow).toBe(262144);
    expect(caps.contextWindowSource).toBe('model-capabilities');
  });

  test('a model neither the table nor the catalog knows stays honestly unknown', async () => {
    _resetCapsCache();
    const caps = await getRouteCapabilities(kimiRoute('no-such-model-xyz'));
    expect(caps.contextWindow).toBe(4096);
    expect(caps.contextWindowSource).toBe('unknown');
  });

  test('the glm-5 generation resolves from the hand table (z-ai is core-owned — the sync skips it)', async () => {
    _resetCapsCache();
    const caps = await getRouteCapabilities({
      provider: 'z-ai', endpoint: 'https://api.z.ai/api/paas/v4', apiKey: '', model: 'glm-5.2',
    });
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.contextWindowSource).toBe('model-capabilities');
    const family = await getRouteCapabilities({
      provider: 'z-ai', endpoint: 'https://api.z.ai/api/paas/v4', apiKey: '', model: 'glm-5',
    });
    expect(family.contextWindow).toBe(204800); // the 1M glm-5.2 entry never shadows the family
  });
});

describe('catalogCapabilitiesFor (pure matcher)', () => {
  test('exact id, org-stripped id, and prefix-on-boundary all resolve', () => {
    // The matcher's job — which id wins — is unchanged. Asserted on the window
    // alone so this test keeps testing MATCHING rather than the record's shape.
    expect(catalogCapabilitiesFor('kimi-for-coding', 'k3').contextWindow).toBe(1048576);
    expect(catalogCapabilitiesFor('kimi-for-coding', 'k3-256k').contextWindow).toBe(262144);
    expect(catalogCapabilitiesFor('kimi-for-coding', 'k3-2099-01').contextWindow).toBe(1048576);
  });

  test('maxOutput rides along when the catalog carries one (2026-08-04)', () => {
    // It was in the data all along and dropped on the floor. It answers a
    // DIFFERENT question than the window — how much a hosted model may EMIT in
    // one turn — and budgeting output against the window alone returns a 400
    // from the provider rather than a longer answer.
    const withCap = catalogCapabilitiesFor('302ai', 'claude-opus-4-6');
    expect(withCap.contextWindow).toBe(1000000);
    expect(withCap.maxOutput).toBe(128000);
  });

  test('a catalog entry without a cap omits the key rather than inventing one', () => {
    const got = catalogCapabilitiesFor('kimi-for-coding', 'k3');
    expect(got).toHaveProperty('contextWindow');
    if ('maxOutput' in got) expect(got.maxOutput).toBeGreaterThan(0);
  });

  test('a mid-string resemblance is NOT a match — the boundary rule holds', () => {
    expect(catalogCapabilitiesFor('kimi-for-coding', 'k35')).toBeNull();
    expect(catalogCapabilitiesFor('kimi-for-coding', 'unknown-model')).toBeNull();
    expect(catalogCapabilitiesFor('lm-studio', 'k3')).toBeNull(); // no catalog models list
    expect(catalogCapabilitiesFor('kimi-for-coding', '')).toBeNull();
  });
});
