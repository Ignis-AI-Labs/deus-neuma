/**
 * TEST-904 (#307) — the coverage hole, closed as a helper contract: custody-
 * layer code must be REACHABLE from a test written with the standard temp
 * kit. Real pinned directories on real disk, no mocks (RULE 0).
 *
 * The pair below is the proof of the original blind spot's shape: the same
 * pin that REFUSES a createTempDir root (under /tmp, mode 1777 — a sticky
 * world-writable ancestor) PINS a createProtectedTempDir root (home-rooted,
 * owner-protected ancestors — production's house-root shape).
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import {
  createTempDir, createProtectedTempDir, removeProtectedTempDir,
} from '../helpers/temp-fs.js';
import { pinDirectoryCustody } from '../../backend/services/refinement-directory-custody.js';

describe('the standard temp kit reaches the custody layer (#307)', () => {
  let protectedRoot = null;

  afterEach(async () => {
    if (protectedRoot) await removeProtectedTempDir(protectedRoot);
    protectedRoot = null;
  });

  it('refuses the shared /tmp root — the refusal that hid the layer from every test', async () => {
    const root = await createTempDir('custody-refusal');
    await fs.chmod(root, 0o700); // the leaf is fine; the ANCESTORS are the refusal
    await expect(pinDirectoryCustody(root, 'tmp-root proof')).rejects.toThrow();
  });

  it('pins a protected root, works a scope, and closes clean', async () => {
    protectedRoot = await createProtectedTempDir('helper-proof');
    await fs.mkdir(`${protectedRoot}/alpha`, { mode: 0o700 });
    await fs.writeFile(`${protectedRoot}/alpha/alpha.marker`, 'a', { mode: 0o600 });
    const owner = await pinDirectoryCustody(protectedRoot, 'protected-root proof');
    try {
      await owner.enter({ name: 'alpha', mode: 0o700, label: 'alpha' });
      await owner.leave();
    } finally {
      await owner.close();
    }
  });

  it('removal refuses anything outside the .neuma-test- family', async () => {
    const bystander = await createTempDir('custody-bystander');
    await removeProtectedTempDir(bystander); // wrong family — must be a no-op
    await expect(fs.access(bystander)).resolves.toBeUndefined();
  });
});
