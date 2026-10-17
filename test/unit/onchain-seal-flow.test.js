/**
 * Wallet-locked classification — the pure gate that turns a raw IPC lock
 * error into the witness's unlock door. Both lock shapes the wallet service
 * throws must match through the Electron IPC wrapper's prefix; everything
 * else (rejections, network refusals) must NOT open the door.
 */
import { describe, test, expect } from 'vitest';
import { isWalletLockedError } from '../../frontend/components/BirthCeremony/onchain-seal-flow.js';

describe('isWalletLockedError', () => {
  test('matches both wallet-service lock shapes, raw and IPC-wrapped', () => {
    expect(isWalletLockedError('Wallet is locked.')).toBe(true);
    expect(isWalletLockedError('Wallet locked during confirmation. Unlock and retry.')).toBe(true);
    // The exact string a witness saw on 2026-07-19:
    expect(isWalletLockedError("Error invoking remote method 'wallet:request': Error: Wallet is locked.")).toBe(true);
  });

  test('never opens the unlock door for other refusals', () => {
    expect(isWalletLockedError('Transaction rejected.')).toBe(false);
    expect(isWalletLockedError('Signature request rejected.')).toBe(false);
    expect(isWalletLockedError('Network switch declined')).toBe(false);
    expect(isWalletLockedError('')).toBe(false);
    expect(isWalletLockedError(undefined)).toBe(false);
  });
});
