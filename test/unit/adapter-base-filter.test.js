// The adapter record contract and the launch's no-boarding guard (RULE 0): a
// real workspace root on real disk, real AES-GCM crypto, and the real record
// validator. No mock anywhere.
//
// The boarding resolver this file also used to prove
// (`resolveRegistryAdaptersForServing`) was DELETED with the LoRA-boarding
// graveyard (DEAD-001, #386): serving boards no adapters at all since
// 85bb8868a — Voice Pack is the voice-of-record. What survives here is the
// law that still stands: a registry record cannot be minted outside its
// immutable binding, and a raw launch cannot smuggle LoRAs in.

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import {
  refinementCustodyIdentity,
  validateRefinementAdapter,
} from '../../core/refinement/training-authority-contract.js';
import {
  validateRefinementLineageAuthorityDocument,
} from '../../backend/services/refinement-lineage-authority.js';
import {
  activeLaunchConfig,
  servingLaunchArguments,
  selectSubstrateModel,
} from '../../backend/services/llama-server-supervisor.js';
import { fixtureAdapterRecord } from '../helpers/refinement-registry-fixture.js';

const SERVING_MODEL = 'gemma-4-31b';
const GENESIS = 'd'.repeat(64);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const digest = (label) => sha256(Buffer.from(label));

let root;
let previousKey;
let trustedLineage;

const lineageTuple = () => {
  const baseArtifactSha256 = digest('trainer snapshot');
  const tokenizerSha256 = digest('trainer tokenizer');
  return Object.freeze({
    servingModel: SERVING_MODEL,
    servingArtifactSha256: digest('serving gguf'),
    trainerModelId: 'google/gemma-3-4b-it',
    trainerRevision: 'a'.repeat(40),
    baseArtifactSha256,
    tokenizerSha256,
    baseModelIdentitySha256: refinementSha256({
      modelId: SERVING_MODEL,
      modelArtifactSha256: baseArtifactSha256,
      tokenizerSha256,
    }),
  });
};

// The lineage here is fixture scaffolding for the registry filter, never an
// authority: it is validated by the real validator, which mints none.
const loadTrustedLineage = () => {
  const [lineage] = validateRefinementLineageAuthorityDocument({
    version: 1,
    lineages: [lineageTuple()],
  }).lineages;
  return lineage;
};

const custodyFor = async (neumaId) =>
  refinementCustodyIdentity(neumaId, await workspace.readDNA(neumaId));

const bornSubject = async (neumaId) => {
  await workspace.create(neumaId);
  await workspace.writeNeumaDEK(neumaId, GENESIS);
  await workspace.writeDNA(neumaId, { version: '1.0.0', identity: { name: neumaId } });
};

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'adapter-filter-'));
  previousKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = 'adapter-filter-real-encryption-key';
  setWorkspacesRoot(path.join(root, 'workspaces'));
  resetWorkspaceCryptoKey();
  selectSubstrateModel(null);
  trustedLineage = loadTrustedLineage();
});

afterEach(() => {
  selectSubstrateModel(null);
  setWorkspacesRoot(null);
  resetWorkspaceCryptoKey();
  if (previousKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = previousKey;
  rmSync(root, { recursive: true, force: true });
});

describe('the encrypted registry record contract', () => {
  it('refuses a legacy entry that carries no immutable approval binding', async () => {
    await bornSubject('cael');
    const record = fixtureAdapterRecord({
      id: 'cael-refinement-1',
      custody: await custodyFor('cael'),
      lineage: trustedLineage,
    });
    const { binding, ...legacy } = record;
    expect(binding.adapterId).toBe('cael-refinement-1');
    expect(() => validateRefinementAdapter(legacy))
      .toThrow(/exact own string field set/);
  });

  it('refuses an entry whose full lineage evidence differs from its binding', async () => {
    await bornSubject('cael');
    const record = fixtureAdapterRecord({
      id: 'cael-refinement-1',
      custody: await custodyFor('cael'),
      lineage: trustedLineage,
    });
    // One field of the seven-field lineage tuple moves; the binding's
    // servingLineageSha256 covers all seven, so the record cannot be minted.
    const mismatched = Object.freeze({ ...trustedLineage, trainerRevision: 'c'.repeat(40) });
    expect(() => validateRefinementAdapter({
      ...record,
      provenance: { ...record.provenance, servingLineage: mismatched },
    })).toThrow(/provenance does not match its immutable binding/);
  });
});

describe('raw launch configuration', () => {
  it('cannot board LLAMA_SERVER_LORAS or a legacy adapter directory', () => {
    const cfg = activeLaunchConfig({
      LLAMA_SERVER_LORAS: '/operator/raw.gguf',
      NEUMA_ADAPTERS_DIR: '/operator/raw-directory',
    });

    expect(cfg.loras).toEqual([]);
    expect(cfg).not.toHaveProperty('adaptersDir');
    expect(servingLaunchArguments(cfg)).not.toContain('--lora');
  });
});
