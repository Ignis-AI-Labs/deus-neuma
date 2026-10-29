// The at-rest key lock on disk — open, migrate, recover, and the Recovery Kit.
//
// The OS keychain is reached through an injected `seal` ({ backend(),
// encrypt(string) → Buffer, decrypt(Buffer) → string }): Electron's safeStorage
// in the app (key-lock-main.cjs). A keychain that is only obfuscation (Linux
// basic_text) or absent is never treated as a lock: the caller keeps the old
// plain file and says so.
//
// Every write is build → verify → atomic replace: the new record is opened
// both ways in memory before it replaces the old file, so a fault can never
// leave the keys unreadable.

const fs = require('node:fs');
const path = require('node:path');
const core = require('./key-lock-core.cjs');

const WEAK_BACKENDS = Object.freeze(new Set(['basic_text', 'unknown', 'none', '']));

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => Buffer.from(String(s), 'base64');

/** Pure — does this keychain actually lock anything? */
const isStrong = (backend) => !WEAK_BACKENDS.has(String(backend || ''));

// impure (fs) — the parsed file, null when absent. A file that is there but
// unreadable or not JSON THROWS: treating it as missing would mint new keys over it.
const readStored = (file) => {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return JSON.parse(text);
};

// impure (fs) — tmp + fsync + rename, owner-only, then the folder synced
const writeAtomic = (file, record) => {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(record, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  if (process.platform !== 'win32') {
    const dfd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  }
};

// pure — two key sets are the same keys
const same = (a, b) => a.dnaEncryptionKey === b.dnaEncryptionKey && a.authSecret === b.authSecret;

// impure (seal) — the keys sealed by this login's keychain
const deviceWrap = (keys, seal) => ({ backend: seal.backend(), blob: b64(seal.encrypt(JSON.stringify(keys))) });

// impure (seal, scrypt) — refuse a record that does not open back to `keys` both ways
const verified = (record, keys, code, seal) => {
  const byDevice = core.validKeys(JSON.parse(seal.decrypt(unb64(record.device.blob))));
  const byKit = core.openWithCode(record.recovery, code);
  if (!same(byDevice, keys) || !same(byKit, keys)) throw new Error('key-lock: a new lock did not open back to the same keys — nothing was replaced');
  return record;
};

// impure (seal, scrypt, randomness) — a locked record for these keys under a new kit
const lockUnderNewKit = (keys, seal, now) => {
  const code = core.newRecoveryCode();
  const record = core.lockedRecord({
    device: deviceWrap(keys, seal),
    recovery: core.sealWithCode(keys, code),
    kit: b64(seal.encrypt(code)),
    createdAt: now,
  });
  return verified(record, keys, code, seal);
};

/**
 * impure (fs, seal) — open the lock for this launch.
 *  - locked + the keychain opens it → `unlocked`
 *  - locked + the keychain does not  → `needs-recovery` (a reset or changed keychain, another computer)
 *  - plain or missing + a real keychain → locked now (a fresh install gets new keys) → `unlocked`, kit pending
 *  - plain or missing + no real keychain → `no-keychain`: the caller keeps the plain file, honestly
 * @param {{file: string, seal: object, now?: string}} opts
 */
const openKeyLock = ({ file, seal, now = new Date().toISOString() }) => {
  const stored = readStored(file);
  const kind = core.classify(stored);
  const backend = seal.backend();
  if (kind === 'unknown') throw new Error(`key-lock: ${file} is not a Neuma key file — refusing to replace it`);
  if (kind === 'locked') {
    try {
      const keys = core.validKeys(JSON.parse(seal.decrypt(unb64(stored.device.blob))));
      return { state: 'unlocked', keys, kitPending: Boolean(stored.kit), backend: stored.device.backend };
    } catch {
      return { state: 'needs-recovery', backend: stored.device.backend, keychainNow: backend };
    }
  }
  if (!isStrong(backend)) return { state: 'no-keychain', backend };
  const keys = kind === 'plain' ? core.validKeys(stored) : core.freshKeys();
  writeAtomic(file, lockUnderNewKit(keys, seal, now));
  return { state: 'unlocked', keys, kitPending: true, backend, locked: kind };
};

/**
 * impure (fs, seal, scrypt) — the Recovery Kit opens a lock this keychain no
 * longer can; the keys are sealed again by this keychain, and the kit counts as
 * saved (it was just typed). Throws on a wrong code.
 * @param {{file: string, seal: object, code: string}} opts
 */
const unlockWithCode = ({ file, seal, code }) => {
  const stored = readStored(file);
  if (core.classify(stored) !== 'locked') throw new Error('key-lock: there is no locked key to recover');
  const keys = core.openWithCode(stored.recovery, code);
  if (isStrong(seal.backend())) {
    const record = core.lockedRecord({ device: deviceWrap(keys, seal), recovery: stored.recovery, kit: null, createdAt: stored.createdAt });
    writeAtomic(file, verified(record, keys, code, seal));
  }
  return { state: 'unlocked', keys, kitPending: false, backend: seal.backend() };
};

/** impure (fs, seal) — the unsaved kit's code, or null once it is saved. */
const revealKit = ({ file, seal }) => {
  const stored = readStored(file);
  return core.classify(stored) === 'locked' && stored.kit ? seal.decrypt(unb64(stored.kit)) : null;
};

/** impure (fs) — the person has saved the kit: its device-sealed copy is dropped. */
const confirmKit = ({ file }) => {
  const stored = readStored(file);
  if (core.classify(stored) !== 'locked') throw new Error('key-lock: there is no locked key');
  writeAtomic(file, core.lockedRecord({ ...stored, kit: null }));
};

/** impure (fs, seal, scrypt) — a new kit replaces the old one, which stops opening anything. */
const replaceKit = ({ file, seal, keys, now = new Date().toISOString() }) => {
  if (core.classify(readStored(file)) !== 'locked') throw new Error('key-lock: there is no locked key');
  writeAtomic(file, lockUnderNewKit(core.validKeys(keys), seal, now));
};

module.exports = { confirmKit, isStrong, openKeyLock, readStored, replaceKit, revealKit, unlockWithCode };
