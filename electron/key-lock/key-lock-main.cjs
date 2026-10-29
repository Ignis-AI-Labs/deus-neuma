// The key lock in the running app — opened once before the backend starts,
// handed to every backend this desk spawns over its IPC channel, and the
// Recovery Kit doors the Security settings use.
//
// Packaged builds only. A dev launch keeps its .env (the backend's dotenv
// would otherwise disagree with the lock), and a desktop with no real keychain
// keeps the plain file: both say so in Settings › Security rather than pretend.

const os = require('node:os');
const path = require('node:path');
const lock = require('./key-lock.cjs');
const { askRecoveryCode } = require('./unlock-window.cjs');

let opened = null; // { keys, backend, kitPending } once unlocked
const backends = new Set();

const secretsFile = () => process.env.NEUMA_SECRETS_FILE || path.join(os.homedir(), '.neuma', 'secrets.json');

/** impure — Electron safeStorage as the lock's seal; `backend()` names the keychain really in use. */
const safeStorageSeal = (safeStorage) => ({
  backend: () => {
    if (!safeStorage.isEncryptionAvailable()) return 'none';
    return process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform;
  },
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (blob) => safeStorage.decryptString(blob),
});

/**
 * impure — open the lock before the backend starts. Resolves false when this
 * launch keeps the old key path (dev, or no real keychain).
 * @param {{app: Electron.App, safeStorage: Electron.SafeStorage}} deps
 */
const openAtRestKeys = async ({ app, safeStorage }) => {
  if (!app.isPackaged || process.env.NEUMA_KEY_LOCK === '0') return false;
  const seal = safeStorageSeal(safeStorage);
  const file = secretsFile();
  let result = lock.openKeyLock({ file, seal });
  if (result.state === 'no-keychain') {
    console.warn(`[NEUMA] no OS keychain (${result.backend}) — the at-rest key stays in ${file}`);
    return false;
  }
  if (result.state === 'needs-recovery') {
    result = await askRecoveryCode((code) => lock.unlockWithCode({ file, seal, code }));
    if (!result) return null; // the person chose to quit
  }
  opened = { keys: result.keys, backend: result.backend, kitPending: result.kitPending };
  return true;
};

/** Is this launch's backend fed by the lock? */
const lockActive = () => opened !== null;

/** impure — answer one backend's request for its keys. */
const attachBackend = (child) => {
  if (!opened) return;
  backends.add(child);
  child.on('exit', () => backends.delete(child));
  child.on('message', (message) => {
    if (message?.type !== 'neuma:at-rest-keys?' || !opened) return;
    child.send({ type: 'neuma:at-rest-keys', keys: opened.keys, backend: opened.backend, kitPending: opened.kitPending });
  });
};

// impure — every live backend learns the kit is saved
const kitSaved = () => {
  opened = { ...opened, kitPending: false };
  for (const child of backends) if (child.connected) child.send({ type: 'neuma:kit-saved' });
};

/**
 * impure — the Recovery Kit doors for the desk (preload: neuma.keyLock). Each answers a desk's own
 * top frame only (isDesk — desk-links.cjs fromDesk): revealKit hands out the code that opens every
 * key (re-audit 2026-10-29, M-07 residual).
 */
const registerKeyLockIpc = ({ ipcMain, safeStorage, isDesk }) => {
  const seal = () => safeStorageSeal(safeStorage);
  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => {
    if (!isDesk(event)) throw new Error(`${channel} refused: not the desk`);
    return fn(event, ...args);
  });
  const guarded = (fn) => async () => {
    if (!opened) return { ok: false, error: 'This launch has no keychain lock.' };
    try { return { ok: true, ...(await fn()) }; } catch (err) { return { ok: false, error: err.message }; }
  };
  handle('keyLock:status', async () => ({ active: lockActive(), backend: opened?.backend ?? null, kitPending: Boolean(opened?.kitPending) }));
  handle('keyLock:revealKit', guarded(async () => ({ code: lock.revealKit({ file: secretsFile(), seal: seal() }) })));
  handle('keyLock:confirmKit', guarded(async () => { lock.confirmKit({ file: secretsFile() }); kitSaved(); return {}; }));
  handle('keyLock:newKit', guarded(async () => {
    lock.replaceKit({ file: secretsFile(), seal: seal(), keys: opened.keys });
    opened = { ...opened, kitPending: true };
    return { code: lock.revealKit({ file: secretsFile(), seal: seal() }) };
  }));
};

module.exports = { attachBackend, lockActive, openAtRestKeys, registerKeyLockIpc };
