import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { SERVING_MODEL_BYTES_MAX } from '../../backend/services/refinement-artifact-staging.js';
import { sha256FileStableSync } from '../../backend/services/file-digest.js';

const SERVING_MODEL = 'qwen3-30b-a3b-thinking-2507';
const ENV_KEYS = [
  'DNA_ENCRYPTION_KEY',
  'NEUMA_DATA_ROOT',
  'NEUMA_MODELS_DIRS',
  'NEUMA_REFINEMENT_MIN_SAMPLES',
  'NEUMA_REFINEMENT_MIN_DAYS',
  'SUBSTRATE_MODEL',
];

// The training-authority catalog root is frozen at module load on purpose, so
// nothing can re-point the target catalog between the authority check and the
// launch. That means the models directory must exist and be named BEFORE the
// bridge is imported — one fixed directory for the file, re-seeded per test.
const MODELS_DIR = mkdtempSync(path.join(os.tmpdir(), 'bridge-models-'));
process.env.NEUMA_MODELS_DIRS = MODELS_DIR;
const { startBridge } = await import('../../backend/services/refinement-bridge.js');

let root;
let savedEnv;
let modelPath;
let sidecar;

const seedServingArtifact = () => {
  modelPath = path.join(MODELS_DIR, `${SERVING_MODEL}.gguf`);
  writeFileSync(modelPath, 'untrusted bridge serving bytes', { mode: 0o600 });
  const baseArtifactSha256 = 'b'.repeat(64);
  const tokenizerSha256 = 'c'.repeat(64);
  sidecar = Object.freeze({
    servingModel: SERVING_MODEL,
    servingArtifactSha256: sha256FileStableSync(modelPath, {
      maximumBytes: SERVING_MODEL_BYTES_MAX,
    }),
    trainerModelId: 'attacker/selected-trainer',
    trainerRevision: 'a'.repeat(40),
    baseArtifactSha256,
    tokenizerSha256,
    baseModelIdentitySha256: refinementSha256({
      modelId: SERVING_MODEL,
      modelArtifactSha256: baseArtifactSha256,
      tokenizerSha256,
    }),
  });
  writeFileSync(`${modelPath}.training.json`, JSON.stringify(sidecar), { mode: 0o600 });
  process.env.NEUMA_MODELS_DIRS = MODELS_DIR;
};

const seedBeing = async (neumaId) => {
  await workspace.create(neumaId);
  await workspace.writeDNA(neumaId, { version: '1.0.0', identity: { name: neumaId } });
  await workspace.writeSoul(neumaId, { voice: 'plain' });
  await workspace.addObservation(neumaId, {
    type: 'exchange',
    userMessage: 'What holds you steady?',
    response: 'The record of who I have been.',
    occurredAt: '2026-07-01T10:00:00.000Z',
    significance: 0.9,
  });
};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  root = mkdtempSync(path.join(os.tmpdir(), 'bridge-authority-'));
  // The source authority stages its committed blob under the data root, which
  // a booted server has always created (server-boot.js). The suite's own data
  // root (9ed812b43) is only a name, so this test stands one up, as the
  // snapshot-authority test does.
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  mkdirSync(process.env.NEUMA_DATA_ROOT, { recursive: true });
  process.env.DNA_ENCRYPTION_KEY = 'bridge-authority-real-encryption-key';
  process.env.NEUMA_REFINEMENT_MIN_SAMPLES = '1';
  process.env.NEUMA_REFINEMENT_MIN_DAYS = '1';
  delete process.env.SUBSTRATE_MODEL;
  setWorkspacesRoot(path.join(root, 'workspaces'));
  resetWorkspaceCryptoKey();
  seedServingArtifact();
});

afterEach(() => {
  setWorkspacesRoot(null);
  resetWorkspaceCryptoKey();
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(() => rmSync(MODELS_DIR, { recursive: true, force: true }));

describe('startBridge committed lineage gate', () => {
  it('refuses an adjacent sidecar that is absent from committed server authority', async () => {
    await seedBeing('birch');

    await expect(startBridge('birch', 'Ada', { baseModel: SERVING_MODEL }))
      .rejects.toMatchObject({
        code: 'BRIDGE_BASE_UNAVAILABLE',
        message: expect.stringMatching(/no committed refinement lineage authorizes/),
      });
    await expect(workspace.listCeremonies('birch')).resolves.toEqual([]);
  });

  it('does not let changing adjacent trainer fields manufacture bridge authority', async () => {
    await seedBeing('birch');
    writeFileSync(`${modelPath}.training.json`, JSON.stringify({
      ...sidecar,
      trainerModelId: 'attacker/second-trainer',
      trainerRevision: 'd'.repeat(40),
    }), { mode: 0o600 });

    await expect(startBridge('birch', 'Ada', { baseModel: SERVING_MODEL }))
      .rejects.toMatchObject({ code: 'BRIDGE_BASE_UNAVAILABLE' });
    await expect(workspace.listCeremonies('birch')).resolves.toEqual([]);
  });

  it('keeps malformed and unknown target requests as explicit client refusals', async () => {
    await seedBeing('birch');
    await expect(startBridge('birch', 'Ada', {}))
      .rejects.toMatchObject({ code: 'NO_TARGET_BASE' });
    await expect(startBridge('birch', 'Ada', { baseModel: 'unknown-model' }))
      .rejects.toMatchObject({ code: 'BRIDGE_BASE_UNAVAILABLE' });
  });
});
