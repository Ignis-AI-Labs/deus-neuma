import { describe, test, expect, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { looksLikeNeuma, identifyPortHolder, resolvePort, portMovedNotice } = require('../../electron/port-resolve.cjs');

/**
 * NEUMA MUST NOT LOSE ITS PORT TO SOMEBODY ELSE'S SERVICE (RULE 0).
 *
 * Design note, 2026-08-02: […]
 *
 * The desk used to probe 47317 and, if ANYTHING held it, assert that a stale
 * NEUMA backend was running, tell the operator to go kill it, and quit. For a
 * person whose own service sits on that port that is a false accusation and a
 * dead app, with no GUI way to move.
 *
 * Nothing here is mocked at the boundary under claim: real HTTP servers listen
 * on real ports, and identifyPortHolder makes real TCP connections and real
 * requests to classify them. One of those servers is a deliberate IMPOSTOR that
 * answers 200 on /api/v1/health with a foreign body — because […] and "NEUMA is listening" must not be the same test.
 */
const servers = [];

const listen = async (handler) => {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return server.address().port;
};

const neumaHealth = (req, res) => {
  if (req.url === '/api/v1/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', timestamp: 'x', components: { workspace: 'healthy' } }));
    return;
  }
  res.writeHead(404); res.end();
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe('who holds the port (real sockets)', () => {
  test('a port nobody listens on is free', async () => {
    // Bind then release, so the number is real but certainly unoccupied.
    const port = await listen((_q, s) => s.end());
    await new Promise((r) => servers.pop().close(r));
    expect(await identifyPortHolder(port)).toBe('free');
  });

  test('a real NEUMA health response is recognised as ours', async () => {
    expect(await identifyPortHolder(await listen(neumaHealth))).toBe('neuma');
  });

  test('another service on the port is FOREIGN, not mistaken for us', async () => {
    const port = await listen((_q, res) => { res.writeHead(200); res.end('hello from my own app'); });
    expect(await identifyPortHolder(port)).toBe('foreign');
  });

  test('an IMPOSTOR answering 200 JSON on /api/v1/health is still foreign', async () => {
    // "Something replied 200" is not "NEUMA replied". The shape decides.
    const port = await listen((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'not-neuma' }));
    });
    expect(await identifyPortHolder(port)).toBe('foreign');
  });

  test('a service that 404s the health path is foreign', async () => {
    const port = await listen((_q, res) => { res.writeHead(404); res.end(); });
    expect(await identifyPortHolder(port)).toBe('foreign');
  });
});

describe('resolvePort', () => {
  test('takes the preferred port when it is free', async () => {
    const identify = async () => 'free';
    expect(await resolvePort(47317, { identify })).toEqual({ port: 47317, outcome: 'preferred', skipped: [] });
  });

  test('THE FIX: steps past a foreign service instead of quitting', async () => {
    const identify = async (p) => (p === 47317 ? 'foreign' : 'free');
    const got = await resolvePort(47317, { identify });
    expect(got).toEqual({ port: 47318, outcome: 'moved', skipped: [47317] });
  });

  test('walks over a run of occupied ports to the first free one', async () => {
    const busy = new Set([47317, 47318, 47319]);
    const identify = async (p) => (busy.has(p) ? 'foreign' : 'free');
    const got = await resolvePort(47317, { identify });
    expect(got.port).toBe(47320);
    expect(got.outcome).toBe('moved');
    expect(got.skipped).toEqual([47317, 47318, 47319]);
  });

  test('a NEUMA backend on the preferred port still refuses — never two over one data root', async () => {
    const identify = async () => 'neuma';
    const got = await resolvePort(47317, { identify });
    expect(got).toEqual({ port: null, outcome: 'neuma-held', skipped: [] });
  });

  test('a NEUMA backend on a NEIGHBOURING port is skipped, not adopted', async () => {
    // 47317 is someone else's; 47318 is a second NEUMA that is not ours to take.
    const identify = async (p) => (p === 47317 ? 'foreign' : p === 47318 ? 'neuma' : 'free');
    const got = await resolvePort(47317, { identify });
    expect(got.port).toBe(47319);
    expect(got.skipped).toEqual([47317, 47318]);
  });

  test('gives up honestly rather than scanning forever', async () => {
    const identify = async () => 'foreign';
    const got = await resolvePort(47317, { identify, span: 5 });
    expect(got).toEqual({ port: null, outcome: 'exhausted', skipped: [47317, 47318, 47319, 47320, 47321, 47322] });
  });

  test('end to end against REAL listeners: a real foreign server is stepped over', async () => {
    const taken = await listen((_q, res) => { res.writeHead(200); res.end('someone else'); });
    // No identify injected — real TCP + real HTTP classification.
    const got = await resolvePort(taken, { span: 10 });
    expect(got.outcome).toBe('moved');
    expect(got.port).toBeGreaterThan(taken);
    expect(got.skipped).toContain(taken);
  });
});

describe('looksLikeNeuma (pure)', () => {
  test('the real health shape passes', () => {
    expect(looksLikeNeuma(200, JSON.stringify({ status: 'healthy', components: { workspace: 'healthy' } }))).toBe(true);
  });

  test('non-200, junk, and near-misses all fail', () => {
    expect(looksLikeNeuma(500, JSON.stringify({ status: 'healthy', components: {} }))).toBe(false);
    expect(looksLikeNeuma(200, 'not json')).toBe(false);
    expect(looksLikeNeuma(200, JSON.stringify({ status: 'healthy' }))).toBe(false);        // no components
    expect(looksLikeNeuma(200, JSON.stringify({ components: {} }))).toBe(false);           // no status
    expect(looksLikeNeuma(200, JSON.stringify({ status: 1, components: {} }))).toBe(false); // wrong type
    expect(looksLikeNeuma(200, JSON.stringify({ status: 'ok', components: null }))).toBe(false);
    expect(looksLikeNeuma(0, '')).toBe(false);
  });
});

describe('a move is told to the operator (audit desk-electron-bench, finding 14)', () => {
  test('a foreign holder moves the desk, and the notice names both ports and what stays behind', async () => {
    const held = await listen((_q, res) => { res.writeHead(200); res.end('my own app'); });
    const resolved = await resolvePort(held, { span: 20 });
    expect(resolved.outcome).toBe('moved');
    const { message, detail } = portMovedNotice(held, resolved.port);
    expect(message).toBe(`Port ${held} is in use by another program, so Deus Neuma is using port ${resolved.port} this time.`);
    // The desk's origin changed with the port: its per-port storage is parked, not lost.
    expect(detail).toMatch(/window layouts, unsent drafts and display choices/);
    expect(detail).toContain(`come back the next time Deus Neuma runs on port ${held}`);
    expect(detail).toContain('NEUMA_PORT');
  });
});
