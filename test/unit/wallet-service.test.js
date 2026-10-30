// Unit tests for the main-process witness wallet service (multi-wallet).
// No mocks of the crypto — real scrypt/AES/ethers against a temp wallet dir
// with a passthrough outer-seal and a cheap scrypt N for speed.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createWalletService, assessPassword, MAX_WALLETS } = require('../../electron/wallet/wallet-service.cjs');
const { ethers } = require('ethers');

const PASSTHROUGH = { available: false }; // store unwrapped — no OS keychain in tests
// A real keychain, and one that only obfuscates (Linux basic_text): both can
// open what they sealed, only the strong one may take a password alone.
const SEAL = {
  available: true,
  strong: true,
  encrypt: (s) => Buffer.from(s, 'utf8'),
  decrypt: (b) => Buffer.from(b).toString('utf8'),
};
const WEAK_SEAL = { ...SEAL, strong: false };
const CHEAP = { N: 1024, r: 8, p: 1, dkLen: 32 };
const PW = 'a-strong-witness-passphrase';

let dir;
let svc;
let locked;

const makeService = (overrides = {}) =>
  createWalletService({
    walletDir: dir,
    outerSeal: PASSTHROUGH,
    scryptParams: CHEAP,
    confirm: async () => true,
    onLock: () => {
      locked = true;
    },
    ...overrides,
  });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-wallet-'));
  locked = false;
  svc = makeService();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('wallet-service: create + registry', () => {
  it('summons a wallet, returns an id + 24-word phrase, and registers it active', () => {
    const { id, address, mnemonic } = svc.create(PW);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(ethers.isAddress(address)).toBe(true);
    expect(mnemonic.split(' ')).toHaveLength(24);
    const s = svc.status();
    expect(s.wallets).toEqual([{ id, address }]);
    expect(s).toMatchObject({ activeId: id, hasWallet: true, unlocked: true, address });
  });

  it('lists multiple wallets and keeps the newest active', () => {
    const a = svc.create(PW);
    const b = svc.create(PW);
    expect(svc.list().map((w) => w.id).sort()).toEqual([a.id, b.id].sort());
    expect(svc.status().activeId).toBe(b.id);
  });

  it('the address matches the one derived from the returned phrase', () => {
    const { address, mnemonic } = svc.create(PW);
    expect(ethers.HDNodeWallet.fromPhrase(mnemonic).address).toBe(address);
  });
});

describe('wallet-service: cap', () => {
  it(`refuses to create more than ${MAX_WALLETS} wallets`, () => {
    for (let i = 0; i < MAX_WALLETS; i += 1) svc.create(PW);
    expect(svc.status().atLimit).toBe(true);
    expect(() => svc.create(PW)).toThrow(/limit/i);
  });
});

describe('wallet-service: select + per-wallet unlock', () => {
  it('each wallet unlocks with its own password and becomes active', () => {
    const a = svc.create('password-for-wallet-a');
    const b = svc.create('password-for-wallet-b');
    expect(svc.status()).toMatchObject({ activeId: b.id, unlocked: true });

    // Selecting another wallet makes it active but locks the prior signer.
    svc.select(a.id);
    expect(svc.status()).toMatchObject({ activeId: a.id, unlocked: false, address: a.address });

    // Wrong password fails; a's own password unlocks it.
    expect(() => svc.unlock(a.id, 'password-for-wallet-b')).toThrow();
    expect(svc.unlock(a.id, 'password-for-wallet-a')).toMatchObject({ activeId: a.id, unlocked: true, address: a.address });
  });

  it('persists across service instances', () => {
    const a = svc.create(PW);
    const fresh = makeService();
    expect(fresh.list().map((w) => w.address)).toContain(a.address);
    expect(fresh.status().unlocked).toBe(false);
    expect(fresh.unlock(a.id, PW)).toMatchObject({ unlocked: true });
  });
});

