/**
 * Tests for user-preset — the witness's per-wallet default inference preset.
 * Real fs (temp realm root): default fallback, set/get round-trip, per-wallet
 * isolation, name validation, and the inherited walletDir traversal guard.
 */
import { describe, expect, test, beforeEach } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { getPreset, setPreset } from '../../backend/services/user-preset.js';

const W1 = '0x1111111111111111111111111111111111111111';
const W2 = '0x2222222222222222222222222222222222222222';

describe('user-preset — per-wallet default, real fs', () => {
  beforeEach(async () => {
    setRealmRoot(await createTempDir(`preset-${Math.random().toString(36).slice(2)}`));
  });

  test('a wallet with no saved preset reads the default (balanced)', async () => {
    expect(await getPreset(W1)).toBe('balanced');
  });

  test('set then get round-trips a chosen preset', async () => {
    expect(await setPreset(W1, 'grounded')).toBe('grounded');
    expect(await getPreset(W1)).toBe('grounded');
  });

  test('an unknown preset name is rejected', async () => {
    await expect(setPreset(W1, 'wild')).rejects.toThrow(/Invalid preset/);
  });

  test('presets are isolated per wallet', async () => {
    await setPreset(W1, 'expansive');
    expect(await getPreset(W2)).toBe('balanced');
  });

  test('a malformed wallet is rejected by the inherited traversal guard', async () => {
    await expect(getPreset('not-a-wallet')).rejects.toThrow(/Invalid wallet/);
  });
});
