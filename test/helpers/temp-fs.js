/**
 * Temp filesystem helpers for file-based module tests.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// Monotonic counter ensures adjacent createTempDir() calls in the same
// millisecond don't collide. Date.now() alone has ms resolution; vitest
// runs tests fast enough that two beforeEach calls can land in the same
// ms with the same label, producing the same path → silent state bleed
// across tests.
let __tempDirSeq = 0;

/**
 * Creates a scoped temp directory under the global TEST_TEMP_DIR.
 * Returns the path. Cleaned up automatically via the global afterAll in setup.js.
 *
 * Unique-per-call: label + Date.now() + monotonic counter. The counter
 * protects against same-millisecond collisions when adjacent tests reuse
 * the same label.
 */
export async function createTempDir(label = 'default') {
  __tempDirSeq += 1;
  const dir = path.join(globalThis.__TEST_TEMP_DIR__, `${label}-${Date.now()}-${__tempDirSeq}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * A temp root the CUSTODY LAYER can pin (#307). The roots above live under
 * the shared temp dir — /tmp, mode 1777 — and pinDirectoryCustody refuses a
 * world-writable/sticky ancestor, so custody-layer code was structurally
 * unreachable from a test written with createTempDir: the refusal read as a
 * test-environment problem and four real defects sat latent in the blind
 * spot. mkdtemp under the home directory gives an owner-protected ancestor
 * chain — the same shape as production's house root. The caller owns removal
 * (removeProtectedTempDir): the global temp sweep only clears the /tmp root.
 */
export async function createProtectedTempDir(label = 'custody') {
  const dir = await fs.mkdtemp(path.join(os.homedir(), `.neuma-test-${label}-`));
  await fs.chmod(dir, 0o700);
  return dir;
}

/**
 * Removes a protected temp root — unseals 0o500 CAS dirs first, and refuses
 * any path outside the `.neuma-test-` family so a bad variable can never
 * aim this at real data.
 */
export async function removeProtectedTempDir(directory) {
  if (typeof directory !== 'string'
    || path.dirname(directory) !== os.homedir()
    || !path.basename(directory).startsWith('.neuma-test-')) return;
  await unsealDirectories(directory);
  await fs.rm(directory, { recursive: true, force: true });
}

/**
 * Makes a tree removable again by the uid that owns it.
 *
 * The refinement CAS seals every published object directory to 0o500 — that IS
 * its immutability contract, and it locks even the owning uid out of unlinking
 * the bytes inside one (measured: `rm -rf` as the owner reports EACCES). Any
 * suite that builds a REAL artifact store therefore has to unseal before it can
 * remove its own temp root. Tolerates an absent path so teardown still runs
 * when setup failed before the root existed.
 */
export async function unsealDirectories(directory) {
  const state = await fs.lstat(directory).catch(() => null);
  if (!state?.isDirectory()) return;
  await fs.chmod(directory, 0o700);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await unsealDirectories(path.join(directory, entry.name));
  }
}

/**
 * Creates subdirectories under a given root.
 */
export async function ensureDirs(root, dirs) {
  for (const d of dirs) {
    await fs.mkdir(path.join(root, d), { recursive: true });
  }
}

/**
 * Writes a JSON file under root.
 */
export async function writeJSON(root, relativePath, data) {
  const fullPath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, JSON.stringify(data, null, 2));
  return fullPath;
}

/**
 * Reads and parses a JSON file.
 */
export async function readJSON(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}
