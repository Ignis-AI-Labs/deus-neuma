// Per-neuma active route overrides. RULE 0: real disk, no mocks. Absence of an
// entry means "run on natal" — clearing IS return-to-natal. Shape is validated
// at the boundary so a malformed or unknown-provider override never persists —
// and the SOVEREIGNTY BOUNDARY (docs/protocols/sovereignty-boundary.md) holds at the
// write seam: a neuma binds only to sovereign doors; witness lanes keep theirs.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  routesPath, loadRoutes, getRoute, setRoute, clearRoute,
  normalizeRoute, assertNeumaId, assertSovereignForNeuma,
} from '../../backend/services/neuma-routes-store.js';

let saved;

beforeEach(async () => {
  saved = process.env.NEUMA_ROUTES_PATH;
  const dir = await createTempDir(`neuma-routes-${Math.random().toString(36).slice(2)}`);
  process.env.NEUMA_ROUTES_PATH = path.join(dir, 'neuma-routes.json');
});

afterEach(() => {
  if (saved === undefined) delete process.env.NEUMA_ROUTES_PATH;
  else process.env.NEUMA_ROUTES_PATH = saved;
});

describe('normalizeRoute / assertNeumaId (pure boundary guards)', () => {
  test('accepts a known provider + non-empty model (shape only — sovereignty is a separate law)', () => {
    expect(normalizeRoute({ provider: 'anthropic', model: 'claude-haiku-4-5' }))
      .toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5' });
  });
  test('rejects an unknown provider or an empty model', () => {
    expect(() => normalizeRoute({ provider: 'nope', model: 'x' })).toThrow(/Unknown provider/);
    expect(() => normalizeRoute({ provider: 'anthropic', model: '' })).toThrow(/model/);
  });
  test('assertNeumaId enforces the id format', () => {
    expect(assertNeumaId('Alder_1-2')).toBe('Alder_1-2');
    expect(() => assertNeumaId('../escape')).toThrow(/Invalid neumaId/);
    expect(() => assertNeumaId('')).toThrow(/Invalid neumaId/);
  });
});

describe('the sovereignty boundary at the write seam', () => {
  test('a neuma may not bind to a cloud door — refused with the boundary words', async () => {
    for (const provider of ['anthropic', 'openai', 'xai', 'custom']) {
      await expect(setRoute('alder', { provider, model: 'x' }))
        .rejects.toThrow(/not sovereign/);
    }
    expect(await getRoute('alder')).toBeNull(); // nothing persisted
  });

  test('a neuma may not bind to foreign-custody subscription routes', async () => {
    // (`claude-code-local` used to ride here too; the bridge was removed from
    // the catalog 2026-07-30, so it is now rejected as an unknown provider
    // rather than as foreign custody — a stronger refusal, not a weaker one.)
    for (const [provider, model] of [
      ['openai-chatgpt', 'gpt-5.6-sol'],
    ]) {
      const err = await setRoute('alder', { provider, model }).catch((e) => e);
      expect(err.code).toBe('INVALID_ROUTE');
      expect(err.message).toMatch(/witnesses, never as neuma/);
    }
  });

  test('a route to the REMOVED subscription bridge is refused outright', async () => {
    // Not "foreign custody" any more — the provider simply does not exist, so
    // even a witness lane cannot bind to it. Any route persisted before
    // 2026-07-30 that named it is now rejected on read, which is the intended
    // outcome of removing the lane rather than merely discouraging it.
    const err = await setRoute('witness-claude-code-Claude', {
      provider: 'claude-code-local', model: 'claude-opus-4-8',
    }).catch((e) => e);
    expect(err.code).toBe('INVALID_ROUTE');
  });

  test('a WITNESS lane keeps its third-party door — that is what a witness is', async () => {
    await setRoute('witness-claude-code-Claude', { provider: 'anthropic', model: 'claude-opus-4-8' });
    await setRoute('witness-openai-Sedge', { provider: 'openai-chatgpt', model: 'gpt-5.6-sol' });
    await setRoute('witness-xai-Thistle', { provider: 'xai', model: 'grok-4' });
    expect(await getRoute('witness-claude-code-Claude'))
      .toEqual({ provider: 'anthropic', model: 'claude-opus-4-8' });
    expect(await getRoute('witness-xai-Thistle')).toEqual({ provider: 'xai', model: 'grok-4' });
    expect(await getRoute('witness-openai-Sedge'))
      .toEqual({ provider: 'openai-chatgpt', model: 'gpt-5.6-sol' });
  });

  test('assertSovereignForNeuma is pure and fail-closed on unknown ids', () => {
    expect(() => assertSovereignForNeuma('alder', 'llama-server')).not.toThrow();
    expect(() => assertSovereignForNeuma('alder', 'anthropic')).toThrow(/not sovereign/);
    expect(() => assertSovereignForNeuma('witness-kimi-code-Fern', 'anthropic')).not.toThrow();
  });
});

