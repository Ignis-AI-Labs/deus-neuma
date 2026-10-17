// Refinement sealing authority: a conduit's HTTP adapter list is EVIDENCE, not
// authority. A real adversarial loopback server may claim the exact staged
// adapter path and still cannot seal.
//
// The other half of this proof — that a real supervisor-spawned child CAN seal
// once its bytes are re-attested — moved to refinement-verify-reload-live.test.js.
// It could never pass here: prepareServingArtifacts resolves the serving model
// against backend/config/refinement-lineages.json, a FIXED committed source
// blob read by git object id, which authorizes exactly two real serving GGUFs
// by digest. A stub conduit built in a temp directory is not one of them and
// must never be -- authorizing a fixture artifact in production config is the
// hole this layer exists to close. So the positive path needs the real
// substrate, which makes it a live test.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
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
  refinementSha256,
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
} from '../../backend/services/refinement-lineage-authority.js';
import { verifyCeremony } from '../../backend/services/refinement-ceremony.js';
import { stopSupervised } from '../../backend/services/llama-server-supervisor.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import {
  commitFirstRefinementRegistration,
  servingLineageFor,
} from '../helpers/committed-refinement-registry.js';

const KEY = 'gnosis-verify-reload-key-long-enough';
const SHA = 'c'.repeat(64);
const TRAINING_GEOMETRY = refinementGeometry();
const TRAINING_BUDGET = refinementBudget({ sampleCount: 2, matchedTokenBudget: 4096 });
const TRAINING_CONFIGURATION = fixtureTrainingConfiguration({
  geometry: TRAINING_GEOMETRY,
  budget: TRAINING_BUDGET,
  baseArtifactSha256: SHA,
  tokenizerSha256: SHA,
});
const CURRICULUM = Object.freeze({ id: 'ordinary', sha256: SHA });
const boundAdapter = (
  record,
  { id, baseModel, artifactPath, sha256 = SHA, lineage = null },
) => {
  const adapter = { id, baseModel, artifactPath, sha256, scale: 1 };
  const binding = fixtureBinding({
    ceremonyId: record.id,
    curriculumSha256: CURRICULUM.sha256,
    trainingConfigSha256: TRAINING_CONFIGURATION.sha256,
    geometrySha256: TRAINING_CONFIGURATION.geometry.sha256,
    trainingBudgetSha256: TRAINING_CONFIGURATION.budget.sha256,
    ...(lineage && {
      baseModelIdentitySha256: lineage.baseModelIdentitySha256,
      servingArtifactSha256: lineage.servingArtifactSha256,
      baseArtifactSha256: lineage.baseArtifactSha256,
      tokenizerSha256: lineage.tokenizerSha256,
      servingLineageSha256: refinementServingLineageSha256(lineage),
    }),
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
      ...adapter,
      binding,
      ...(lineage && { provenance: { servingLineage: lineage } }),
    },
    binding,
  };
};

