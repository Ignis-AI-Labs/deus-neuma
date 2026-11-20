// P6-110 — explicit operator-wallet paths only. Real env and real temp trees;
// a planted project .env is never an ambient identity source.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { withEnv } from '../helpers/with-env.js';
import { resolveWalletEnvPath } from '../../cli/lib/wallet-env.js';

describe('cli/lib/wallet-env — resolveWalletEnvPath', () => {
  test('an absolute NEUMA_WALLET_ENV wins', async () => {
    await withEnv('NEUMA_WALLET_ENV', '/tmp/explicit/.env', () => {
      expect(resolveWalletEnvPath('/some/cwd')).toBe('/tmp/explicit/.env');
    });
  });

  test('an explicitly relative override resolves against the caller cwd', async () => {
    await withEnv('NEUMA_WALLET_ENV', 'private/operator.env', () => {
      expect(resolveWalletEnvPath('/some/cwd')).toBe(resolvePath('/some/cwd', 'private/operator.env'));
    });
  });

  test('a git project .env is refused when no explicit wallet path stands', async () => {
    const project = await createTempDir('cli-wallet-env-hostile');
    mkdirSync(join(project, '.git'));
    const subdir = join(project, 'src', 'nested');
    mkdirSync(subdir, { recursive: true });
    writeFileSync(join(project, '.env'), 'CONTRACT_DEPLOYER_PRIVATE_KEY=not-read\n');
    await withEnv('NEUMA_WALLET_ENV', undefined, () => {
      expect(() => resolveWalletEnvPath(subdir)).toThrow(/NEUMA_WALLET_ENV.*never reads a working project/);
    });
  });

  test('an empty override fails closed outside a git tree too', async () => {
    const orphan = await createTempDir('cli-wallet-env-orphan');
    await withEnv('NEUMA_WALLET_ENV', '   ', () => {
      expect(() => resolveWalletEnvPath(orphan)).toThrow(/NEUMA_WALLET_ENV/);
    });
  });
});
