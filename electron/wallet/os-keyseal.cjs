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
// Lives apart from the testable core because it can only run inside Electron.

const { safeStorage } = require('electron');

const osKeySeal = {
  get available() {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  },
  encrypt: (plaintext) => safeStorage.encryptString(plaintext),
  decrypt: (blob) => safeStorage.decryptString(blob),
};

module.exports = { osKeySeal };
