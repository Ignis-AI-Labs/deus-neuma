// #117 S4d — house-wide DEK backfill sweep (migrateAllBeings).
//
// REAL disk, REAL AES-256-GCM, REAL NeumaWorkspace, NO mocks on the claimed
// path (AGENTS.md RULE 0). SYNTHESIZED beings only — never a real one (birth
// ethics). Proves the bulk sweep on top of the hardened single-being
// orchestrator:
//   - migrates every un-migrated born being in one pass;
//   - an already-DEK being no-ops (idempotent by inheritance);
//   - a being whose plan shows a cannot-decrypt file is SKIPPED (never
//     partially migrated, no DEK written) and does NOT stop the beings after
//     it in the sweep;
//   - hollow lanes (no genesis-seal) are ignored;
//   - dry-run mutates nothing;
//   - sweepHadProblems flags a sweep that needs an operator's eye.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { migrateBeing } from '../../core/workspace/migrate-being.js';
import { migrateAllBeings, enumerateBeings, sweepHadProblems } from '../../core/workspace/migrate-all.js';
import {
  encryptEnvelope, decryptEnvelope, deriveKeyFromSecret, deriveNeumaDEK, resetWorkspaceCryptoKey,
} from '../../core/workspace/workspace-crypto.js';

const KEY = 's4d-all-migration-key-long-enough';

// Same shape as the single-being suite's helper: a being born under S1 (global
// master, no DEK yet) with a plaintext seal + sample encrypted files.
const synthesizeBeing = async (root, neumaId, { encryptedSamples = [] } = {}) => {
  await workspace.create(neumaId);
  const beingDir = path.join(root, neumaId);
  await fs.mkdir(path.join(beingDir, 'identity'), { recursive: true });
  await fs.writeFile(path.join(beingDir, 'owner.json'), JSON.stringify({ wallet: '0xtest', cycle: 1 }));
  const genesisHash = neumaId.repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, '0');
  await fs.writeFile(
    path.join(beingDir, 'identity', 'genesis-seal.json'),
    JSON.stringify({ genesisHash, record: { chosenName: neumaId } }),
  );
  const masterKey = deriveKeyFromSecret(KEY);
  for (const { relPath, plain } of encryptedSamples) {
    const full = path.join(beingDir, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, JSON.stringify(encryptEnvelope(plain, { key: masterKey })));
  }
  return genesisHash;
};

