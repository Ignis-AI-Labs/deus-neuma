// Gnosis for the at-rest key lock on THIS desktop's real keychain:
//   npx electron scripts/key-lock-proof.cjs
// Locks a throwaway plain key file in a temp folder with Electron's safeStorage,
// opens it again, proves the Recovery Kit opens it, and proves a different
// keychain is refused and recovered by the kit. Touches nothing of the real
// install (its own temp file; the keychain entry is the Electron default's).
const { app, safeStorage } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lock = require('../electron/key-lock/key-lock.cjs');
const core = require('../electron/key-lock/key-lock-core.cjs');

const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) process.exitCode = 1; };

app.whenReady().then(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'key-lock-proof-'));
  const file = path.join(dir, 'secrets.json');
  try {
    const seal = {
      backend: () => (safeStorage.isEncryptionAvailable() ? (process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform) : 'none'),
      encrypt: (t) => safeStorage.encryptString(t),
      decrypt: (b) => safeStorage.decryptString(b),
    };
    console.log(`keychain backend: ${seal.backend()}`);
    const keys = { dnaEncryptionKey: crypto.randomBytes(32).toString('hex'), authSecret: crypto.randomBytes(32).toString('hex') };
    fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
    const first = lock.openKeyLock({ file, seal });
    if (first.state === 'no-keychain') { check(false, `a real keychain is present (got ${first.backend})`); return; }
    const text = fs.readFileSync(file, 'utf8');
    check(first.state === 'unlocked' && first.keys.dnaEncryptionKey === keys.dnaEncryptionKey, 'the real keychain locks the plain file and returns the same keys');
    check(!text.includes(keys.dnaEncryptionKey) && !text.includes(keys.authSecret), 'no key is left in the clear on disk');
    const again = lock.openKeyLock({ file, seal });
    check(again.state === 'unlocked' && again.keys.authSecret === keys.authSecret, 'the real keychain opens it again on the next launch');
    const code = lock.revealKit({ file, seal });
    check(core.openWithCode(JSON.parse(text).recovery, code).dnaEncryptionKey === keys.dnaEncryptionKey, 'the Recovery Kit opens the same keys');
    const otherKey = crypto.randomBytes(32);
    const other = { backend: () => 'kwallet6', encrypt: (t) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', otherKey, iv); return Buffer.concat([iv, c.update(t, 'utf8'), c.final(), c.getAuthTag()]); }, decrypt: () => { throw new Error('not this keychain'); } };
    check(lock.openKeyLock({ file, seal: other }).state === 'needs-recovery', 'a different keychain is refused (needs the kit)');
    check(lock.unlockWithCode({ file, seal, code }).keys.dnaEncryptionKey === keys.dnaEncryptionKey, 'the kit unlocks it and the real keychain seals it again');
    check(lock.openKeyLock({ file, seal }).state === 'unlocked', 'after recovery the real keychain opens it unaided');
  } catch (err) {
    check(false, `no error (${err.message})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    app.quit();
  }
});
