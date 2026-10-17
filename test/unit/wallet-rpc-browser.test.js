// Unit tests for the browser custom-RPC store. vitest runs in node (no DOM), so
// we stub a minimal localStorage; these prove set/get/status/clear, that the
// masked status hides the API key, validation, and wallet-scoped isolation.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getBrowserRpc, browserRpcStatus, setBrowserRpc, clearBrowserRpc,
} from '../../frontend/app/RelinkShell/wallet-rpc-browser.js';

const makeLocalStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

beforeEach(() => { global.localStorage = makeLocalStorage(); });

describe('wallet-rpc-browser', () => {
  it('starts with no custom RPC', () => {
    expect(browserRpcStatus()).toEqual({ custom: false, browser: true });
    expect(getBrowserRpc()).toBe(null);
  });

  it('saves a valid RPC and masks the key in the status label', () => {
    const r = setBrowserRpc('https://base-mainnet.g.alchemy.com/v2/SECRET_KEY');
    expect(r.ok).toBe(true);
    expect(r.status.custom).toBe(true);
    expect(r.status.label).toBe('https://base-mainnet.g.alchemy.com/…');
    expect(r.status.label).not.toContain('SECRET_KEY');
    // raw URL is retrievable for read routing
    expect(getBrowserRpc()).toBe('https://base-mainnet.g.alchemy.com/v2/SECRET_KEY');
  });

  it('rejects non-http(s) and malformed URLs without storing', () => {
    expect(setBrowserRpc('not a url').ok).toBe(false);
    expect(setBrowserRpc('ftp://example.com').ok).toBe(false);
    expect(setBrowserRpc('').ok).toBe(false);
    expect(getBrowserRpc()).toBe(null);
  });

  it('allows http only for a local node and requires https for remote', () => {
    expect(setBrowserRpc('http://localhost:8545').ok).toBe(true);
    expect(setBrowserRpc('http://127.0.0.1:8545').ok).toBe(true);
    expect(setBrowserRpc('http://1.2.3.4:8545').ok).toBe(false); // remote http would leak the key in cleartext
    expect(setBrowserRpc('https://base-mainnet.g.alchemy.com/v2/k').ok).toBe(true);
  });

  it('clears back to public', () => {
    setBrowserRpc('https://mainnet.base.org');
    expect(clearBrowserRpc()).toEqual({ ok: true, status: { custom: false, browser: true } });
    expect(getBrowserRpc()).toBe(null);
  });

  it('scopes the RPC to the connected wallet', () => {
    global.localStorage.setItem('walletAddress', '0xAAA');
    setBrowserRpc('https://aaa.example/rpc');
    expect(getBrowserRpc()).toBe('https://aaa.example/rpc');
    // switching wallets must not leak the other wallet's endpoint
    global.localStorage.setItem('walletAddress', '0xBBB');
    expect(getBrowserRpc()).toBe(null);
  });
});
