// Witness wallet IPC — the bridge between the renderer UI and the main-process
// wallet service. This is where the security boundary actually lives: every
// signature and send is gated by a trusted confirmation window here in the
// main process (confirm-window.cjs), rendered from a packaged-local file the
// renderer cannot reach — so a compromised renderer can REQUEST a signature but
// can never click Sign or auto-approve one. The renderer only ever receives
// signatures and the
// non-secret status marker — never the key.

const { ipcMain, BrowserWindow } = require('electron');
const { AsyncLocalStorage } = require('node:async_hooks');
const path = require('node:path');
const { ethers } = require('ethers');
const { createWalletService } = require('./wallet-service.cjs');
const { createLedgerService } = require('./ledger-service.cjs');
const { osKeySeal } = require('./os-keyseal.cjs');
const { createRpcStore, maskRpcUrl } = require('./rpc-store.cjs');
const { validateRpcUrl } = require('./rpc-url.cjs');
const { pickPersonalSignMessage, parseTypedData, isReadMethod, toChainIdHex } = require('./eip1193-helpers.cjs');
const { createConfirmWindow } = require('./confirm-window.cjs');
const { buildSignConfirmView, buildGateView } = require('./confirm-view.cjs');
const { NETWORKS, createNetworkStore } = require('./networks.cjs');
const { fromDesk } = require('../desk-links.cjs');

// Which renderer asked — carried through the async call chain so a confirm
// dialog raised deep inside the wallet service attaches to the desk that made
// the request, not a sibling window (multi-window; confused-deputy-adjacent
// if the sheet landed elsewhere). AsyncLocalStorage rather than a module
// variable: two desks can have handler calls in flight at once, and a stashed
// "current sender" would let one call's await window clobber the other's.
const callCtx = new AsyncLocalStorage();

// impure — the authoritative confirmation for a sign/send. The native OS dialog
// this used to be could not be styled; it is now a trusted, LINE & CYCLE window
// rendered from a packaged-local file (confirm-window.cjs). Every security
// property is preserved: it defaults to Reject, the renderer cannot click it,
// only one may be open at a time, and it shows the FULL content being signed —
// the typed-data value, the target chain, a warning on opaque digests — so the
// human can actually refuse a malicious request. The what-to-show shaping is the
// pure buildSignConfirmView (confirm-view.cjs), proven by real tests.
const makeNativeConfirm = (getWindow) => (req) => createConfirmWindow(getWindow(), buildSignConfirmView(req));

// impure — a stern gate for irreversible actions (reveal/delete/reroute RPC),
// through the same trusted window. Destructive gates pass tone:'alert' so the
// window lights the theatrical alert register.
const gateDialog = (getWindow, spec) => createConfirmWindow(getWindow(), buildGateView(spec));

// impure — lazily build + cache the RPC provider for the SELECTED network. The
// witness's custom RPC (a secret held by rpcStore) wins when set; otherwise the
// selected network's public endpoint is used. Reads AND the embedded wallet's
// sends route through this, so a custom RPC gives the user their own node + MEV
// protection. Keyed on the chosen URL so a set/clear in Settings — or a network
// switch — takes effect at once.
const makeRpcGetter = (rpcStore, networkStore) => {
  let cached = null;
  let cachedFor = null;
  return async () => {
    const target = (rpcStore && rpcStore.get()) || networkStore.resolve().publicRpc;
    if (cached && cachedFor === target) return cached;
    cached = new ethers.JsonRpcProvider(target);
    cachedFor = target;
    return cached;
  };
};

/**
 * Register the wallet IPC handlers and wire the main-process wallet service.
 * @param {{getWindow: () => object, userDataPath: string}} deps
 * @returns {() => void} an unregister function
 */
