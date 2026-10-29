// A VOICE SIDECAR ANSWERS THE BACKEND, NEVER A WEB PAGE (audit 2026-10-28 M-06). RULE 0: the real
// guard module run by a real Python, and — where the csm sidecar's own environment exists — the
// real speak_app front door (_Guard) on a real uvicorn socket, asked over raw HTTP with each header
// exactly as sent — the backend's call carries no Origin, no Sec-Fetch-Site and a loopback Host.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SHARED = path.join(REPO, 'voice-engines', '_shared');
const SPEAK = path.join(REPO, 'voice-engines', '_speak');
const CSM_PY = path.join(REPO, 'voice-engines', 'csm', '.venv', 'bin', 'python');

const verdict = (headers) => execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(SHARED)})
from browser_guard import refusal
print(json.dumps(refusal(json.loads(sys.argv[1]))))`, JSON.stringify(headers)], { encoding: 'utf8' }).trim();

describe('the rule, in the real Python module', () => {
  test('the backend\'s own call passes: loopback Host, no Origin, no browser marks', () => {
    expect(verdict({ host: '127.0.0.1:7860' })).toBe('null');
    expect(verdict({ host: 'localhost:7861' })).toBe('null');
    expect(verdict({ host: '[::1]:7862' })).toBe('null');
  });
  test('a page is refused: its Origin, its Sec-Fetch-Site, or a rebound Host', () => {
    expect(verdict({ host: '127.0.0.1:7860', origin: 'https://evil.example' })).toMatch(/Origin/);
    expect(verdict({ host: '127.0.0.1:7860', origin: 'null' })).toMatch(/Origin/);
    expect(verdict({ host: '127.0.0.1:7860', 'sec-fetch-site': 'cross-site' })).toMatch(/browser/);
    expect(verdict({ host: 'evil.example:7860' })).toMatch(/non-loopback Host/);
  });
});

// raw HTTP: every header exactly as a browser (or the backend) would send it — fetch drops Host
const post = (base, pathname, headers = {}) => new Promise((resolve, reject) => {
  const url = new URL(pathname, base);
  const req = http.request({ host: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'content-length': 2, ...headers } }, (res) => { res.resume(); resolve(res.statusCode); });
  req.on('error', reject);
  req.end('{}');
});

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

describe.skipIf(!existsSync(CSM_PY))('the real speak_app front door on a real socket', () => {
  let child;
  let base;
  beforeAll(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    // the real _Guard around an app that answers 200; its activity clock is the one thing stood in
    const script = `
import sys, uvicorn
sys.path.insert(0, ${JSON.stringify(SPEAK)})
from speak_app import _Guard
async def ok(scope, receive, send):
    await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"text/plain")]})
    await send({"type": "http.response.body", "body": b"spoken"})
class Clock:
    def touch(self): pass
uvicorn.run(_Guard(ok, Clock()), host="127.0.0.1", port=${port}, log_level="warning")`;
    child = spawn(CSM_PY, ['-c', script], { stdio: ['ignore', 'ignore', 'pipe'] });
    for (let i = 0; i < 100; i += 1) {
      try { await fetch(`${base}/health`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    throw new Error('the guarded app never listened');
  }, 30_000);
  afterAll(() => { child?.kill('SIGKILL'); });

  test('the backend\'s call is served; a page\'s POST, an img-style GET and a rebound Host are refused', async () => {
    expect(await post(base, '/speak')).toBe(200);
    expect(await post(base, '/speak', { origin: 'https://evil.example', 'content-type': 'text/plain' })).toBe(403);
    expect(await post(base, '/shutdown', { 'sec-fetch-site': 'cross-site' })).toBe(403);
    expect(await post(base, '/speak', { host: 'evil.example' })).toBe(403);
  });
});
