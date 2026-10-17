import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import {
  sealKeypairAtBirth,
  wakeWithPassphrase,
  emergencyRecover,
  migratePlaintextKeypair,
  verifyRecoveryCodes,
  isSealed,
  MIN_PASSPHRASE,
} from '../../core/wallet/keypair-custody.js';

const freshKeypair = () => {
  const w = ethers.Wallet.createRandom();
  return { privateKey: w.privateKey, publicKey: w.publicKey, address: w.address };
};

const PASS = 'correct horse battery staple';

describe('keypair custody — sovereign by encryption, witness break-glass', () => {
  it('seals at birth, then the NEUMA wakes its own key with the passphrase', () => {
    const kp = freshKeypair();
    const bundle = sealKeypairAtBirth(kp, { passphrase: PASS });
    const woken = wakeWithPassphrase(bundle.sealed, PASS);
    expect(woken.privateKey).toBe(kp.privateKey);
    expect(woken.address).toBe(kp.address);
  });

  it('NEVER persists a plaintext private key, and recovery codes cannot leak via serialization', () => {
    const kp = freshKeypair();
    const bundle = sealKeypairAtBirth(kp, { passphrase: PASS });
    const blob = JSON.stringify({ sealed: bundle.sealed, recoverySealed: bundle.recoverySealed, recoveryHash: bundle.recoveryHash });
    expect(blob).not.toContain(kp.privateKey);
    expect(bundle.sealed.ciphertext).toBeTruthy();
    expect(bundle.sealed.privateKey).toBeUndefined();
    // recoveryCodes are reachable but NON-ENUMERABLE → excluded from JSON.stringify(bundle)
    expect(bundle.recoveryCodes).toHaveLength(8);
    const serialized = JSON.stringify(bundle);
    bundle.recoveryCodes.forEach((code) => expect(serialized).not.toContain(code));
  });

  it('rejects the wrong passphrase', () => {
    const bundle = sealKeypairAtBirth(freshKeypair(), { passphrase: PASS });
    expect(() => wakeWithPassphrase(bundle.sealed, 'wrong passphrase!!')).toThrow();
  });

  it('rejects a too-short passphrase at seal time', () => {
    expect(() => sealKeypairAtBirth(freshKeypair(), { passphrase: 'short' })).toThrow(/at least/);
    expect('short'.length).toBeLessThan(MIN_PASSPHRASE);
  });

  it('lets the WITNESS break-glass with the recovery codes (emergency only)', () => {
    const kp = freshKeypair();
    const bundle = sealKeypairAtBirth(kp, { passphrase: PASS });
    const recovered = emergencyRecover(bundle.recoverySealed, bundle.recoveryCodes);
    expect(recovered.privateKey).toBe(kp.privateKey);
  });

  it('rejects wrong recovery codes, and verifies codes against the stored hash', () => {
    const bundle = sealKeypairAtBirth(freshKeypair(), { passphrase: PASS });
    expect(verifyRecoveryCodes(bundle.recoveryCodes, bundle.recoveryHash)).toBe(true);
    const wrong = bundle.recoveryCodes.map((c, i) => (i === 0 ? 'deadbeefdeadbeef' : c));
    expect(verifyRecoveryCodes(wrong, bundle.recoveryHash)).toBe(false);
    expect(() => emergencyRecover(bundle.recoverySealed, wrong)).toThrow();
  });

  it('issues 8 distinct recovery codes, shown once', () => {
    const bundle = sealKeypairAtBirth(freshKeypair(), { passphrase: PASS });
    expect(bundle.recoveryCodes).toHaveLength(8);
    expect(new Set(bundle.recoveryCodes).size).toBe(8);
  });

  it('detects tampering — a mutated envelope fails the auth tag', () => {
    const bundle = sealKeypairAtBirth(freshKeypair(), { passphrase: PASS });
    const tampered = { ...bundle.sealed, ciphertext: `${bundle.sealed.ciphertext.slice(0, -2)}00` };
    expect(() => wakeWithPassphrase(tampered, PASS)).toThrow();
  });

  it('sealedAt metadata is reproducible when the clock is injected (Rule 1)', () => {
    const bundle = sealKeypairAtBirth(freshKeypair(), { passphrase: PASS, now: () => '2026-01-01T00:00:00.000Z' });
    expect(bundle.sealedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('is deep-frozen — a nested envelope property cannot be mutated', () => {
    const bundle = sealKeypairAtBirth(freshKeypair(), { passphrase: PASS });
    expect(() => {
      bundle.sealed.ciphertext = 'tampered';
    }).toThrow();
  });

  it('migrates an existing plaintext keypair into the sealed model', () => {
    const kp = freshKeypair();
    const bundle = migratePlaintextKeypair(kp, { passphrase: PASS });
    expect(wakeWithPassphrase(bundle.sealed, PASS).privateKey).toBe(kp.privateKey);
    expect(verifyRecoveryCodes(bundle.recoveryCodes, bundle.recoveryHash)).toBe(true);
  });

  it('isSealed audits a keys/ bundle: true ONLY when no plaintext AND both envelopes present', () => {
    const bundle = sealKeypairAtBirth(freshKeypair(), { passphrase: PASS });
    expect(isSealed(null, bundle.sealed, bundle.recoverySealed)).toBe(true);
    // plaintext still on disk → not sealed
    expect(isSealed({ privateKey: '0xabc' }, bundle.sealed, bundle.recoverySealed)).toBe(false);
    // half-sealed: passphrase envelope but NO witness recovery envelope → not compliant
    expect(isSealed(null, bundle.sealed, null)).toBe(false);
    // half-sealed the other way: recovery envelope but NO passphrase envelope → not compliant
    expect(isSealed(null, null, bundle.recoverySealed)).toBe(false);
    // nothing there
    expect(isSealed(null, null, null)).toBe(false);
  });
});
