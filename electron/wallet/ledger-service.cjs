'use strict';
//
// Ledger hardware-wallet medium — the platform as a RELAY to the device, nothing more.
//
// THE INVARIANT (the whole point of this file): a private key or seed phrase
// NEVER enters this process. A Ledger physically cannot export them — there is
// no such command in the device protocol — and this module only ever:
//   (a) READS public account addresses for discovery, and
//   (b) hands a message to the device and receives a SIGNATURE
//       back, the key never leaving the device.
// Key custody lives entirely on the Ledger. `toPublicAccount` is a hard
// allow-list so that even a buggy or compromised lower layer cannot surface
// anything but `{ path, address }`; `friendlyError` guarantees a raw device
// buffer (which never contains a key, but defense in depth) never reaches a log
// or the renderer.
//
// The transport and the Eth app are INJECTED so this security logic is fully
// unit-testable without the native USB stack. The real Ledger libraries are
// lazy-required only when an actual device connection is opened — they are a
// native install step (node-hid + an Electron ABI rebuild); see
// docs/operations/hardware-wallet-checklist.md.

// BIP-44 Ethereum account path for index i. hw-app-eth wants no leading "m/".
const ethPath = (i) => `44'/60'/${i}'/0/0`;
const PATH_RE = /^44'\/60'\/\d+'\/\d+\/\d+$/;

const DEFAULT_ACCOUNT_COUNT = 5;
const MAX_ACCOUNT_COUNT = 25;

// pure — THE security boundary. Reduce any device response to PUBLIC,
// non-sensitive fields ONLY: the derivation path and the address. Never the
// public key, chain code, or anything else a future library version might add.
const toPublicAccount = (path, raw) =>
  Object.freeze({
    path,
    address: typeof raw?.address === 'string' ? raw.address : null,
  });

// pure — strip a leading 0x and lowercase a hex component.
const stripHex = (h) => String(h == null ? '' : h).replace(/^0x/i, '').toLowerCase();
const HEX64 = /^[0-9a-f]{64}$/;

// pure — assemble the device's {v, r, s} into a 0x EIP-191 signature
// (0x + r[32] + s[32] + v[1] = 65 bytes). r/s come back as 64-hex strings (no 0x
// prefix); v is the recovery byte (the backend's ethers verify accepts 27/28 or
// 0/1). This is a SIGNATURE, not key material — it is what we hand out. The
// device output is VALIDATED here (a system boundary): a malformed/empty result
// fails clearly rather than emitting a junk "0xNaN…" the backend would reject
// with an opaque error.
const assembleSignature = ({ v, r, s } = {}) => {
  const rh = stripHex(r);
  const sh = stripHex(s);
  // Guard null/undefined v BEFORE coercion: Number(null) === 0, which is a
  // valid recovery byte, so a missing v would otherwise pass and emit a wrong
  // signature (v=0 recovers the wrong address — an opaque backend failure).
  if (v == null || !HEX64.test(rh) || !HEX64.test(sh) || ![0, 1, 27, 28].includes(Number(v))) {
    throw new Error('Invalid signature returned from device.');
  }
  return `0x${rh}${sh}${Number(v).toString(16).padStart(2, '0')}`;
};

// pure — map a raw transport/device error to a safe, actionable message.
// NEVER returns the raw error (no device buffers, no stack, nothing key-shaped).
const friendlyError = (err) => {
  const code = err && err.statusCode;
  const msg = (err && err.message) || '';
  if ((err && err.code === 'MODULE_NOT_FOUND') || /Cannot find module.*(ledgerhq|node-hid)/i.test(msg)) {
    return 'Ledger support is not installed in this build — run the hardware-wallet install steps.';
  }
  // User pressed Reject on the device — the device is fine, they just declined.
  // 0x6985 = CONDITIONS_OF_USE_NOT_SATISFIED. The status code is the precise
  // signal; the text fallback is rejection-SPECIFIC so it can't swallow Linux
  // "access denied" / "connection refused" (which belong to the no-device branch).
  if (code === 0x6985 || /user (rejected|cancelled|refused)|conditions of use not satisfied/i.test(msg)) {
    return 'You rejected the request on your Ledger.';
  }
  if (code === 0x5515 || /locked/i.test(msg)) return 'Unlock your Ledger and try again.';
  if (code === 0x6e00 || code === 0x6d00 || /(eth(ereum)? app|app is not|CLA_NOT_SUPPORTED)/i.test(msg)) {
    return 'Open the Ethereum app on your Ledger, then try again.';
  }
  if (/no device|cannot open|no such|access denied|listen/i.test(msg)) {
    return 'No Ledger detected — connect it over USB and unlock it.';
  }
  return 'Could not reach the Ledger. Reconnect it, unlock it, and open the Ethereum app.';
};

