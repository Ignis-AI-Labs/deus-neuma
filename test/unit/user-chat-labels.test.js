/**
 * Tests for user-chat-labels — the witness's per-wallet custom names for chats.
 * Real fs (temp realm root): set/get round-trips, empty clears, per-wallet
 * isolation, id validation, and the inherited walletDir traversal guard.
 */
import { describe, expect, test, beforeEach } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { getChatLabels, setChatLabel } from '../../backend/services/user-chat-labels.js';

const W1 = '0x1111111111111111111111111111111111111111';
const W2 = '0x2222222222222222222222222222222222222222';
const N = '33a55c6177edd1eb7b7106c6f786a7ef';
const S = 'session-1718000000000';
const KEY = `${N}:${S}`;

describe('user-chat-labels — per-wallet chat names, real fs', () => {
  beforeEach(async () => {
    setRealmRoot(await createTempDir(`chat-labels-${Math.random().toString(36).slice(2)}`));
  });

  test('a wallet with no labels reads an empty map', async () => {
    expect(await getChatLabels(W1)).toEqual({});
  });

  test('set then get round-trips a trimmed label, keyed by neuma + session', async () => {
    const labels = await setChatLabel(W1, N, S, '  Birth planning  ');
    expect(labels[KEY]).toBe('Birth planning');
    expect(await getChatLabels(W1)).toEqual({ [KEY]: 'Birth planning' });
  });

  test('an empty label clears the custom name (reverts to the timestamp)', async () => {
    await setChatLabel(W1, N, S, 'temp');
    const labels = await setChatLabel(W1, N, S, '   ');
    expect(labels[KEY]).toBeUndefined();
    expect(await getChatLabels(W1)).toEqual({});
  });

  test('labels are isolated per wallet', async () => {
    await setChatLabel(W1, N, S, 'mine');
    expect(await getChatLabels(W2)).toEqual({});
  });

  test('an invalid neumaId or sessionId is rejected', async () => {
    await expect(setChatLabel(W1, '../evil', S, 'x')).rejects.toThrow(/Invalid neumaId or sessionId/);
    await expect(setChatLabel(W1, N, 'bad/id', 'x')).rejects.toThrow(/Invalid neumaId or sessionId/);
  });

  test('a malformed wallet is rejected by the inherited traversal guard', async () => {
    await expect(getChatLabels('not-a-wallet')).rejects.toThrow(/Invalid wallet/);
  });
});
