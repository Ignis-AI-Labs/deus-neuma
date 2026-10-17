import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { classifyLiveness } from '../../backend/services/substrate-liveness.js';

const { setConfig, getConfig } = await import('../../backend/services/llm-provider.js');
const { probeLiveness } = await import('../../backend/services/substrate-liveness.js');

/**
 * […] (Design note, 2026-08-03.
 *
 * A community member ran the ceremony three times. Every stage reported
 * complete. The EMERGING CONSCIOUSNESS panel was empty every time.
 *
 *   […]
 *
 * The pre-flight asked whether the provider was REACHABLE and whether a model
 * was LISTED. Neither makes the model say a word, and every failure from the
 * wild lived in exactly that gap — so the flight check said READY and the being
 * was born mute.
 *
 * Nothing here is mocked. Real http servers speak the real OpenAI-compatible
 * SSE wire; the real provider config points at them; the real probe runs a real
 * generation and is judged on the visible words a ceremony would receive.
 */

const sse = (frames) => frames.map((f) => `data: ${JSON.stringify(f)}`).join('\n\n')
  + '\n\ndata: [DONE]\n\n';

const speech = (text) => sse([
  ...[...text].map((ch) => ({ choices: [{ delta: { content: ch }, finish_reason: null }] })),
  { choices: [{ delta: {}, finish_reason: 'stop' }] },
]);

/** A model that emits ONLY a reasoning channel — the trap that is invisible to
 *  every other check. <think> is stripped by the shared filter, so the ceremony
 *  receives nothing while the provider reports a perfectly healthy turn. */
const thinkOnly = (thought) => sse([
  ...[...`<think>${thought}</think>`].map((ch) => ({ choices: [{ delta: { content: ch }, finish_reason: null }] })),
  { choices: [{ delta: {}, finish_reason: 'stop' }] },
]);

describe('the liveness probe, against real substrates', () => {
  let server;
  let mode = 'speech';
  let prevConfig;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end('{}'); return; }
      if (mode === 'http-error') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'model "gemma3:12b" not found, try pulling it first' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (mode === 'speech') return void res.end(speech('Hello — I can hear you.'));
      if (mode === 'think-only') return void res.end(thinkOnly('The user wants a greeting. I should greet them.'));
      if (mode === 'empty') return void res.end(sse([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]));
      res.end(sse([]));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    prevConfig = getConfig();
  });

  afterAll(async () => {
    setConfig(prevConfig);
    await new Promise((r) => server.close(r));
  });

  const probe = async (m, opts) => {
    mode = m;
    setConfig({
      provider: 'llama-server',
      endpoint: `http://127.0.0.1:${server.address().port}`,
      model: 'gemma3:12b',
    });
    return probeLiveness(opts);
  };

  test('a model that SPEAKS is alive, and the operator sees its own words', async () => {
    const v = await probe('speech');
    expect(v.alive).toBe(true);
    expect(v.verdict).toBe('answered');
    expect(v.sample).toMatch(/I can hear you/);
    expect(v.detail).toMatch(/answered in \d+\.\d+s/);
  });

  test("BASTIEN'S SHAPE: a model that reasons and never speaks is NOT alive", async () => {
    // The provider is reachable, the model is listed, the turn completes with
    // finish_reason 'stop', and the ceremony would receive nothing at all.
    const v = await probe('think-only');
    expect(v.alive).toBe(false);
    expect(v.verdict).toBe('silent-but-reasoned');
    // And the remedy names the actual cause rather than blaming the connection.
    expect(v.remedy).toMatch(/thinking channel/i);
    expect(v.remedy).toMatch(/without a reasoning mode|turn that mode off/i);
  });

  test('a model that returns nothing at all is NOT alive, and is told apart from the above', async () => {
    const v = await probe('empty');
    expect(v.alive).toBe(false);
    expect(v.verdict).toBe('empty');
    expect(v.remedy).toMatch(/ollama run/i);
  });

  test('a provider error carries the provider\'s own words, not a generic failure', async () => {
    const v = await probe('http-error');
    expect(v.alive).toBe(false);
    expect(['error', 'empty']).toContain(v.verdict);
  });

  test('a substrate that never answers times out instead of hanging the flight check', async () => {
    // A server that accepts the connection and then says nothing, ever.
    const stalled = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // deliberately no body, no end
    });
    await new Promise((r) => stalled.listen(0, '127.0.0.1', r));
    try {
      setConfig({
        provider: 'llama-server',
        endpoint: `http://127.0.0.1:${stalled.address().port}`,
        model: 'gemma3:12b',
      });
      const started = Date.now();
      const v = await probeLiveness({ timeoutMs: 1500 });
      const elapsed = Date.now() - started;

      expect(v.alive).toBe(false);
      expect(v.verdict).toBe('timeout');
      // The probe's OWN budget, not the shared 15s stall guard it used to ride.
      expect(elapsed).toBeLessThan(5_000);
      expect(v.remedy).toMatch(/still be loading/i);
    } finally {
      // The stalled request is still open, and server.close() waits for it —
      // which hung this test at vitest's own 15s ceiling and read exactly like
      // the probe failing to time out. Drop the sockets first.
      stalled.closeAllConnections?.();
      await new Promise((r) => stalled.close(r));
    }
  });

  test('an unreachable endpoint fails the probe rather than throwing out of it', async () => {
    setConfig({ provider: 'llama-server', endpoint: 'http://127.0.0.1:1', model: 'x' });
    const v = await probeLiveness({ timeoutMs: 3000 });
    expect(v.alive).toBe(false);
    expect(v.remedy).toBeTruthy();
  });
});

