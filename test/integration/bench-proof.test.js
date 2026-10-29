/**
 * bench-proof.test.js — the PROOF SUITE end to end (RULE 0): a REAL express
 * app, a REAL HMAC token (witnessFor), and a REAL fixture HTTP server on :0
 * speaking genuine chat-completions JSON. The fixture server answers from a
 * deterministic bank — it exercises the runner's plumbing honestly (real
 * fetch, real scoring, real disk); it does NOT prove model behavior. The live
 * gnosis (a real loaded model → a real certificate) is the rollout with Founder.
 */
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { buildBenchFixtureTree } from '../helpers/bench-fixture-tree.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

const GSM8K = JSON.parse(readFileSync(path.resolve('test/fixtures/proof/gsm8k-25-source.json'), 'utf8')).items;

const ENV = [
  'NEUMA_BENCH_HARNESS_PATH', 'NEUMA_BENCH_SERVING_URL', 'NEUMA_BENCH_WATCH_PATH',
  'NEUMA_DATA_ROOT', 'WORKSPACES_ROOT', 'NEUMA_BENCH_TEST_PROCESS_PATTERN',
];

const TWENTY_WORDS = 'calm blue water rolls under soft morning light while patient waves reshape the quiet shore with steady silver rhythm today';
const SIXTY_WORDS = Array(60).fill('steady').join(' ');

/** The deterministic answer bank — every completion a real, parseable answer. */
const answerFor = (prompt) => {
  if (prompt.includes('\n\nQuestion: ')) {
    const question = prompt.split('\n\nQuestion: ')[1];
    const item = GSM8K.find((i) => i.question === question);
    if (!item) return '#### 0';
    // gsm8k-07 deliberately answered WRONG — the scorer's FAIL path must show
    // up in a "passing" run or the run proves nothing.
    if (item.id === 'gsm8k-07') return 'Wrong work.\n#### 0';
    return `Step by step.\n#### ${item.final}`;
  }
  const bank = [
    ['the key "ok" set to true', '{"ok":true}'],
    ['"ok" (a boolean) and "items" (an array', '{"ok":true,"items":[]}'],
    ['keys "name" (a string) and "age" (a number)', '{"name":"Ada","age":36}'],
    ['exactly 3 strings', '["apple","pear","plum"]'],
    ['"population": number', '{"city":{"name":"Paris","population":2100000}}'],
    ['exactly 2 objects', '[{"id":1,"label":"a"},{"id":2,"label":"b"}]'],
    ['6 multiplied by 7', '{"answer":42}'],
    ['exactly 20 words', TWENTY_WORDS],
    ['at least 50 words', SIXTY_WORDS],
    ['ALL CAPITAL LETTERS', 'THE CAPITAL OF FRANCE IS PARIS.'],
    ['all lowercase letters', 'the answer is four.'],
    ['the word "beam"', 'A lighthouse casts its beam across the dark water.'],
    ['"aroma" and the word "bitter"', 'The aroma of this coffee is pleasantly bitter.'],
    ['without using the word "red"', 'Cyan, magenta, and yellow.'],
    ['"green" or "leaf"', 'A tall trunk rises over the quiet field.'],
    ['exactly 4 planets', '1. Mercury\n2. Venus\n3. Earth\n4. Mars'],
    ['exactly 3 tips', '1. Dim the lights\n2. Keep a schedule\n3. Cool the room'],
    ['Begin your answer with exactly', 'The answer is Jupiter.'],
  ];
  for (const [fragment, answer] of bank) {
    if (prompt.includes(fragment)) return answer;
  }
  throw new Error(`fixture server: no banked answer for prompt: ${prompt.slice(0, 80)}`);
};

/** A REAL chat-completions server. `held` gates answers until released. */
const startFixtureServer = async () => {
  const state = { held: null };
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"data":[{"id":"proof-fixture-v1"}]}');
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      if (state.held) await state.held;
      let body = '';
      for await (const chunk of req) body += chunk;
      const prompt = JSON.parse(body).messages[0].content;
      // An unbanked prompt is a fixture BUG — answer 500 so the runner's
      // transport path records it loudly instead of hanging the suite.
      try {
        const content = answerFor(prompt);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
        }));
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    hold: () => { state.held = new Promise((done) => { state.release = done; }); },
    release: () => { const r = state.release; state.held = null; r?.(); },
  };
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));


