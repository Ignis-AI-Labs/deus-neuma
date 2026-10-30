/**
 * K2 — a master key a person chose must not be guessable: DNA_ENCRYPTION_KEY
 * encrypts every being's records directly. The flight check warns (never
 * fails) when a hand-set key does not look random, and never questions a key
 * this install generated. Real functions, real provisioning against a temp
 * secrets file; nothing replaced.
 */
import crypto from 'crypto';
import path from 'path';
import process from 'process';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { checkDnaKey, looksRandomKey } from '../../backend/routes/preflight-checks.js';
import { ensureSecrets, secretSource } from '../../backend/services/secret-provisioning.js';
import { plainCheck } from '../../frontend/components/BirthCeremony/plain-checks.js';

const PASSPHRASES = [
  'correct horse battery staple and a few more words',
  'my-super-secret-dna-encryption-key-for-kestrel-2026',
  'CorrectHorseBatteryStaple2024PurpleMonkeyDishwasherZ',
  'test-encryption-key-32-characters!',
  'Kestrel-Marlow-Sorrel-Kestrel-Marlow-Sorrel-77',
];

describe('a hand-set master key that does not look random is warned about', () => {
  test('a passphrase-like key warns, says why, and names the way to a random key', () => {
    for (const key of PASSPHRASES) {
      expect(looksRandomKey(key), key).toBe(false);
      const row = checkDnaKey({ key, source: 'environment' });
      expect(row.status, key).toBe('warn');
      expect(row.requirement).toMatch(/encrypts every being’s records directly/);
      expect(row.requirement).toMatch(/cracked offline/);
      expect(row.requirement).toMatch(/scripts\/rekey-house\.mjs/);
    }
    const plain = plainCheck(checkDnaKey({ key: PASSPHRASES[0], source: 'environment' }));
    expect(plain.means).toMatch(/does not look like a random key/);
    expect(plain.todo).toMatch(/re-key/);
  });

  // Fixed 256-bit digests keep the run repeatable: the word check reads about one random base64 key in
  // a thousand as wordy, so a fresh draw per run would make this test itself a lottery.
  test('a random 64-hex or base64 key does not warn', () => {
    for (let i = 0; i < 50; i++) {
      const digest = crypto.createHash('sha256').update(`lane-a:${i}`).digest();
      for (const key of [crypto.randomBytes(32).toString('hex'), digest.toString('base64'), digest.toString('base64url')]) {
        expect(looksRandomKey(key), key).toBe(true);
        expect(checkDnaKey({ key, source: 'environment' }).status).toBe('pass');
      }
    }
  });

  test('a short key still fails, and a missing one too', () => {
    expect(checkDnaKey({ key: 'short', source: 'environment' }).status).toBe('fail');
    expect(checkDnaKey({ key: '', source: null }).status).toBe('fail');
  });
});

describe('a key this install generated is never questioned', () => {
  let file;
  beforeEach(async () => {
    file = path.join(await createTempDir('dna-key-strength'), 'secrets.json');
    process.env.NEUMA_SECRETS_FILE = file;
  });
  afterEach(() => { delete process.env.NEUMA_SECRETS_FILE; });

  test('generated, then reused from the secrets file: pass both times; a hand-set passphrase: warn', () => {
    const fresh = {};
    ensureSecrets({ env: fresh });
    expect(secretSource('DNA_ENCRYPTION_KEY')).toBe('generated');
    expect(checkDnaKey({ key: fresh.DNA_ENCRYPTION_KEY }).status).toBe('pass');

    const again = {};
    ensureSecrets({ env: again });
    expect(secretSource('DNA_ENCRYPTION_KEY')).toBe('stored');
    expect(checkDnaKey({ key: again.DNA_ENCRYPTION_KEY }).status).toBe('pass');

    const handSet = { DNA_ENCRYPTION_KEY: PASSPHRASES[1] };
    ensureSecrets({ env: handSet });
    expect(secretSource('DNA_ENCRYPTION_KEY')).toBe('environment');
    expect(checkDnaKey({ key: handSet.DNA_ENCRYPTION_KEY }).status).toBe('warn');
  });
});