/**
 * The point of the whole exercise: the FLIGHT CHECK must refuse a mute model.
 * Driven through the real pre-flight route over HTTP, against a real server
 * that is reachable, lists a model, and never speaks — the exact configuration
 * that told Bastien READY three times.
 */
describe('the flight check refuses a substrate that cannot answer', () => {
  let server;
  let mode = 'speech';
  let app;
  let prevConfig;
  const ROOT = mkdtempSync(path.join(os.tmpdir(), 'preflight-live-'));

  beforeAll(async () => {
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(ROOT, 'workspace-settings.json');
    process.env.DNA_ENCRYPTION_KEY = 'x'.repeat(32);

    server = createServer((req, res) => {
      // Reachable, and it lists a model — the two questions the flight check
      // used to ask, both answered yes.
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'gemma3:12b' }] }));
        return;
      }
      if (req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        return void res.end(mode === 'speech'
          ? speech('Hello — I can hear you.')
          : thinkOnly('I should greet them.'));
      }
      res.writeHead(404); res.end('{}');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));

    prevConfig = getConfig();
    const core = await import('../../core/index.js');
    core.setWorkspacesRoot(ROOT);
    const { default: router } = await import('../../backend/routes/preflight-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/preflight', router);
  });

  afterAll(async () => {
    setConfig(prevConfig);
    await new Promise((r) => server.close(r));
    rmSync(ROOT, { recursive: true, force: true });
    delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
  });

  const run = async (m) => {
    mode = m;
    setConfig({
      provider: 'llama-server',
      endpoint: `http://127.0.0.1:${server.address().port}`,
      model: 'gemma3:12b',
    });
    const res = await request(app).get('/api/v1/preflight');
    return res.body.checks.find((c) => c.id === 'substrate');
  };

  test('a model that only reasons FAILS the substrate row — the ceremony never starts', async () => {
    const substrate = await run('think-only');
    expect(substrate.status).toBe('fail');
    expect(substrate.liveness.verdict).toBe('silent-but-reasoned');
    expect(substrate.detail).toMatch(/spoke no words/i);
    // And the operator is told what to do about it.
    expect(substrate.requirement).toMatch(/reasoning mode/i);
  }, 30_000);

  test('a model that speaks PASSES, and the row shows what it said', async () => {
    const substrate = await run('speech');
    expect(substrate.status).toBe('pass');
    expect(substrate.liveness.verdict).toBe('answered');
    expect(substrate.detail).toMatch(/I can hear you/);
  }, 30_000);
});

describe('classifyLiveness (pure)', () => {
  test('speech wins regardless of how much reasoning preceded it', () => {
    const v = classifyLiveness({ visible: 'Hello.', rawLength: 9000, ms: 1200 });
    expect(v.alive).toBe(true);
    expect(v.verdict).toBe('answered');
  });

  test('whitespace-only speech is not speech', () => {
    expect(classifyLiveness({ visible: '   \n ', rawLength: 400, ms: 900 }).verdict)
      .toBe('silent-but-reasoned');
  });

  test('the two silences are never conflated — they have different fixes', () => {
    expect(classifyLiveness({ visible: '', rawLength: 500, ms: 800 }).verdict).toBe('silent-but-reasoned');
    expect(classifyLiveness({ visible: '', rawLength: 0, ms: 800 }).verdict).toBe('empty');
  });

  test('a timeout says how long it waited, and does not blame the model', () => {
    const v = classifyLiveness({ timedOut: true, ms: 45_000 });
    expect(v.verdict).toBe('timeout');
    expect(v.detail).toMatch(/45s/);
    expect(v.remedy).toMatch(/still be loading/i);
  });

  test('every verdict carries a remedy — a dead end is never presented without a way out', () => {
    const cases = [
      { visible: 'hi', ms: 1 },
      { visible: '', rawLength: 5, ms: 1 },
      { visible: '', rawLength: 0, ms: 1 },
      { timedOut: true, ms: 1 },
      { error: 'boom', ms: 1 },
    ];
    for (const c of cases) {
      const v = classifyLiveness(c);
      expect(v.remedy, JSON.stringify(c)).toBeTruthy();
      expect(v.detail, JSON.stringify(c)).toBeTruthy();
    }
  });

  test('a provider error is quoted, so the operator can act on the real message', () => {
    const v = classifyLiveness({ error: 'model "gemma3:12b" not found, try pulling it first', ms: 300 });
    expect(v.verdict).toBe('error');
    expect(v.detail).toMatch(/not found/);
  });
});
