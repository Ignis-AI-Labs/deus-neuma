/* global URL, fetch, process */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SIDECAR_CALLER_HEADER,
  callerToken,
  engineIdentityProof,
  engineKey,
  identityProof,
  sidecarFetch,
  verifySidecar,
} from '../../backend/services/voice/sidecar-trust.js';

const KEY = randomBytes(32).toString('hex');
const savedKey = process.env.NEUMA_SIDECAR_KEY;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const socketOf = (req) => `${req.socket.localAddress === '::1' ? '[::1]' : '127.0.0.1'}:${req.socket.localPort}`;

const listen = async (handler) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
};

const honestEngine = async (engine) => {
  const seen = [];
  const derived = engineKey(KEY, engine).toString('hex');
  const holder = await listen((req, res) => {
    const url = new URL(req.url, 'http://engine');
    if (url.pathname === '/identity') {
      const challenge = url.searchParams.get('challenge') || '';
      const socket = socketOf(req);
      const valid = url.searchParams.get('socket') === socket;
      res.writeHead(valid ? 200 : 403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ proof: valid ? engineIdentityProof(derived, engine, challenge, socket) : '' }));
      return;
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, phase: 'ready' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const token = req.headers[SIDECAR_CALLER_HEADER] || '';
      seen.push({ path: url.pathname, body, token });
      const authorized = token === callerToken(KEY, engine);
      res.writeHead(authorized ? 200 : 403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: authorized }));
    });
  });
  return { ...holder, seen };
};

const post = async (base, engine) => {
  const response = await fetch(`${base}/speak`, {
    method: 'POST',
    headers: { [SIDECAR_CALLER_HEADER]: callerToken(KEY, engine) },
    body: 'audio-shaped-bytes',
  });
  return response.status;
};

const closeAll = async (holders) => {
  await Promise.all(holders.filter(Boolean).map(({ server }) => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  }));
};

describe('engine- and socket-bound sidecar trust', () => {
  let kokoro;
  let whisper;
  let relay;
  beforeAll(async () => {
    process.env.NEUMA_SIDECAR_KEY = KEY;
    kokoro = await honestEngine('kokoro');
    whisper = await honestEngine('whisper');
    relay = await listen(async (req, res) => {
      const upstream = await fetch(`${kokoro.base}${req.url}`);
      res.writeHead(upstream.status, { 'content-type': 'application/json' });
      res.end(await upstream.text());
    });
  });
  afterAll(async () => {
    await closeAll([kokoro, whisper, relay]);
    if (savedKey === undefined) delete process.env.NEUMA_SIDECAR_KEY;
    else process.env.NEUMA_SIDECAR_KEY = savedKey;
  });

  test('the honest engine accepts its own backend call and bytes; another engine rejects its token', async () => {
    const response = await sidecarFetch(`${kokoro.base}/speak`, { method: 'POST', body: 'legitimate-audio' }, 'kokoro');
    expect(response.status).toBe(200);
    expect(kokoro.seen.at(-1)).toMatchObject({ body: 'legitimate-audio', token: callerToken(KEY, 'kokoro') });
    expect(await post(whisper.base, 'kokoro')).toBe(403);
    expect(await post(whisper.base, 'whisper')).toBe(200);
    expect(callerToken(KEY, 'kokoro')).not.toBe(callerToken(KEY, 'whisper'));
  });

  test('a live relay to the honest engine and a wrong-engine proof are both refused', async () => {
    expect(await verifySidecar(relay.base, 'kokoro')).toBe(false);
    expect(await verifySidecar(kokoro.base, 'whisper')).toBe(false);
    expect(await verifySidecar(kokoro.base, 'kokoro')).toBe(true);
    await expect(sidecarFetch(`${relay.base}/speak`, { method: 'POST', body: 'private-audio' }, 'kokoro')).rejects.toThrow(/could not prove/);
    expect(kokoro.seen.filter((row) => row.body === 'private-audio')).toEqual([]);
  });

  test('the real Python guard computes the same proof and refuses a relayed socket or cross-engine token', () => {
    const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(REPO, 'voice-engines', '_shared'))})
from browser_guard import guard
key = ${JSON.stringify(engineKey(KEY, 'kokoro').toString('hex'))}
query = 'challenge=${'ab'.repeat(16)}&socket=127.0.0.1%3A43210'
valid = guard({'host': '127.0.0.1:43210'}, '/identity', query, key=key, engine='kokoro', local=('127.0.0.1', 43210))
relayed = guard({'host': '127.0.0.1:43210'}, '/identity', query, key=key, engine='kokoro', local=('127.0.0.1', 43211))
accepted = guard({'host': '127.0.0.1:43210', 'x-neuma-sidecar': ${JSON.stringify(callerToken(KEY, 'kokoro'))}}, '/speak', key=key, engine='kokoro', local=('127.0.0.1', 43210))
cross_engine = guard({'host': '127.0.0.1:43210', 'x-neuma-sidecar': ${JSON.stringify(callerToken(KEY, 'whisper'))}}, '/speak', key=key, engine='kokoro', local=('127.0.0.1', 43210))
print(json.dumps({'valid': valid, 'relayed': relayed, 'accepted': accepted, 'cross_engine': cross_engine}))
`;
    const result = JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }));
    expect(result.valid[0]).toBe(200);
    expect(result.valid[1].proof).toBe(identityProof(KEY, 'kokoro', 'ab'.repeat(16), '127.0.0.1:43210'));
    expect(result.relayed[0]).toBe(403);
    expect(result.accepted).toBeNull();
    expect(result.cross_engine[0]).toBe(403);
  });
});
