// RULE 0 verification for cli/lib/wallet-env.js — the operator-wallet
// path resolver. Real env mutation with save-restore, real fs via
// createTempDir + mkdir .git. No mocks.

import { mkdirSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { withEnv } from '../helpers/with-env.js';
import { resolveWalletEnvPath } from '../../cli/lib/wallet-env.js';

describe('cli/lib/wallet-env — resolveWalletEnvPath', () => {
  test('NEUMA_WALLET_ENV env wins (no fs walk needed)', async () => {
    await withEnv('NEUMA_WALLET_ENV', '/tmp/explicit/.env', () => {
      expect(resolveWalletEnvPath('/some/cwd')).toBe('/tmp/explicit/.env');
    });
  });

  test('falls back to <projectRoot>/.env via .git walk-up', async () => {
    const project = await createTempDir('cli-wallet-env-fallback');
    mkdirSync(join(project, '.git'));
    const subdir = join(project, 'src', 'nested');
    mkdirSync(subdir, { recursive: true });

    await withEnv('NEUMA_WALLET_ENV', undefined, () => {
      // From subdir — should resolve to project's .env, not subdir/.env
      expect(resolveWalletEnvPath(subdir)).toBe(resolvePath(project, '.env'));
    });
  });

  test('non-git tree → falls back to cwd/.env', async () => {
    const orphan = await createTempDir('cli-wallet-env-orphan');
    // NO .git anywhere up the tree (the tmp dir parents don't have .git
    // either — createTempDir gives us /tmp/... so we're safe)
    await withEnv('NEUMA_WALLET_ENV', undefined, () => {
      // findProjectRoot falls back to start path, so result = orphan/.env
      expect(resolveWalletEnvPath(orphan)).toBe(resolvePath(orphan, '.env'));
    });
  });
});
