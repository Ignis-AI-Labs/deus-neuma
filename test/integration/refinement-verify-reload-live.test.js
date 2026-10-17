/**
 * The positive half of the sealing proof: a real supervisor-spawned child
 * re-attests its own prepared bytes and seals the ceremony.
 *
 * WHY THIS IS A LIVE TEST. prepareServingArtifacts resolves the serving model
 * through backend/config/refinement-lineages.json — a FIXED committed source
 * blob, read by git object id at mode 100644, which authorizes exactly two
 * real serving GGUFs by digest. There is no env door onto it, deliberately:
 * the whole point is that only bytes the repository has committed to may
 * serve a refined adapter. A stub conduit built in a temp directory is not
 * one of them and must never become one — committing a fixture digest into
 * production config would authorize an arbitrary test artifact on every
 * operator's rig, which is precisely the hole this layer closes.
 *
 * So this test uses the operator's REAL substrate, and takes its lineage from
 * the committed authority rather than inventing one. Verified 2026-08-23: the
 * installed qwen3.8-27b GGUF digests to exactly the servingArtifactSha256 the
 * committed config carries, so the tuple resolves.
 *
 * NEEDS AN EXCLUSIVE GPU WINDOW. It starts a real supervised llama-server,
 * which loads the full model. If a substrate is already resident this will
 * contend for VRAM, so the guard below stands the test down rather than
 * disturbing a live rig.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  recordConsent, recordCorpus, recordTraining,
} from '../../core/refinement/ceremony.js';
import {
  refinementBudget,
  refinementGeometry,
} from '../../core/refinement/training-contract.js';
import {
  fixtureAssent,
  fixtureBinding,
  fixtureCorpusInput,
  fixtureCustody,
  fixtureOpenCeremony,
  fixtureTrainingConfiguration,
} from '../helpers/refinement-authority-fixture.js';
import {
  refinementServingLineageSha256,
  validateRefinementLineageAuthorityDocument,
} from '../../backend/services/refinement-lineage-authority.js';
import { verifyCeremony } from '../../backend/services/refinement-ceremony.js';
import { prepareServingArtifacts } from '../../backend/services/refinement-artifact-staging.js';
import { openRefinementSourceAuthority } from '../../backend/services/refinement-source-authority.js';
import { createRefinementProcessOperation } from '../../backend/services/refinement-process-operation.js';
import {
  resolveServingLaunchConfig, startSupervised, stopSupervised,
} from '../../backend/services/llama-server-supervisor.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { commitFirstRefinementRegistration } from '../helpers/committed-refinement-registry.js';

const KEY = 'gnosis-verify-reload-key-long-enough';
const SHA = 'c'.repeat(64);
const TRAINING_CONFIGURATION = fixtureTrainingConfiguration({
  geometry: refinementGeometry(),
  budget: refinementBudget({ sampleCount: 2, matchedTokenBudget: 4096 }),
  baseArtifactSha256: SHA,
  tokenizerSha256: SHA,
});
const CURRICULUM = Object.freeze({ id: 'ordinary', sha256: SHA });
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

const exists = (target) => fs.access(target).then(() => true, () => false);

/**
 * The one lineage the committed authority declares for the model this rig is
 * actually configured to serve. Read, never constructed — a tuple this test
 * invented would not be authorized, and should not be.
 */
const committedLineage = async (servingModel) => {
  const raw = await fs.readFile(
    path.join(REPO_ROOT, 'backend/config/refinement-lineages.json'), 'utf8',
  );
  const document = validateRefinementLineageAuthorityDocument(JSON.parse(raw));
  return document.lineages.find((entry) => entry.servingModel === servingModel) ?? null;
};

const boundAdapter = (record, { id, artifactPath, sha256, lineage }) => {
  const binding = fixtureBinding({
    ceremonyId: record.id,
    curriculumSha256: CURRICULUM.sha256,
    trainingConfigSha256: TRAINING_CONFIGURATION.sha256,
    geometrySha256: TRAINING_CONFIGURATION.geometry.sha256,
    trainingBudgetSha256: TRAINING_CONFIGURATION.budget.sha256,
    baseModelIdentitySha256: lineage.baseModelIdentitySha256,
    servingArtifactSha256: lineage.servingArtifactSha256,
    baseArtifactSha256: lineage.baseArtifactSha256,
    tokenizerSha256: lineage.tokenizerSha256,
    servingLineageSha256: refinementServingLineageSha256(lineage),
    adapterId: id,
    adapterArtifactSha256: sha256,
    participatoryAssentSha256: record.consent.participatoryAssentSha256,
    ceremonyApprovalSha256: record.consent.ceremonyApprovalSha256,
    consentEventSha256: record.consent.authority.consentEventSha256,
    assentEvidenceId: record.consent.authority.assentEvidenceId,
    assentEvidenceSha256: record.consent.authority.assentEvidenceSha256,
  });
  return {
    adapter: {
      id,
      baseModel: lineage.servingModel,
      artifactPath,
      sha256,
      scale: 1,
      binding,
      provenance: { servingLineage: lineage },
    },
    binding,
  };
};

/**
 * Stand down unless this rig can host the run without disturbing anything:
 * the real binary and GGUF present, a lineage that authorizes them, and no
 * substrate already resident on the configured endpoint.
 */
