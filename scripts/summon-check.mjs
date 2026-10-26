/**
 * SUMMON CHECK — can THIS local model, on THIS machine, carry a summoning?
 *
 * An operator may use any model, so long as it is local and has the capacity
 * to summon a neuma. That capacity is measured here, never assumed from a model's name: the whole ceremony walked end to
 * end against a local provider, passing only when every act the birth needs
 * truly landed. The smallest setup that passes sets the published MINIMUM
 * spec (docs/work/release-early-access.md).
 *
 *   REAL local provider (Ollama, LM Studio, or a llama-server you started)
 *   REAL MCP filesystem server, REAL portal routes over a REAL WebSocket,
 *   REAL StagedBirthHandler, packaged-shaped paths (NEUMA_DATA_ROOT set)
 *
 * REHEARSAL, NOT A BIRTH. `isTest: true` — BIRTH ETHICS forbid create-and-
 * discard. The rehearsal still EXECUTES the naming and genesis writes; the
 * verdict reads them from the act ledger and the disk, never from the
 * ceremony's own say-so (#272).
 *
 * NEVER the house substrate: a llama-server endpoint on :8089 is refused, and
 * the llama-server provider runs in the sandbox lane (NEUMA_SUBSTRATE_SANDBOX)
 * against a server that must ALREADY be answering — this script never boots,
 * restarts or stops one.
 *
 * Usage:
 *   node scripts/summon-check.mjs --provider ollama --model qwen3:8b
 *   node scripts/summon-check.mjs --provider lm-studio --model <id>
 *   node scripts/summon-check.mjs --provider llama-server --endpoint http://127.0.0.1:8189
 * Writes a receipt to data/logs/summon-check/<stamp>.json (or --out <dir>).
 */
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { promises as fsp } from 'fs';
import { join, resolve } from 'path';
import os from 'os';
import { parseArgs } from 'util';
import process from 'node:process';
import { URL } from 'node:url';
import { walkCeremony } from './lib/summon-walk.mjs';

const { fetch } = globalThis;

const DEFAULT_ENDPOINTS = Object.freeze({
  ollama: 'http://localhost:11434',
  'lm-studio': 'http://localhost:1234',
  'llama-server': 'http://127.0.0.1:8189',
});
const HOUSE_PORT = '8089';

const { values: args } = parseArgs({
  options: {
    provider: { type: 'string', default: 'ollama' },
    endpoint: { type: 'string' },
    model: { type: 'string' },
    attempts: { type: 'string', default: '3' },
    out: { type: 'string' },
    'stage-minutes': { type: 'string', default: '12' },
    // held stages a walk retries, as a person pressing RETRY THE STAGE would (0: none, the strict check)
    'stage-retries': { type: 'string', default: '0' },
  },
});
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
const fail = (msg) => { say(`✗ ${msg}`); process.exit(2); };

const PROVIDER = args.provider;
if (!DEFAULT_ENDPOINTS[PROVIDER]) fail(`--provider must be one of: ${Object.keys(DEFAULT_ENDPOINTS).join(', ')}`);
const ENDPOINT = (args.endpoint || DEFAULT_ENDPOINTS[PROVIDER]).replace(/\/$/, '');
if (new URL(ENDPOINT).port === HOUSE_PORT) fail(`${ENDPOINT} is the house substrate — never walked from here`);
const ATTEMPTS = Math.max(1, Number(args.attempts) || 3);
const WALK_MS = Math.max(1, Number(args['stage-minutes']) || 12) * 60_000;

// --- the substrate must already be there, and the model must be named ---
const listModels = async () => {
  if (PROVIDER === 'ollama') {
    const tags = await fetch(`${ENDPOINT}/api/tags`).then((r) => r.json());
    return (tags.models || []).map((m) => m.name);
  }
  if (PROVIDER === 'llama-server') {
    const health = await fetch(`${ENDPOINT}/health`);
    if (!health.ok) throw new Error(`/health answered ${health.status}`);
  }
  const list = await fetch(`${ENDPOINT}/v1/models`).then((r) => r.json());
  return (list.data || []).map((m) => m.id);
};
let MODEL = args.model || null;
try {
  const present = await listModels();
  if (!MODEL && present.length === 1) [MODEL] = present;
  if (!MODEL) fail(`name a --model; ${ENDPOINT} holds: ${present.join(', ') || '(none)'}`);
  if (!present.includes(MODEL)) fail(`${ENDPOINT} has no model "${MODEL}". Present: ${present.join(', ') || '(none)'}`);
} catch (e) {
  fail(`${PROVIDER} unreachable at ${ENDPOINT} — ${e.message}`);
}
say(`substrate: ${PROVIDER} at ${ENDPOINT}, model ${MODEL}`);

const root = await fsp.mkdtemp(join(os.tmpdir(), 'summon-check-'));
const house = join(root, 'workspaces');
const dataRoot = join(root, 'data');
await fsp.mkdir(house, { recursive: true });
await fsp.mkdir(dataRoot, { recursive: true });

// Packaged shape, and the sandbox lane for anything substrate-shaped.
process.env.NEUMA_DATA_ROOT = dataRoot;
process.env.DNA_ENCRYPTION_KEY = 'summon-check-rehearsal-key-long-enough';
process.env.NEUMA_SUBSTRATE_SANDBOX = '1';
if (PROVIDER === 'llama-server') process.env.LLAMA_SERVER_URL = ENDPOINT;