// impure — real transport/app factories, required lazily so this module loads
// (and its tests run) without the native dependencies present.
const lazyRealTransport = async () => {
  const mod = require('@ledgerhq/hw-transport-node-hid');
  const Transport = mod.default || mod;
  return Transport.create();
};
const lazyRealEthApp = (transport) => {
  const mod = require('@ledgerhq/hw-app-eth');
  const Eth = mod.default || mod;
  return new Eth(transport);
};

/**
 * Create the Ledger medium.
 * @param {{openTransport?: () => Promise<object>, openEthApp?: (t: object) => object}} [deps]
 *   Injected for tests; defaults relay to the real (lazy-required) Ledger libs.
 * @returns {{ listAccounts: Function, getAccount: Function, signMessage: Function }}
 */
const createLedgerService = ({ openTransport = lazyRealTransport, openEthApp = lazyRealEthApp } = {}) => {
  // impure — open the device, run `fn(eth)`, ALWAYS close the transport. Errors
  // are normalized through friendlyError so nothing raw escapes.
  const withDevice = async (fn) => {
    let transport;
    try {
      transport = await openTransport();
    } catch (err) {
      throw new Error(friendlyError(err));
    }
    try {
      return await fn(openEthApp(transport));
    } catch (err) {
      throw new Error(friendlyError(err));
    } finally {
      // Intentionally non-fatal: a close failure AFTER a read error must not
      // mask the original (already propagating). Surface it as a diagnostic
      // (Electron main has no access to the backend logger) rather than swallow.
      try {
        await (transport && transport.close && transport.close());
      } catch (e) {
        console.warn('[ledger] transport close failed:', (e && e.message) || e);
      }
    }
  };

  // Read the public addresses already derived on the device — account discovery.
  // Read-only: no signing, no key material, just the addresses the witness holds.
  const listAccounts = async ({ count = DEFAULT_ACCOUNT_COUNT } = {}) => {
    // count > 0 → clamp to the max; anything invalid (0, negative, NaN) → default.
    const parsed = Math.floor(Number(count));
    const n = Number.isFinite(parsed) && parsed > 0
      ? Math.min(MAX_ACCOUNT_COUNT, parsed)
      : DEFAULT_ACCOUNT_COUNT;
    return withDevice(async (eth) => {
      const accounts = [];
      for (let i = 0; i < n; i++) {
        const path = ethPath(i);
        // getAddress(path, display=false, chainCode=false): public address only.
        accounts.push(toPublicAccount(path, await eth.getAddress(path, false, false)));
      }
      return accounts;
    });
  };

  // Read a single account at an explicit BIP-44 path (advanced/custom).
  const getAccount = async (path) => {
    if (typeof path !== 'string' || !PATH_RE.test(path)) {
      throw new Error('Invalid derivation path.');
    }
    return withDevice(async (eth) => toPublicAccount(path, await eth.getAddress(path, false, false)));
  };

  // Sign an EIP-191 personal message ON THE DEVICE. The message (e.g. the login
  // challenge) is shown on the Ledger screen; the witness approves with the
  // physical buttons; only the SIGNATURE returns — the private key never leaves
  // the device. This is what lets a Ledger be the witness's login.
  const signMessage = async (path, message) => {
    if (typeof path !== 'string' || !PATH_RE.test(path)) throw new Error('Invalid derivation path.');
    if (typeof message !== 'string' || message.length === 0) throw new Error('Nothing to sign.');
    const hex = Buffer.from(message, 'utf8').toString('hex');
    // Get the raw {v,r,s} inside withDevice (device errors → friendlyError, no
    // leak), then assemble OUTSIDE so a malformed-output error surfaces cleanly
    // rather than being rewrapped as a generic […].
    const raw = await withDevice(async (eth) => eth.signPersonalMessage(path, hex));
    return assembleSignature(raw);
  };

  return Object.freeze({ listAccounts, getAccount, signMessage });
};

module.exports = {
  createLedgerService,
  // exported for tests / reuse
  toPublicAccount,
  assembleSignature,
  ethPath,
  __test: { friendlyError, PATH_RE, DEFAULT_ACCOUNT_COUNT, MAX_ACCOUNT_COUNT },
};
