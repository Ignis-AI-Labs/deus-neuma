import { describe, it, expect, beforeEach, vi } from 'vitest';
import { connectViaBrowserBridge, applyBridgeSession } from '../../frontend/services/wallet-bridge-core.js';

// The Electron side of the system-browser wallet bridge (WEB-001 / #126): start a
// session, open the system browser, poll with the pollSecret, store the token.
// Core is DOM-light, so a couple of global stubs replace a full browser env.
const makeStore = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
};
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  globalThis.window = { location: { origin: 'http://localhost:3355' } };
  globalThis.sessionStorage = makeStore();
  globalThis.localStorage = makeStore();
});

describe('connectViaBrowserBridge — Electron side of the wallet bridge', () => {
  it('starts a session, opens the system browser, polls, and returns the token without committing', async () => {
    const opened = [];
    const calls = [];
    const fetchImpl = vi.fn(async (url, opts) => {
      calls.push({ url, opts });
      if (url.endsWith('/bridge/start')) return jsonRes(200, { browserCode: 'BC', pollSecret: 'PS', expiresIn: 1000 });
      if (url.includes('/bridge/poll')) {
        const polls = calls.filter((c) => c.url.includes('/bridge/poll')).length;
        return polls < 2 ? jsonRes(200, { pending: true }) : jsonRes(200, { token: 'TOK', address: '0xabc' });
      }
      throw new Error('unexpected ' + url);
    });

    const result = await connectViaBrowserBridge({ open: (u) => opened.push(u), fetchImpl, sleep: async () => {} });

    expect(result).toEqual({ token: 'TOK', address: '0xabc' });
    expect(opened[0]).toContain('/?bridge=BC');

    // The pollSecret rode in the HEADER, never the URL.
    const poll = calls.find((c) => c.url.includes('/bridge/poll'));
    expect(poll.url).not.toContain('PS');
    expect(poll.opts.headers['x-bridge-secret']).toBe('PS');

    // It does NOT commit on its own — the caller confirms the address first.
    expect(sessionStorage.getItem('authToken')).toBeNull();

    // applyBridgeSession() commits it like a normal sign-in.
    applyBridgeSession(result);
    expect(sessionStorage.getItem('authToken')).toBe('TOK');
    expect(localStorage.getItem('walletAddress')).toBe('0xabc');
    expect(localStorage.getItem('walletConnected')).toBe('true');
  });

  it('throws on timeout when the browser never associates', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/bridge/start')) return jsonRes(200, { browserCode: 'BC', pollSecret: 'PS' });
      return jsonRes(200, { pending: true });
    });
    await expect(
      connectViaBrowserBridge({ open: () => {}, fetchImpl, sleep: async () => {}, deadlineMs: -1 })
    ).rejects.toThrow(/timed out/);
  });

  it('throws when the bridge session expired (410)', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/bridge/start')) return jsonRes(200, { browserCode: 'BC', pollSecret: 'PS' });
      return jsonRes(410, { error: 'expired' });
    });
    await expect(
      connectViaBrowserBridge({ open: () => {}, fetchImpl, sleep: async () => {} })
    ).rejects.toThrow(/expired/);
  });
});
