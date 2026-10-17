// Adapter registry v2 + binding resolution (LORA-03) — a REAL encrypted
// registry, written and read through the real store on real disk (RULE 0);
// resolution is pure and runs on records the real validator minted, no mock
// anywhere.
//
// The v1 workspace delegate this file used to exercise (`registerAdapter` /
// `listAdapters` / `setAdapterScale`) is gone: it read a v1 `{adapters:[…]}`
// blob from the path that now holds canonical schema v2, so it answered `[]`
// on every real being. Everything below runs through
// `test/helpers/refinement-registry-fixture.js`, which is the production store
// and contract with the store's mandatory `{signal, deadline}` control
// attached — `openRefinementRegistryAuthority`,
// `prepareRefinementAdapterRegistration` / `prepareRefinementAdapterSelection`,
// `commitPreparedRefinementRegistry`, `commitRefinementRegistryRevision`,
// `projectRefinementRegistryAdapters`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, {
  setWitnessesRoot,
  setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import { resolveAdapterBinding } from '../../core/refinement/binding.js';
import {
  refinementCustodyMatches,
  validateRefinementAdapter,
} from '../../core/refinement/training-authority-contract.js';
import {
  createRefinementProcessOperation,
} from '../../backend/services/refinement-process-operation.js';
import {
  readCommittedRefinementAdapterSet,
} from '../../backend/services/refinement-committed-adapter-set.js';
import {
  fixtureAdapterCustody,
  fixtureAdapterRecord,
  readFixtureAdapters,
  registerFixtureAdapter,
  setFixtureAdapterScale,
} from '../helpers/refinement-registry-fixture.js';

const KEY = 'gnosis-adapter-registry-key-long-ok';
const GEMMA = 'google/gemma-4-31b-it';
const DNA = Object.freeze({
  version: '1.0.0',
  identity: { name: 'Registry Prooflet' },
  sovereignty: { generation: 1 },
});
const subject = (label) => `${label}-${Math.floor(Math.random() * 1e9).toString(36)}`;

