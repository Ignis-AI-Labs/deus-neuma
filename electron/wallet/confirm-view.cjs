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
const { decodeCall, feeFacts, callWarning } = require('./tx-content.cjs');
const { readMessage, parseSignIn, describeTypedData } = require('./message-content.cjs');

const fmtEther = (v) => {
  try {
    return ethers.formatEther(v ?? 0n) + ' ETH';
  } catch {
    return String(v ?? '0');
  }
};

// The most the window will show of one request. More than this is refused: a
// request too long to show in full is never signed on a part of it.
const MAX_SHOWN = 64 * 1024;

const DEFAULT_CHAIN_ID = 8453; // Base mainnet — the one chain this wallet targets

/**
 * Is this text a Sign-In with Ethereum challenge for THIS wallet? The whole
 * message must parse as one (message-content.cjs parseSignIn) and name the
 * wallet's own address. Pure.
 * @param {string} text
 * @param {string} address - the wallet that would sign
 * @returns {boolean}
 */
const isSignInMessage = (text, address) => {
  const parsed = parseSignIn(text);
  return Boolean(parsed && address && parsed.address.toLowerCase() === String(address).toLowerCase());
};

// pure — the transaction view: every field that is signed has a row, the call is read in words
const transactionView = (base, req) => {
  const fields = [
    { label: 'TO', value: req.to || '—', mono: true },
    { label: 'VALUE', value: fmtEther(req.value), mono: true },
    // The chainId the service resolved and will PIN into the signed tx —
    // the witness must read the real target, never an assumed default.
    { label: 'CHAIN', value: String(req.chainId ?? DEFAULT_CHAIN_ID), mono: true },
  ];
  const fee = feeFacts(req);
  const warnings = [fee.warning];
  let body;
  if (req.data && req.data !== '0x') {
    const call = decodeCall(String(req.data));
    if (!call) throw new Error('This transaction carries a call the wallet cannot read, so it cannot show you what it does. Nothing was signed.');
    fields.push({ label: 'CALL', value: call.signature, mono: true });
    body = [...call.args.map((a) => `${a.name}: ${a.value}`), `data: ${req.data}`].join('\n');
    warnings.unshift(callWarning(call, req.to));
  }
  fields.push(...fee.rows.map((row) => ({ ...row, mono: true })));
  const warning = warnings.filter(Boolean).join(' ');
  return {
    ...base, heading: 'CONFIRM TRANSACTION', intro: 'A transaction is about to be broadcast from this wallet.', fields,
    ...(body ? { body } : {}), ...(warning ? { warning, tone: 'alert' } : {}), confirmLabel: 'CONFIRM & SEND',
  };
};

// pure — the typed-data view: the whole domain, and every signed field in the order its type declares
const typedDataView = (base, req) => {
  const d = req.domain || {};
  const told = describeTypedData(d, req.types || {}, req.value);
  const fields = [{ label: 'DOMAIN', value: d.name || '—', mono: true }];
  if (d.version) fields.push({ label: 'VERSION', value: String(d.version), mono: true });
  if (d.verifyingContract) fields.push({ label: 'CONTRACT', value: d.verifyingContract, mono: true });
  if (d.chainId) fields.push({ label: 'CHAIN', value: String(d.chainId), mono: true });
  if (d.salt) fields.push({ label: 'SALT', value: String(d.salt), mono: true });
  fields.push({ label: 'TYPE', value: told.primaryType, mono: true });
  const warnings = [
    told.grantee ? `Signing this can let ${told.grantee} move tokens out of this wallet, with no transaction of yours.` : null,
    d.chainId && req.chainId && Number(d.chainId) !== Number(req.chainId) ? `This is for chain ${Number(d.chainId)}, and the wallet is on chain ${req.chainId}.` : null,
  ].filter(Boolean).join(' ');
  return {
    ...base, heading: 'SIGN TYPED DATA', intro: 'A structured message is about to be signed with this wallet.', fields,
    body: told.body, ...(warnings ? { warning: warnings, tone: 'alert' } : {}), confirmLabel: 'SIGN',
  };
};

// pure — personal_sign: the login challenge and any plain-message signature
const messageView = (base, req) => {
  const { text, opaque } = readMessage(req.message);
  if (opaque) {
    return {
      ...base,
      heading: 'SIGN MESSAGE',
      tone: 'alert',
      intro: 'This request asks you to sign raw, unreadable data.',
      warning: 'Unreadable (raw) data — only sign this if you fully trust the source. Malicious sites use opaque signatures to forge approvals.',
      body: text,
      confirmLabel: 'SIGN',
    };
  }
  // The sign-in challenge says what it is: a plain word for a plain act — and
  // only a whole, well-formed challenge for this wallet is one.
  if (isSignInMessage(text, req.address)) {
    const told = parseSignIn(text);
    return {
      ...base,
      heading: 'SIGN IN',
      intro: 'Sign in with this wallet. Signing proves the wallet is yours — it sends nothing and costs nothing.',
      fields: [
        { label: 'SITE', value: told.domain, mono: true },
        { label: 'ADDRESS', value: told.uri, mono: true },
        { label: 'CHAIN', value: String(told.chainId), mono: true },
      ],
      body: text,
      confirmLabel: 'SIGN IN',
      rejectLabel: 'CANCEL',
    };
  }
  return {
    ...base,
    heading: 'SIGN MESSAGE',
    intro: 'A message is about to be signed with this wallet to prove it is yours.',
    body: text,
    confirmLabel: 'SIGN',
  };
};

