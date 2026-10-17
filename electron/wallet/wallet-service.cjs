// Witness wallet service — main-process custody for the witness's wallets.
//
// The witness may hold up to MAX_WALLETS sovereign wallets. Each is its own
// encrypted vault (vault-crypto) on disk, keyed by a random id; a small
// registry (non-secret: id + address) tracks them and which one is active. The
// unlocked signer is for the ACTIVE wallet only, and lives ONLY in
// main-process memory. Every Electron dependency — the OS keychain
// (safeStorage), the native confirm dialog, the RPC provider — is INJECTED so
// this orchestrator stays pure-of-Electron and unit-testable.

const { ethers } = require('ethers');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vaultCrypto = require('./vault-crypto.cjs');
const vaultStore = require('./vault-store.cjs');

const DEFAULT_IDLE_MS = 15 * 60 * 1000; // auto-lock after 15 min with no signing
const MIN_PASSWORD_LEN = 12;
const MAX_WALLETS = 5; // keep the witness's wallet list from sprawling
const WEAK = new Set(['password', 'passphrase', '123456789012', 'qwertyuiopas']);

// pure — password floor. Memory-hard scrypt covers brute force; we only block
// the catastrophically short/trivial. Long passphrases pass without symbol rules.
const assessPassword = (pw) => {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LEN) {
    return { ok: false, reason: `Password must be at least ${MIN_PASSWORD_LEN} characters.` };
  }
  if (WEAK.has(pw.toLowerCase())) return { ok: false, reason: 'That password is too common.' };
  if (/^(.)\1+$/.test(pw)) return { ok: false, reason: 'Password cannot be a single repeated character.' };
  return { ok: true };
};

// pure — derive an ethers signer from a decrypted vault payload
const signerFromPayload = (payload) =>
  payload.type === 'mnemonic'
    ? ethers.HDNodeWallet.fromPhrase(payload.secret)
    : new ethers.Wallet(payload.secret);

// pure — open a stored vault (v1 or legacy v0) with a password; throws on wrong pw
const openStored = (envelope, password) =>
  vaultCrypto.isLegacyVault(envelope)
    ? vaultCrypto.openLegacyVault(envelope, password)
    : vaultCrypto.openVault(envelope, password);

const newId = () => crypto.randomBytes(8).toString('hex'); // impure

/**
 * Create a witness wallet service rooted at one wallet directory.
 * @param {{walletDir: string, outerSeal: object, getRpcProvider?: Function, getChainId?: Function, confirm?: Function, onLock?: Function, idleMs?: number, scryptParams?: object, maxWallets?: number}} config
 * @returns {object} the frozen service API
 */
