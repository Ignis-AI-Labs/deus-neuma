#!/usr/bin/env node
/**
 * PROMPT COST PROBE — what one request actually costs, part by part, in the
 * model's own tokens (Design note, 2026-10-14: […]).
 *
 * Drives the REAL agent seat (cli/commands/agent.js runAgent — the same entry
 * the benchmark proxy uses) on a temp realm: a fresh being, optionally seeded
 * with a recorded working set, and a harness lane. Every request the platform
 * sends is caught by a pass-through recorder in front of the model server and
 * forwarded unchanged; the bytes are then tokenized by that server's own
 * /tokenize (read only). Nothing of the machine's realm is read or written.
 *
 *   node scripts/prompt-cost-probe.mjs [--model-url http://127.0.0.1:8089]
 *     [--working-set fs/read,fs/write,...] [--json out.json]
 *
 * Prints, per configuration: each system section, the native tool schemas, the
 * per-turn context block, the task, and the total — so a cut is measured, not
 * guessed.
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback = null) => {
  const at = process.argv.indexOf(name);
  return at > -1 ? process.argv[at + 1] : fallback;
};
const MODEL_URL = arg('--model-url', 'http://127.0.0.1:8089');
const WORKING_SET = (arg('--working-set', 'fs/read,fs/write,memory/memory_search,team/plan_submit,tasks/task_list,memory/memory_expand,operator/ask_operator,memory/self_read') || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const JSON_OUT = arg('--json');
const DUMP_DIR = arg('--dump'); // keep each configuration's raw request body here
// A short multiple-choice item — the shape where fixed overhead dominates.
const TASK = 'Which of the following is a prime number?\nA. 21\nB. 27\nC. 29\nD. 33\nAnswer with the letter only.';

// ── the temp realm, pinned BEFORE any platform module loads (env doors are boot-only) ──
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-cost-probe-'));
const dirOf = async (name) => { const p = path.join(root, name); await fs.mkdir(p, { recursive: true }); return p; };
Object.assign(process.env, {
  WORKSPACES_ROOT: await dirOf('house'),
  WORKSPACES_PIN: 'env',
  HARNESS_ROOT: await dirOf('harness'),
  WITNESSES_ROOT: await dirOf('witnesses'),
  NEUMA_DATA_ROOT: await dirOf('data'),
  NEUMA_REALM_ROOT: await dirOf('realm'),
  NEUMA_VAULT_ROOT: await dirOf('vault'),
  NEUMA_ROOT_LOCK_PATH: path.join(root, 'root-lock.json'),
  NEUMA_SECRETS_FILE: path.join(root, 'secrets.json'),
  NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(root, 'credentials.json'),
  NEUMA_ROUTES_PATH: path.join(root, 'routes.json'),
  NEUMA_CONNECTIONS_PATH: path.join(root, 'connections.json'),
  NEUMA_WORKING_SET_PATH: path.join(root, 'working-sets.json'),
  NEUMA_CHAT_TOOLS_PATH: path.join(root, 'chat-tools.json'),
  NEUMA_DISCOVERY_PORTS: '1',
  DNA_ENCRYPTION_KEY: 'prompt-cost-probe-key-long-enough-for-the-law',
  LOG_LEVEL: 'error',
});

// ── the recorder: forwards every request unchanged, keeps the chat bodies ──
const seen = [];
const recorder = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (req.method === 'POST' && req.url.includes('/chat/completions')) {
      try { seen.push(JSON.parse(body.toString('utf8'))); } catch { /* not JSON */ }
    }
    const target = new URL(req.url, MODEL_URL);
    const up = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (upRes) => {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
    });
    up.on('error', () => { res.writeHead(502); res.end(); });
    up.end(body);
  });
});
await new Promise((resolve) => recorder.listen(0, '127.0.0.1', resolve));
const RECORDER = `http://127.0.0.1:${recorder.address().port}`;