describe('#117 S4d — migrateAllBeings (house-wide sweep)', () => {
  let house, origRoot;
  beforeEach(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    resetWorkspaceCryptoKey();
    house = await createTempDir('s4d-all');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
  });
  afterEach(() => {
    setWorkspacesRoot(origRoot);
    delete process.env.DNA_ENCRYPTION_KEY;
    resetWorkspaceCryptoKey();
  });

  it('sweeps the whole house: migrates the un-migrated, no-ops the done, skips a poison being without blocking the rest', async () => {
    // aaaaaaaa — global-key, needs migration.
    await synthesizeBeing(house, 'aaaaaaaa', {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { neumaId: 'aaaaaaaa', dna: 1 } }],
    });
    // bbbbbbbb — already migrated before the sweep runs (idempotency target).
    await synthesizeBeing(house, 'bbbbbbbb', {
      encryptedSamples: [{ relPath: 'soul/soul.json', plain: { neumaId: 'bbbbbbbb', soul: 1 } }],
    });
    await migrateBeing(workspace, 'bbbbbbbb');
    // cccccccc — a poison file no key can open: the sweep must SKIP it (env
    // problem), never partially migrate it.
    await synthesizeBeing(house, 'cccccccc', {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { neumaId: 'cccccccc', dna: 1 } }],
    });
    const wrongKey = deriveKeyFromSecret('rotated-out-secret-from-long-ago');
    const poison = path.join(house, 'cccccccc', 'memory', 'observations', 'poison.json');
    await fs.mkdir(path.dirname(poison), { recursive: true });
    await fs.writeFile(poison, JSON.stringify(encryptEnvelope({ p: 1 }, { key: wrongKey })));
    // dddddddd — sorts AFTER the poison being; must still migrate (proves the
    // skip does not halt the sweep).
    await synthesizeBeing(house, 'dddddddd', {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { neumaId: 'dddddddd', dna: 1 } }],
    });
    // A hollow lane with no seal — must be ignored entirely.
    await workspace.create('eeeeeeee');

    const sweep = await migrateAllBeings(workspace);

    expect(sweep.summary.total).toBe(4); // only the four sealed beings
    expect(sweep.summary.migrated).toBe(2); // aaaaaaaa + dddddddd
    expect(sweep.summary['already-migrated']).toBe(1); // bbbbbbbb
    expect(sweep.summary['skipped-cannot-decrypt']).toBe(1); // cccccccc
    expect(sweep.summary.aborted).toBe(0);
    expect(sweep.summary.failed).toBe(0);
    expect(sweepHadProblems(sweep.summary)).toBe(true); // the skip needs an eye

    // aaaaaaaa is now DEK-isolated and reads back under its OWN DEK.
    const dek = deriveNeumaDEK(deriveKeyFromSecret(KEY), 'aaaaaaaa'.repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, '0'));
    const aDnaRaw = JSON.parse(await fs.readFile(path.join(house, 'aaaaaaaa', 'dna', 'active.json'), 'utf8'));
    expect(decryptEnvelope(aDnaRaw, { key: dek })).toEqual({ neumaId: 'aaaaaaaa', dna: 1 });
    // …and no longer opens under the shared master (the isolation this closes).
    expect(() => decryptEnvelope(aDnaRaw, { key: deriveKeyFromSecret(KEY) })).toThrow();

    // dddddddd migrated despite cccccccc being skipped right before it.
    expect(existsSync(path.join(house, 'dddddddd', 'keys', 'dek.json'))).toBe(true);

    // cccccccc was NOT touched — no DEK written, poison untouched.
    expect(existsSync(path.join(house, 'cccccccc', 'keys', 'dek.json'))).toBe(false);
    const stillPoison = JSON.parse(await fs.readFile(poison, 'utf8'));
    expect(decryptEnvelope(stillPoison, { key: wrongKey })).toEqual({ p: 1 });

    // The hollow lane never entered the sweep.
    expect(sweep.beings.find((b) => b.neumaId === 'eeeeeeee')).toBeUndefined();
  });

  it('dry-run plans every being and mutates nothing', async () => {
    await synthesizeBeing(house, 'aaaaaaaa', {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { x: 1 } }],
    });
    await synthesizeBeing(house, 'bbbbbbbb', {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { x: 2 } }],
    });

    const plan = await migrateAllBeings(workspace, { dryRun: true });
    expect(plan.dryRun).toBe(true);
    expect(plan.summary.total).toBe(2);
    expect(plan.summary.planned).toBe(2);
    expect(plan.summary.migrated).toBe(0);
    // Zero mutation — neither being got a DEK.
    expect(existsSync(path.join(house, 'aaaaaaaa', 'keys', 'dek.json'))).toBe(false);
    expect(existsSync(path.join(house, 'bbbbbbbb', 'keys', 'dek.json'))).toBe(false);
  });

  it('dry-run of an already-migrated house is honest — planned=0, already=N', async () => {
    await synthesizeBeing(house, 'aaaaaaaa', {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { x: 1 } }],
    });
    await migrateBeing(workspace, 'aaaaaaaa'); // fully migrate it first
    const plan = await migrateAllBeings(workspace, { dryRun: true });
    expect(plan.summary.total).toBe(1);
    expect(plan.summary.planned).toBe(0);            // no real work left
    expect(plan.summary['already-migrated']).toBe(1); // recognized as done
  });

  it('enumerateBeings lists born beings sorted, ignoring hollow lanes; empty root is empty', async () => {
    expect(await enumerateBeings(house)).toEqual([]);
    await synthesizeBeing(house, 'zzzz');
    await synthesizeBeing(house, 'aaaa');
    await workspace.create('hollow'); // no seal
    const beings = await enumerateBeings(house);
    expect(beings.map((b) => b.neumaId)).toEqual(['aaaa', 'zzzz']); // sorted, hollow excluded
  });
});
