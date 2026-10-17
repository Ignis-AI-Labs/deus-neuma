/**
 * Ledger medium — the security proof.
 *
 * Founder's invariant: the platform is ONLY a medium for the Ledger; a private key
 * or seed must NEVER be exposed through it. A Ledger can't export key material
 * (no such device command), but these tests prove OUR code can't surface
 * anything sensitive either: it touches only the public `getAddress`, returns
 * only `{ path, address }`, and never leaks a raw device error.
 *
 * The transport + Eth app are injected as spies/Proxies, so this runs with no
 * device and no native USB stack.
 */

const { createLedgerService, toPublicAccount, assembleSignature, ethPath, __test } = require('../../electron/wallet/ledger-service.cjs');

// A Proxy Eth app that RECORDS every property accessed on it — so we can assert
// the medium only ever touches `getAddress` and nothing key-shaped.
const makeEth = (getAddressImpl) => {
  const accessed = [];
  const target = { getAddress: (...args) => getAddressImpl(...args) };
  const eth = new Proxy(target, {
    get(t, prop) {
      if (typeof prop === 'string') accessed.push(prop);
      if (prop === 'getAddress') return t.getAddress;
      // Any OTHER access returns a tripwire that fails loudly.
      return () => { throw new Error(`SECURITY: unexpected Eth method accessed: ${String(prop)}`); };
    },
  });
  return { eth, accessed };
};

const makeTransport = () => {
  let closed = false;
  return {
    close: () => { closed = true; return Promise.resolve(); },
    wasClosed: () => closed,
  };
};

// A deliberately HOSTILE device response: alongside the address it returns key
// material a buggy/compromised lower layer might leak. The medium must drop it all.
const hostileGetAddress = (path) => ({
  address: `0xADDR${path.split('/').pop()}`,
  publicKey: '04deadbeefPUBLICKEY',
  chainCode: 'cc00cc00chaincode',
  privateKey: '0xPRIVATEKEYdeadbeefdeadbeef',
  mnemonic: 'witch collapse practice feed shame open despair creek road again ice least',
});