describe('wallet-service: remember password', () => {

  it('a remembered unlock opens a fresh service with no typed password', () => {
    const a = svc.create(PW);
    svc.lock();
    const sealed = makeService({ outerSeal: SEAL });
    expect(sealed.unlock(a.id, PW, true)).toMatchObject({ unlocked: true });
    const again = makeService({ outerSeal: SEAL });
    expect(again.status().unlocked).toBe(false);
    expect(again.tryRememberedUnlock()).toMatchObject({ unlocked: true, activeId: a.id });
  });

  it('without a keychain, remember is a no-op', () => {
    const a = svc.create(PW);
    svc.unlock(a.id, PW, true);
    const fresh = makeService();
    expect(fresh.tryRememberedUnlock()).toBeNull();
    expect(fresh.status().unlocked).toBe(false);
  });

  it('a keychain that only obfuscates never takes the password, yet an older blob still opens', () => {
    const a = svc.create(PW);
    const weak = makeService({ outerSeal: WEAK_SEAL });
    expect(weak.unlock(a.id, PW, true)).toMatchObject({ unlocked: true });
    expect(fs.existsSync(path.join(dir, 'remember.dat'))).toBe(false);

    makeService({ outerSeal: SEAL }).unlock(a.id, PW, true);
    const blob = fs.readFileSync(path.join(dir, 'remember.dat'));
    expect(makeService({ outerSeal: WEAK_SEAL }).tryRememberedUnlock()).toMatchObject({ unlocked: true, activeId: a.id });
    expect(fs.readFileSync(path.join(dir, 'remember.dat'))).toEqual(blob);
  });

  it('a corrupt remember blob is forgotten, never retried', () => {
    const sealed = makeService({ outerSeal: SEAL });
    const a = sealed.create(PW);
    sealed.unlock(a.id, PW, true);
    fs.writeFileSync(path.join(dir, 'remember.dat'), Buffer.from('not-json'));
    const again = makeService({ outerSeal: SEAL });
    expect(again.tryRememberedUnlock()).toBeNull();
    expect(fs.existsSync(path.join(dir, 'remember.dat'))).toBe(false);
  });
});

describe('wallet-service: recovery + import', () => {
  it('reveals a specific wallet phrase only with its password', () => {
    const a = svc.create(PW);
    expect(svc.revealMnemonic(a.id, PW).split(' ')).toHaveLength(24);
    expect(() => svc.revealMnemonic(a.id, 'nope-nope-nope')).toThrow();
  });

  it('imports by phrase and by private key as new wallets', () => {
    const phrase = ethers.Mnemonic.fromEntropy(ethers.randomBytes(32)).phrase;
    expect(svc.importMnemonic(phrase, PW).address).toBe(ethers.HDNodeWallet.fromPhrase(phrase).address);
    const w = ethers.Wallet.createRandom();
    expect(svc.importPrivateKey(w.privateKey, PW).address).toBe(w.address);
    expect(svc.list()).toHaveLength(2);
  });
});

describe('wallet-service: signing (active wallet)', () => {
  it('signs with the active wallet, recoverable to its address', async () => {
    const a = svc.create(PW);
    const sig = await svc.signMessage('gm from the void');
    expect(ethers.verifyMessage('gm from the void', sig)).toBe(a.address);
  });

  it('refuses to sign when locked', async () => {
    svc.create(PW);
    svc.lock();
    await expect(svc.signMessage('locked out')).rejects.toThrow(/locked/);
  });
});

describe('wallet-service: delete', () => {
  it('removes only with the correct password and drops it from the registry', () => {
    const a = svc.create(PW);
    const b = svc.create(PW);
    expect(() => svc.remove(a.id, 'wrong-password-x')).toThrow();
    svc.remove(a.id, PW);
    expect(svc.list().map((w) => w.id)).toEqual([b.id]);
  });
});

describe('wallet-service: legacy migration', () => {
  it('migrates a pre-multi single vault.dat into the registry as the first wallet', () => {
    const vaultCrypto = require('../../electron/wallet/vault-crypto.cjs');
    const vaultStore = require('../../electron/wallet/vault-store.cjs');
    const w = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromEntropy(ethers.randomBytes(32)));
    const envelope = vaultCrypto.createVault({ type: 'mnemonic', secret: w.mnemonic.phrase }, PW, { params: CHEAP, address: w.address });
    vaultStore.writeVault(path.join(dir, 'vault.dat'), envelope, PASSTHROUGH);

    const migrated = makeService(); // migrates on construction
    const s = migrated.status();
    expect(s.wallets).toHaveLength(1);
    expect(s.wallets[0].address).toBe(w.address);
    expect(fs.existsSync(path.join(dir, 'vault.dat'))).toBe(false);
    expect(migrated.unlock(s.wallets[0].id, PW)).toMatchObject({ unlocked: true });
  });
});

describe('wallet-service: password floor', () => {
  it('rejects weak passwords', () => {
    expect(assessPassword('short').ok).toBe(false);
    expect(assessPassword(PW).ok).toBe(true);
    expect(() => svc.create('short')).toThrow(/at least/);
  });
});

