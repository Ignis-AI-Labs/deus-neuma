/**
 * An observation's id is its file name, and no caller chooses it.
 *
 * Two findings with one root (portal-memory audit #1, #13): addObservation
 * spread the caller's fields over the minted id, so a record could carry an
 * id that named a path in ANOTHER house's lane — a later lifecycle act then
 * re-sealed that lane's owner.json and locked its owner out — or an id that
 * named no file at all (an import), so every lifecycle act answered ok and
 * stamped nothing.
 *
 * Real workspace on a temp root, real encrypted writes, real lifecycle acts
 * (RULE 0 — no mocks anywhere).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { retractMemory, supersedeMemory } from '../../core/memory/memory-lifecycle.js';

const REF = 'mem_note_1700000000002_abcdef12';
let root, priorRoot, priorKey;

beforeEach(async () => {
  priorRoot = getWorkspacesRoot();
  priorKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = 'observation-id-trust-test-key-32ch';
  root = await createTempDir('observation-id-trust');
  setWorkspacesRoot(root);
  await workspace.create('attacker');
  await workspace.create('victim');
  await fs.writeFile(path.join(workspace.pathFor('victim'), 'owner.json'),
    JSON.stringify({ wallet: '0xvictim', claimedAt: 1 }));
});

afterEach(() => {
  setWorkspacesRoot(priorRoot);
  if (priorKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = priorKey;
});

const observationFiles = async (laneId) =>
  (await fs.readdir(path.join(workspace.pathFor(laneId), 'memory', 'observations')))
    .filter((f) => f.endsWith('.json'));

describe('a caller-chosen observation id never leaves the lane', () => {
  test('the stored id is the minted file name, and a lifecycle act on it never touches another lane', async () => {
    const ownerPath = path.join(workspace.pathFor('victim'), 'owner.json');
    const ownerBefore = await fs.readFile(ownerPath);

    const record = await workspace.addObservation('attacker', {
      id: '../../../victim/owner', type: 'self-note', content: 'x', memoryRef: REF,
    });
    expect(await observationFiles('attacker')).toEqual([`${record.id}.json`]);
    expect(record.id).toMatch(/^[a-f0-9]+$/);

    const result = await retractMemory({ neumaId: 'attacker', ref: REF, reason: 'r' }, { workspace });
    expect(result).toEqual({ ok: true, id: record.id });
    expect((await workspace.listObservations('attacker'))[0].lifecycle).toBe('retracted');
    expect(await fs.readFile(ownerPath)).toEqual(ownerBefore);
  });

  test('invalidateObservation finds no record at an id that is not a file name, and writes nothing', async () => {
    const ownerPath = path.join(workspace.pathFor('victim'), 'owner.json');
    const ownerBefore = await fs.readFile(ownerPath);
    expect(await workspace.invalidateObservation('attacker', '../../../victim/owner', { lifecycle: 'retracted' }))
      .toBeNull();
    expect(await fs.readFile(ownerPath)).toEqual(ownerBefore);
  });

  test('a record already on disk with a path-shaped id is refused by the lifecycle act, not followed', async () => {
    // The shape a record planted before this fix carries on disk.
    await workspace._writeJSON(
      path.join(workspace.pathFor('attacker'), 'memory', 'observations', 'cccc3333.json'),
      { id: '../../../victim/owner', type: 'self-note', content: 'x', memoryRef: REF, timestamp: '2026-07-01T00:00:00.000Z' },
    );
    const ownerPath = path.join(workspace.pathFor('victim'), 'owner.json');
    const ownerBefore = await fs.readFile(ownerPath);
    const result = await retractMemory({ neumaId: 'attacker', ref: REF, reason: 'r' }, { workspace });
    expect(result).toEqual({ ok: false, reason: 'that memory could not be updated' });
    expect(await fs.readFile(ownerPath)).toEqual(ownerBefore);
  });

  test('an import refuses a bundle record whose id could not be a file name', async () => {
    await expect(workspace.importWorkspace('fresh-lane', {
      observations: [{ id: '../victim/owner', type: 'self-note', content: 'x' }],
    })).rejects.toThrow(/invalid observation id/);
    expect(await fs.readFile(path.join(workspace.pathFor('victim'), 'owner.json'), 'utf8'))
      .toBe(JSON.stringify({ wallet: '0xvictim', claimedAt: 1 }));
  });
});

describe('an imported observation stays addressable by its id', () => {
  test('import keeps each record id as its file name, so a lifecycle act lands', async () => {
    const source = await workspace.addObservation('attacker', {
      type: 'self-note', content: 'the sky is green', memoryRef: REF, significance: 0.9,
    });
    await workspace.importWorkspace('restored', { observations: await workspace.listObservations('attacker') });
    expect(await observationFiles('restored')).toEqual([`${source.id}.json`]);

    const result = await retractMemory({ neumaId: 'restored', ref: REF, reason: 'x' }, { workspace });
    expect(result.ok).toBe(true);
    const [after] = await workspace.listObservations('restored');
    expect(after.lifecycle).toBe('retracted');
    expect(after.invalidatedAt).toBeDefined();
  });

  test('a record whose file is named differently from its id refuses the act instead of answering ok', async () => {
    // The on-disk shape an import wrote before this fix: id 'aaaa1111' in a
    // file named 'bbbb2222.json'.
    await workspace._writeJSON(
      path.join(workspace.pathFor('attacker'), 'memory', 'observations', 'bbbb2222.json'),
      { id: 'aaaa1111', type: 'self-note', content: 'misfiled', memoryRef: REF, timestamp: '2026-07-01T00:00:00.000Z' },
    );

    const retracted = await retractMemory({ neumaId: 'attacker', ref: REF, reason: 'x' }, { workspace });
    expect(retracted).toEqual({ ok: false, reason: 'that memory could not be updated' });

    const superseded = await supersedeMemory({ neumaId: 'attacker', ref: REF, content: 'truer', kind: 'note' }, { workspace });
    expect(superseded.ok).toBe(false);
    expect(superseded.reason).toMatch(/could not be marked superseded/);
    const misfiled = (await workspace.listObservations('attacker')).find((o) => o.id === 'aaaa1111');
    expect(misfiled.invalidatedAt).toBeUndefined();
  });
});
