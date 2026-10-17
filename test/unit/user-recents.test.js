/**
 * Tests for user-recents — the per-wallet MRU of opened folders behind the
 * picker's RECENT list. Real fs (temp realm root): record dedups + newest-
 * first + caps at 12, list drops folders that no longer exist, per-wallet
 * isolation holds, and the inherited walletDir guard rejects a bad wallet.
 */
import { describe, expect, test, beforeEach } from 'vitest';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { recordRecent, listRecents } from '../../backend/services/user-recents.js';

const W1 = '0x1111111111111111111111111111111111111111';
const W2 = '0x2222222222222222222222222222222222222222';

describe('user-recents — per-wallet MRU folders, real fs', () => {
  let a; let b;
  beforeEach(async () => {
    // Unique realm per test — createTempDir only suffixes with Date.now(), so a
    // fixed label can collide in the same ms and leak recents between tests.
    const uniq = Math.random().toString(36).slice(2);
    setRealmRoot(await createTempDir(`recents-realm-${uniq}`));
    a = await createTempDir(`recent-a-${uniq}`);
    b = await createTempDir(`recent-b-${uniq}`);
  });

  test('a wallet with no recents lists nothing', async () => {
    expect(await listRecents(W1)).toEqual([]);
  });

  test('records newest-first and de-dupes by path', async () => {
    await recordRecent(W1, a);
    await recordRecent(W1, b);
    expect(await listRecents(W1)).toEqual([b, a]); // newest first
    await recordRecent(W1, a); // re-open a → moves to front, no duplicate
    expect(await listRecents(W1)).toEqual([a, b]);
  });

  test('caps at 12 most-recent folders', async () => {
    const dirs = [];
    for (let i = 0; i < 15; i += 1) {
      const d = await createTempDir(`recent-cap-${i}`);
      dirs.push(d);
      await recordRecent(W1, d);
    }
    const list = await listRecents(W1);
    expect(list).toHaveLength(12);
    expect(list[0]).toBe(dirs[14]); // most-recent first
    expect(list).not.toContain(dirs[0]); // oldest dropped
  });

  test('listRecents drops a folder that no longer exists', async () => {
    await recordRecent(W1, a);
    await recordRecent(W1, b);
    await fs.rm(a, { recursive: true, force: true });
    expect(await listRecents(W1)).toEqual([b]);
  });

  test('recents are isolated per wallet', async () => {
    await recordRecent(W1, a);
    expect(await listRecents(W2)).toEqual([]);
  });

  test('a non-absolute folder is ignored, not recorded', async () => {
    await recordRecent(W1, 'relative/path');
    expect(await listRecents(W1)).toEqual([]);
  });

  test('a malformed wallet is rejected by the inherited traversal guard', async () => {
    await expect(listRecents('not-a-wallet')).rejects.toThrow(/Invalid wallet/);
  });
});
