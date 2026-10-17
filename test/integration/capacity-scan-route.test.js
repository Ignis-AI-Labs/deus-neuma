/**
 * THE CAPACITY SCAN ROUTE — a scan the operator started must actually run.
 *
 * Design note, 2026-08-29, with the log in one hand and the panel in the other: […]
 *
 * ONE ROOT CAUSE, BOTH SYMPTOMS. The route hung its soft-stop on
 * `req.on('close')`. On Node 24 a POST's REQUEST stream closes the moment
 * express.json() finishes reading the body — measured at ~1ms with the client
 * still very much connected — so every scan aborted before its first ladder
 * level. The route then answered NOTHING, because an abort was assumed to mean
 * a vanished client; the panel's fetch never settled, so "MEASURING" stayed on
 * screen forever.
 *
 * These tests run the REAL router over a REAL socket (RULE 0). The scan's
 * `fire` seam is the module's own documented injection point, so no probe
 * touches the rig — but every layer that broke is the real one.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { runCapacityScan } from '../../backend/services/capacity-scan.js';

let server; let base; let dir; let priorPath;

// The route's own shape: json body parsing in front, a long-running POST that
// answers only when the work is done. This is the arrangement that broke.
const buildApp = ({ onScan }) => {
  const app = express();
  app.use(express.json());
  let inflight = false;
  let progress = null;
  app.get('/capacity', (_req, res) => {
    res.json({ scan: inflight ? { running: true, progress } : { running: false } });
  });
  app.post('/capacity', async (req, res) => {
    if (inflight) return res.status(409).json({ error: 'already running' });
    inflight = true;
    const controller = new AbortController();
    // THE FIX UNDER TEST: res, never req.
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const result = await onScan({ signal: controller.signal, onProgress: (p) => { progress = p; } });
      res.json({ result });
    } catch (err) {
      if (!res.writableEnded) res.status(499).json({ error: err.message, aborted: true });
    } finally {
      inflight = false;
      progress = null;
    }
  });
  return app;
};

// A level that takes real (small) time, so an abort has somewhere to land.
const slowFire = async (concurrency) => {
  await new Promise((r) => { setTimeout(r, 15); });
  return { ok: true, concurrency, medianMs: 100, throughput: concurrency };
};

const scanWith = (opts) => runCapacityScan({
  fire: slowFire,
  testConnection: async () => true,
  substrate: { model: 'probe' },
  runAt: '2026-08-29T09:00:00Z',
  ...opts,
});

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'cap-route-'));
  priorPath = process.env.NEUMA_CAPACITY_PATH;
  process.env.NEUMA_CAPACITY_PATH = path.join(dir, 'capacity');
});

afterAll(async () => {
  if (priorPath === undefined) delete process.env.NEUMA_CAPACITY_PATH;
  else process.env.NEUMA_CAPACITY_PATH = priorPath;
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  if (server) await new Promise((r) => server.close(r));
  server = null;
});

const listen = async (app) => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
};

describe('a scan the operator started RUNS', () => {
  test('THE REGRESSION: a connected client does not abort its own scan', async () => {
    // This is the exact failure. Before the fix, this POST came back 499 with
    // "aborted" while the caller had not moved.
    await listen(buildApp({ onScan: ({ signal, onProgress }) => scanWith({ signal, onProgress }) }));
    const res = await fetch(`${base}/capacity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.result?.ceiling).toBeGreaterThan(0);
    expect(body.aborted).toBeUndefined();
  }, 30000);

  test('an EMPTY body cannot abort it either — that is what read the stream shut', async () => {
    await listen(buildApp({ onScan: ({ signal, onProgress }) => scanWith({ signal, onProgress }) }));
    const res = await fetch(`${base}/capacity`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json()).result?.ceiling).toBeGreaterThan(0);
  }, 30000);

  test('the in-flight scan is visible to a SECOND reader while it runs', async () => {
    // The panel that did not start the scan — or was reopened — must still see
    // it. This is why progress lives on the server and not in a component.
    let release;
    const held = new Promise((r) => { release = r; });
    await listen(buildApp({
      onScan: async ({ signal, onProgress }) => {
        const p = scanWith({ signal, onProgress });
        setTimeout(release, 60);
        return p;
      },
    }));
    const running = fetch(`${base}/capacity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    await held;
    const peek = await (await fetch(`${base}/capacity`)).json();
    expect(peek.scan.running).toBe(true);
    expect(peek.scan.progress).toBeTruthy();
    expect(peek.scan.progress.ladder.length).toBeGreaterThan(0);
    await running;
    // ...and it is gone again once the run settles, so the panel stops.
    const after = await (await fetch(`${base}/capacity`)).json();
    expect(after.scan.running).toBe(false);
  }, 30000);
});

describe('a scan the operator really did stop', () => {
  test('a client that walks away DOES abort it, and nothing is recorded', async () => {
    await listen(buildApp({ onScan: ({ signal, onProgress }) => scanWith({ signal, onProgress }) }));
    const ctl = new AbortController();
    const p = fetch(`${base}/capacity`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: ctl.signal,
    }).catch((e) => e);
    setTimeout(() => ctl.abort(), 40);
    const out = await p;
    expect(out.name).toBe('AbortError'); // the client is genuinely gone

    // The server lets go TOO — but not instantly, and the honest law is the
    // one worth pinning: the abort lands between ladder levels, so the
    // single-flight latch releases within a bounded time rather than sticking
    // forever. A latch that never released would 409 every future scan.
    let released = false;
    for (let i = 0; i < 40 && !released; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      released = !(await (await fetch(`${base}/capacity`)).json()).scan.running;
      // eslint-disable-next-line no-await-in-loop
      if (!released) await new Promise((r) => { setTimeout(r, 25); });
    }
    expect(released, 'the aborted scan never released its single-flight latch').toBe(true);
    const again = await fetch(`${base}/capacity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(again.status).toBe(200);
  }, 30000);

  test('AN ABORT STILL ANSWERS — a live panel is never left on a promise that cannot settle', async () => {
    // The second half of the bug: the route used to return silently, so the
    // fetch never resolved and the card showed MEASURING for good.
    await listen(buildApp({
      onScan: async ({ signal }) => {
        const err = new Error('capacity scan aborted by the operator — no run recorded');
        void signal;
        throw err;
      },
    }));
    const res = await fetch(`${base}/capacity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(499);
    const body = await res.json();
    expect(body.aborted).toBe(true);
    expect(body.error).toContain('aborted');
  }, 30000);
});
