/**
 * A witness lane seals under its own key (portal-memory audit #10).
 *
 * Witness lanes live on their own ground beside the house, but the engine
 * read a file's lane only against the workspaces root. A witness file
 * therefore resolved to no lane, no DEK, and was sealed under the shared
 * master key, while the lane's DEK sat on disk and its status said it had one.
 *
 * Real workspace on temp grounds, real key derivation, real envelopes on disk
 * (RULE 0 — no mocks anywhere).
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, {
  getWorkspacesRoot, setWorkspacesRoot, setWitnessesRoot,
} from '../../core/workspace/neuma-workspace.js';
import { setHarnessRoot } from '../../core/workspace/lane-grounds.js';
import { decryptEnvelope, deriveKeyFromSecret } from '../../core/workspace/workspace-crypto.js';

const KEY = 'witness-lane-dek-seal-test-key-32c';
const LANE = 'witness-test-Quill';
let base, priorRoot, priorKey;

beforeAll(async () => {
  priorRoot = getWorkspacesRoot();
  priorKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = KEY;
  base = await createTempDir('witness-lane-dek');
  setWorkspacesRoot(path.join(base, 'workspaces'));
  setWitnessesRoot(path.join(base, 'witnesses'));
  setHarnessRoot(path.join(base, 'harness'));
  await workspace.create(LANE);
});

afterAll(() => {
  setWorkspacesRoot(priorRoot);
  setWitnessesRoot(null);
  setHarnessRoot(null);
  if (priorKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = priorKey;
});

beforeEach(() => workspace._dekCache.clear());

describe('lane resolution follows the ground _path chose', () => {
  test('a file in a witness lane or a harness lane names that lane', () => {
    expect(workspace._neumaIdFromPath(path.join(workspace.pathFor(LANE), 'memory', 'x.json'))).toBe(LANE);
    expect(workspace._neumaIdFromPath(path.join(workspace.pathFor('harness-Tess'), 'sessions', 'a.jsonl')))
      .toBe('harness-Tess');
    expect(workspace._neumaIdFromPath(path.join(workspace.pathFor('house-being'), 'dna', 'active.json')))
      .toBe('house-being');
    expect(workspace._neumaIdFromPath(path.join(base, 'elsewhere', 'x.json'))).toBeNull();
  });

  test('a witness lane with a DEK seals new files under it, and still reads its older master-key files', async () => {
    const older = path.join(workspace.pathFor(LANE), 'memory', 'older.json');
    await workspace._writeJSON(older, { written: 'before the key' });

    await workspace.writeNeumaDEK(LANE, 'c'.repeat(64));
    expect(Buffer.isBuffer(await workspace._resolveDEK(older))).toBe(true);

    const fresh = path.join(workspace.pathFor(LANE), 'memory', 'fresh.json');
    await workspace._writeJSON(fresh, { written: 'under the lane key' });
    const envelope = JSON.parse(await fs.readFile(fresh, 'utf8'));
    expect(decryptEnvelope(envelope, { key: await workspace.readNeumaDEK(LANE) }))
      .toEqual({ written: 'under the lane key' });
    expect(() => decryptEnvelope(envelope, { key: deriveKeyFromSecret(KEY) })).toThrow();

    expect(await workspace._readJSON(older)).toEqual({ written: 'before the key' });
  });
});