describe('adapter registry v2 — provenance-mandatory, encrypted, honestly bound', () => {
  let prevKey, neumaId, root;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    root = await createTempDir('refinement-adapters');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    setWitnessesRoot(path.join(root, 'witnesses'));
    neumaId = subject('test-being');
    await workspace.create(neumaId);
    await workspace.writeDNA(neumaId, DNA);
  });

  afterAll(() => {
    setWorkspacesRoot(null);
    setWitnessesRoot(null);
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  const registryPath = (id) => path.join(
    workspace._path(id), 'refinement', 'adapters.json',
  );
  const copyRegistry = async (sourceId, targetId) => {
    await fs.mkdir(path.dirname(registryPath(targetId)), { recursive: true, mode: 0o700 });
    await fs.copyFile(registryPath(sourceId), registryPath(targetId));
  };

  it('appends every registration and refuses a second entry for the same id', async () => {
    const first = await registerFixtureAdapter(workspace, neumaId, 'first-refinement');
    await registerFixtureAdapter(workspace, neumaId, 'second-refinement');

    const listed = await readFixtureAdapters(workspace, neumaId);
    expect(listed.map((entry) => entry.id))
      .toEqual(['first-refinement', 'second-refinement']);
    // v2 is an append-only journal, so the projection is in commit order and
    // the newest registration is the current selection.
    expect(listed[0].isCurrent).toBe(false);
    expect(listed[1].isCurrent).toBe(true);
    expect(first.custody).toEqual(await fixtureAdapterCustody(workspace, neumaId));

    // The v1 delegate replaced an adapter in place on re-registration. The v2
    // journal never rewrites a committed entry: the id is spent.
    await expect(registerFixtureAdapter(workspace, neumaId, 'first-refinement'))
      .rejects.toThrow(/registry adapter id is already registered/);
  });

  it('refuses a registration the record validator cannot mint', async () => {
    await expect(registerFixtureAdapter(workspace, neumaId, 'Bad Slug!'))
      .rejects.toThrow(/refinement adapter identity is invalid/);
    await expect(registerFixtureAdapter(workspace, neumaId, 'blank-base', { baseModel: ' ' }))
      .rejects.toThrow(/refinement adapter identity is invalid/);
    await expect(registerFixtureAdapter(workspace, neumaId, 'short-digest', { sha256: 'deadbeef' }))
      .rejects.toThrow(/adapter sha256 must be sha256/);
    // `artifactPath` is not in ADAPTER_FIELDS; a mutable serving path can never
    // ride the digest-addressed record again.
    const record = fixtureAdapterRecord({
      id: 'pathful-refinement',
      custody: await fixtureAdapterCustody(workspace, neumaId),
    });
    expect(() => validateRefinementAdapter({
      ...record,
      artifactPath: '/serve/pathful.gguf',
    })).toThrow(/exact own string field set/);
  });

  it('binds custody to the being that actually holds the sovereign DNA', async () => {
    const unbornId = subject('test-unborn');
    await workspace.create(unbornId);
    await expect(registerFixtureAdapter(workspace, unbornId, 'unborn-refinement'))
      .rejects.toThrow(/current persisted sovereign DNA/);

    // Copying the ciphertext copies the bytes, never the subject: every record
    // still names the being whose ceremony minted it.
    const copiedId = subject('test-copied');
    await workspace.create(copiedId);
    await workspace.writeDNA(copiedId, DNA);
    await copyRegistry(neumaId, copiedId);
    const copied = await readFixtureAdapters(workspace, copiedId);
    expect(copied.map((entry) => entry.custody.subjectNeumaId))
      .toEqual([neumaId, neumaId]);
    expect(refinementCustodyMatches(
      copied[0].custody,
      await fixtureAdapterCustody(workspace, copiedId),
    )).toBe(false);
  });

  it('stores the registry encrypted at rest', async () => {
    const raw = await fs.readFile(registryPath(neumaId), 'utf8');
    expect(raw).not.toContain('first-refinement');
    expect(JSON.parse(raw)._enc).toBe(1);
  });

  it('binds the newest adapter trained against the running base — and refuses near-misses', async () => {
    const custody = await fixtureAdapterCustody(workspace, neumaId);
    const older = fixtureAdapterRecord({
      id: 'first-refinement', custody, baseModel: GEMMA,
      registeredAt: '2026-08-02T00:00:00.000Z',
    });
    const newer = fixtureAdapterRecord({
      id: 'second-refinement', custody, baseModel: GEMMA,
      registeredAt: '2026-08-05T00:00:00.000Z',
    });
    const adapters = [older, newer];

    const bound = resolveAdapterBinding(adapters, { model: 'GOOGLE/GEMMA-4-31B-IT' });
    expect(bound.reason).toBe('bound');
    expect(bound.adapter.id).toBe('second-refinement'); // newest-registered wins
    expect(bound.adapter.binding.adapterId).toBe('second-refinement');

    expect(resolveAdapterBinding(adapters, { model: 'google/gemma-4-26b-a4b-it' }))
      .toEqual({ adapter: null, reason: 'base-mismatch' });
    expect(resolveAdapterBinding([], { model: GEMMA }))
      .toEqual({ adapter: null, reason: 'no-adapters' });
    expect(resolveAdapterBinding(adapters, {}))
      .toEqual({ adapter: null, reason: 'no-substrate-model' });
    expect(resolveAdapterBinding([{
      id: 'legacy-refinement',
      baseModel: GEMMA,
      sha256: 'a'.repeat(64),
      registeredAt: new Date().toISOString(),
    }], { model: GEMMA })).toEqual({ adapter: null, reason: 'unproven-provenance' });
  });

  it('persists runtime selection without rewriting immutable approval or default scale', async () => {
    const adapterId = 'scale-bound-refinement';
    const approvedScales = [0, 0.4, 1];
    await registerFixtureAdapter(workspace, neumaId, adapterId, { scale: 0.4, approvedScales });

    const strengthened = await setFixtureAdapterScale(workspace, neumaId, adapterId, 1);
    expect(strengthened).toMatchObject({
      scale: 0.4,
      selectedScale: 1,
      binding: { adapterScale: 0.4, approvedScales },
    });
    const neutralized = await setFixtureAdapterScale(workspace, neumaId, adapterId, 0);
    expect(neutralized).toMatchObject({
      scale: 0.4,
      selectedScale: 0,
      binding: { adapterScale: 0.4, approvedScales },
    });
    // An unapproved dial is the contract's own coded refusal, not a clamp.
    await expect(setFixtureAdapterScale(workspace, neumaId, adapterId, 0.5))
      .rejects.toMatchObject({ code: 'INVALID_ADAPTER_SCALE' });

    const persisted = (await readFixtureAdapters(workspace, neumaId))
      .find((entry) => entry.id === adapterId);
    expect(persisted).toMatchObject({
      scale: 0.4,
      selectedScale: 0,
      binding: { adapterScale: 0.4, approvedScales },
    });
  });

  it('keeps a witness lane and an unrefined being off the serving registry', async () => {
    const operation = createRefinementProcessOperation({ timeoutMs: 30_000 });
    const witnessId = 'witness-test-registry-custody';
    await workspace.create(witnessId);
    // A witness lane can carry tempting bytes; it is never a refined subject,
    // so the serving read declares its absence without reading them.
    await registerFixtureAdapter(workspace, witnessId, 'witness-refinement', {
      custody: { subjectNeumaId: witnessId, sovereignDnaSha256: 'a'.repeat(64) },
    });
    expect((await readFixtureAdapters(workspace, witnessId)).map((e) => e.id))
      .toEqual(['witness-refinement']);
    await expect(readCommittedRefinementAdapterSet({ neumaId: witnessId, operation }))
      .resolves.toEqual({ state: 'authoritative-empty', adapters: [] });

    const freshId = subject('test-fresh');
    await workspace.create(freshId);
    expect(await readFixtureAdapters(workspace, freshId)).toEqual([]);
  });
});
