/**
 * Ledger renderer client — the second, independent read-only boundary.
 *
 * Main already guarantees only { path, address } crosses (ledger-service.cjs);
 * this layer re-applies the same allow-list so even a hostile main response
 * can't push key-shaped fields into the UI. Browser builds (no bridge) report
 * unsupported, never throw.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

let ledger;

const installBridge = (ledgerListAccounts) => {
  vi.stubGlobal('window', { neuma: { wallet: { ledgerListAccounts } } });
};

beforeEach(async () => {
  vi.resetModules();
  ledger = await import('../../frontend/services/ledger-client.js');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isLedgerSupported', () => {
  test('false without the Electron bridge (browser tab)', () => {
    vi.stubGlobal('window', {});
    expect(ledger.isLedgerSupported()).toBe(false);
  });

  test('false when the wallet bridge lacks the ledger surface', () => {
    vi.stubGlobal('window', { neuma: { wallet: { status: () => {} } } });
    expect(ledger.isLedgerSupported()).toBe(false);
  });

  test('true when the read-only ledger bridge is present', () => {
    installBridge(async () => []);
    expect(ledger.isLedgerSupported()).toBe(true);
  });
});

describe('listLedgerAccounts', () => {
  test('unsupported (no desktop app) → ok:false with a clear message, no throw', async () => {
    vi.stubGlobal('window', {});
    const r = await ledger.listLedgerAccounts();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/desktop app/i);
  });

  test('strips a hostile main response to { path, address } only', async () => {
    installBridge(async () => [
      { path: "44'/60'/0'/0/0", address: '0xA', publicKey: 'PUB', privateKey: 'PRIV', mnemonic: 'words' },
    ]);
    const r = await ledger.listLedgerAccounts({ count: 1 });
    expect(r.ok).toBe(true);
    expect(Object.keys(r.accounts[0]).sort()).toEqual(['address', 'path']);
    expect(JSON.stringify(r.accounts)).not.toMatch(/PUB|PRIV|words/);
  });

  test('passes the requested count through to the bridge', async () => {
    const spy = vi.fn(async () => []);
    installBridge(spy);
    await ledger.listLedgerAccounts({ count: 8 });
    expect(spy).toHaveBeenCalledWith({ count: 8 });
  });

  test('a non-array response degrades to an empty list', async () => {
    installBridge(async () => null);
    expect(await ledger.listLedgerAccounts()).toEqual({ ok: true, accounts: [] });
  });

  test('a main-process error becomes ok:false with its message (no throw)', async () => {
    installBridge(async () => { throw new Error('Unlock your Ledger and try again.'); });
    const r = await ledger.listLedgerAccounts();
    expect(r).toEqual({ ok: false, error: 'Unlock your Ledger and try again.' });
  });

  test('a null entry in the response is dropped, never rendered as a blank row', async () => {
    installBridge(async () => [null, { path: "44'/60'/0'/0/0", address: '0xA' }]);
    const r = await ledger.listLedgerAccounts();
    expect(r.accounts).toEqual([{ path: "44'/60'/0'/0/0", address: '0xA' }]);
  });
});
