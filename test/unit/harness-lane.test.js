// The harness lane's pure law: its id, its door, its ground — and the neuma
// law beside it, unchanged. Real inputs, real outputs.
import { describe, it, expect, afterEach } from 'vitest';
import { harnessLaneId, normalizeHarnessChoice } from '../../backend/services/harness-lane.js';
import { isHarnessLane, getHarnessRoot, setHarnessRoot } from '../../core/workspace/lane-grounds.js';
import { assertSovereignForNeuma } from '../../backend/services/neuma-routes-store.js';

describe('a harness lane id', () => {
  it('is harness- and the first 8 hex of the lowercased wallet', () => {
    expect(harnessLaneId('0xAbCdEf0123456789aBcDeF0123456789AbCdEf01')).toBe('harness-abcdef01');
    expect(isHarnessLane('harness-abcdef01')).toBe(true);
    expect(isHarnessLane('witness-kimi-code-Basunor')).toBe(false);
    expect(isHarnessLane('keir')).toBe(false);
  });

  it('needs a wallet', () => {
    expect(() => harnessLaneId('')).toThrow(/wallet/);
    expect(() => harnessLaneId('0xzz')).toThrow(/wallet/);
  });
});

describe('a harness lane door', () => {
  it('takes any catalog provider, local or cloud, and trims the model', () => {
    expect(normalizeHarnessChoice({ providerId: 'anthropic', model: ' claude-haiku-4-5-20251001 ' }))
      .toEqual({ providerId: 'anthropic', model: 'claude-haiku-4-5-20251001' });
    expect(normalizeHarnessChoice({ providerId: 'ollama', model: 'qwen3:8b' }).providerId).toBe('ollama');
  });

  it('refuses an unknown provider, a custom endpoint, and an empty model', () => {
    expect(() => normalizeHarnessChoice({ providerId: 'nowhere', model: 'x' })).toThrow(/Unknown provider/);
    expect(() => normalizeHarnessChoice({ providerId: 'custom', model: 'x' })).toThrow(/Unknown provider/);
    expect(() => normalizeHarnessChoice({ providerId: 'openai', model: ' ' })).toThrow(/model/);
  });
});

describe('the sovereignty law beside it', () => {
  it('a harness lane may ride a cloud door; a neuma still may not', () => {
    expect(() => assertSovereignForNeuma('harness-abcdef01', 'openai')).not.toThrow();
    expect(() => assertSovereignForNeuma('keir', 'openai')).toThrow(/not sovereign/);
    expect(() => assertSovereignForNeuma('keir', 'llama-server')).not.toThrow();
  });
});

describe('the harness ground', () => {
  const saved = process.env.HARNESS_ROOT;
  afterEach(() => { setHarnessRoot(null); if (saved === undefined) delete process.env.HARNESS_ROOT; else process.env.HARNESS_ROOT = saved; });

  it('stands beside the house: a sibling of the workspaces root, unless set', () => {
    delete process.env.HARNESS_ROOT;
    expect(getHarnessRoot('/data/realm/workspaces')).toBe('/data/realm/harness');
    process.env.HARNESS_ROOT = '/elsewhere/harness';
    expect(getHarnessRoot('/data/realm/workspaces')).toBe('/elsewhere/harness');
    setHarnessRoot('/explicit');
    expect(getHarnessRoot('/data/realm/workspaces')).toBe('/explicit');
  });
});
