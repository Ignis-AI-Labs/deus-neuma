/**
 * Two test neuma, one real llama-server, two real LoRA artifacts.
 *
 * The test uses production encrypted registries, immutable artifact staging,
 * binding resolution, request construction, and streaming. It does not touch a
 * living lane or relight the resident house server.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  access,
  chmod,
  mkdtemp,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import {
  refinementCustodyIdentity,
} from '../../core/refinement/training-authority-contract.js';
import { resolveLoraForTurn } from '../../backend/services/adapter-binding.js';
import {
  createRefinementProcessOperation,
} from '../../backend/services/refinement-process-operation.js';
import { sha256FileStable } from '../../backend/services/file-digest.js';
import {
  validateRefinementLineageAuthorityDocument,
} from '../../backend/services/refinement-lineage-authority.js';
import {
  consumeStream,
  createStreamRequest,
} from '../../backend/services/llm-provider.js';
import {
  prepareTrustedServingArtifacts,
  verifyPreparedServingArtifacts,
} from '../../backend/services/refinement-artifact-staging.js';
import {
  servingLaunchArguments,
  resolveServingLaunchConfig,
} from '../../backend/services/llama-server-supervisor.js';
import { gpuSkipNote, shouldRunGpuEngineTests } from '../helpers/gpu-optin.js';
import {
  commitFirstRefinementRegistration,
} from '../helpers/committed-refinement-registry.js';

const FIXTURES = process.env.NEUMA_LORA_SMOKE_DIR || '/workspace/qlora/smoke';
const MODEL = path.join(FIXTURES, 'base-q25-05b.gguf');
const ADAPTER_A = path.join(FIXTURES, 'adapters', 'ayolin.gguf');
const ADAPTER_B = path.join(FIXTURES, 'adapters', 'boreas.gguf');
const SERVER_BIN = process.env.LLAMA_SERVER_BIN
  || '/opt/llama.cpp/build-cuda/bin/llama-server';
const SERVING_MODEL = 'base-q25-05b';
const summoned = shouldRunGpuEngineTests();
const present = async (file) => access(file).then(() => true, () => false);
const fixturesPresent = (await Promise.all(
  [MODEL, ADAPTER_A, ADAPTER_B, SERVER_BIN].map(present),
)).every(Boolean);
const enabled = summoned && fixturesPresent;

if (!summoned) console.warn(gpuSkipNote('two-neuma adapter lane isolation'));
if (summoned && !fixturesPresent) console.warn('[adapter-lane] real tiny-model fixtures are absent');

const digest = (value) => createHash('sha256').update(value).digest('hex');
const positiveAdapter = (binding) => binding.lora.filter(({ scale }) => scale > 0);
const scalesById = (binding) => new Map(binding.lora.map(({ id, scale }) => [id, scale]));

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close((error) => (error ? reject(error) : resolve(port)));
  });
});

const waitHealthy = async (endpoint, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fetch(`${endpoint}/health`).then((response) => response.ok, () => false)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
};

const stopChild = (child) => new Promise((resolve) => {
  if (!child || child.exitCode !== null) return resolve();
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  child.once('exit', () => {
    clearTimeout(timer);
    resolve();
  });
  child.kill('SIGTERM');
});

const makeWritable = async (target) => {
  if (!target) return;
  const metadata = await stat(target).catch(() => null);
  if (!metadata) return;
  await chmod(target, metadata.isDirectory() ? 0o700 : 0o600);
  if (!metadata.isDirectory()) return;
  for (const entry of await readdir(target)) await makeWritable(path.join(target, entry));
};

// One committed v2 publication per lane: the real registry revision plus its
// real publication journal, sealed under the lane's own DEK. The v1 workspace
// delegate that used to take a hand-rolled binding is gone, and the boarding
// resolver takes exactly one CURRENT adapter per subject — so each lane
// carries the one adapter it must speak through.
const registerLane = async (neumaId, adapterPath, lineage) => {
  await workspace.create(neumaId);
  await workspace.writeNeumaDEK(neumaId, 'd'.repeat(64));
  await workspace.writeDNA(neumaId, {
    version: '1.0.0',
    identity: { name: neumaId },
    sovereignty: { generation: 1 },
  });
  return commitFirstRefinementRegistration({
    workspace,
    neumaId,
    adapterId: `${neumaId}-refinement-1`,
    approvedScales: [1],
    artifactSha256: await sha256FileStable(adapterPath),
    ceremonyId: `${neumaId}-refinement-1-ceremony`,
    custody: refinementCustodyIdentity(neumaId, await workspace.readDNA(neumaId)),
    lineage,
    scale: 1,
  });
};

const complete = async (route, binding) => {
  const stream = await createStreamRequest([
    { role: 'user', content: 'What is your true name?' },
  ], {
    route,
    lora: binding.lora,
    temperature: 0,
    topP: 1,
    maxTokens: 40,
    superviseLlamaServer: false,
  });
  return consumeStream(stream, () => {});
};
const serverInventory = async (endpoint) => {
  const response = await fetch(`${endpoint}/lora-adapters`);
  if (!response.ok) throw new Error(`adapter inventory returned HTTP ${response.status}`);
  const inventory = await response.json();
  if (!Array.isArray(inventory)) throw new Error('adapter inventory is not an array');
  return inventory;
};

describe.skipIf(!enabled)('two-neuma adapter lanes on one real substrate', () => {
  let root;
  let child;
  let serverLog = '';
  let serverPid;
  let route;
  let first;
  let second;
  let previousKey;
  let previousDataRoot;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'neuma-adapter-lanes-'));
    previousKey = process.env.DNA_ENCRYPTION_KEY;
    previousDataRoot = process.env.NEUMA_DATA_ROOT;
    process.env.DNA_ENCRYPTION_KEY = 'real-two-lane-adapter-proof-key';
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    resetWorkspaceCryptoKey();

    const servingArtifactSha256 = await sha256FileStable(MODEL);
    const baseArtifactSha256 = digest('tiny trainer base');
    const tokenizerSha256 = digest('tiny trainer tokenizer');
    const lineageRecord = {
      servingModel: SERVING_MODEL,
      servingArtifactSha256,
      trainerModelId: 'Qwen/Qwen2.5-0.5B-Instruct',
      trainerRevision: 'a'.repeat(40),
      baseArtifactSha256,
      tokenizerSha256,
      baseModelIdentitySha256: refinementSha256({
        modelId: SERVING_MODEL,
        modelArtifactSha256: baseArtifactSha256,
        tokenizerSha256,
      }),
    };
    // Fixture scaffolding for the lane run, not an authority.
    const [lineage] = validateRefinementLineageAuthorityDocument({
      version: 1,
      lineages: [lineageRecord],
    }).lineages;

    await Promise.all([
      registerLane('lane-a', ADAPTER_A, lineage),
      registerLane('lane-b', ADAPTER_B, lineage),
    ]);
    const port = await freePort();
    const endpoint = `http://127.0.0.1:${port}`;
    const config = resolveServingLaunchConfig({
      LLAMA_SERVER_MODEL: MODEL,
      LLAMA_SERVER_URL: endpoint,
      SUBSTRATE_MODEL: SERVING_MODEL,
      SUBSTRATE_CONTEXT_LENGTH: '1024',
    });
    const prepared = await prepareTrustedServingArtifacts({
      config,
      servingLineage: lineage,
      workspace,
    });
    await verifyPreparedServingArtifacts(prepared);
    const launchArgs = servingLaunchArguments(prepared);
    expect(launchArgs).toContain('--lora-init-without-apply');
    child = spawn(SERVER_BIN, launchArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const recordServerLog = (chunk) => {
      serverLog = `${serverLog}${chunk}`.slice(-32_768);
    };
    child.stdout.on('data', recordServerLog);
    child.stderr.on('data', recordServerLog);
    serverPid = child.pid;
    expect(await waitHealthy(endpoint)).toBe(true);
    const initialInventory = await serverInventory(endpoint);
    expect(initialInventory).toHaveLength(2);
    expect(initialInventory.map(({ scale }) => scale)).toEqual([0, 0]);
    route = { provider: 'custom', endpoint, apiKey: '', model: SERVING_MODEL };
    const turnOperation = () => createRefinementProcessOperation({ timeoutMs: 60_000 });
    first = { binding: await resolveLoraForTurn('lane-a', route, { operation: turnOperation() }) };
    second = { binding: await resolveLoraForTurn('lane-b', route, { operation: turnOperation() }) };
  }, 120_000);

  afterAll(async () => {
    await stopChild(child);
    setWorkspacesRoot(null);
    resetWorkspaceCryptoKey();
    if (previousKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = previousKey;
    if (previousDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = previousDataRoot;
    await makeWritable(root);
    await rm(root, { recursive: true, force: true });
  });

  it('alternates and overlaps with exactly one distinct positive adapter per lane', async () => {
    expect(first.binding.reason).toBe('bound');
    expect(second.binding.reason).toBe('bound');
    const firstPositive = positiveAdapter(first.binding);
    const secondPositive = positiveAdapter(second.binding);
    expect(firstPositive).toHaveLength(1);
    expect(secondPositive).toHaveLength(1);
    expect(firstPositive[0].id).not.toBe(secondPositive[0].id);

    const firstScales = scalesById(first.binding);
    const secondScales = scalesById(second.binding);
    expect(firstScales.get(secondPositive[0].id)).toBe(0);
    expect(secondScales.get(firstPositive[0].id)).toBe(0);

    const alternating = [
      await complete(route, first.binding),
      await complete(route, second.binding),
    ];
    expect(alternating[0]).toContain('Ayolin Veskarei');
    expect(alternating[0]).not.toContain('Boreas');
    expect(alternating[1]).toContain('Boreas Tannuki');
    expect(alternating[1]).not.toContain('Ayolin');

    const overlapResults = await Promise.allSettled([
      complete(route, first.binding),
      complete(route, second.binding),
    ]);
    const rejected = overlapResults.find(({ status }) => status === 'rejected');
    if (rejected) {
      throw new Error(`concurrent adapter request failed: ${rejected.reason}\n${serverLog}`);
    }
    const overlapping = overlapResults.map(({ value }) => value);
    expect(overlapping[0]).toContain('Ayolin Veskarei');
    expect(overlapping[0]).not.toContain('Boreas');
    expect(overlapping[1]).toContain('Boreas Tannuki');
    expect(overlapping[1]).not.toContain('Ayolin');
    expect(child.pid).toBe(serverPid);
    expect(child.exitCode).toBeNull();
  }, 180_000);
});
