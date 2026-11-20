// The key lock in the running app — opened once before the backend starts,
// handed to every backend this desk spawns over its IPC channel, and the
// Recovery Kit doors the Security settings use.
//
// Packaged builds only. A dev launch keeps its .env (the backend's dotenv
// would otherwise disagree with the lock), and a desktop with no real keychain
// keeps the plain file: both say so in Settings › Security rather than pretend.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dialog } = require('electron');
const lock = require('./key-lock.cjs');
const { boundedRecovery } = require('./recovery-attempts.cjs');
const { askRecoveryCode } = require('./unlock-window.cjs');
const { secretGate } = require('../wallet/trusted-gate.cjs');
const { kitDoors } = require('./kit-doors.cjs');

let opened = null; // { keys, backend, kitPending } once unlocked
const backends = new Set();

const secretsFile = () => process.env.NEUMA_SECRETS_FILE || path.join(os.homedir(), '.neuma', 'secrets.json');

// impure (fs) — has a master key already sealed data on this install? The marks are the ones
// core/workspace/master-check.js names; the data root is the one backend-spawn.cjs hands the backend.
const holdsSealedData = () => {
  const dataRoot = process.env.NEUMA_DATA_ROOT || path.join(os.homedir(), '.neuma', 'data');
  return ['master-check.json', 'retired-masters.json', path.join('settings', 'provider-credentials.json')]
    .some((mark) => fs.existsSync(path.join(dataRoot, mark)));
};

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
  let result = lock.openKeyLock({ file, seal, holdsData: holdsSealedData });
  if (result.state === 'key-missing') {
    dialog.showErrorBox('Neuma cannot find its key', `This computer already holds your Neuma data, but the key that opens it is missing (${file} and its copy are gone).\n\nPut the key file back from a backup, or restore the key from your recovery file. Neuma will not make a new key over your data.`);
    return null;
  }
  if (result.state === 'no-keychain') {
    console.warn(`[NEUMA] no OS keychain (${result.backend}) — the at-rest key stays in ${file}`);
    return false;
  }
  if (result.state === 'needs-recovery') {
    result = await askRecoveryCode(boundedRecovery((code) => lock.unlockWithCode({ file, seal, code })));
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
const registerKeyLockIpc = ({ ipcMain, safeStorage, isDesk, getWindow }) => {
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
  // The kit is shown in the trusted window and never returned to the page (kit-doors.cjs).
  const doors = kitDoors({
    lock, gate: secretGate(getWindow), file: secretsFile, seal, keys: () => opened.keys,
    onSaved: kitSaved, onReplaced: () => { opened = { ...opened, kitPending: true }; },
  });
  handle('keyLock:revealKit', guarded(doors.revealKit));
  handle('keyLock:confirmKit', guarded(doors.confirmKit));
  handle('keyLock:newKit', guarded(doors.newKit));
};

module.exports = { attachBackend, lockActive, openAtRestKeys, registerKeyLockIpc };
