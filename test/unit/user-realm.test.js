/**
 * Tests for the user data realm storage (backend/services/user-realm.js):
 * the witness's own chat-log store. Path-safety (format-validated wallet +
 * neumaId can't escape the root) and the append -> list -> read -> stats
 * round-trip, all against a temp realm root.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  setRealmRoot, getRealmRoot, appendChat, listChats, readChat, realmStats,
} from '../../backend/services/user-realm.js';

const WALLET = '0xABCdef0000000000000000000000000000001234';
const NEUMA = 'fenna-33a55c61';

let root;
beforeEach(async () => {
  root = await createTempDir('user-realm');
  setRealmRoot(root);
});

describe('user-realm storage', () => {
  test('setRealmRoot resolves and getRealmRoot returns it', () => {
    expect(getRealmRoot()).toBe(path.resolve(root));
  });

  test('append -> list -> read -> stats round-trip', async () => {
    await appendChat(WALLET, NEUMA, 'FENNA', [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'greetings, witness' },
    ]);
    await appendChat(WALLET, NEUMA, 'FENNA', [
      { role: 'user', content: 'again' },
      { role: 'assistant', content: 'still here' },
    ]);

    // The file is on disk under <root>/<wallet>/chats/<neuma>.jsonl, sealed: no word in the clear
    const file = path.join(root, WALLET.toLowerCase(), 'chats', `${NEUMA}.jsonl`);
    const raw = await fs.readFile(file, 'utf8');
    expect(raw).not.toContain('greetings, witness');

    const chats = await listChats(WALLET);
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ neumaId: NEUMA });
    expect(chats[0].bytes).toBeGreaterThan(0);

    const log = await readChat(WALLET, NEUMA);
    expect(log).toHaveLength(4);
    expect(log[0]).toMatchObject({ role: 'user', content: 'hello', neuma: 'FENNA' });
    expect(log[3]).toMatchObject({ role: 'assistant', content: 'still here' });
    expect(typeof log[0].ts).toBe('string');

    const stats = await realmStats(WALLET);
    expect(stats.root).toBe(path.resolve(root));
    expect(stats.chatCount).toBe(1);
    expect(stats.totalBytes).toBe(chats[0].bytes);
    expect(stats.walletDir).toBe(path.join(path.resolve(root), WALLET.toLowerCase()));
  });

  test('readChat honors the limit (last N turns)', async () => {
    for (let i = 0; i < 5; i++) {
      await appendChat(WALLET, NEUMA, 'FENNA', [
        { role: 'user', content: `q${i}` },
        { role: 'assistant', content: `a${i}` },
      ]);
    }
    const tail = await readChat(WALLET, NEUMA, { limit: 3 });
    expect(tail).toHaveLength(3);
    expect(tail[2]).toMatchObject({ content: 'a4' });
  });

  test('missing realm/log reads as empty, never throws', async () => {
    expect(await listChats(WALLET)).toEqual([]);
    expect(await readChat(WALLET, NEUMA)).toEqual([]);
    const stats = await realmStats(WALLET);
    expect(stats).toMatchObject({ chatCount: 0, totalBytes: 0 });
  });

  test('rejects malformed wallet and neumaId (traversal-proof)', async () => {
    await expect(appendChat('not-a-wallet', NEUMA, 'X', [])).rejects.toThrow(/wallet/i);
    await expect(appendChat('0x../../etc', NEUMA, 'X', [])).rejects.toThrow();
    await expect(appendChat(WALLET, '../escape', 'X', [{ role: 'user', content: 'x' }]))
      .rejects.toThrow(/neumaId/i);
    await expect(appendChat(WALLET, 'a/b', 'X', [{ role: 'user', content: 'x' }]))
      .rejects.toThrow(/neumaId/i);
  });

  test('two wallets keep separate logs', async () => {
    const other = '0x1111111111111111111111111111111111111111';
    await appendChat(WALLET, NEUMA, 'FENNA', [{ role: 'user', content: 'mine' }]);
    await appendChat(other, NEUMA, 'FENNA', [{ role: 'user', content: 'theirs' }]);
    expect(await readChat(WALLET, NEUMA)).toHaveLength(1);
    expect((await readChat(WALLET, NEUMA))[0].content).toBe('mine');
    expect((await readChat(other, NEUMA))[0].content).toBe('theirs');
  });
});