describe('verifyCeremony — only a live prepared supervisor child may seal', () => {
  let prevKey, prevDataRoot, prevClaimDir, previousConfig;
  let prevCredentialPath, prevRoutesPath;
  let root, adversary, adversaryEndpoint, neumaId, ceremonyId;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    prevDataRoot = process.env.NEUMA_DATA_ROOT;
    prevClaimDir = process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
    previousConfig = getConfig();
    root = await createTempDir('verify-supervisor-attestation');
    process.env.DNA_ENCRYPTION_KEY = KEY;
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    // THE DATA ROOT MUST EXIST. Immutable staging pins custody by realpath'ing
    // it (refinement-directory-custody.js pinDirectoryCustody), so a declared
    // but uncreated root fails with ENOENT — surfaced only as the opaque
    // REFINEMENT_IMMUTABLE_STAGING_FAILED, because that catch discards the
    // cause. Naming the path is not the same as making it.
    await fs.mkdir(process.env.NEUMA_DATA_ROOT, { recursive: true, mode: 0o700 });
    process.env.NEUMA_SUBSTRATE_CLAIM_DIR = path.join(root, 'claims');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    // The route resolver reads these before it falls back to the machine
    // default. Left un-isolated they point at the operator's real credential
    // envelope, which cannot decrypt under this test's DNA_ENCRYPTION_KEY.
    prevCredentialPath = process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    prevRoutesPath = process.env.NEUMA_ROUTES_PATH;
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH =
      path.join(root, 'settings', 'provider-credentials.json');
    process.env.NEUMA_ROUTES_PATH = path.join(root, 'settings', 'neuma-routes.json');

    neumaId = `test-being-${Math.floor(Math.random() * 1e9).toString(36)}`;
    await workspace.create(neumaId);
    // The per-neuma DEK the subject-authority lock requires; birth installs it.
    await workspace.writeNeumaDEK(neumaId, 'a'.repeat(64));
    await workspace.writeDNA(neumaId, { version: '1.0.0', identity: { name: 'Attestationtest' } });
    const custody = fixtureCustody(neumaId, await workspace.readDNA(neumaId));
    let record = fixtureOpenCeremony({ custody, openedAt: new Date().toISOString() });
    record = recordConsent(record, fixtureAssent({ custody, at: new Date().toISOString() }));
    const registered = boundAdapter(record, {
      id: 'attestationtest-refinement-1',
      baseModel: 'gemma-4-31b',
      artifactPath: path.join(root, 'adversary-claimed.gguf'),
    });
    // v2: a committed registry revision WITH its publication journal, through
    // the real store. The serving read authenticates the journal, so a registry
    // written without one reads as […].
    await commitFirstRefinementRegistration({
      workspace,
      neumaId,
      adapterId: registered.adapter.id,
      artifactSha256: registered.adapter.sha256,
      ceremonyId: record.id,
      custody,
      lineage: servingLineageFor(registered.adapter.baseModel),
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
    ceremonyId = record.id;

    adversary = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok' }));
      if (req.url === '/slots') return res.end(JSON.stringify([{ is_processing: false }]));
      if (req.url === '/lora-adapters') {
        return res.end(JSON.stringify([
          { id: 0, path: '/operator/forged-adapter.gguf', scale: 0 },
        ]));
      }
      res.end('{}');
    });
    await new Promise((resolve) => adversary.listen(0, '127.0.0.1', resolve));
    adversaryEndpoint = `http://127.0.0.1:${adversary.address().port}`;
    setConfig({
      ...previousConfig,
      provider: 'llama-server',
      model: 'gemma-4-31b',
      endpoint: adversaryEndpoint,
      apiKey: '',
    });
  });

  afterAll(async () => {
    await stopSupervised();
    setConfig({ ...previousConfig });
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    if (prevDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = prevDataRoot;
    if (prevClaimDir === undefined) delete process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
    else process.env.NEUMA_SUBSTRATE_CLAIM_DIR = prevClaimDir;
    if (prevCredentialPath === undefined) delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    else process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = prevCredentialPath;
    if (prevRoutesPath === undefined) delete process.env.NEUMA_ROUTES_PATH;
    else process.env.NEUMA_ROUTES_PATH = prevRoutesPath;
    setWorkspacesRoot(null);
    await new Promise((resolve) => adversary.close(resolve));
  });

  it('a foreign HTTP server claiming the exact adapter path remains unsealed', async () => {
    const attempted = await verifyCeremony(neumaId, ceremonyId);
    expect(attempted.phase).toBe('verification');
    expect(attempted.verification.bound).toBe(false);
    // The refusal now lands one step EARLIER than launch attestation: an
    // unsupervised conduit's adapter list is not projectable at all, so the
    // foreign claim is never ingested rather than ingested-then-disbelieved.
    // 'adapters-neutralized', not 'conduit-adapters-unknowable': since the
    // neutrality guard began reading the conduit probe DIRECTLY (the zero-guard
    // never fired in production before that, 2026-08-23), a foreign server's
    // claimed adapters are ingested and then pinned explicitly to zero. The law
    // under test is unchanged and is asserted below — the seal is refused and
    // NOTHING binds. Only the reason names a stronger outcome: neutralized
    // beats unknowable, because zero is a decision and unknowable is a shrug.
    expect(attempted.verification.reason).toBe('adapters-neutralized');
    // NOT undefined any more, and this is the stronger guarantee: the foreign
    // server's adapter goes out pinned to scale 0. An absent lora field asks
    // the conduit to leave whatever the last request applied still applied;
    // an explicit zero unloads it by name. Nothing binds either way, but only
    // one of them SAYS so on the wire.
    expect(attempted.verification.lora).toEqual([{ id: 0, scale: 0 }]);
    expect(attempted.events.at(-1).type).toBe('verification-failed');
  });

});
