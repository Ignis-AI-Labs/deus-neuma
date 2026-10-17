import { expect, it } from 'vitest';
import { encryptKeypair, decryptKeypair } from '../../core/wallet/keypair-vault.js';
import { generateKeypair } from '../../core/weave/keypair.js';

it('preserves the actual authentication failure as a non-enumerable cause', () => {
  const envelope = encryptKeypair(generateKeypair(), 'correct-password-for-test');
  let failure;
  try { decryptKeypair(envelope, 'incorrect-password-for-test'); }
  catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toContain('Decryption failed');
  expect(failure.cause).toBeInstanceOf(Error);
  expect(failure.cause).not.toBe(failure);
  expect(failure.cause.message).toMatch(/authenticate/i);
  expect(Object.getOwnPropertyDescriptor(failure, 'cause').enumerable).toBe(false);
  expect(JSON.stringify(failure)).toBe('{}');
});

it('retains an integrity failure after successful real decryption', () => {
  const password = 'correct-password-for-test';
  const envelope = encryptKeypair(generateKeypair(), password);
  let failure;
  try { decryptKeypair({ ...envelope, address: 'changed-envelope-address' }, password); }
  catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toBe('Keypair integrity check failed: address mismatch');
  expect(Object.hasOwn(failure, 'cause')).toBe(false);
});