describe('override lifecycle (real disk)', () => {
  test('no override by default means run-on-natal (null)', async () => {
    expect(await getRoute('alder')).toBeNull();
    expect(await loadRoutes()).toEqual({});
  });

  test('reads the retired OpenCode provider id as Neuma direct OAuth', async () => {
    await fs.writeFile(routesPath(), JSON.stringify({
      'witness-openai-Sedge': { provider: 'opencode-openai-local', model: 'gpt-5.6-sol' },
    }));
    expect(await getRoute('witness-openai-Sedge')).toEqual({
      provider: 'openai-chatgpt',
      model: 'gpt-5.6-sol',
    });
  });

  test('set persists and reads back', async () => {
    await setRoute('alder', { provider: 'llama-server', model: 'gemma-4-31b' });
    expect(await getRoute('alder')).toEqual({ provider: 'llama-server', model: 'gemma-4-31b' });
    const raw = JSON.parse(await fs.readFile(routesPath(), 'utf8'));
    expect(raw.alder).toEqual({ provider: 'llama-server', model: 'gemma-4-31b' });
  });

  test('overrides are isolated per neuma', async () => {
    await setRoute('alder', { provider: 'llama-server', model: 'gemma-4-31b' });
    await setRoute('birch', { provider: 'ollama', model: 'qwen3.5' });
    expect(await getRoute('alder')).toEqual({ provider: 'llama-server', model: 'gemma-4-31b' });
    expect(await getRoute('birch')).toEqual({ provider: 'ollama', model: 'qwen3.5' });
  });

  test('clear removes the override (return to natal) and is idempotent', async () => {
    await setRoute('alder', { provider: 'llama-server', model: 'gemma-4-31b' });
    expect(await clearRoute('alder')).toBe(true);
    expect(await getRoute('alder')).toBeNull();
    expect(await clearRoute('alder')).toBe(false);
  });

  test('set rejects a bad neumaId before touching disk', async () => {
    await expect(setRoute('../evil', { provider: 'llama-server', model: 'x' })).rejects.toThrow(/Invalid neumaId/);
  });

  test('concurrent overrides for different neumas all persist (no TOCTOU loss)', async () => {
    await Promise.all([
      setRoute('alder', { provider: 'llama-server', model: 'gemma-4-31b' }),
      setRoute('birch', { provider: 'ollama', model: 'qwen3.5' }),
      setRoute('cedar', { provider: 'lm-studio', model: 'local-model' }),
    ]);
    expect(await getRoute('alder')).toEqual({ provider: 'llama-server', model: 'gemma-4-31b' });
    expect(await getRoute('birch')).toEqual({ provider: 'ollama', model: 'qwen3.5' });
    expect(await getRoute('cedar')).toEqual({ provider: 'lm-studio', model: 'local-model' });
  });

  test('a malformed stored override refuses explicitly without rewriting the file', async () => {
    await fs.mkdir(path.dirname(routesPath()), { recursive: true });
    const stored = JSON.stringify({ alder: { provider: 'llama-server' }, birch: { model: 'x' } });
    await fs.writeFile(routesPath(), stored);
    // Strict reads expose broken operator data; they do not silently select
    // another route. Portal callers own fallback/refusal, not this store.
    await expect(getRoute('alder')).rejects.toMatchObject({ code: 'INVALID_ROUTE' });
    await expect(getRoute('birch')).rejects.toMatchObject({ code: 'INVALID_ROUTE' });
    expect(await fs.readFile(routesPath(), 'utf8')).toBe(stored);
  });

  test('an array file refuses reads and updates without destroying the original bytes', async () => {
    await fs.mkdir(path.dirname(routesPath()), { recursive: true });
    await fs.writeFile(routesPath(), '[]');
    await expect(loadRoutes()).rejects.toMatchObject({ code: 'INVALID_ROUTE' });
    await expect(setRoute('alder', { provider: 'llama-server', model: 'x' }))
      .rejects.toMatchObject({ code: 'INVALID_ROUTE' });
    expect(await fs.readFile(routesPath(), 'utf8')).toBe('[]');
  });
});