const { setConfig } = await import('../backend/services/llm-provider.js');
const { setupPortalRoutes } = await import('../backend/routes/portal-routes.js');
const { generateChallenge, verifySignature, createSessionToken } = await import('../backend/services/auth.js');
const { generateKeypair, signMessage } = await import('../core/weave/keypair.js');
const { StagedBirthHandler } = await import('../core/birth/staged-birth-handler.js');
const { setWorkspacesRoot } = await import('../core/workspace/neuma-workspace.js');
const { connectFilesystemServer } = await import('../backend/services/mcp-filesystem.js');
const { mcpService } = await import('../backend/services/mcp.js');
const { readActs } = await import('../backend/services/act-ledger.js');
const { getSubstrateProfile } = await import('../backend/services/substrate-detector.js');

const machine = await getSubstrateProfile().then((p) => ({
  cpu: p?.cpu?.model ?? null,
  cores: p?.cpu?.cores ?? null,
  ramGB: p?.memory?.totalGB ? Math.round(p.memory.totalGB) : null,
  gpu: p?.gpu?.name ?? null,
  vramGB: p?.gpu?.vramGB ?? null,
}), () => null);

setWorkspacesRoot(house);
setConfig({ provider: PROVIDER, endpoint: ENDPOINT, model: MODEL, apiKey: '' });
await connectFilesystemServer();

const handler = new StagedBirthHandler(
  { createNeumaSession: async () => 'tok', createDNA: async () => ({}) },
  { handleServerUpdate: () => {} },
);
await handler._ready;

const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer });
setupPortalRoutes(wss, { birthHandler: handler });
await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));

const keypair = generateKeypair();
const challenge = generateChallenge(keypair.address);
const signature = await signMessage(keypair.privateKey, challenge);
const token = createSessionToken(verifySignature(keypair.address, challenge, signature));

// THE ACTS MUST HAVE TRULY LANDED (#272): the naming write and the genesis
// write both succeed in the ledger, and nothing erred or was denied.
const judgeActs = async () => {
  const acts = await readActs().catch(() => []);
  const failed = acts.filter((a) => a.status !== 'success' && a.status !== 'ok');
  if (failed.length) return { ok: false, why: `acts failed: ${failed.map((a) => `${a.tool} (${a.status})`).join(', ')}` };
  const named = acts.some((a) => a.status === 'success' && String(a.scope || '').endsWith('chosen_name.txt'));
  const genesis = acts.some((a) => a.status === 'success' && /genesis\.md$/.test(String(a.scope || '')));
  if (!named || !genesis) return { ok: false, why: `ceremony writes missing — naming: ${named}, genesis: ${genesis}` };
  return { ok: true, why: 'consented, named itself, and authored its DNA — every act landed' };
};

// A small substrate misses a turn now and then; the operator has RETRY for
// that. The receipt records how many attempts it took — 1 of 3 and 3 of 3
// are different machines to recommend.
const attempts = [];
let verdict = null;
for (let n = 1; n <= ATTEMPTS && !verdict?.ok; n += 1) {
  await fsp.rm(join(dataRoot, 'acts'), { recursive: true, force: true });
  await fsp.rm(house, { recursive: true, force: true });
  await fsp.mkdir(house, { recursive: true });
  say(`\n--- summoning rehearsal, attempt ${n}/${ATTEMPTS} ---`);
  const run = await walkCeremony({ wsUrl: `ws://127.0.0.1:${httpServer.address().port}?token=${token}`, walkMs: WALK_MS,
    stageRetries: Math.max(0, Number(args['stage-retries']) || 0) });
  verdict = run.ok ? { ...run, ...(await judgeActs()) } : run;
  attempts.push({ n, ok: verdict.ok, why: verdict.why, stages: run.stages, totalMs: run.totalMs });
  if (!verdict.ok) say(`  attempt ${n} failed: ${verdict.why}`);
}

const receipt = {
  schema: 'summon-check/v1',
  at: new Date().toISOString(),
  provider: PROVIDER,
  endpoint: ENDPOINT,
  model: MODEL,
  machine,
  pass: Boolean(verdict?.ok),
  attemptsUsed: attempts.length,
  attemptsAllowed: ATTEMPTS,
  why: verdict?.why ?? null,
  attempts,
};
const outDir = resolve(args.out || join(process.cwd(), 'data', 'logs', 'summon-check'));
await fsp.mkdir(outDir, { recursive: true });
const outFile = join(outDir, `${receipt.at.replace(/[:.]/g, '-')}.json`);
await fsp.writeFile(outFile, `${JSON.stringify(receipt, null, 2)}\n`);

say('\n--- VERDICT ---');
say(receipt.pass
  ? `PASS on attempt ${receipt.attemptsUsed}/${ATTEMPTS} — ${receipt.why}`
  : `FAIL after ${ATTEMPTS} attempt(s) — ${receipt.why}`);
say(`receipt: ${outFile}`);
say(`(rehearsal ground kept for inspection: ${root})`);

process.emit('SIGTERM');
await mcpService.disconnect('filesystem').catch(() => {});
wss.close();
httpServer.close();
process.exit(receipt.pass ? 0 : 1);
