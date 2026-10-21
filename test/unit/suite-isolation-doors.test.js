/**
 * The hermetic suite never resolves the operator's live stores.
 *
 * Audit 3 E7 (2026-10-19): test/setup.js pinned neither the realm nor the
 * data root, so suites wrote into ~/.kenorie/realm (1600+ wallet dirs and
 * test-named chats) and into the repo's data/ — the live desk's settings,
 * including its provider choice. These are the REAL resolvers, read as a test
 * file sees them after setup — the same import-time view the ~20 modules that
 * capture their settings dir at load get. No mocks (RULE 0).
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import { getRealmRoot } from '../../backend/services/user-realm.js';
import { getDataRoot, getSettingsDir, getVaultRoot } from '../../backend/services/data-root.js';
import { providerChoicePath } from '../../backend/services/provider-choice.js';
import { credentialsPath } from '../../backend/services/provider-credentials.js';

const TEST_ROOT = globalThis.__TEST_TEMP_DIR__;
const inTestRoot = (p) => path.resolve(p).startsWith(path.resolve(TEST_ROOT) + path.sep);

describe('test/setup.js isolation doors', () => {
  it('the realm resolves inside this run\'s temp dir', () => {
    expect(inTestRoot(getRealmRoot())).toBe(true);
  });

  it('the data root, settings dir and DNA vault resolve inside it', () => {
    for (const p of [getDataRoot(), getSettingsDir(), getVaultRoot()]) expect(inTestRoot(p)).toBe(true);
  });

  it('the desk\'s provider choice and credential store resolve inside it', () => {
    expect(inTestRoot(providerChoicePath())).toBe(true);
    expect(inTestRoot(credentialsPath())).toBe(true);
  });
});