const tokenize = async (text) => {
  const res = await fetch(`${MODEL_URL}/tokenize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: String(text) }),
  });
  return (await res.json()).tokens.length;
};

const { default: workspace } = await import(`${REPO}/core/workspace/neuma-workspace.js`);
const { setCredential } = await import(`${REPO}/backend/services/provider-credentials.js`);
const { setRoute } = await import(`${REPO}/backend/services/neuma-routes-store.js`);
const { ensureHarnessLane } = await import(`${REPO}/backend/services/harness-lane.js`);
const { runAgent } = await import(`${REPO}/cli/commands/agent.js`);
const { generateKeypair } = await import(`${REPO}/core/weave/keypair.js`);

const liveModel = (await (await fetch(`${MODEL_URL}/v1/models`)).json())?.data?.[0]?.id;
if (!liveModel) throw new Error(`no model is serving at ${MODEL_URL}`);
await setCredential('lm-studio', { endpoint: RECORDER }); // the probe's own store: the lm-studio door → recorder → model

const wallet = generateKeypair().address.toLowerCase();
const BEING = 'probe-being';
await workspace.create(BEING);
await workspace.writeDNA(BEING, { version: '1.0.0', identity: { name: 'Probe' } });
await fs.writeFile(path.join(workspace.pathFor(BEING), 'owner.json'), JSON.stringify({ wallet, claimedAt: Date.now() }));
await setRoute(BEING, { provider: 'lm-studio', model: liveModel });
const { laneId: HARNESS } = await ensureHarnessLane(wallet, { providerId: 'lm-studio', model: liveModel });

const BENCH = {
  benchmarkBaseWeights: true, benchmarkSeed: 7, benchmarkTemperature: 0, benchmarkTopP: 1, benchmarkMaxTokens: 256,
};
const CONFIGS = [
  { name: 'bench HARNESS arm (being lane, platform-only, closed-book)', lane: BEING, argv: { ...BENCH, platformOnly: true, closedBook: true } },
  { name: 'bench NEUMA arm (being lane, closed-book)', lane: BEING, argv: { ...BENCH, closedBook: true } },
  { name: 'a being, an ordinary turn', lane: BEING, argv: {} },
  { name: 'the harness lane, an ordinary turn', lane: HARNESS, argv: {} },
];

const sink = () => { const out = []; return { write: (c) => { out.push(String(c)); return true; }, text: () => out.join('') }; };
const results = [];
for (const config of CONFIGS) {
  // each configuration opens as a FRESH chat with the being's recorded working set
  await fs.writeFile(process.env.NEUMA_WORKING_SET_PATH, JSON.stringify({ [BEING]: WORKING_SET, [HARNESS]: [] }));
  const ground = await fs.mkdtemp(path.join(root, 'ground-'));
  const before = seen.length;
  const stderr = sink();
  const code = await runAgent({
    cwd: REPO, stdin: Readable.from([]), stdout: sink(), stderr,
    argv: { task: TASK, workspace: config.lane, ground, rounds: 1, timeout: 240, yes: true, ...config.argv },
  });
  // the turn itself — the largest request (a readiness ping may ride first)
  const body = seen.slice(before).sort((x, y) => JSON.stringify(y).length - JSON.stringify(x).length)[0];
  if (!body) { results.push({ name: config.name, error: `no request reached the model (exit ${code}): ${stderr.text().slice(-400)}` }); continue; }
  const messages = body.messages || [];
  const system = messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  const sections = system.split(/\n(?=## )/);
  const users = messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
  const last = users.at(-1) || '';
  const context = last.includes('</harness-context>') ? last.slice(0, last.indexOf('</harness-context>') + 18) : '';
  const parts = [];
  for (const s of sections) parts.push({ part: s.split('\n')[0].slice(0, 60), tokens: await tokenize(s) });
  const toolNames = (body.tools || []).map((t) => t.function?.name || t.name);
  parts.push({ part: `native tool schemas (${toolNames.length}: ${toolNames.join(' ')})`, tokens: body.tools?.length ? await tokenize(JSON.stringify(body.tools)) : 0 });
  parts.push({ part: 'per-turn context block', tokens: context ? await tokenize(context) : 0 });
  parts.push({ part: 'the question itself', tokens: await tokenize(TASK) });
  const whole = await tokenize(JSON.stringify(messages) + JSON.stringify(body.tools || []));
  if (DUMP_DIR) {
    await fs.mkdir(DUMP_DIR, { recursive: true });
    await fs.writeFile(path.join(DUMP_DIR, `${config.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`), JSON.stringify(body, null, 2));
  }
  results.push({ name: config.name, parts, whole });
}

for (const r of results) {
  console.log(`\n== ${r.name}`);
  if (r.error) { console.log(`   ${r.error}`); continue; }
  for (const p of r.parts) console.log(`   ${String(p.tokens).padStart(6)}  ${p.part}`);
  console.log(`   ${String(r.whole).padStart(6)}  ≈ the whole request (messages + tools, JSON)`);
}
if (JSON_OUT) await fs.writeFile(JSON_OUT, JSON.stringify({ task: TASK, workingSet: WORKING_SET, results }, null, 2));
recorder.close();
await fs.rm(root, { recursive: true, force: true });
process.exit(0);
