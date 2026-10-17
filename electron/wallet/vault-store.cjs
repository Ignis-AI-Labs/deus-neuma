// Vault persistence — where the sealed envelope lives on disk.
//
// The password envelope (vault-crypto) is already self-sufficient: without the
// witness password its secret cannot be recovered. On top of it we apply an
// OS-keychain "outer seal" (Electron safeStorage → macOS Keychain / Windows
// DPAPI / Linux libsecret) so the on-disk bytes are ALSO bound to this machine
// + user account — a stolen vault file is useless on another box even before
// the password is considered.
//
// The outer seal is INJECTED, not imported, so this module needs no Electron
// runtime to be unit-tested, and degrades gracefully (password-only) where no
// OS keyring is present (e.g. a headless Linux box without libsecret).

const fs = require('node:fs');
const path = require('node:path');

/**
 * @typedef {Object} OuterSeal
 * @property {boolean} available - whether an OS keychain is usable here
 * @property {(plaintext: string) => Buffer} encrypt - OS-bound encrypt
 * @property {(blob: Buffer) => string} decrypt - OS-bound decrypt
 */

// impure — persist the sealed envelope, OS-key-wrapped when a keychain exists.
// File is written owner-read/write only (0600).
const writeVault = (filePath, envelope, outerSeal) => {
  const sealAvailable = !!(outerSeal && outerSeal.available);
  // Never silently strip the OS-keychain layer off an already-wrapped vault: if
  // the keychain is transiently unavailable, refuse rather than rewrite a
  // machine-bound vault as password-only.
  if (!sealAvailable && fs.existsSync(filePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (existing && existing.wrapped) {
        throw new Error('vault-store: OS keychain unavailable — refusing to rewrite a keychain-sealed vault as password-only');
      }
    } catch (e) {
      if (e.message && e.message.startsWith('vault-store:')) throw e;
      // an unreadable existing file is treated as absent (fresh write)
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const json = JSON.stringify(envelope);
  const onDisk = sealAvailable
    ? JSON.stringify({ wrapped: true, data: outerSeal.encrypt(json).toString('base64') })
    : JSON.stringify({ wrapped: false, data: json });
  fs.writeFileSync(filePath, onDisk, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600); // enforce perms even if the file pre-existed
};

// impure — read + unwrap the sealed envelope (null if no vault on disk)
const readVault = (filePath, outerSeal) => {
  if (!fs.existsSync(filePath)) return null;
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (raw.wrapped) {
    if (!outerSeal || !outerSeal.available) {
      throw new Error('vault-store: this vault is OS-keychain-sealed and the keychain is unavailable here');
    }
    return JSON.parse(outerSeal.decrypt(Buffer.from(raw.data, 'base64')));
  }
  return JSON.parse(raw.data);
};

// impure — does a vault file exist on disk?
const vaultExists = (filePath) => fs.existsSync(filePath);

// impure — remove the vault file (no-op if already absent)
const deleteVault = (filePath) => {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* already gone */
  }
};

module.exports = { writeVault, readVault, vaultExists, deleteVault };
