/**
 * The at-rest key lock (electron/key-lock/) on real files with real crypto.
 * The OS keychain here is a real AES-256-GCM seal held in memory — a second
 * real implementation of the seal contract, not a stand-in for the code under
 * test; Electron's safeStorage itself is proven by scripts/key-lock-proof.cjs
 * inside Electron on a real desktop.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { createTempDir } from '../helpers/temp-fs.js';

const require = createRequire(import.meta.url);
const core = require('../../electron/key-lock/key-lock-core.cjs');
const lock = require('../../electron/key-lock/key-lock.cjs');

// A real keychain-shaped seal: AES-256-GCM under a key only this object holds.
const aesSeal = (backend = 'gnome_libsecret') => {
  const key = crypto.randomBytes(32);
  return {
    backend: () => backend,
    encrypt: (text) => {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), ct]);
    },
    decrypt: (blob) => {
      const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
      d.setAuthTag(blob.subarray(12, 28));
      return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8');
    },
  };
};

const plainKeys = () => ({ dnaEncryptionKey: crypto.randomBytes(32).toString('hex'), authSecret: crypto.randomBytes(32).toString('hex') });

describe('key lock', () => {
  let file;
  beforeEach(async () => {
    file = path.join(await createTempDir(`keylock-${Math.random().toString(36).slice(2)}`), 'secrets.json');
  });

  test('a plain key file is locked in place: same keys, none left in the clear, the kit opens it', () => {
    const keys = plainKeys();
    fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
    const seal = aesSeal();
    const opened = lock.openKeyLock({ file, seal });
    expect(opened).toMatchObject({ state: 'unlocked', keys, kitPending: true, locked: 'plain' });
    const text = fs.readFileSync(file, 'utf8');
    expect(text).not.toContain(keys.dnaEncryptionKey);
    expect(text).not.toContain(keys.authSecret);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const code = lock.revealKit({ file, seal });
    expect(code).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    expect(text).not.toContain(code);
    expect(core.openWithCode(JSON.parse(text).recovery, code)).toEqual(keys);
    expect(lock.openKeyLock({ file, seal })).toMatchObject({ state: 'unlocked', keys });
  });

  test('a fresh install gets two new 256-bit keys, locked from the first write', () => {
    const opened = lock.openKeyLock({ file, seal: aesSeal() });
    expect(opened.state).toBe('unlocked');
    expect(opened.keys.dnaEncryptionKey).toMatch(/^[0-9a-f]{64}$/);
    expect(core.classify(JSON.parse(fs.readFileSync(file, 'utf8')))).toBe('locked');
  });

  test('another keychain cannot open it; only the kit can, and then the new keychain holds it', () => {
    const keys = plainKeys();
    fs.writeFileSync(file, JSON.stringify(keys));
    const first = aesSeal();
    lock.openKeyLock({ file, seal: first });
    const code = lock.revealKit({ file, seal: first });
    const second = aesSeal('kwallet6');
    expect(lock.openKeyLock({ file, seal: second })).toMatchObject({ state: 'needs-recovery', backend: 'gnome_libsecret' });
    expect(() => lock.unlockWithCode({ file, seal: second, code: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA' })).toThrow(/does not open/);
    const typed = code.toLowerCase().replace(/-/g, ' ');
    expect(lock.unlockWithCode({ file, seal: second, code: typed })).toMatchObject({ state: 'unlocked', keys, kitPending: false });
    expect(lock.openKeyLock({ file, seal: second })).toMatchObject({ state: 'unlocked', keys, kitPending: false, backend: 'kwallet6' });
  });

  test('an obfuscating keychain locks nothing and leaves the file as it was', () => {
    const before = JSON.stringify(plainKeys());
    fs.writeFileSync(file, before);
    expect(lock.openKeyLock({ file, seal: aesSeal('basic_text') })).toEqual({ state: 'no-keychain', backend: 'basic_text' });
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  test('a file it does not recognise, or cannot parse, is never replaced', () => {
    fs.writeFileSync(file, JSON.stringify({ something: 'else' }));
    expect(() => lock.openKeyLock({ file, seal: aesSeal() })).toThrow(/refusing to replace/);
    fs.writeFileSync(file, '{ not json');
    expect(() => lock.openKeyLock({ file, seal: aesSeal() })).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('{ not json');
  });

  test('a saved kit is dropped from the file; a new kit retires the old one', () => {
    const keys = plainKeys();
    fs.writeFileSync(file, JSON.stringify(keys));
    const seal = aesSeal();
    lock.openKeyLock({ file, seal });
    const oldCode = lock.revealKit({ file, seal });
    lock.confirmKit({ file });
    expect(lock.revealKit({ file, seal })).toBeNull();
    expect(lock.openKeyLock({ file, seal }).kitPending).toBe(false);
    lock.replaceKit({ file, seal, keys });
    const newCode = lock.revealKit({ file, seal });
    const recovery = JSON.parse(fs.readFileSync(file, 'utf8')).recovery;
    expect(core.openWithCode(recovery, newCode)).toEqual(keys);
    expect(() => core.openWithCode(recovery, oldCode)).toThrow(/does not open/);
  });

  test('a typed code is forgiven its case, spacing and misreadable digits', () => {
    expect(core.normalizeCode('abcd efgh-ijkl mnop')).toBe('ABCD-EFGH-IJKL-MNOP');
    expect(core.normalizeCode('0I8B')).toBe('OIBB');
  });
});
