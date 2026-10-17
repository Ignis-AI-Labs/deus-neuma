/**
 * FD DISCIPLINE OF THE COMMITTED ADAPTER READ — leak hunt (RULE 0: real
 * workspace, real encrypted registry, real subject lock, real read; the fd
 * custody trace watches every fs.promises.open in the worker).
 *
 * Why this path: the 2026-08-15 desk boots leaked FileHandles to the GC
 * (fds 79, 78, 69 — #322), and fd 69 fired 58ms after the per-turn adapter
 * probe logged 'conduit-adapters-unknowable' — readCommittedRefinementAdapterSet
 * runs on EVERY turn. A leak here compounds turn by turn. This test demands
 * the whole read path returns every handle it opens; when it fails, the
 * assertion message carries the exact opening stack.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, {
  setWitnessesRoot,
  setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import {
  createRefinementProcessOperation,
} from '../../backend/services/refinement-process-operation.js';
import {
  readCommittedRefinementAdapterSet,
} from '../../backend/services/refinement-committed-adapter-set.js';
import { refinementCustodyIdentity } from '../../core/refinement/training-authority-contract.js';
import {
  commitFirstRefinementRegistration,
  servingLineageFor,
} from '../helpers/committed-refinement-registry.js';
import { createHash } from 'node:crypto';
import { installFdCustody, leakedOpenHandles } from '../../backend/services/fd-custody.js';

const KEY = 'gnosis-adapter-registry-key-long-ok';
const GENESIS = 'd'.repeat(64);
const SERVING_MODEL = 'gemma-4-31b';
const ARTIFACT_SHA256 = createHash('sha256').update('refined weights').digest('hex');
const DNA = Object.freeze({
  version: '1.0.0',
  identity: { name: 'Fd Discipline Prooflet' },
  sovereignty: { generation: 1 },
});
const subject = (label) => `${label}-${Math.floor(Math.random() * 1e9).toString(36)}`;

const standingStacks = (baseline) => leakedOpenHandles()
  .filter((h) => !baseline.has(h.fd))
  .map((h) => `fd ${h.fd} → ${h.path}\n${h.stack}`);

describe('committed adapter read returns every handle it opens', () => {
  let prevKey, neumaId, uninstall;

  beforeAll(async () => {
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    // The per-neuma DEK is wrapped with the master key, so the cached master
    // must be re-derived from this suite's own key before the DEK is written.
    resetWorkspaceCryptoKey();
    const root = await createTempDir('adapter-read-fd-leak');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    setWitnessesRoot(path.join(root, 'witnesses'));
    uninstall = installFdCustody({ trace: true, logger: { info: () => {}, error: () => {} } });
    neumaId = subject('fd-being');
    await workspace.create(neumaId);
    await workspace.writeNeumaDEK(neumaId, GENESIS);
    await workspace.writeDNA(neumaId, DNA);
    await commitFirstRefinementRegistration({
      workspace,
      neumaId,
      adapterId: 'fd-refinement',
      approvedScales: [1],
      artifactSha256: ARTIFACT_SHA256,
      ceremonyId: 'fd-refinement-ceremony',
      custody: refinementCustodyIdentity(neumaId, await workspace.readDNA(neumaId)),
      lineage: servingLineageFor(SERVING_MODEL),
      scale: 1,
    });
  });

  afterAll(() => {
    uninstall();
    setWorkspacesRoot(null);
    setWitnessesRoot(null);
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('a registry-present read leaves no FileHandle standing', async () => {
    const baseline = new Set(leakedOpenHandles().map((h) => h.fd));
    const read = await readCommittedRefinementAdapterSet({
      neumaId, operation: createRefinementProcessOperation(),
    });
    expect(read.state).toBe('present');
    expect(read.adapters.map(({ id }) => id)).toEqual(['fd-refinement']);
    expect(standingStacks(baseline)).toEqual([]);
  });

  it('an unrefined being (authoritative-empty) leaves no FileHandle standing', async () => {
    const bare = subject('bare-being');
    await workspace.create(bare);
    await workspace.writeNeumaDEK(bare, GENESIS);
    await workspace.writeDNA(bare, DNA);
    const baseline = new Set(leakedOpenHandles().map((h) => h.fd));
    const read = await readCommittedRefinementAdapterSet({
      neumaId: bare, operation: createRefinementProcessOperation(),
    });
    expect(read.state).toBe('authoritative-empty');
    expect(standingStacks(baseline)).toEqual([]);
  });
});
