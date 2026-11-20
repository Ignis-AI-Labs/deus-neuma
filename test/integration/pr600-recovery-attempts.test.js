/* global Buffer */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lock = require('../../electron/key-lock/key-lock.cjs');
const { boundedRecovery, MAX_RECOVERY_ATTEMPTS } = require('../../electron/key-lock/recovery-attempts.cjs');

const aesSeal = (backend = 'gnome_libsecret') => {
  const key = crypto.randomBytes(32);
  return {
    backend: () => backend,
    encrypt: (text) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ct]);
    },
    decrypt: (blob) => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
      decipher.setAuthTag(blob.subarray(12, 28));
      return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
};

const fixture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr600-recovery-'));
  const file = path.join(dir, 'secrets.json');
  const keys = { dnaEncryptionKey: crypto.randomBytes(32).toString('hex'), authSecret: crypto.randomBytes(32).toString('hex') };
  fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  const first = aesSeal();
  lock.openKeyLock({ file, seal: first });
  const code = lock.revealKit({ file, seal: first });
  return { dir, file, code, keys, second: aesSeal('kwallet6') };
};

describe('Recovery Kit launch attempt bound', () => {
  let current;
  beforeEach(() => { current = fixture(); });
  afterEach(() => { if (current) fs.rmSync(current.dir, { recursive: true, force: true }); });

  test('five real wrong scrypt attempts are allowed; the sixth refuses before opening', () => {
    const tryCode = boundedRecovery((code) => lock.unlockWithCode({ file: current.file, seal: current.second, code }));
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS; i += 1) {
      expect(() => tryCode('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA')).toThrow(/does not open/);
    }
    expect(() => tryCode(current.code)).toThrow(/Too many Recovery Kit attempts/);
  });

  test('the genuine code still opens within the same real attempt budget', () => {
    const tryCode = boundedRecovery((code) => lock.unlockWithCode({ file: current.file, seal: current.second, code }));
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS - 1; i += 1) {
      expect(() => tryCode('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA')).toThrow(/does not open/);
    }
    expect(tryCode(current.code)).toMatchObject({ state: 'unlocked', keys: current.keys });
  });
});
