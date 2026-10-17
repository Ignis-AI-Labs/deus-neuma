/**
 * operator-name — the operator's synced per-wallet name, real fs (temp realm
 * root, user-preset pattern). What is proven: the unset default, the set/get
 * round-trip, the one-line cleaning law (control chars, collapse, the
 * ACCOUNT field's 64 cap), clearing with an empty name, per-wallet
 * isolation, and the inherited walletDir traversal guard. No mock anywhere
 * (RULE 0).
 */
import { describe, expect, test, beforeEach } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { cleanOperatorName, getOperatorName, setOperatorName } from '../../backend/services/operator-name.js';

const W1 = '0x1111111111111111111111111111111111111111';
const W2 = '0x2222222222222222222222222222222222222222';

describe('the cleaning law — one prompt-safe line', () => {
  test('whitespace collapses and trims', () => {
    expect(cleanOperatorName('  Founder   Ignis  ')).toBe('Founder Ignis');
  });

  test('control characters become spaces, never survive', () => {
    expect(cleanOperatorName(`a${String.fromCharCode(0)}b${String.fromCharCode(10)}c`)).toBe('a b c');
  });

  test('caps at the ACCOUNT field\'s 64', () => {
    expect(cleanOperatorName('x'.repeat(80))).toHaveLength(64);
  });

  test('nothing in, nothing out', () => {
    expect(cleanOperatorName(null)).toBe('');
    expect(cleanOperatorName(undefined)).toBe('');
    expect(cleanOperatorName('   ')).toBe('');
  });
});

describe('operator-name — per-wallet store, real fs', () => {
  beforeEach(async () => {
    setRealmRoot(await createTempDir(`opname-${Math.random().toString(36).slice(2)}`));
  });

  test('a wallet that never spoke a name reads empty', async () => {
    expect(await getOperatorName(W1)).toBe('');
  });

  test('set then get round-trips the cleaned name', async () => {
    expect(await setOperatorName(W1, '  Founder ')).toBe('Founder');
    expect(await getOperatorName(W1)).toBe('Founder');
  });

  test('an empty name clears the record', async () => {
    await setOperatorName(W1, 'Founder');
    expect(await setOperatorName(W1, '   ')).toBe('');
    expect(await getOperatorName(W1)).toBe('');
  });

  test('names are isolated per wallet', async () => {
    await setOperatorName(W1, 'Founder');
    expect(await getOperatorName(W2)).toBe('');
  });

  test('a malformed wallet is rejected by the inherited traversal guard', async () => {
    await expect(getOperatorName('not-a-wallet')).rejects.toThrow(/Invalid wallet/);
  });
});