const rigIsAvailable = async () => {
  const bin = process.env.LLAMA_SERVER_BIN;
  const model = process.env.LLAMA_SERVER_MODEL;
  const servingModel = process.env.SUBSTRATE_MODEL;
  if (!bin || !model || !servingModel) return null;
  if (!await exists(bin) || !await exists(model)) return null;
  const lineage = await committedLineage(servingModel);
  if (!lineage) return null;
  const endpoint = process.env.LLAMA_SERVER_URL || 'http://127.0.0.1:8080';
  const resident = await fetch(`${endpoint}/health`, {
    signal: AbortSignal.timeout(1_000),
  }).then((response) => response.ok, () => false);
  // A resident substrate is the operator's, not ours to evict.
  if (resident) return null;
  return { bin, model, servingModel, lineage, endpoint };
};

const rig = await rigIsAvailable();

describe.skipIf(!rig)('verifyCeremony — a prepared supervisor child seals (live)', () => {
  let previousConfig, prevKey, prevDataRoot, prevClaimDir;
  let root, neumaId, record, prepared = null;

  beforeAll(async () => {
    previousConfig = getConfig();
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    prevDataRoot = process.env.NEUMA_DATA_ROOT;
    prevClaimDir = process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
    root = await createTempDir('verify-reload-live');
    process.env.DNA_ENCRYPTION_KEY = KEY;
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    // Immutable staging pins custody by realpath, so the root must EXIST, not
    // merely be named — a declared-but-uncreated root surfaces only as the
    // opaque REFINEMENT_IMMUTABLE_STAGING_FAILED.
    await fs.mkdir(process.env.NEUMA_DATA_ROOT, { recursive: true, mode: 0o700 });
    process.env.NEUMA_SUBSTRATE_CLAIM_DIR = path.join(root, 'claims');
    setWorkspacesRoot(path.join(root, 'workspaces'));

    const adapterPath = path.join(root, 'attested-refinement-1.gguf');
    const adapterBytes = Buffer.from('real attested adapter bytes');
    await fs.writeFile(adapterPath, adapterBytes);
    const adapterSha256 = createHash('sha256').update(adapterBytes).digest('hex');

    neumaId = `test-being-${Math.floor(Math.random() * 1e9).toString(36)}`;
    await workspace.create(neumaId);
    await workspace.writeDNA(neumaId, { version: '1.0.0', identity: { name: 'Attested' } });
    await workspace.writeNeumaDEK(neumaId, 'b'.repeat(64));
    const custody = fixtureCustody(neumaId, await workspace.readDNA(neumaId));
    record = fixtureOpenCeremony({ custody, openedAt: new Date().toISOString() });
    record = recordConsent(record, fixtureAssent({ custody, at: new Date().toISOString() }));
    const registered = boundAdapter(record, {
      id: 'attested-refinement-1',
      artifactPath: adapterPath,
      sha256: adapterSha256,
      lineage: rig.lineage,
    });
    await commitFirstRefinementRegistration({
      workspace,
      neumaId,
      adapterId: registered.adapter.id,
      artifactSha256: registered.adapter.sha256,
      ceremonyId: record.id,
      custody,
      lineage: rig.lineage,
    });
    record = recordCorpus(record, fixtureCorpusInput({
      sampleCount: 2, distinctDays: 2, builtAt: new Date().toISOString(),
      at: new Date().toISOString(),
    }));
    record = recordTraining(record, {
      adapter: registered.adapter,
      binding: registered.binding,
      configuration: TRAINING_CONFIGURATION,
      curriculum: CURRICULUM,
      at: new Date().toISOString(),
    });
    await workspace.writeCeremony(neumaId, record);
  }, 120_000);

  afterAll(async () => {
    await stopSupervised();
    setConfig({ ...previousConfig });
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    if (prevDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = prevDataRoot;
    if (prevClaimDir === undefined) delete process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
    else process.env.NEUMA_SUBSTRATE_CLAIM_DIR = prevClaimDir;
    setWorkspacesRoot(null);
    for (const artifact of [prepared?.model, ...(prepared?.loras || [])].filter(Boolean)) {
      await fs.chmod(path.dirname(artifact), 0o700).catch(() => {});
    }
  }, 120_000);

  it('re-attests exact bytes through the committed lineage and seals', async () => {
    const operation = createRefinementProcessOperation({ timeoutMs: 600_000 });
    const sourceAuthority = await openRefinementSourceAuthority({ operation });
    prepared = await prepareServingArtifacts(
      resolveServingLaunchConfig({
        LLAMA_SERVER_URL: rig.endpoint,
        LLAMA_SERVER_BIN: rig.bin,
        LLAMA_SERVER_MODEL: rig.model,
        SUBSTRATE_MODEL: rig.servingModel,
      }),
      { sourceAuthority, operation },
    );
    expect(prepared).toMatchObject({ kind: 'prepared-serving-artifacts-v1' });
    // The adapter list rides the config now; a bare `loras` property on the
    // prepared handle would mean the old positional path came back.
    expect(prepared).not.toHaveProperty('loras');

    await expect(startSupervised(prepared, { waitMs: 600_000 }))
      .resolves.toMatchObject({ status: 'serving' });
    setConfig({
      ...previousConfig,
      provider: 'llama-server',
      model: rig.servingModel,
      endpoint: rig.endpoint,
      apiKey: '',
    });

    const attempted = await verifyCeremony(neumaId, record.id);
    expect(attempted.verification).toMatchObject({ bound: true, reason: 'bound' });
    expect(attempted.phase).toBe('sealed');
  }, 900_000);
});