// a settled set notifies its operator — into a temp realm, never the machine's
useTempRealm();
describe('Bench proof suite (/api/v1/bench)', () => {
  let house, witness, app, fixture;
  const saved = {};

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) { saved[k] = process.env[k]; }

    house = await createTempDir('bench-proof');
    const tree = path.join(house, 'harness');
    await buildBenchFixtureTree(tree);
    process.env.NEUMA_BENCH_HARNESS_PATH = tree;
    process.env.WORKSPACES_ROOT = path.join(house, 'workspaces');
    process.env.NEUMA_DATA_ROOT = path.join(house, 'data');
    process.env.NEUMA_BENCH_WATCH_PATH = path.join(house, 'watch', 'incidents.jsonl');

    fixture = await startFixtureServer();
    process.env.NEUMA_BENCH_SERVING_URL = fixture.url;

    const { witnessFor } = await import('../helpers/witness.js');
    witness = await witnessFor(process.env.WORKSPACES_ROOT, 'benchlane');
    // The bench plane runs the machine's processes: its launches are the install owner's.
    await makeInstallOwner(witness.address);
    const { default: router } = await import('../../backend/routes/bench-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/bench', router);
  });

  afterEach(async () => {
    await new Promise((done) => fixture.server.close(done));
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  const pollRun = async () => {
    for (let i = 0; i < 200; i += 1) {
      const res = await request(app).get('/api/v1/bench/proof-run').set(witness.header);
      if (res.body.run.state !== 'running') return res.body.run;
      await sleep(100);
    }
    throw new Error('the proof run did not settle in 20s');
  };

  test('a full run: 202 → poll → sealed receipt → certificate route → integrity recomputes', async () => {
    const start = await request(app).post('/api/v1/bench/proof-run').set(witness.header).send({});
    expect(start.status).toBe(202);
    expect(start.body.total).toBe(43);

    const done = await pollRun();
    expect(done.state).toBe('done');
    expect(done.done).toBe(43);
    expect(done.verdict).toEqual({ pass: 42, total: 43 }); // the one deliberate miss
    // The watcher's state carries the live-item detail (residue of the last item).
    expect(Number.isFinite(Date.parse(done.itemStartedAt))).toBe(true);
    expect(typeof done.itemPrompt).toBe('string');
    expect(done.itemPrompt.length).toBeLessThanOrEqual(301); // truncated server-side
    expect(done.lastItem.id).toBe('format-answer'); // the suite's last item in run order
    expect(done.lastItem.pass).toBe(true);
    expect(Number.isInteger(done.lastItem.durationMs)).toBe(true);
    expect(typeof done.lastItem.detail).toBe('string');

    const proofs = (await request(app).get('/api/v1/bench/proofs').set(witness.header)).body.proofs;
    expect(proofs.length).toBe(1);
    expect(proofs[0].id).toBe(done.proofId);

    const one = await request(app).get(`/api/v1/bench/proofs/${done.proofId}`).set(witness.header);
    expect(one.status).toBe(200);
    const { receipt, certificate } = one.body;
    expect(receipt.subject.servedId).toBe('proof-fixture-v1');
    expect(receipt.sampling).toEqual({ temperature: 0, seed: 7 });
    expect(receipt.sections.arithmetic).toEqual({ total: 25, pass: 24 });
    expect(receipt.sections.instruction).toEqual({ total: 12, pass: 12 });
    expect(receipt.sections.format).toEqual({ total: 6, pass: 6 });
    expect(receipt.items.length).toBe(43);
    // Every item's raw completion rides the receipt.
    expect(receipt.items[0].completion).toContain('####');
    expect(receipt.items.find((i) => i.id === 'gsm8k-07').pass).toBe(false);

    // The certificate attests — and the hash RECOMPUTES from the receipt.
    expect(certificate).toContain('# NEUMA BENCH — PROOF CERTIFICATE');
    expect(certificate).toContain('**42 of 43 items pass — 97.7%.**');
    expect(certificate).toContain(receipt.integrity);
    const { integrityHash } = await import('../../backend/services/bench/proof-certificate.js');
    expect(integrityHash(receipt)).toBe(receipt.integrity);

    // The receipt is really on disk under the isolated data root.
    const onDisk = JSON.parse(await fs.readFile(path.join(
      process.env.NEUMA_DATA_ROOT, 'benchmarks', 'proofs', done.proofId, 'receipt.json'), 'utf8'));
    expect(onDisk.integrity).toBe(receipt.integrity);
  }, 30000);

  test('409 BENCH_PROOF_RUNNING while a run is in flight — then it finishes clean', async () => {
    fixture.hold();
    const start = await request(app).post('/api/v1/bench/proof-run').set(witness.header).send({});
    expect(start.status).toBe(202);
    const second = await request(app).post('/api/v1/bench/proof-run').set(witness.header).send({});
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('BENCH_PROOF_RUNNING');
    fixture.release();
    expect((await pollRun()).state).toBe('done');
  }, 30000);

  // L3 (docs/work/bench-speed-campaign.md): a proof run and a benchmark never
  // share the GPU — each refuses while the other runs, in both directions.
  test('409 BENCH_RIG_LOCKED while a benchmark holds the rig — no item is sent', async () => {
    const tree = process.env.NEUMA_BENCH_HARNESS_PATH;
    let completions = 0;
    fixture.server.on('request', (req) => { if (req.method === 'POST') completions += 1; });
    // The lock names a LIVE pid (this test process) — the real liveness law.
    await fs.mkdir(path.join(tree, 'active.lock'), { recursive: true });
    await fs.writeFile(path.join(tree, 'active.lock', 'owner.json'), JSON.stringify({ pid: process.pid }));
    const res = await request(app).post('/api/v1/bench/proof-run').set(witness.header).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BENCH_RIG_LOCKED');
    expect(res.body.error.message).toContain(String(process.pid));
    expect(completions).toBe(0);
    // A lock left by a dead pid is not a benchmark — the proof may run.
    await fs.writeFile(path.join(tree, 'active.lock', 'owner.json'), JSON.stringify({ pid: 2 ** 22 + 1 }));
    const clear = await request(app).post('/api/v1/bench/proof-run').set(witness.header).send({});
    expect(clear.status).toBe(202);
    expect((await pollRun()).state).toBe('done');
  }, 30000);

  test('a benchmark launch refuses while a proof run is in flight (BENCH_PROOF_RUNNING)', async () => {
    const { launch } = await import('../../backend/services/bench/bench-launch.js');
    fixture.hold();
    const start = await request(app).post('/api/v1/bench/proof-run').set(witness.header).send({});
    expect(start.status).toBe(202);
    const refused = await launch('run-benchmark', { cell: 'gsm8k', arms: ['bare'], model: 'qwen3.8-27b' }, '0xabc123def456');
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe('BENCH_PROOF_RUNNING');
    fixture.release();
    expect((await pollRun()).state).toBe('done');
  }, 30000);

  test('409 BENCH_PLANE_BUSY while the plane owns a running benchmark child', async () => {
    const tree = process.env.NEUMA_BENCH_HARNESS_PATH;
    // A real child that stays alive long enough to be the plane's long act.
    await fs.writeFile(path.join(tree, 'bench.mjs'), 'setTimeout(() => process.exit(0), 5000);\n');
    process.env.NEUMA_BENCH_TEST_PROCESS_PATTERN = `neuma-bench-clear-${process.pid}-${Date.now()}`;
    const { launch, ownedStatus, stopOwned } = await import('../../backend/services/bench/bench-launch.js');
    const started = await launch('run-benchmark', { cell: 'gsm8k', arms: ['bare'], model: 'qwen3.8-27b' }, '0xabc123def456');
    expect(started.ok).toBe(true);
    for (let i = 0; i < 100 && ownedStatus().length === 0; i += 1) await sleep(25);
    const res = await request(app).post('/api/v1/bench/proof-run').set(witness.header).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BENCH_PLANE_BUSY');
    await stopOwned();
  }, 30000);

  test('409 BENCH_NOT_SERVING when nothing answers (load a model first)', async () => {
    process.env.NEUMA_BENCH_SERVING_URL = 'http://127.0.0.1:9'; // dead
    const res = await request(app).post('/api/v1/bench/proof-run').set(witness.header).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BENCH_NOT_SERVING');
    expect(res.body.error.message).toContain('load a model first');
  });

  test('no token is a real 401; idle state reads before any run', async () => {
    expect((await request(app).post('/api/v1/bench/proof-run').send({})).status).toBe(401);
    const idle = await request(app).get('/api/v1/bench/proof-run').set(witness.header);
    // NOTE: this test runs after the runs above only in file order — the
    // runner module is fresh per test (resetModules), so idle holds.
    expect(idle.body.run.state).toBe('idle');
    const missing = await request(app).get('/api/v1/bench/proofs/no-such-proof').set(witness.header);
    expect(missing.status).toBe(404);
    const traversal = await request(app).get('/api/v1/bench/proofs/..%2F..').set(witness.header);
    expect(traversal.status).toBe(404);
  });
});

