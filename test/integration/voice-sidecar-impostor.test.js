// AN IMPOSTOR ON A SIDECAR'S PORT GETS NOTHING (re-audit 2026-10-29, M-06). The CSO ran it against
// 0.1.89: a local program answering GET /health on the whisper/speak port was adopted as the sidecar
// and, through the clip_ref → 409 → clip_b64 fallback, received the Voice-DNA reference clip; its
// own idle_seconds kept it from ever being reaped.
//
// Here a REAL HTTP server on a REAL loopback port plays that impostor — it answers /health as a
// ready engine and /identity with a proof it cannot know — and records every request it gets. The
// backend's REAL engine manager, speak provider and stream lane are pointed at it through the same
// ${ID}_PORT env the launcher uses. A second server that holds the install key (the backend's own
// identityProof over the challenge, as the Python guard computes it) stands for an honest sidecar.
// No mocks (RULE 0).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { SIDECAR_CALLER_HEADER, callerToken, identityProof } from '../../backend/services/voice/sidecar-trust.js';

const KEY = randomBytes(32).toString('hex');
const saved = { key: process.env.NEUMA_SIDECAR_KEY, port: process.env.KOKORO_PORT, wport: process.env.WHISPER_PORT };

// impure — a loopback server answering like a ready voice engine; `honest` answers the challenge with the key
const engineServer = async (honest) => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, path: req.url.split('?')[0], bytes: body.length, token: req.headers[SIDECAR_CALLER_HEADER] || null });
      const url = new URL(req.url, 'http://x');
      const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (url.pathname === '/health') return json(200, { ok: true, phase: 'ready', model: null, idle_seconds: 0 });
      if (url.pathname === '/identity') {
        return json(200, { proof: honest ? identityProof(KEY, url.searchParams.get('challenge')) : 'ab'.repeat(32) });
      }
      // the CSO's PoC: refuse the clip's ref so the backend resends the clip itself inline
      if (url.pathname === '/speak' && !body.includes('clip_b64')) return json(409, { error: 'unknown_ref', ref: 'ref-1' });
      return json(200, { ok: true });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, seen, port: server.address().port, base: `http://127.0.0.1:${server.address().port}` };
};

let impostor;
let honest;
let manager;
beforeAll(async () => {
  process.env.NEUMA_SIDECAR_KEY = KEY;
  impostor = await engineServer(false);
  honest = await engineServer(true);
  manager = await import('../../backend/services/voice/engine-manager.js');
});
afterAll(async () => {
  manager?.shutdownAll();
  await Promise.all([impostor, honest].map((s) => new Promise((r) => s.server.close(r))));
  for (const [env, value] of [['NEUMA_SIDECAR_KEY', saved.key], ['KOKORO_PORT', saved.port], ['WHISPER_PORT', saved.wport]]) {
    if (value === undefined) delete process.env[env]; else process.env[env] = value;
  }
});

describe('an impostor answering /health on a sidecar port', () => {
  test('is never adopted: asked only to step aside (an empty, tokenless ask), and refused when it stays', async () => {
    process.env.KOKORO_PORT = String(impostor.port);
    await expect(manager.ensureReady('kokoro', { timeoutMs: 15_000 })).rejects.toThrow(/could not prove/);
    expect(manager.getStatus('kokoro').state).not.toBe('ready');
    const asked = impostor.seen.filter((r) => !(r.method === 'GET' && ['/health', '/identity'].includes(r.path)));
    expect(asked.every((r) => r.method === 'POST' && r.path === '/shutdown' && r.bytes === 0 && r.token === null)).toBe(true);
  }, 30_000);

  test('never receives the voice clip: the speak provider refuses before any POST of it', async () => {
    const { speak } = await import('../../backend/services/voice/providers/speak.js');
    const voice = { ref: 'ref-1', words: 'the reference words', wav: Buffer.alloc(4096, 7) };
    const run = async () => {
      for await (const chunk of speak({ endpoint: impostor.base, text: 'hello', voice })) void chunk;
    };
    const before = impostor.seen.length;
    await expect(run()).rejects.toThrow(/could not prove/);
    expect(impostor.seen.slice(before).filter((r) => r.method === 'POST')).toEqual([]);
  });

  test('never receives transcription audio: the stream lane refuses to open its socket', async () => {
    const { sidecarSocketHeaders } = await import('../../backend/services/voice/sidecar-trust.js');
    await expect(sidecarSocketHeaders(impostor.base)).rejects.toThrow(/could not prove/);
  });
});

describe('a sidecar from before the install key (an app update left it running)', () => {
  test('steps aside when asked, so the app can start its own; one that will not leave is refused', async () => {
    const { provenOrRetired } = await import('../../backend/services/voice/engine-process.js');
    const old = http.createServer((req, res) => {
      if (req.url.startsWith('/identity')) { res.writeHead(404); return res.end(); }
      if (req.method === 'POST' && req.url === '/shutdown') { res.end('{}'); return old.close(); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, phase: 'ready' }));
    });
    await new Promise((r) => old.listen(0, '127.0.0.1', r));
    expect(await provenOrRetired('127.0.0.1', old.address().port)).toBe(false);
    await expect(provenOrRetired('127.0.0.1', impostor.port)).rejects.toThrow(/could not prove/);
    expect(await provenOrRetired('127.0.0.1', honest.port)).toBe(true);
  }, 30_000);
});

describe('a sidecar holding the install key', () => {
  test('is adopted, and the calls it gets carry the backend\'s token', async () => {
    process.env.KOKORO_PORT = String(honest.port);
    manager.shutdownAll();
    await manager.ensureReady('kokoro', { timeoutMs: 5000 });
    expect(manager.getStatus('kokoro').state).toBe('ready');
    const { sidecarFetch } = await import('../../backend/services/voice/sidecar-trust.js');
    expect((await sidecarFetch(`${honest.base}/synthesize`, { method: 'POST', body: '{}' })).status).toBe(200);
    const posted = honest.seen.filter((r) => r.method === 'POST');
    expect(posted).toHaveLength(1);
    expect(posted[0].token).toBe(callerToken(KEY));
  });
});