const createWalletService = (config) => {
  const {
    walletDir,
    outerSeal,
    getRpcProvider = async () => null,
    // The chainId every outgoing tx is pinned to (the app's SELECTED network).
    // null = legacy behavior (ethers fills from the provider) — kept as the
    // default so existing tests/config are unaffected until the caller opts in.
    getChainId = () => null,
    confirm = async () => true,
    onLock = () => {},
    idleMs = DEFAULT_IDLE_MS,
    scryptParams, // test override for a cheap KDF
    maxWallets = MAX_WALLETS,
  } = config;

  const registryPath = path.join(walletDir, 'registry.json');
  const vaultPath = (id) => path.join(walletDir, `${id}.dat`);
  const rememberPath = path.join(walletDir, 'remember.dat');

  let signer = null; // the unlocked ethers wallet — main-process memory only
  let unlockedId = null; // which wallet the in-memory signer belongs to
  let idleTimer = null;


  // --- registry (non-secret: id + address + the active id) ---
  const readRegistry = () => {
    try {
      const reg = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      if (reg && Array.isArray(reg.wallets)) return reg;
    } catch {
      /* no registry yet */
    }
    return { activeId: null, wallets: [] };
  };
  const writeRegistry = (reg) => {
    fs.mkdirSync(walletDir, { recursive: true });
    fs.writeFileSync(registryPath, JSON.stringify(reg), { mode: 0o600 });
    try {
      fs.chmodSync(registryPath, 0o600);
    } catch {
      /* best effort */
    }
  };

  // one-time migration: a pre-multi single vault becomes the first wallet
  const migrateLegacy = () => {
    const legacy = path.join(walletDir, 'vault.dat');
    if (fs.existsSync(registryPath) || !fs.existsSync(legacy)) return;
    try {
      const envelope = vaultStore.readVault(legacy, outerSeal);
      const id = newId();
      fs.renameSync(legacy, vaultPath(id));
      writeRegistry({ activeId: id, wallets: [{ id, address: (envelope && envelope.address) || null, createdAt: new Date().toISOString() }] });
    } catch {
      /* unreadable — leave it in place for the user to handle */
    }
  };
  migrateLegacy();

  const clearIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };
  const lock = () => {
    signer = null;
    unlockedId = null;
    clearIdle();
  };
  // EVERY lock transition notifies — idle, explicit, switch, and removal.
  // Without this a witness locking from one desk left every sibling desk
  // believing the wallet was still unlocked (caught by the multi-window
  // e2e); fail-closed staleness is acceptable, fail-open never is.
  const lockAndNotify = () => {
    lock();
    onLock();
  };
  const armIdle = () => {
    clearIdle();
    idleTimer = setTimeout(lockAndNotify, idleMs);
    if (idleTimer.unref) idleTimer.unref();
  };

  const isUnlocked = () => signer !== null;
  const list = () => readRegistry().wallets.map((w) => ({ id: w.id, address: w.address }));

  const activeAddress = () => {
    const reg = readRegistry();
    if (signer && unlockedId === reg.activeId) return signer.address;
    const a = reg.wallets.find((w) => w.id === reg.activeId);
    return a ? a.address : null;
  };

  const status = () => {
    const reg = readRegistry();
    return {
      wallets: reg.wallets.map((w) => ({ id: w.id, address: w.address })),
      activeId: reg.activeId,
      hasWallet: reg.wallets.length > 0,
      unlocked: isUnlocked() && unlockedId === reg.activeId,
      address: activeAddress(),
      atLimit: reg.wallets.length >= maxWallets,
    };
  };

  // impure — seal a new wallet to disk, register it active, and adopt its signer
  const commitNewWallet = (payload, password, address) => {
    const reg = readRegistry();
    if (reg.wallets.length >= maxWallets) throw new Error(`Wallet limit reached (${maxWallets}).`);
    const id = newId();
    const envelope = vaultCrypto.createVault(payload, password, { params: scryptParams, address });
    vaultStore.writeVault(vaultPath(id), envelope, outerSeal);
    reg.wallets.push({ id, address, createdAt: new Date().toISOString() });
    reg.activeId = id;
    writeRegistry(reg);
    signer = signerFromPayload(payload);
    unlockedId = id;
    armIdle();
    return id;
  };

  const create = (password) => {
    const strength = assessPassword(password);
    if (!strength.ok) throw new Error(strength.reason);
    const mnemonic = ethers.Mnemonic.fromEntropy(ethers.randomBytes(32)); // 24-word, 256-bit floor
    const w = ethers.HDNodeWallet.fromMnemonic(mnemonic);
    const id = commitNewWallet({ type: 'mnemonic', secret: mnemonic.phrase }, password, w.address);
    return { id, address: w.address, mnemonic: mnemonic.phrase };
  };

  const importMnemonic = (phrase, password) => {
    const strength = assessPassword(password);
    if (!strength.ok) throw new Error(strength.reason);
    const mnemonic = ethers.Mnemonic.fromPhrase(String(phrase).trim());
    const w = ethers.HDNodeWallet.fromMnemonic(mnemonic);
    const id = commitNewWallet({ type: 'mnemonic', secret: mnemonic.phrase }, password, w.address);
    return { id, address: w.address };
  };

  const importPrivateKey = (privateKey, password) => {
    const strength = assessPassword(password);
    if (!strength.ok) throw new Error(strength.reason);
    const w = new ethers.Wallet(String(privateKey).trim());
    const id = commitNewWallet({ type: 'privateKey', secret: w.privateKey }, password, w.address);
    return { id, address: w.address };
  };

  const resolveId = (id) => id || readRegistry().activeId;

  // impure — decrypt one wallet and adopt it as the active signer; upgrades v0→v1
  const clearRemember = () => {
    try { fs.unlinkSync(rememberPath); } catch { /* none */ }
  };

  const writeRemember = (id, password) => {
    if (!outerSeal.available) return;
    const blob = outerSeal.encrypt(JSON.stringify({ id, password }));
    fs.writeFileSync(rememberPath, blob, { mode: 0o600 });
    try { fs.chmodSync(rememberPath, 0o600); } catch { /* non-posix */ }
  };

  // impure — decrypt one wallet and adopt it as the active signer; upgrades v0→v1
  const unlock = (id, password, remember = false) => {
    const targetId = resolveId(id);
    if (!targetId) throw new Error('No wallet to unlock.');
    const envelope = vaultStore.readVault(vaultPath(targetId), outerSeal);
    if (!envelope) throw new Error('Wallet not found.');
    const payload = openStored(envelope, password); // throws on wrong pw / tamper
    const w = signerFromPayload(payload);
    if (envelope.address && w.address.toLowerCase() !== String(envelope.address).toLowerCase()) {
      throw new Error('Vault integrity check failed.');
    }
    if (vaultCrypto.needsUpgrade(envelope)) {
      const upgraded = vaultCrypto.createVault(payload, password, { params: scryptParams, address: w.address });
      vaultStore.writeVault(vaultPath(targetId), upgraded, outerSeal);
    }
    signer = w;
    unlockedId = targetId;
    const reg = readRegistry();
    if (reg.activeId !== targetId) {
      reg.activeId = targetId;
      writeRegistry(reg);
    }
    if (remember) writeRemember(targetId, password);
    armIdle();
    return status();
  };

  // A KEY MADE FOR THE OPERATOR (Design note, 2026-10-14: people who want no wallet
  // still sign in, so a key is made for them in one click). The password is
  // generated HERE and never reaches the renderer; it is kept sealed by the OS
  // keychain in its own file, apart from remember.dat (one slot another
  // wallet's […] would overwrite). No keychain, no made key: refused.
  const madePath = (id) => path.join(walletDir, `made-${id}.dat`);
  const canKeepMadeKey = () => outerSeal.available === true;
  const readMadeKey = (id) => {
    try { return outerSeal.decrypt(fs.readFileSync(madePath(id))); } catch { return null; }
  };

  // impure — create a wallet with a generated password, keep it, unlock it
  const createForMe = () => {
    if (!canKeepMadeKey()) {
      throw new Error('This machine has no OS keychain to keep a key for you — create a wallet with a password instead.');
    }
    const password = ethers.hexlify(ethers.randomBytes(32)).slice(2);
    const made = create(password);
    fs.writeFileSync(madePath(made.id), outerSeal.encrypt(password), { mode: 0o600 });
    unlock(made.id, password, true);
    return { id: made.id, address: made.address, mnemonic: made.mnemonic };
  };

  // impure — the recovery phrase of a key made for the operator, read with its
  // kept password (the operator never had one to type)
  const revealMadeMnemonic = (id) => {
    const targetId = resolveId(id);
    const password = targetId && readMadeKey(targetId);
    if (!password) throw new Error('This wallet was not made for you on this machine — reveal its phrase with its password.');
    return revealMnemonic(targetId, password);
  };

  // impure — the active wallet, if it is a key made here, unlocked with its kept password
  const tryMadeUnlock = () => {
    const id = readRegistry().activeId;
    const password = id && readMadeKey(id);
    if (!password) return null;
    try { return unlock(id, password, false); } catch { return null; }
  };

  // impure — unlock from the OS-sealed remember blob. No-op without a
  // keychain. A stale/corrupt blob is forgotten, never retried; a key made
  // for the operator still opens from its own kept password.
  const tryRememberedUnlock = () => {
    if (!outerSeal.available) return null;
    let remembered;
    try {
      remembered = JSON.parse(outerSeal.decrypt(fs.readFileSync(rememberPath)));
    } catch {
      clearRemember();
      return tryMadeUnlock();
    }
    if (!remembered?.id || typeof remembered.password !== 'string') {
      clearRemember();
      return tryMadeUnlock();
    }
    try {
      return unlock(remembered.id, remembered.password, true);
    } catch {
      clearRemember();
      return null;
    }
  };

  // make a wallet active without unlocking it; switching clears the old signer
  const select = (id) => {
    const reg = readRegistry();
    if (!reg.wallets.find((w) => w.id === id)) throw new Error('Unknown wallet.');
    if (id !== reg.activeId) {
      reg.activeId = id;
      writeRegistry(reg);
    }
    if (unlockedId !== id) lockAndNotify();
    return status();
  };

  // Re-verifies against the vault on disk — never the in-memory session.
  const revealMnemonic = (id, password) => {
    const targetId = resolveId(id);
    const envelope = vaultStore.readVault(vaultPath(targetId), outerSeal);
    if (!envelope) throw new Error('No wallet found.');
    const payload = openStored(envelope, password); // throws on wrong pw
    if (payload.type !== 'mnemonic') {
      throw new Error('This wallet was imported by private key and has no recovery phrase.');
    }
    return payload.secret;
  };

  const remove = (id, password) => {
    const targetId = resolveId(id);
    const envelope = vaultStore.readVault(vaultPath(targetId), outerSeal);
    if (envelope) openStored(envelope, password); // throws on wrong pw
    if (unlockedId === targetId) lockAndNotify();
    vaultStore.deleteVault(vaultPath(targetId));
    try { fs.unlinkSync(madePath(targetId)); } catch { /* not a made key */ }
    const reg = readRegistry();
    reg.wallets = reg.wallets.filter((w) => w.id !== targetId);
    if (reg.activeId === targetId) reg.activeId = reg.wallets[0] ? reg.wallets[0].id : null;
    writeRegistry(reg);
    clearRemember();
    return status();
  };

  // Run a signing action under the lock + confirm + idle-safety guard: idle
  // auto-lock is paused while the native dialog is open, the signer is
  // re-checked after the user responds, and the idle clock resumes afterward.
  const guardedSign = async (req, action) => {
    if (!signer) throw new Error('Wallet is locked.');
    clearIdle();
    try {
      const rejectMsg = req.type === 'transaction' ? 'Transaction rejected.' : 'Signature request rejected.';
      if (!(await confirm(req))) throw new Error(rejectMsg);
      if (!signer) throw new Error('Wallet locked during confirmation. Unlock and retry.');
      return await action(signer);
    } finally {
      if (signer) armIdle();
    }
  };

  const signMessage = (message) =>
    // personal_sign semantics: a 0x string signs raw bytes, otherwise UTF-8 text
    guardedSign({ type: 'sign', message }, (s) =>
      s.signMessage(typeof message === 'string' && message.startsWith('0x') ? ethers.getBytes(message) : message)
    );

  const signTypedData = (domain, types, value) =>
    guardedSign({ type: 'signTypedData', domain, types, value }, (s) => s.signTypedData(domain, types, value));

  const sendTransaction = (tx) => {
    // Resolve the pinned chain BEFORE the confirm dialog so the CHAIN field
    // the witness reads is the chain the signature will actually bind — the
    // display and the pin must never diverge (a Base Sepolia seal used to
    // read "8453" while correctly signing for 84532).
    const chainId = getChainId();
    return guardedSign({ type: 'transaction', to: tx.to, value: tx.value, data: tx.data, chainId }, async (s) => {
      const rpc = await getRpcProvider();
      if (!rpc) throw new Error('No RPC provider available.');
      // Pin the tx to the app's SELECTED chain. Without this, ethers fills
      // chainId from whatever the RPC claims — a lying or wrong-chain RPC
      // could then obtain a signature valid on ITS chain. Pinned, the
      // signature binds our chain and a mismatched RPC fails safe.
      const pinned = chainId ? { ...tx, chainId } : tx;
      return (await s.connect(rpc).sendTransaction(pinned)).hash;
    });
  };

  return Object.freeze({
    assessPassword,
    list,
    status,
    getAddress: activeAddress,
    isUnlocked,
    create,
    importMnemonic,
    importPrivateKey,
    unlock,
    tryRememberedUnlock,
    canKeepMadeKey,
    createForMe,
    revealMadeMnemonic,
    select,
    lock: lockAndNotify,
    revealMnemonic,
    remove,
    signMessage,
    signTypedData,
    sendTransaction,
  });
};

module.exports = { createWalletService, assessPassword, signerFromPayload, MIN_PASSWORD_LEN, MAX_WALLETS, DEFAULT_IDLE_MS };
