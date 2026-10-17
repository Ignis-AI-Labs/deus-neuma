// Pure view-model layer for the trusted wallet confirmation window.
//
// The native OS dialog this replaces could not be styled — it was GTK/Win32
// chrome. To bring the confirmation into LINE & CYCLE we draw it ourselves,
// but the decision of WHAT to show a human about to sign is security-relevant
// (an under-described transaction is a phishing vector), so that shaping lives
// here as pure functions that can be proven by real tests, separate from the
// Electron window that renders them.
//
// A view model is display-only: labels, values, a tone. It carries no key
// material and no capability — the window renders it and reports back a single
// boolean the human chose.

const { ethers } = require('ethers');

const fmtEther = (v) => {
  try {
    return ethers.formatEther(v ?? 0n) + ' ETH';
  } catch {
    return String(v ?? '0');
  }
};

const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

// Decode a sign payload for display. A 0x payload that is not valid UTF-8 is an
// opaque digest the human cannot evaluate — flag it so the view can warn in the
// theatrical alert register (this is exactly the case «WARNING» is reserved for).
const decodeSign = (m) => {
  if (typeof m === 'string' && m.startsWith('0x')) {
    try {
      return { text: ethers.toUtf8String(m), opaque: false };
    } catch {
      return { text: m, opaque: true };
    }
  }
  return { text: String(m), opaque: false };
};

const DEFAULT_CHAIN_ID = 8453; // Base mainnet — the one chain this wallet targets

// Shape a signature/transaction request into a display view model. Mirrors the
// content the old native dialog showed — never less: the same fields, the same
// opaque-digest warning — so restyling can never quietly hide what is signed.
/**
 * Shape a signature/transaction request into a display-only view model.
 * @param {{type?: string, to?: string, value?: bigint, data?: string, domain?: object, value?: any, message?: string}} req — the sign request
 * @returns {{kind: string, heading: string, intro: string, fields?: Array<{label:string,value:string,mono:boolean}>, body?: string, warning?: string, tone: string, confirmLabel: string, rejectLabel: string}} display-only model (no key material, no capability)
 */
const buildSignConfirmView = (req) => {
  const base = { kind: req.type || 'signMessage', title: 'NEUMA WALLET', rejectLabel: 'REJECT', tone: 'normal' };
  if (req.type === 'transaction') {
    const fields = [
      { label: 'TO', value: req.to || '—', mono: true },
      { label: 'VALUE', value: fmtEther(req.value), mono: true },
      // The chainId the service resolved and will PIN into the signed tx —
      // the witness must read the real target, never an assumed default.
      { label: 'CHAIN', value: String(req.chainId ?? DEFAULT_CHAIN_ID), mono: true },
    ];
    if (req.data && req.data !== '0x') fields.push({ label: 'DATA', value: clip(String(req.data), 80), mono: true });
    return { ...base, heading: 'CONFIRM TRANSACTION', intro: 'A transaction is about to be broadcast from this wallet.', fields, confirmLabel: 'CONFIRM & SEND' };
  }
  if (req.type === 'signTypedData') {
    const d = req.domain || {};
    const fields = [{ label: 'DOMAIN', value: d.name || '—', mono: true }];
    if (d.verifyingContract) fields.push({ label: 'CONTRACT', value: d.verifyingContract, mono: true });
    if (d.chainId) fields.push({ label: 'CHAIN', value: String(d.chainId), mono: true });
    let valueStr;
    try {
      valueStr = JSON.stringify(req.value, null, 2);
    } catch {
      valueStr = String(req.value);
    }
    return { ...base, heading: 'SIGN TYPED DATA', intro: 'A structured message is about to be signed with this wallet.', fields, body: clip(valueStr, 600), confirmLabel: 'SIGN' };
  }
  // personal_sign — the login challenge and any plain-message signature.
  const { text, opaque } = decodeSign(req.message);
  if (opaque) {
    return {
      ...base,
      heading: 'SIGN MESSAGE',
      tone: 'alert',
      intro: 'This request asks you to sign raw, unreadable data.',
      warning: 'Unreadable (raw) data — only sign this if you fully trust the source. Malicious sites use opaque signatures to forge approvals.',
      body: clip(text, 80),
      confirmLabel: 'SIGN',
    };
  }
  return {
    ...base,
    heading: 'SIGN MESSAGE',
    intro: 'A message is about to be signed with this wallet to prove it is yours.',
    body: clip(text, 400),
    confirmLabel: 'SIGN',
  };
};

// Shape a stern gate (reveal secret / delete vault / reroute RPC) into a view
// model. Destructive gates pass tone:'alert' so the window lights the alert
// register — the same theatrical weight the native 'warning' dialog carried.
/**
 * Shape a stern gate (reveal/delete/reroute) into a display-only view model.
 * @param {{heading?: string, intro?: string, message?: string, detail?: string, confirmLabel?: string, rejectLabel?: string, tone?: 'normal'|'alert'}} spec — `message` doubles as the intro; `confirmLabel` doubles as the heading when none is given
 * @returns {object} display-only model; alert tone raises `detail` into the warning band
 */
const buildGateView = ({ heading, intro, message, detail, confirmLabel, rejectLabel = 'CANCEL', tone = 'normal' }) => ({
  kind: 'gate',
  title: 'NEUMA WALLET',
  // The action label doubles as the mono heading when a caller gives no explicit
  // one — 'Reveal' → «REVEAL», 'Set RPC' → «SET RPC».
  heading: String(heading || confirmLabel || 'CONFIRM').toUpperCase(),
  // `message` is the caller's headline question; it reads as the voice intro.
  intro: intro || message || '',
  // Destructive gates raise the detail into the theatrical alert band; calm
  // gates carry it as ordinary body text — never both, so it reads once.
  body: tone === 'alert' ? '' : detail || '',
  warning: tone === 'alert' ? detail || '' : null,
  tone: tone === 'alert' ? 'alert' : 'normal',
  confirmLabel: String(confirmLabel || 'CONFIRM').toUpperCase(),
  rejectLabel: String(rejectLabel).toUpperCase(),
});

// The security hinge of the styled window. ipcMain listeners are process-global:
// EVERY webContents can emit on a channel, so a compromised app renderer could
// fire the resolve channel to forge an approval. The only defence is sender
// identity — accept the human's choice ONLY from the confirm window's own
// contents, never from any other window. Pure and total so it can be proven.
/**
 * The security hinge: is an IPC resolve event genuinely from the confirm window?
 * Returns `true` ONLY on reference identity between the event sender and the
 * confirm window's own webContents. Returns `false` for a missing event or
 * webContents, a destroyed webContents, or any sender mismatch — so a resolve
 * forged from any other renderer is rejected.
 * @param {{sender: object}} event — the ipcMain event
 * @param {{isDestroyed?: () => boolean}} confirmWebContents — the confirm window's webContents
 * @returns {boolean} true only for the trusted window's own sender
 */
const isTrustedResolve = (event, confirmWebContents) => {
  if (!event || !confirmWebContents) return false;
  if (typeof confirmWebContents.isDestroyed === 'function' && confirmWebContents.isDestroyed()) return false;
  return event.sender === confirmWebContents;
};

module.exports = { buildSignConfirmView, buildGateView, isTrustedResolve, DEFAULT_CHAIN_ID };
