/**
 * DYNAMIC PROVIDER DISCOVERY (Bastien, 2026-08-08).
 *
 * […] No mocks (RULE 0): REAL http servers on EPHEMERAL
 * ports — ports nobody hard-coded anywhere — answering real provider
 * signatures, found by the real sweep. If discovery only worked on
 * well-known ports, every test here would fail.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import {
  parseProcNetTcp, parseNetstat, listeningPorts, identifyEndpoint,
  discoverProviders, pickAutoAdopt, sameEndpoint, dedupeEndpoints, FALLBACK_PORTS,
} from '../../backend/services/provider-discovery.js';
import { loadProviderChoice, saveProviderChoice, providerChoicePath } from '../../backend/services/provider-choice.js';
import { createTempDir } from '../helpers/temp-fs.js';
import fs from 'node:fs/promises';
import path from 'node:path';

// A real Ollama-shaped server: /api/tags with models.
const serveOllamaShaped = () => new Promise((resolve) => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ models: [{ name: 'walk-test:latest' }] }));
    } else { res.statusCode = 404; res.end(); }
  });
  srv.listen(0, '127.0.0.1', () => resolve(srv));
});

// A real llama.cpp-shaped server: /v1/models + /props.
const serveLlamaCppShaped = () => new Promise((resolve) => {
  const srv = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'gemma-test' }] }));
    else if (req.url === '/props') res.end(JSON.stringify({ total_slots: 1 }));
    else { res.statusCode = 404; res.end(); }
  });
  srv.listen(0, '127.0.0.1', () => resolve(srv));
});

let ollamaSrv, llamaSrv, prevPorts;

beforeAll(async () => {
  ollamaSrv = await serveOllamaShaped();
  llamaSrv = await serveLlamaCppShaped();
  prevPorts = process.env.NEUMA_DISCOVERY_PORTS;
});

afterAll(() => {
  ollamaSrv?.close(); llamaSrv?.close();
  if (prevPorts === undefined) delete process.env.NEUMA_DISCOVERY_PORTS;
  else process.env.NEUMA_DISCOVERY_PORTS = prevPorts;
});

describe('the machine names its own listeners', () => {
  test('the real OS enumeration sees a port we JUST opened on an ephemeral number', async () => {
    delete process.env.NEUMA_DISCOVERY_PORTS;
    const port = ollamaSrv.address().port;
    const ports = await listeningPorts();
    expect(ports).toContain(port); // nobody hard-coded this number anywhere
  });

  test('NEUMA_DISCOVERY_PORTS pins the sweep exactly', async () => {
    process.env.NEUMA_DISCOVERY_PORTS = '4242, 999999x, 5353';
    expect(await listeningPorts()).toEqual([4242, 5353]);
    delete process.env.NEUMA_DISCOVERY_PORTS;
  });

  test('/proc/net/tcp parsing: LISTEN rows only, hex ports, privileged skipped', () => {
    const fixture = [
      '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid',
      '   0: 00000000:2CAA 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000', // 11434 LISTEN
      '   1: 0100007F:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0', // 80 — privileged, skipped
      '   2: 0100007F:1F90 0100007F:A2C4 01 00000000:00000000 00:00000000 00000000  1000', // ESTABLISHED, skipped
    ].join('\n');
    expect(parseProcNetTcp(fixture)).toEqual([11434]);
  });

  test('netstat parsing: linux/mac/windows spellings all yield the port', () => {
    const fixture = [
      'tcp4       0      0  127.0.0.1.1234         *.*                    LISTEN',
      '  TCP    0.0.0.0:11434          0.0.0.0:0              LISTENING       4321',
      'tcp6       0      0 :::8080                 :::*                    LISTEN',
      'tcp        0      0 127.0.0.1:631           0.0.0.0:*               LISTEN', // privileged
    ].join('\n');
    expect(parseNetstat(fixture).sort((a, b) => a - b)).toEqual([1234, 8080, 11434]);
  });
});

describe('every listener asked what it is', () => {
  test('an Ollama-shaped server on an arbitrary port identifies as ollama with its models', async () => {
    const found = await identifyEndpoint(`http://127.0.0.1:${ollamaSrv.address().port}`);
    expect(found).toMatchObject({ provider: 'ollama', models: ['walk-test:latest'] });
  });

  test('a llama.cpp-shaped server (v1/models + props) identifies as llama-server', async () => {
    const found = await identifyEndpoint(`http://127.0.0.1:${llamaSrv.address().port}`);
    expect(found).toMatchObject({ provider: 'llama-server', models: ['gemma-test'] });
  });

  test('a port serving nothing recognizable is null, never a throw', async () => {
    expect(await identifyEndpoint('http://127.0.0.1:9')).toBeNull();
  });
});

describe('the full sweep', () => {
  test('finds BOTH ephemeral servers with the sweep pinned to their ports + the dead fallbacks', async () => {
    process.env.NEUMA_DISCOVERY_PORTS =
      `${ollamaSrv.address().port},${llamaSrv.address().port}`;
    const found = await discoverProviders();
    delete process.env.NEUMA_DISCOVERY_PORTS;
    const providers = found.map((f) => f.provider).sort();
    expect(providers).toEqual(['llama-server', 'ollama']);
  }, 30000);
});

describe('pickAutoAdopt — fills silence, never overrides a person', () => {
  const one = [{ id: 'ollama', endpoint: 'http://127.0.0.1:11434', models: ['m'] }];
  const two = [...one, { id: 'lm-studio', endpoint: 'http://127.0.0.1:1234', models: ['n'] }];

  test('no prior choice + exactly one server with models → adopt it', () => {
    expect(pickAutoAdopt(one, null)).toBe(one[0]);
  });
  test('a prior OPERATOR choice is never overridden', () => {
    expect(pickAutoAdopt(one, { chosenBy: 'operator' })).toBeNull();
  });
  test('a prior AUTO adoption may be re-decided', () => {
    expect(pickAutoAdopt(one, { chosenBy: 'auto' })).toBe(one[0]);
  });
  test('two candidates = ambiguity = the operator picks via chips', () => {
    expect(pickAutoAdopt(two, null)).toBeNull();
  });
  test('a modelless server is not a mind', () => {
    expect(pickAutoAdopt([{ id: 'ollama', endpoint: 'x', models: [] }], null)).toBeNull();
  });

  test('THE COLLISION CASE (sc-echo R3): one server seen by both the fixed probe (localhost) and the sweep (127.0.0.1) is ONE candidate — adopt fires', () => {
    const collided = [
      { id: 'ollama', endpoint: 'http://localhost:11434', models: ['m'] },
      { id: 'ollama', endpoint: 'http://127.0.0.1:11434', models: ['m'] },
    ];
    expect(pickAutoAdopt(collided, null)).toBe(collided[0]);
  });
});

describe('one server, one chip', () => {
  test('localhost and 127.0.0.1 fold to the same server; different ports never do', () => {
    expect(sameEndpoint('http://localhost:11434', 'http://127.0.0.1:11434')).toBe(true);
    expect(sameEndpoint('http://localhost:11434/', 'http://127.0.0.1:11434')).toBe(true);
    expect(sameEndpoint('http://127.0.0.1:11434', 'http://127.0.0.1:1234')).toBe(false);
  });

  test('dedupeEndpoints keeps the first of a collided pair, everything else intact', () => {
    const list = [
      { id: 'ollama', endpoint: 'http://localhost:11434' },
      { id: 'ollama', endpoint: 'http://127.0.0.1:11434' },
      { id: 'llama-server', endpoint: 'http://127.0.0.1:8080' },
    ];
    expect(dedupeEndpoints(list)).toEqual([list[0], list[2]]);
  });
});

describe('the choice survives the restart', () => {
  test('save → load round-trips with chosenBy; never writes an apiKey', async () => {
    const dir = await createTempDir('provider-choice');
    const prev = process.env.NEUMA_PROVIDER_CHOICE_PATH;
    process.env.NEUMA_PROVIDER_CHOICE_PATH = path.join(dir, 'llm-provider.json');
    try {
      expect(await loadProviderChoice()).toBeNull();
      await saveProviderChoice(
        { provider: 'ollama', endpoint: 'http://127.0.0.1:33333', model: 'walk', apiKey: 'MUST-NOT-PERSIST' },
        { chosenBy: 'auto' },
      );
      const back = await loadProviderChoice();
      expect(back).toMatchObject({ provider: 'ollama', endpoint: 'http://127.0.0.1:33333', model: 'walk', chosenBy: 'auto' });
      const raw = await fs.readFile(providerChoicePath(), 'utf8');
      expect(raw).not.toContain('MUST-NOT-PERSIST');
    } finally {
      if (prev === undefined) delete process.env.NEUMA_PROVIDER_CHOICE_PATH;
      else process.env.NEUMA_PROVIDER_CHOICE_PATH = prev;
    }
  });
});
