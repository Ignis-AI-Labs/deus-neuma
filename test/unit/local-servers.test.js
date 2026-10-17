// The harness door's LOCAL road — the machine's model servers, read from the
// birth flight check's own probe payload (GET /api/v1/preflight/setup). Pure.
import { describe, expect, it } from 'vitest';
import {
  localServers, localGuide, endpointToStore, serverModels, sameEndpoint,
} from '../../frontend/app/FirstRunChoice/local-servers.js';

const setup = (providers) => ({ providers });
const off = (endpoint) => ({ running: false, models: [], endpoint });

describe('localServers', () => {
  it('names every server, ready first, and the address tried where nothing answered', () => {
    const rows = localServers(setup({
      ollama: off('http://localhost:11434'),
      lmStudio: { running: true, models: [], endpoint: 'http://localhost:1234' },
      discovered: [{ provider: 'llama-server', endpoint: 'http://127.0.0.1:8089', models: ['qwen3.8-27b'] }],
    }));
    expect(rows.map((r) => [r.name, r.state, r.endpoint])).toEqual([
      ['llama.cpp', 'ready', 'http://127.0.0.1:8089'],
      ['LM Studio', 'empty', 'http://localhost:1234'],
      ['Ollama', 'off', 'http://localhost:11434'],
    ]);
  });

  it('shows one row per server — the sweep\'s sighting of a silent fixed probe wins', () => {
    const rows = localServers(setup({
      ollama: off('http://localhost:11434'),
      lmStudio: off('http://localhost:1234'),
      discovered: [{ provider: 'ollama', endpoint: 'http://127.0.0.1:11434/', models: ['llama3'] }],
    }));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ providerId: 'ollama', state: 'ready', models: ['llama3'] });
  });

  it('a running fixed probe is not replaced by a duplicate sighting', () => {
    const rows = localServers(setup({
      ollama: { running: true, models: ['a'], endpoint: 'http://localhost:11434' },
      lmStudio: off('http://localhost:1234'),
      discovered: [{ provider: 'ollama', endpoint: 'http://127.0.0.1:11434', models: ['a'] }],
    }));
    expect(rows.map((r) => r.endpoint)).toEqual(['http://localhost:11434', 'http://localhost:1234']);
  });

  it('offers every model a server can serve, loaded first, and counts the loaded', () => {
    const [studio] = localServers(setup({
      ollama: off('http://localhost:11434'),
      lmStudio: { running: true, models: [], available: ['qwen/qwen3-32b', 'gemma-3-12b'], endpoint: 'http://localhost:1234' },
      discovered: [],
    }));
    expect(studio).toMatchObject({ name: 'LM Studio', state: 'ready', loaded: 0, models: ['qwen/qwen3-32b', 'gemma-3-12b'] });
    const [swept] = localServers(setup({
      discovered: [{ provider: 'lm-studio', endpoint: 'http://127.0.0.1:1234', models: ['b'], available: ['b', 'a'] }],
    }));
    expect(swept).toMatchObject({ models: ['b', 'a'], loaded: 1 });
  });

  it('reads nothing from an absent or unknown payload', () => {
    expect(localServers(null)).toEqual([]);
    expect(localServers(setup({ discovered: [{ provider: 'vllm', endpoint: 'http://127.0.0.1:8000', models: ['x'] }] }))).toEqual([]);
  });
});

describe('localGuide', () => {
  const rec = { model: 'Qwen3.8-27B', quant: 'Q4_K_M', sizeGB: 17 };

  it('says nothing when a server is ready', () => {
    expect(localGuide([{ name: 'Ollama', state: 'ready' }], rec)).toBeNull();
  });

  it('a running server with nothing loaded: load the model this machine can hold', () => {
    expect(localGuide([{ name: 'LM Studio', state: 'empty' }, { name: 'Ollama', state: 'off' }], rec))
      .toBe('LM Studio is running with no model loaded — load Qwen3.8-27B Q4_K_M (~17 GB) in it, then RECHECK.');
  });

  it('nothing running: install, start, load, recheck — and where a remote server goes', () => {
    const text = localGuide([{ name: 'Ollama', state: 'off' }], null);
    expect(text).toContain('Install Ollama (ollama.com) or LM Studio (lmstudio.ai)');
    expect(text).toContain('load a model — then RECHECK');
    expect(text).toContain('Settings → Models');
  });
});

describe('endpointToStore', () => {
  const catalog = [{ id: 'llama-server', endpoint: 'http://localhost:8089' }, { id: 'ollama', endpoint: 'http://localhost:11434' }];

  it('stores nothing when the provider already points at the server', () => {
    expect(endpointToStore({ providerId: 'llama-server', endpoint: 'http://127.0.0.1:8089' }, catalog)).toBeNull();
  });

  it('stores the server\'s address when it runs elsewhere', () => {
    expect(endpointToStore({ providerId: 'llama-server', endpoint: 'http://127.0.0.1:8080' }, catalog)).toBe('http://127.0.0.1:8080');
    expect(endpointToStore({ providerId: 'lm-studio', endpoint: 'http://127.0.0.1:1234' }, catalog)).toBe('http://127.0.0.1:1234');
  });
});

describe('serverModels / sameEndpoint', () => {
  it('offers a server\'s models to the ModelPicker', () => {
    expect(serverModels({ models: ['a', 'b'] })).toEqual([{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }]);
    expect(serverModels(null)).toEqual([]);
  });

  it('folds localhost and a trailing slash', () => {
    expect(sameEndpoint('http://localhost:1234/', 'http://127.0.0.1:1234')).toBe(true);
    expect(sameEndpoint('http://localhost:1234', 'http://localhost:1235')).toBe(false);
  });
});