const registerWalletIpc = ({ getWindow, userDataPath, getOrigin = null }) => {
  const walletDir = path.join(userDataPath, 'wallet');
  const rpcStore = createRpcStore({ walletDir, outerSeal: osKeySeal });
  const networkStore = createNetworkStore({ walletDir });
  const getRpcProvider = makeRpcGetter(rpcStore, networkStore);
  // The desk that made the in-flight request, resolved from call context;
  // falls back to the operator-provided window (focused desk) when the
  // sender is gone (window closed mid-request) or absent (internal call).
  const resolveWindow = () => {
    const sender = callCtx.getStore()?.sender;
    if (sender && !sender.isDestroyed()) {
      const w = BrowserWindow.fromWebContents(sender);
      if (w && !w.isDestroyed()) return w;
    }
    return getWindow();
  };
  const service = createWalletService({
    walletDir,
    outerSeal: osKeySeal,
    getRpcProvider,
    // Every outgoing tx is PINNED to the selected network's chainId — the
    // signature then binds OUR chain, so a custom RPC that lies about (or
    // simply serves) another chain fails safe instead of silently rerouting
    // a broadcast (2026-07-11, network-switch slice).
    getChainId: () => networkStore.resolve().chainId,
    confirm: makeNativeConfirm(resolveWindow),
    onLock: () => {
      // Lock state is process-global truth — every desk's UI must flip at
      // once, not just the one that asked.
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('wallet:locked');
      }
    },
  });

  // Ledger medium — a pure relay to the hardware device. No key material ever
  // enters this process (see ledger-service.cjs); it only reads public addresses.
  const ledger = createLedgerService();

  // EIP-1193 dispatch — secret-requiring methods go through the service (and its
  // native confirm); reads go straight to the RPC node; everything else is denied.
  const handleRequest = async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
      const address = service.getAddress();
      return address ? [address] : [];
    }
    // The SELECTED network's chain (Base mainnet by default; Base Sepolia when
    // the witness deliberately switches for testnet work). A custom RPC is
    // expected to serve this chain; the signed tx pins this chainId so a
    // wrong-chain RPC fails safe.
    if (method === 'eth_chainId') return toChainIdHex(networkStore.resolve().chainId);
    if (method === 'personal_sign') return service.signMessage(pickPersonalSignMessage(params));
    if (method === 'eth_signTypedData_v4' || method === 'eth_signTypedData') {
      const { domain, types, value } = parseTypedData(params);
      return service.signTypedData(domain, types, value);
    }
    if (method === 'eth_sendTransaction') return service.sendTransaction((params && params[0]) || {});
    if (isReadMethod(method)) {
      const rpc = await getRpcProvider();
      if (!rpc) throw new Error('No RPC provider available');
      return rpc.send(method, params || []);
    }
    throw new Error(`Unsupported method: ${method}`);
  };

  const handlers = {
    'wallet:status': () => service.status(),
    'wallet:list': () => service.list(),
    'wallet:assessPassword': (_e, pw) => service.assessPassword(pw),
    'wallet:create': (_e, password) => service.create(password),
    'wallet:importMnemonic': (_e, phrase, password) => service.importMnemonic(phrase, password),
    'wallet:importPrivateKey': (_e, pk, password) => service.importPrivateKey(pk, password),
    'wallet:select': (_e, id) => service.select(id),
    'wallet:unlock': (_e, id, password, remember) => service.unlock(id, password, remember),
    'wallet:tryRemembered': () => service.tryRememberedUnlock(),
    'wallet:canKeepMadeKey': () => service.canKeepMadeKey(),
    'wallet:createForMe': () => service.createForMe(),
    'wallet:revealMade': async (_e, id) => {
      const ok = await gateDialog(resolveWindow, {
        message: 'Reveal your recovery phrase?',
        detail:
          'Anyone who sees these 24 words controls this wallet and its funds. Make sure no one is watching your screen — including screen share or recording.',
        confirmLabel: 'Reveal',
        tone: 'alert',
      });
      if (!ok) throw new Error('Reveal cancelled.');
      return service.revealMadeMnemonic(id);
    },
    'wallet:lock': () => {
      service.lock();
      return { unlocked: false };
    },
    'wallet:reveal': async (_e, id, password) => {
      const ok = await gateDialog(resolveWindow, {
        message: 'Reveal your recovery phrase?',
        detail:
          'Anyone who sees these 24 words controls this wallet and its funds. Make sure no one is watching your screen — including screen share or recording.',
        confirmLabel: 'Reveal',
        tone: 'alert',
      });
      if (!ok) throw new Error('Reveal cancelled.');
      return service.revealMnemonic(id, password);
    },
    'wallet:remove': async (_e, id, password) => {
      const ok = await gateDialog(resolveWindow, {
        message: 'Delete this wallet from this device?',
        detail:
          'This removes the encrypted vault from this machine. If you have not saved your recovery phrase, the wallet and any funds in it are gone forever.',
        confirmLabel: 'Delete',
        tone: 'alert',
      });
      if (!ok) throw new Error('Deletion cancelled.');
      return service.remove(id, password);
    },
    'wallet:request': (_e, payload) => handleRequest(payload || {}),
    // Custom RPC endpoint — the secret URL stays in main; the renderer only ever
    // gets a masked status, never the raw value. Setting/clearing reroutes every
    // read AND broadcast, so — like reveal/remove — it is gated by the trusted
    // confirmation window the renderer cannot click: a compromised renderer can request a
    // reroute but can never silently point the wallet at an attacker's RPC.
    'wallet:rpc:status': () => rpcStore.status(),
    'wallet:rpc:set': async (_e, url) => {
      const v = validateRpcUrl(url);
      if (!v.ok) return { ok: false, error: v.error };
      const net = networkStore.resolve();
      const ok = await gateDialog(resolveWindow, {
        message: 'Route this wallet through a custom RPC?',
        detail: `All balance reads and your transaction broadcasts will go through:\n\n${maskRpcUrl(v.url)}\n\nThis endpoint can see and order your transactions, and must serve ${net.label} (chain ${net.chainId}). Only set it if you trust it.`,
        confirmLabel: 'Set RPC',
      });
      if (!ok) return { ok: false, error: 'Cancelled.' };
      return rpcStore.set(v.url); // re-validated inside set() — deliberate defense-in-depth on the secret-writing path
    },
    // Network selection — which chain the wallet points at. NOT a secret (the
    // renderer sees the full status), but switching moves every read and
    // broadcast to another chain, so — like an RPC reroute — it is gated by
    // the trusted confirmation window the renderer cannot click. Mainnet is
    // home; the testnet exists for witnessed testnet-first walks.
    'wallet:network:status': () => ({
      network: networkStore.resolve(),
      networks: Object.values(NETWORKS),
    }),
    'wallet:network:set': async (_e, key) => {
      const target = NETWORKS[key];
      if (!target) return { ok: false, error: `Unknown network '${key}'` };
      if (target.key === networkStore.get()) return { ok: true, network: target.key };
      const ok = await gateDialog(resolveWindow, {
        message: `Switch this wallet to ${target.label}?`,
        detail: target.testnet
          ? `Reads, broadcasts, and signatures will target ${target.label} (chain ${target.chainId}). Testnet funds have no real value — switch back to a mainnet before any real transaction.`
          : `Reads, broadcasts, and signatures will target ${target.label} (chain ${target.chainId}) — the REAL network. Transactions here move real value.`,
        confirmLabel: `Use ${target.label}`,
        tone: target.testnet ? undefined : 'alert',
      });
      if (!ok) return { ok: false, error: 'Cancelled.' };
      return networkStore.set(key);
    },
    'wallet:rpc:clear': async () => {
      const ok = await gateDialog(resolveWindow, {
        message: 'Switch back to the public RPC?',
        detail: 'This removes your custom RPC. Reads and broadcasts will use the public endpoint — without your MEV protection.',
        confirmLabel: 'Use Public RPC',
      });
      if (!ok) return { ok: false, error: 'Cancelled.' };
      return rpcStore.clear();
    },
    // Ledger — read-only account discovery. Returns public { path, address }
    // only; the device holds the keys and never exports them.
    'wallet:ledger:listAccounts': (_e, opts) => ledger.listAccounts(opts || {}),
    'wallet:ledger:getAccount': (_e, derivationPath) => ledger.getAccount(derivationPath),
    // Sign a message ON THE DEVICE (the login challenge). Returns only the
    // signature; the private key never leaves the Ledger.
    'wallet:ledger:signMessage': (_e, derivationPath, message) => ledger.signMessage(derivationPath, message),
  };

  // Every handler runs inside call context carrying its sender, so any
  // dialog raised anywhere down the chain can attach to the asking desk.
  // Only a desk's own top frame on the desk's origin may ask the wallet (desk-links.cjs fromDesk;
  // audit 2026-10-28 M-07). The confirm and unlock windows keep their own sender checks.
  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args) => {
      if (getOrigin && !fromDesk(event, getOrigin())) throw new Error(`${channel} refused: not the desk`);
      return callCtx.run({ sender: event.sender }, () => fn(event, ...args));
    });
  }
  return () => {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
  };
};

module.exports = { registerWalletIpc };