describe('wallet-service: every lock transition notifies (multi-window truth)', () => {
  // Caught by the multi-window e2e: the explicit lock wiped the signer but
  // never fired onLock, so sibling desks kept believing the wallet was
  // unlocked. Every path that ends a session must notify — fail-closed.

  it('explicit lock() notifies', () => {
    svc.create(PW);
    expect(locked).toBe(false);
    svc.lock();
    expect(locked).toBe(true);
    expect(svc.isUnlocked()).toBe(false);
  });

  it('lock() notifies even with no wallet at all (idempotent, still honest)', () => {
    svc.lock();
    expect(locked).toBe(true);
  });

  it('selecting a different wallet ends the old session AND notifies', () => {
    const a = svc.create(PW);
    const b = svc.create(PW); // b active + unlocked
    expect(svc.isUnlocked()).toBe(true);
    locked = false;
    svc.select(a.id);
    expect(locked).toBe(true);
    expect(svc.isUnlocked()).toBe(false);
  });

  it('removing the unlocked wallet notifies', () => {
    const { id } = svc.create(PW);
    locked = false;
    svc.remove(id, PW);
    expect(locked).toBe(true);
    expect(svc.isUnlocked()).toBe(false);
  });

  it('unlock itself never fires a false lock broadcast', () => {
    const { id } = svc.create(PW);
    svc.lock();
    locked = false;
    svc.unlock(id, PW);
    expect(locked).toBe(false);
    expect(svc.isUnlocked()).toBe(true);
  });
});

describe('wallet-service: a key made for the operator', () => {

  it('is refused on a machine with no keychain to keep it', () => {
    expect(() => svc.createForMe()).toThrow(/no OS keychain/);
  });

  it('is refused on a keychain that only obfuscates, while one made before still opens', () => {
    const weak = makeService({ outerSeal: WEAK_SEAL });
    expect(weak.canKeepMadeKey()).toBe(false);
    expect(() => weak.createForMe()).toThrow(/no OS keychain/);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('made-'))).toEqual([]);

    const made = makeService({ outerSeal: SEAL }).createForMe();
    fs.rmSync(path.join(dir, 'remember.dat'));
    expect(makeService({ outerSeal: WEAK_SEAL }).tryRememberedUnlock()).toMatchObject({ unlocked: true, activeId: made.id });
  });

  it('is made, unlocked, and never hands its password out', () => {
    const sealed = makeService({ outerSeal: SEAL });
    const made = sealed.createForMe();
    expect(Object.keys(made).sort()).toEqual(['address', 'id', 'mnemonic']);
    expect(made.mnemonic.split(' ')).toHaveLength(24);
    expect(sealed.status()).toMatchObject({ unlocked: true, activeId: made.id });
    expect(fs.existsSync(path.join(dir, `made-${made.id}.dat`))).toBe(true);
  });

  it('opens again on a fresh launch even after another wallet took the remember slot', () => {
    const sealed = makeService({ outerSeal: SEAL });
    const made = sealed.createForMe();
    const other = sealed.create(PW);
    sealed.unlock(other.id, PW, true);   // remember.dat now holds the OTHER wallet
    sealed.select(made.id);              // the made key is active again
    fs.rmSync(path.join(dir, 'remember.dat'));
    const again = makeService({ outerSeal: SEAL });
    expect(again.tryRememberedUnlock()).toMatchObject({ unlocked: true, activeId: made.id });
  });

  it('shows its recovery phrase later, read with the kept password', () => {
    const sealed = makeService({ outerSeal: SEAL });
    const made = sealed.createForMe();
    expect(makeService({ outerSeal: SEAL }).revealMadeMnemonic(made.id)).toBe(made.mnemonic);
  });

  it('refuses to reveal a wallet that was not made here', () => {
    const sealed = makeService({ outerSeal: SEAL });
    const typed = sealed.create(PW);
    expect(() => sealed.revealMadeMnemonic(typed.id)).toThrow(/not made for you/);
  });

  it('forgets the kept password when the wallet is removed', () => {
    const sealed = makeService({ outerSeal: SEAL });
    const made = sealed.createForMe();
    const pw = SEAL.decrypt(fs.readFileSync(path.join(dir, `made-${made.id}.dat`)));
    sealed.remove(made.id, pw);
    expect(fs.existsSync(path.join(dir, `made-${made.id}.dat`))).toBe(false);
  });
});