/**
 * Shape a signature/transaction request into a display-only view model: the
 * WHOLE content that is signed, never a part of it. Throws (so nothing is
 * signed) on a call it cannot read, typed data that does not fit its types, a
 * message that is neither text nor bytes, or content too long to show in full.
 * @param {{type?: string, to?: string, value?: *, data?: string, chainId?: number, domain?: object, types?: object, message?: *, address?: string}} req — the sign request
 * @returns {{kind: string, heading: string, intro: string, fields?: Array<{label:string,value:string,mono:boolean}>, body?: string, warning?: string, tone: string, confirmLabel: string, rejectLabel: string}} display-only model (no key material, no capability)
 */
const buildSignConfirmView = (req) => {
  const base = { kind: req.type || 'signMessage', title: 'NEUMA WALLET', rejectLabel: 'REJECT', tone: 'normal' };
  const shape = { transaction: transactionView, signTypedData: typedDataView }[req.type] || messageView;
  const view = shape(base, req);
  if ((view.body || '').length > MAX_SHOWN) throw new Error('This request is too long for the wallet to show you in full. Nothing was signed.');
  return view;
};

// Shape a stern gate (reveal secret / delete vault / reroute RPC) into a view
// model. Destructive gates pass tone:'alert' so the window lights the alert
// register — the same theatrical weight the native 'warning' dialog carried.
/**
 * Shape a stern gate (reveal/delete/reroute) into a display-only view model.
 * @param {{heading?: string, intro?: string, message?: string, detail?: string, confirmLabel?: string, rejectLabel?: string, tone?: 'normal'|'alert'}} spec — `message` doubles as the intro; `confirmLabel` doubles as the heading when none is given
 * @returns {object} display-only model; alert tone raises `detail` into the warning band
 */
const buildGateView = ({ heading, intro, message, detail, confirmLabel, rejectLabel = 'CANCEL', tone = 'normal', subject = null, armMs = 0 }) => ({
  kind: 'gate',
  // What the gate is about (the wallet's address, the Recovery Kit): a gate never asks without saying for what.
  ...(subject ? { fields: [{ label: String(subject.label), value: String(subject.value), mono: true }] } : {}),
  // How long after it shows the window refuses an approval (isArmed): a click already on its way lands on nothing.
  armMs,
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

/**
 * A secret, shown in the trusted window and nowhere else (audit PR600 P6-10):
 * a recovery phrase is numbered three words to a line; a key or a kit code
 * stands as it is. One button, which only closes the window. Pure.
 * @param {{heading: string, intro: string, secret: string, subject?: {label: string, value: string}}} spec
 * @returns {object} display-only model
 */
const buildSecretView = ({ heading, intro, secret, subject = null }) => {
  const words = String(secret).trim().split(/\s+/);
  const rows = [];
  for (let i = 0; i < words.length; i += 3) {
    rows.push(words.slice(i, i + 3).map((w, j) => `${String(i + j + 1).padStart(2)} ${w.padEnd(10)}`).join(' ').trimEnd());
  }
  return {
    kind: 'secret', title: 'NEUMA WALLET', tone: 'alert', single: true, armMs: 0,
    heading: String(heading).toUpperCase(), intro,
    ...(subject ? { fields: [{ label: String(subject.label), value: String(subject.value), mono: true }] } : {}),
    body: words.length > 1 ? rows.join('\n') : String(secret),
    warning: 'Anyone who sees this controls what it opens. It is shown here only, and is gone when you close this window.',
    confirmLabel: 'DONE', rejectLabel: 'CLOSE',
  };
};

/**
 * May an approval count yet? Not until the window has been showing for the
 * view's arming delay — a click or key already under way when it appeared
 * approves nothing. A rejection always counts. Pure.
 * @param {number|null} shownAt - when the window showed (ms), null before it has
 * @param {number} now
 * @param {number} [armMs]
 * @returns {boolean}
 */
const isArmed = (shownAt, now, armMs = 0) => shownAt !== null && now - shownAt >= armMs;

module.exports = { buildSignConfirmView, buildGateView, buildSecretView, isTrustedResolve, isSignInMessage, isArmed, DEFAULT_CHAIN_ID, MAX_SHOWN };
