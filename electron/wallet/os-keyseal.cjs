// OS-keychain outer seal — binds the on-disk vault to this machine + user.
//
// A thin adapter over Electron safeStorage (macOS Keychain / Windows DPAPI /
// Linux libsecret), injected into the wallet service as its `outerSeal`. A
// stolen vault file is then useless on another box even before the password is
// considered. When no OS keyring is available (e.g. a headless Linux host with
// no libsecret), `available` is false and the vault falls back to password-only
// protection — still scrypt + AES-256-GCM, and the on-disk record marks itself
// unwrapped so we never decrypt against the wrong assumption.
//
// `available` is not `strong`: on Linux without a keyring, safeStorage still
// "encrypts" with Chromium's fixed basic_text key, which any process can undo.
// That still opens what was sealed before, but a secret that rests on the seal
// alone (a remembered or generated wallet password) needs `strong` — the same
// weak-backend rule as the key lock (key-lock.cjs isStrong).
//
// Lives apart from the testable core because it can only run inside Electron.

const { safeStorage } = require('electron');
const { isStrong } = require('../key-lock/key-lock.cjs');

const osKeySeal = {
  get available() {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  },
  get strong() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      return process.platform !== 'linux' || isStrong(safeStorage.getSelectedStorageBackend());
    } catch {
      return false;
    }
  },
  encrypt: (plaintext) => safeStorage.encryptString(plaintext),
  decrypt: (blob) => safeStorage.decryptString(blob),
};

module.exports = { osKeySeal };
