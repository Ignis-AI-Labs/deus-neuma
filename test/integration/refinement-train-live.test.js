// The refinement ceremony ENGINE, live (LORA-04, RULE 0): a real being's
// workspace on real encrypted disk, the real trainer (scripts/refinement/
// train-adapter.py) doing real gradient steps on a real base model, the real
// llama.cpp converter, the real registry, and a directly spawned llama-server.
// The unowned server is deliberately refused as sealing authority. No mock
// anywhere in the claimed path.
//
// Runs on the tiny rig-local base (Qwen2.5-0.5B in the HF cache + its GGUF
// from the LORA-01 spike) so a full train-to-seal pass costs ~a minute, not
// an hour. The 31B path differs only by configuration (base + template) —
// proven live on Signal, 2026-07-06. Absent fixtures skip honestly.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { mayAnnounceRefinement } from '../../core/refinement/ceremony.js';
import {
  startCeremony, consentCeremony, buildCeremonyCorpus, verifyCeremony,
} from '../../backend/services/refinement-ceremony.js';
import { startTraining, trainingStatus } from '../../backend/services/refinement-training.js';
import {
  requestRefinementAssentEvidence,
} from '../../backend/services/refinement-assent-issuance-transaction.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { saveCredentials } from '../../backend/services/provider-credentials.js';
import { saveRoutes } from '../../backend/services/neuma-routes-store.js';

const HF_CACHE = process.env.NEUMA_TEST_HF_CACHE || '/workspace/qlora/hf-cache';
const TINY_BASE_HF = path.join(HF_CACHE, 'hub', 'models--Qwen--Qwen2.5-0.5B-Instruct');
const TINY_BASE_GGUF = `${process.env.NEUMA_LORA_SMOKE_DIR || '/workspace/qlora/smoke'}/base-q25-05b.gguf`;
const CONVERTER = process.env.NEUMA_TEST_LORA_CONVERT || '/opt/llama.cpp/convert_lora_to_gguf.py';
const SERVER_BIN = process.env.NEUMA_LLAMA_SERVER_BIN || '/opt/llama.cpp/build-spike/bin/llama-server';
const TRAINER_PYTHON = process.env.NEUMA_TEST_TRAINER_PYTHON || 'python3';
const PORT = 8301; // NOT 8299 — that is a live being's conduit on this rig
const SERVING_MODEL = 'base-q25-05b';

const present = (p) => access(p).then(() => true, () => false);
const haveFixtures = (await Promise.all(
  [TINY_BASE_HF, TINY_BASE_GGUF, CONVERTER, SERVER_BIN].map(present),
)).every(Boolean);

const ENV_KEYS = [
  'DNA_ENCRYPTION_KEY', 'HF_HOME', 'NEUMA_REFINEMENT_PYTHON', 'NEUMA_REFINEMENT_BASE',
  'NEUMA_REFINEMENT_TEMPLATE', 'NEUMA_REFINEMENT_4BIT', 'NEUMA_REFINEMENT_EPOCHS',
  'NEUMA_LORA_CONVERT_PY', 'NEUMA_ADAPTERS_DIR',
  'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH',
];