// The PDF press rides the real Chromium when this machine has one — the same
// gnosis gate as doc-press's own integration test.
const { locateChromium } = await import('../../backend/services/doc-press/index.js');
const chromiumAvailable = (() => {
  try {
    locateChromium();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!chromiumAvailable)('bench proof PDF (real Chromium)', () => {
  let house, witness, app;
  const saved = {};
  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) { saved[k] = process.env[k]; }
    house = await createTempDir('bench-proof-pdf');
    const tree = path.join(house, 'harness');
    await buildBenchFixtureTree(tree);
    process.env.NEUMA_BENCH_HARNESS_PATH = tree;
    process.env.WORKSPACES_ROOT = path.join(house, 'workspaces');
    process.env.NEUMA_DATA_ROOT = path.join(house, 'data');
    process.env.NEUMA_BENCH_WATCH_PATH = path.join(house, 'watch', 'incidents.jsonl');
    process.env.NEUMA_BENCH_SERVING_URL = 'http://127.0.0.1:9';
    const { witnessFor } = await import('../helpers/witness.js');
    witness = await witnessFor(process.env.WORKSPACES_ROOT, 'benchlane');
    // The bench plane runs the machine's processes: its launches are the install owner's.
    await makeInstallOwner(witness.address);
    const { default: router } = await import('../../backend/routes/bench-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/bench', router);
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  test('GET /proofs/:id/pdf presses the sealed certificate into real PDF bytes', async () => {
    // Seal a real proof through the real store (the press route needs one on
    // disk; the runner's own end-to-end is proven in the describe above).
    const { saveProof } = await import('../../backend/services/bench/proof-certificate.js');
    const sealed = await saveProof({
      kind: 'bench-proof', suiteVersion: '1', runId: '2026-09-24T02-00-00-000Z-cafef00d',
      startedAt: '2026-09-24T02:00:00.000Z', finishedAt: '2026-09-24T02:03:00.000Z',
      subject: { servedId: 'proof-fixture-v1' },
      environment: { gpuName: 'NVIDIA RTX PRO 6000', driver: '610.57.04', platformVersion: '0.1.22' },
      sampling: { temperature: 0, seed: 7 },
      sections: { arithmetic: { total: 1, pass: 1 } },
      total: { total: 1, pass: 1 },
      items: [{ id: 'gsm8k-00', section: 'arithmetic', prompt: 'p', completion: '#### 18', pass: true, detail: '18 (via ####)', transportError: false, durationMs: 1 }],
    });
    // supertest leaves non-JSON bodies unparsed — buffer the PDF for real.
    const binary = (res, done) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    };
    const res = await request(app).get(`/api/v1/bench/proofs/${sealed.id}/pdf`)
      .set(witness.header)
      .buffer(true)
      .parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain(`neuma-bench-proof-${sealed.id}.pdf`);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.body.length).toBeGreaterThan(10_000);
  }, 60000);
});
