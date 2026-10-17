// Real round-trip proof for the browser-vault crypto extracted from
// EmbeddedWallet.js into wallet-browser-keystore.js (SIZE-028). Real
// WebCrypto PBKDF2-600k + AES-256-GCM, real inputs, real outputs — no mocks
// (RULE 0). This is the crypto that seals a wallet's recovery phrase at rest;
// if the split altered a single parameter, these fail.
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, PBKDF2_ITERATIONS } from '../../frontend/services/wallet-browser-keystore.js';

const SECRET = 'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title';
const PASSWORD = 'correct horse battery staple';

describe('wallet-browser-keystore crypto', () => {
  it('encrypt → decrypt round-trips the secret under the real KDF parameters', async () => {
    const sealed = await encrypt(SECRET, PASSWORD);
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    for (const field of ['ciphertext', 'salt', 'iv']) {
      expect(typeof sealed[field]).toBe('string');
      expect(sealed[field].length).toBeGreaterThan(0);
    }
    const opened = await decrypt(sealed.ciphertext, sealed.salt, sealed.iv, PASSWORD, PBKDF2_ITERATIONS);
    expect(opened).toBe(SECRET);
  });

  it('refuses the wrong password (AES-GCM integrity)', async () => {
    const sealed = await encrypt(SECRET, PASSWORD);
    await expect(decrypt(sealed.ciphertext, sealed.salt, sealed.iv, 'wrong password', PBKDF2_ITERATIONS)).rejects.toThrow();
  });

  it('produces a fresh salt + iv per seal (no ciphertext reuse)', async () => {
    const a = await encrypt(SECRET, PASSWORD);
    const b = await encrypt(SECRET, PASSWORD);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});
