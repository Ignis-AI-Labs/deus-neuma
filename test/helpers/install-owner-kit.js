/**
 * The install owner, for tests that drive a machine-wide route as its owner
 * (backend/services/install-owner.js; Design note, 2026-10-19. Writes the real
 * record, on the test's own data root, that the real gate reads — the same
 * way the ownership suites write a real owner.json. Nothing is mocked: the
 * gate still judges the wallet and the desk for every request.
 */
import fs from 'fs/promises';
import path from 'path';

/**
 * Make this wallet the owner of the install whose data root the test runs on.
 * impure (writes <NEUMA_DATA_ROOT>/settings/install-owner.json).
 * @param {string} wallet
 * @param {{coOwners?: string[]}} [opts]
 */
export const makeInstallOwner = async (wallet, { coOwners = [] } = {}) => {
  const file = path.join(process.env.NEUMA_DATA_ROOT, 'settings', 'install-owner.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({
    schema: 'install-owner/1',
    owner: String(wallet).toLowerCase(),
    coOwners: coOwners.map((w) => String(w).toLowerCase()),
    recordedAt: new Date().toISOString(),
    source: 'test',
  }));
};