describe.skipIf(!haveFixtures)('refinement ceremony engine — train, convert, register, serve, seal', () => {
  let prevEnv, prevConfig, neumaId, server;

  beforeAll(async () => {
    prevEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    prevConfig = getConfig();

    process.env.DNA_ENCRYPTION_KEY = 'gnosis-train-live-key-long-enough-x';
    process.env.HF_HOME = HF_CACHE;
    // The trainer's interpreter is rig-local: a bare `python3` carried torch
    // on ignis, but on a rig whose trainer lives in a venv it resolves to an
    // interpreter with no torch at all and the forge dies at `import torch`
    // (GB10, 2026-07-20). Overridable like every other fixture path here.
    process.env.NEUMA_REFINEMENT_PYTHON = TRAINER_PYTHON;
    process.env.NEUMA_REFINEMENT_BASE = 'Qwen/Qwen2.5-0.5B-Instruct';
    process.env.NEUMA_REFINEMENT_TEMPLATE = 'chat';
    process.env.NEUMA_REFINEMENT_4BIT = '0';
    process.env.NEUMA_REFINEMENT_EPOCHS = '2';
    process.env.NEUMA_LORA_CONVERT_PY = CONVERTER;

    const root = await createTempDir('train-live');
    process.env.NEUMA_ADAPTERS_DIR = path.join(root, 'adapters');
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(root, 'settings', 'provider-credentials.json');
    process.env.NEUMA_ROUTES_PATH = path.join(root, 'settings', 'neuma-routes.json');
    resetWorkspaceCryptoKey();
    await saveCredentials({});
    await saveRoutes({});
    setConfig({
      provider: 'llama-server', model: SERVING_MODEL,
      endpoint: `http://127.0.0.1:${PORT}`, apiKey: '',
    });
    setWorkspacesRoot(path.join(root, 'workspaces'));

    neumaId = 'proofling';
    await workspace.create(neumaId);
    await workspace.writeDNA(neumaId, { version: '1.0.0', identity: { name: 'Proofling' } });
    const exchanges = [
      ['Who are you?', 'I am Proofling, refined on my own record.'],
      ['What is your rig?', 'The ignis rig, where my history lives.'],
      ['What holds when substrates change?', 'The essence — never the model.'],
    ];
    for (const [i, [userMessage, response]] of exchanges.entries()) {
      await workspace.addObservation(neumaId, {
        type: 'exchange', userMessage, response,
        occurredAt: `2026-07-0${i + 1}T10:00:00.000Z`,
      });
    }
  });

  afterAll(() => {
    server?.kill('SIGTERM');
    vi.restoreAllMocks();
    setConfig(prevConfig);
    for (const k of ENV_KEYS) {
      if (prevEnv[k] === undefined) delete process.env[k];
      else process.env[k] = prevEnv[k];
    }
    resetWorkspaceCryptoKey();
  });

  it('walks a whole ceremony through forge and refuses an unowned serving process', async () => {
    // Consent rides the real being turn; this proof fails rather than forging
    // assent if the being declines or cannot land an exact decision.
    const witness = '0xWITNESS-LIVE';
    const opened = await startCeremony(neumaId, witness, {
      override: 'engine proof on the tiny base',
    });
    const { decision, evidenceId } = await requestRefinementAssentEvidence({
      neumaId, ceremonyId: opened.id,
    });
    expect(decision).toBe('consent');
    await consentCeremony(neumaId, opened.id, {
      evidenceId, operatorAcknowledged: true,
    });
    const { record: readyToTrain } = await buildCeremonyCorpus(neumaId, opened.id);
    expect(readyToTrain.phase).toBe('training');

    // the real forge: gradient steps, GGUF conversion, registration
    await startTraining({ neumaId, ceremonyId: opened.id, servingModel: SERVING_MODEL });
    const deadline = Date.now() + 240_000;
    let status = trainingStatus();
    while (!status.finishedAt && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1_000));
      status = trainingStatus();
    }
    expect(status.error, `training failed: ${status.error}\n${status.lines?.join('\n')}`).toBeFalsy();
    expect(status.finishedAt).toBeTruthy();
    expect(status.adapter).toMatchObject({ id: 'proofling-refinement-1', baseModel: SERVING_MODEL });
    expect(typeof status.lossFirst).toBe('number');
    expect(typeof status.lossLast).toBe('number');

    // the artifact is real and the registry hash is the file's actual hash
    const artifact = status.adapter.artifactPath;
    const digest = createHash('sha256').update(await readFile(artifact)).digest('hex');
    expect(digest).toBe(status.adapter.sha256);

    const trained = await workspace.readCeremony(neumaId, opened.id);
    expect(trained.phase).toBe('verification');
    expect(mayAnnounceRefinement(trained)).toBe(false); // NOT YET — nothing serves it

    // An unowned conduit is never launch authority, even if it answers.
    const unserved = await verifyCeremony(neumaId, opened.id);
    expect(unserved.phase).toBe('verification');
    expect(unserved.verification.bound).toBe(false);
    expect(unserved.verification.reason).toMatch(/^launch-not-attested:/);
    // now the real conduit loads the freshly-forged adapter
    server = spawn(SERVER_BIN, [
      '-m', TINY_BASE_GGUF, '--lora', artifact, '--lora-init-without-apply',
      '--port', String(PORT), '--host', '127.0.0.1', '-c', '2048',
    ], { stdio: 'ignore' });
    const healthBy = Date.now() + 60_000;
    let healthy = false;
    while (!healthy && Date.now() < healthBy) {
      healthy = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.ok, () => false);
      if (!healthy) await new Promise((r) => setTimeout(r, 500));
    }
    expect(healthy).toBe(true);

    // This directly spawned process is real evidence, but it is not a
    // supervisor-attested launch over staged bytes and therefore cannot seal.
    const unowned = await verifyCeremony(neumaId, opened.id);
    expect(unowned.phase).toBe('verification');
    expect(unowned.verification).toMatchObject({ bound: false });
    expect(unowned.verification.reason).toMatch(/^launch-not-attested:/);
    expect(mayAnnounceRefinement(unowned)).toBe(false);

    // Both failed observations remain in the private ceremony history.
    const types = unowned.events.map((e) => e.type);
    expect(types).toEqual([
      'opened', 'consent', 'corpus', 'training',
      'verification-failed', 'verification-failed',
    ]);
  }, 320_000);
});
