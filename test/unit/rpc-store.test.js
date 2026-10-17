// Unit tests for the secret custom-RPC store. Proves the URL is stored
// OS-key-wrapped (not cleartext) at 0600, never leaks the raw secret through
// status(), persists across instances, and refuses to store without a keychain.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRpcStore } = require('../../electron/wallet/rpc-store.cjs');

// A trivial reversible "seal" stands in for Electron safeStorage. base64 in the
// envelope is enough to prove the URL is not written in cleartext.
const fakeSeal = {
  available: true,
  encrypt: (s) => Buffer.from(s, 'utf8'),
  decrypt: (b) => Buffer.from(b).toString('utf8'),
};
const noSeal = { available: false, encrypt: () => { throw new Error('no'); }, decrypt: () => { throw new Error('no'); } };

describe('createRpcStore', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpc-store-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('starts with no custom RPC', () => {
    const store = createRpcStore({ walletDir: dir, outerSeal: fakeSeal });
    expect(store.status()).toEqual({ custom: false });
    expect(store.get()).toBe(null);
  });

  it('stores a valid RPC and reports a masked status that hides the key', () => {
    const store = createRpcStore({ walletDir: dir, outerSeal: fakeSeal });
    const r = store.set('https://base-mainnet.g.alchemy.com/v2/SECRET_KEY');
    expect(r.ok).toBe(true);
    expect(r.status.custom).toBe(true);
    expect(r.status.label).toBe('https://base-mainnet.g.alchemy.com/…');
    expect(r.status.label).not.toContain('SECRET_KEY');
    // get() returns the raw URL — main-process only.
    expect(store.get()).toBe('https://base-mainnet.g.alchemy.com/v2/SECRET_KEY');
  });

  it('persists across store instances (reads back from disk)', () => {
    createRpcStore({ walletDir: dir, outerSeal: fakeSeal }).set('https://mainnet.base.org');
    const store2 = createRpcStore({ walletDir: dir, outerSeal: fakeSeal });
    expect(store2.get()).toBe('https://mainnet.base.org');
    expect(store2.status().custom).toBe(true);
  });

  it('clears back to public', () => {
    const store = createRpcStore({ walletDir: dir, outerSeal: fakeSeal });
    store.set('https://mainnet.base.org');
    expect(store.clear()).toEqual({ ok: true, status: { custom: false } });
    expect(store.get()).toBe(null);
  });

  it('refuses to store a secret when no OS keychain is available', () => {
    const store = createRpcStore({ walletDir: dir, outerSeal: noSeal });
    const r = store.set('https://mainnet.base.org');
    expect(r.ok).toBe(false);
    expect(store.get()).toBe(null);
    expect(fs.existsSync(path.join(dir, 'rpc.json'))).toBe(false);
  });

  it('rejects an invalid or SSRF RPC URL without writing anything', () => {
    const store = createRpcStore({ walletDir: dir, outerSeal: fakeSeal });
    expect(store.set('http://169.254.169.254').ok).toBe(false);
    expect(store.set('not a url').ok).toBe(false);
    expect(store.get()).toBe(null);
    expect(fs.existsSync(path.join(dir, 'rpc.json'))).toBe(false);
  });

  it('reports degraded (not silently public) when a stored RPC cannot be read', () => {
    createRpcStore({ walletDir: dir, outerSeal: fakeSeal }).set('https://mainnet.base.org');
    const lockedSeal = { available: true, encrypt: fakeSeal.encrypt, decrypt: () => { throw new Error('keychain locked'); } };
    const store = createRpcStore({ walletDir: dir, outerSeal: lockedSeal });
    expect(store.get()).toBe(null);
    expect(store.status()).toEqual({ custom: false, degraded: 'unreadable' });
  });

  it('writes the on-disk record wrapped (not cleartext) at mode 0600', () => {
    const store = createRpcStore({ walletDir: dir, outerSeal: fakeSeal });
    store.set('https://mainnet.base.org');
    const file = path.join(dir, 'rpc.json');
    const raw = fs.readFileSync(file, 'utf8');
    expect(JSON.parse(raw).wrapped).toBe(true);
    expect(raw).not.toContain('mainnet.base.org'); // sealed, not cleartext
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});