describe('Ledger medium — only public addresses ever cross the boundary', () => {
  test('listAccounts returns ONLY { path, address } — strips every key-shaped field', async () => {
    const { eth } = makeEth(hostileGetAddress);
    const svc = createLedgerService({ openTransport: async () => makeTransport(), openEthApp: () => eth });

    const accounts = await svc.listAccounts({ count: 3 });

    expect(accounts).toHaveLength(3);
    for (const acc of accounts) {
      expect(Object.keys(acc).sort()).toEqual(['address', 'path']); // nothing else, ever
      expect(acc).not.toHaveProperty('publicKey');
      expect(acc).not.toHaveProperty('privateKey');
      expect(acc).not.toHaveProperty('chainCode');
      expect(acc).not.toHaveProperty('mnemonic');
    }
    // and the values are exactly the public address + path
    expect(accounts[0]).toEqual({ path: "44'/60'/0'/0/0", address: '0xADDR0' });
  });

  test('the serialized result contains no key material at all', async () => {
    const { eth } = makeEth(hostileGetAddress);
    const svc = createLedgerService({ openTransport: async () => makeTransport(), openEthApp: () => eth });
    const blob = JSON.stringify(await svc.listAccounts({ count: 5 }));
    for (const secret of ['PRIVATEKEY', 'PUBLICKEY', 'chaincode', 'mnemonic', 'witch collapse']) {
      expect(blob.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  test('touches ONLY getAddress on the device app — never a sign/export method', async () => {
    const { eth, accessed } = makeEth(hostileGetAddress);
    const svc = createLedgerService({ openTransport: async () => makeTransport(), openEthApp: () => eth });
    await svc.listAccounts({ count: 2 });
    expect([...new Set(accessed)]).toEqual(['getAddress']); // and nothing else
  });

  test('requests addresses silently — no on-device display, no chain code', async () => {
    const calls = [];
    const eth = { getAddress: (...args) => { calls.push(args); return { address: '0xA' }; } };
    const svc = createLedgerService({ openTransport: async () => makeTransport(), openEthApp: () => eth });
    await svc.listAccounts({ count: 1 });
    expect(calls[0]).toEqual(["44'/60'/0'/0/0", false, false]); // display=false, chainCode=false
  });

  test('derives the standard BIP-44 account paths in order', async () => {
    const eth = { getAddress: (path) => ({ address: `0x${path}` }) };
    const svc = createLedgerService({ openTransport: async () => makeTransport(), openEthApp: () => eth });
    const paths = (await svc.listAccounts({ count: 3 })).map((a) => a.path);
    expect(paths).toEqual(["44'/60'/0'/0/0", "44'/60'/1'/0/0", "44'/60'/2'/0/0"]);
  });

  test('account count: > 0 clamped to max, invalid (0/neg/NaN) falls back to default', async () => {
    const eth = { getAddress: (path) => ({ address: `0x${path}` }) };
    const svc = createLedgerService({ openTransport: async () => makeTransport(), openEthApp: () => eth });
    expect(await svc.listAccounts({ count: 100 })).toHaveLength(__test.MAX_ACCOUNT_COUNT);    // 25 (clamped)
    expect(await svc.listAccounts({ count: 1 })).toHaveLength(1);                              // explicit minimum honored
    expect(await svc.listAccounts({ count: 0 })).toHaveLength(__test.DEFAULT_ACCOUNT_COUNT);   // invalid → default
    expect(await svc.listAccounts({ count: -3 })).toHaveLength(__test.DEFAULT_ACCOUNT_COUNT);  // invalid → default
    expect(await svc.listAccounts({ count: NaN })).toHaveLength(__test.DEFAULT_ACCOUNT_COUNT); // invalid → default
    expect(await svc.listAccounts()).toHaveLength(__test.DEFAULT_ACCOUNT_COUNT);               // default
  });

  test('returned accounts are frozen — no field can be grafted on afterward', async () => {
    const eth = { getAddress: () => ({ address: '0xA' }) };
    const svc = createLedgerService({ openTransport: async () => makeTransport(), openEthApp: () => eth });
    const [acc] = await svc.listAccounts({ count: 1 });
    expect(Object.isFrozen(acc)).toBe(true);
    expect(() => { acc.privateKey = 'x'; }).toThrow(); // strict mode: cannot add to frozen
  });
});

describe('Ledger medium — transport lifecycle + error containment', () => {
  test('always closes the transport on success', async () => {
    const t = makeTransport();
    const eth = { getAddress: () => ({ address: '0xA' }) };
    const svc = createLedgerService({ openTransport: async () => t, openEthApp: () => eth });
    await svc.listAccounts({ count: 1 });
    expect(t.wasClosed()).toBe(true);
  });

  test('always closes the transport even when a read throws', async () => {
    const t = makeTransport();
    const eth = { getAddress: () => { throw new Error('device fell over'); } };
    const svc = createLedgerService({ openTransport: async () => t, openEthApp: () => eth });
    await expect(svc.listAccounts({ count: 1 })).rejects.toThrow();
    expect(t.wasClosed()).toBe(true);
  });

  test('a device error NEVER leaks key material or raw buffers — only a safe message', async () => {
    const t = makeTransport();
    const leaky = new Error('boom privateKey=0xDEADBEEF seed="witch collapse practice" raw=<<buffer>>');
    const eth = { getAddress: () => { throw leaky; } };
    const svc = createLedgerService({ openTransport: async () => t, openEthApp: () => eth });

    await expect(svc.listAccounts({ count: 1 })).rejects.toThrow(/Could not reach the Ledger/);
    const caught = await svc.listAccounts({ count: 1 }).catch((e) => e.message);
    for (const secret of ['privateKey', '0xDEADBEEF', 'seed', 'witch collapse', 'buffer']) {
      expect(caught).not.toContain(secret);
    }
  });

  test('a failed transport open surfaces a safe message, no device handle leaked', async () => {
    const svc = createLedgerService({
      openTransport: async () => { throw new Error('cannot open device /dev/hidraw0'); },
      openEthApp: () => { throw new Error('should never be reached'); },
    });
    await expect(svc.listAccounts()).rejects.toThrow(/No Ledger detected/);
  });

  test('friendlyError maps the known device states without echoing raw text', () => {
    expect(__test.friendlyError({ statusCode: 0x5515 })).toMatch(/Unlock your Ledger/);
    expect(__test.friendlyError({ statusCode: 0x6e00 })).toMatch(/Open the Ethereum app/);
    expect(__test.friendlyError({ statusCode: 0x6985 })).toMatch(/rejected/i);
    expect(__test.friendlyError({ message: 'no device found' })).toMatch(/No Ledger detected/);
    // a Linux "access denied" must NOT be mis-flagged as a user reject — the
    // tightened reject text only matches rejection-specific phrasing.
    expect(__test.friendlyError({ message: 'access denied' })).toMatch(/No Ledger detected/);
    expect(__test.friendlyError({ message: 'connection refused' })).not.toMatch(/rejected/i);
    expect(__test.friendlyError({ message: 'totally unknown' })).toMatch(/Could not reach the Ledger/);
  });

  test('a missing native dependency is reported honestly (not masked as a device error)', () => {
    const modErr = Object.assign(new Error("Cannot find module '@ledgerhq/hw-transport-node-hid'"), { code: 'MODULE_NOT_FOUND' });
    expect(__test.friendlyError(modErr)).toMatch(/not installed in this build/);
  });
});

describe('Ledger medium — getAccount (explicit path)', () => {
  test('reads a single public account at a valid path', async () => {
    const eth = { getAddress: (p) => ({ address: '0xCUSTOM', publicKey: 'leak' }) };
    const svc = createLedgerService({ openTransport: async () => makeTransport(), openEthApp: () => eth });
    const acc = await svc.getAccount("44'/60'/7'/0/0");
    expect(acc).toEqual({ path: "44'/60'/7'/0/0", address: '0xCUSTOM' }); // no publicKey
  });

  test('rejects a malformed derivation path before touching the device', async () => {
    let opened = false;
    const svc = createLedgerService({
      openTransport: async () => { opened = true; return makeTransport(); },
      openEthApp: () => ({ getAddress: () => ({ address: '0xA' }) }),
    });
    for (const bad of ['', 'm/44/60', "44'/61'/0'/0/0", '../../etc', "44'/60'/0'/0", 42, null]) {
      await expect(svc.getAccount(bad)).rejects.toThrow(/Invalid derivation path/);
    }
    expect(opened).toBe(false); // never even opened the device for a bad path
  });
});

describe('Ledger medium — signMessage (on-device login signing)', () => {
  const SIG = { v: 28, r: 'a'.repeat(64), s: 'b'.repeat(64) };

  test('hex-encodes the message and signs it ON the device, returning only the signature', async () => {
    const calls = [];
    const eth = { signPersonalMessage: (path, hex) => { calls.push([path, hex]); return SIG; } };
    const svc = createLedgerService({ openTransport: async () => makeTransport(), openEthApp: () => eth });

    const sig = await svc.signMessage("44'/60'/0'/0/0", 'Login challenge ABC');

    // message passed as hex (utf8 → hex), at the chosen path
    expect(calls[0][0]).toBe("44'/60'/0'/0/0");
    expect(calls[0][1]).toBe(Buffer.from('Login challenge ABC', 'utf8').toString('hex'));
    // returns the assembled 0x signature — 65 bytes, no key material
    expect(sig).toBe(`0x${SIG.r}${SIG.s}1c`);
    expect(sig.length).toBe(2 + 130);
  });

  test('touches ONLY signPersonalMessage on the device app', async () => {
    const accessed = [];
    const target = { signPersonalMessage: () => SIG };
    const eth = new Proxy(target, {
      get(t, prop) {
        if (typeof prop === 'string') accessed.push(prop);
        if (prop === 'signPersonalMessage') return t.signPersonalMessage;
        return () => { throw new Error(`SECURITY: unexpected Eth method accessed: ${String(prop)}`); };
      },
    });
    const svc = createLedgerService({ openTransport: async () => makeTransport(), openEthApp: () => eth });
    await svc.signMessage("44'/60'/0'/0/0", 'hi');
    expect([...new Set(accessed)]).toEqual(['signPersonalMessage']);
  });

  test('rejects a malformed path or empty message before touching the device', async () => {
    let opened = false;
    const svc = createLedgerService({
      openTransport: async () => { opened = true; return makeTransport(); },
      openEthApp: () => ({ signPersonalMessage: () => SIG }),
    });
    await expect(svc.signMessage('bad/path', 'hi')).rejects.toThrow(/Invalid derivation path/);
    await expect(svc.signMessage("44'/60'/0'/0/0", '')).rejects.toThrow(/Nothing to sign/);
    await expect(svc.signMessage("44'/60'/0'/0/0", 42)).rejects.toThrow(/Nothing to sign/);
    expect(opened).toBe(false);
  });

  test('a Ledger reject (0x6985) maps to a clear message and closes the transport', async () => {
    const t = makeTransport();
    const rejectErr = Object.assign(new Error('CONDITIONS_OF_USE_NOT_SATISFIED'), { statusCode: 0x6985 });
    const eth = { signPersonalMessage: () => { throw rejectErr; } };
    const svc = createLedgerService({ openTransport: async () => t, openEthApp: () => eth });
    await expect(svc.signMessage("44'/60'/0'/0/0", 'hi')).rejects.toThrow(/rejected/i);
    expect(t.wasClosed()).toBe(true);
  });

  test('a leaky signing error never echoes key material — only a safe message', async () => {
    const eth = { signPersonalMessage: () => { throw new Error('boom privateKey=0xDEADBEEF mnemonic="witch collapse"'); } };
    const svc = createLedgerService({ openTransport: async () => makeTransport(), openEthApp: () => eth });
    const caught = await svc.signMessage("44'/60'/0'/0/0", 'hi').catch((e) => e.message);
    for (const secret of ['privateKey', '0xDEADBEEF', 'mnemonic', 'witch collapse']) {
      expect(caught).not.toContain(secret);
    }
  });

  test('a malformed device signature surfaces a clear boundary error (not 0xNaN)', async () => {
    const eth = { signPersonalMessage: () => ({ v: 28, r: 'nope', s: 'bad' }) };
    const svc = createLedgerService({ openTransport: async () => makeTransport(), openEthApp: () => eth });
    await expect(svc.signMessage("44'/60'/0'/0/0", 'hi')).rejects.toThrow(/Invalid signature returned from device/);
  });
});

describe('assembleSignature (pure)', () => {
  const r = 'a'.repeat(64);
  const s = 'b'.repeat(64);

  test('packs {v,r,s} into a 65-byte 0x signature; maps the recovery byte', () => {
    expect(assembleSignature({ v: 28, r, s })).toBe(`0x${r}${s}1c`);
    expect(assembleSignature({ v: 27, r, s })).toBe(`0x${r}${s}1b`);
    expect(assembleSignature({ v: 0, r, s })).toBe(`0x${r}${s}00`);
    expect(assembleSignature({ v: 1, r, s })).toBe(`0x${r}${s}01`);
    expect(assembleSignature({ v: 28, r, s }).length).toBe(2 + 130);
  });

  test('strips a leading 0x and lowercases r/s', () => {
    const rUp = `0x${'A'.repeat(64)}`;
    const sUp = 'B'.repeat(64);
    expect(assembleSignature({ v: 27, r: rUp, s: sUp })).toBe(`0x${'a'.repeat(64)}${'b'.repeat(64)}1b`);
  });

  test('rejects malformed device output instead of emitting junk (0xNaN…)', () => {
    expect(() => assembleSignature({})).toThrow(/Invalid signature/);
    expect(() => assembleSignature(undefined)).toThrow(/Invalid signature/);
    expect(() => assembleSignature({ v: null, r, s })).toThrow(/Invalid signature/); // Number(null)===0 must NOT pass
    expect(() => assembleSignature({ v: 28, r: 'short', s })).toThrow(/Invalid signature/);
    expect(() => assembleSignature({ v: 5, r, s })).toThrow(/Invalid signature/); // bad recovery byte
  });
});

describe('Ledger medium — pure helpers', () => {
  test('toPublicAccount is a hard allow-list (path + address only)', () => {
    const out = toPublicAccount("44'/60'/0'/0/0", hostileGetAddress("44'/60'/0'/0/0"));
    expect(Object.keys(out).sort()).toEqual(['address', 'path']);
    expect(Object.isFrozen(out)).toBe(true);
  });

  test('toPublicAccount null-safes a missing address', () => {
    expect(toPublicAccount("44'/60'/0'/0/0", {}).address).toBe(null);
    expect(toPublicAccount("44'/60'/0'/0/0", null).address).toBe(null);
  });

  test('ethPath builds the standard Ethereum account path', () => {
    expect(ethPath(0)).toBe("44'/60'/0'/0/0");
    expect(ethPath(9)).toBe("44'/60'/9'/0/0");
  });
});
