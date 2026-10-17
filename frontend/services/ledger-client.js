// Ledger renderer client — a thin, READ-ONLY bridge to the main-process Ledger
// medium (electron/wallet/ledger-service.cjs).
//
// It only ever asks the device for PUBLIC account addresses. Private keys never
// leave the Ledger and never enter the renderer. Defense in depth: even though
// main already reduces every response to { path, address } (toPublicAccount),
// this layer re-applies the SAME allow-list independently — so a second, fully
// separate boundary would have to fail before anything else could reach the UI.
//
// Hardware wallets require the Electron desktop app: node-hid is main-process
// USB, so a browser tab has no bridge. In a browser this reports "unsupported"
// rather than throwing.

// pure — strip any account object to PUBLIC fields only (the renderer's own
// allow-list, independent of main's).
const toPublicAccount = (a) => ({ path: a && a.path, address: a && a.address });

// impure — reads window: is the read-only Ledger bridge present? (Requires the
// desktop app + the preload IPC surface; a browser tab has neither.)
export const isLedgerSupported = () =>
  typeof window !== 'undefined'
  && !!(window.neuma && window.neuma.wallet)
  && typeof window.neuma.wallet.ledgerListAccounts === 'function';

const UNSUPPORTED = 'Hardware wallets need the NEUMA desktop app (a browser tab can’t reach a Ledger).';

// impure — read the public accounts already on the device. Read-only discovery;
// no signing, no key material. Returns { ok, accounts } or { ok:false, error }.
export const listLedgerAccounts = async ({ count = 5 } = {}) => {
  if (!isLedgerSupported()) return { ok: false, error: UNSUPPORTED };
  try {
    const raw = await window.neuma.wallet.ledgerListAccounts({ count });
    return { ok: true, accounts: (Array.isArray(raw) ? raw : []).filter(Boolean).map(toPublicAccount) };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Could not read the Ledger.' };
  }
};
