// What a transaction request really carries — read before the trusted window
// shows it and before the wallet signs it (audit PR600 P6-09).
//
// The confirm window used to show TO / VALUE / CHAIN and the first 80
// characters of the calldata, while the wallet signed the caller's whole
// object: an unlimited token approval read as a row of hex, and a fee or nonce
// the caller set was signed without being shown. Here the request is cut down
// to the fields the window shows, its call is read against the calls the
// wallet knows, and anything it cannot read or show is refused. The SAME
// normalised object is shown and signed, so the two can never differ.
//
// Pure, except loadKnownCalls (reads the app's own contract ABIs from disk).

const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('ethers');

// The token and wrapper calls a wallet meets everywhere.
const STANDARD_CALLS = Object.freeze([
  'function transfer(address to, uint256 amount)',
  'function approve(address spender, uint256 amount)',
  'function transferFrom(address from, address to, uint256 amount)',
  'function increaseAllowance(address spender, uint256 addedValue)',
  'function decreaseAllowance(address spender, uint256 subtractedValue)',
  'function setApprovalForAll(address operator, bool approved)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function deposit()',
  'function withdraw(uint256 amount)',
]);

// The app's own contracts (the birth seal, the house registry), packaged with it.
const APP_ABI_DIR = path.join(__dirname, '../../docs/contracts/abis');
const APP_ABI_FILES = Object.freeze(['Natalis.json', 'HouseRegistry.json', 'base/Natalis.json', 'base/HouseRegistry.json']);

/**
 * The calls the wallet can read: the standard token calls and the app's own
 * contracts. A missing or unreadable ABI file adds nothing (its calls are then
 * refused as unreadable, never guessed). impure (fs read).
 * @param {string} [dir] - the ABI folder; default the packaged one
 * @returns {ethers.Interface[]}
 */
const loadKnownCalls = (dir = APP_ABI_DIR) => {
  const known = [new ethers.Interface(STANDARD_CALLS)];
  for (const file of APP_ABI_FILES) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      known.push(new ethers.Interface(Array.isArray(parsed) ? parsed : parsed.abi));
    } catch {
      /* not packaged here — its calls stay unreadable */
    }
  }
  return known;
};

let cachedCalls = null;
const knownCalls = () => (cachedCalls ??= loadKnownCalls());

const MAX_UINT256 = (1n << 256n) - 1n;

// pure — one decoded value as the words a person reads, never clipped
const showValue = (type, value) => {
  if (type.baseType === 'array') return `[${value.map((v) => showValue(type.arrayChildren, v)).join(', ')}]`;
  if (type.baseType === 'tuple') return `(${type.components.map((c, i) => `${c.name || i}: ${showValue(c, value[i])}`).join(', ')})`;
  if (typeof value === 'bigint') return value === MAX_UINT256 ? `UNLIMITED (${value})` : value.toString();
  return String(value);
};

/**
 * Read calldata against the known calls. Null when its selector is unknown or
 * when re-encoding the decoded arguments does not give back the same bytes
 * (bytes appended after the arguments would be signed without being shown). Pure.
 * @param {string} data - 0x calldata
 * @param {ethers.Interface[]} [known]
 * @returns {{signature: string, name: string, args: Array<{name: string, type: string, value: string, raw: *}>}|null}
 */
const decodeCall = (data, known = knownCalls()) => {
  if (!ethers.isHexString(data) || ethers.dataLength(data) < 4) return null;
  for (const iface of known) {
    let parsed;
    try { parsed = iface.parseTransaction({ data }); } catch { parsed = null; }
    if (!parsed) continue;
    try {
      if (iface.encodeFunctionData(parsed.fragment, parsed.args).toLowerCase() !== data.toLowerCase()) return null;
    } catch {
      return null;
    }
    return {
      name: parsed.name,
      signature: parsed.fragment.format('full').replace(/^function /, ''),
      args: parsed.fragment.inputs.map((input, i) => ({
        name: input.name || `arg${i}`, type: input.type, value: showValue(input, parsed.args[i]), raw: parsed.args[i],
      })),
    };
  }
  return null;
};

// The only request fields the window shows, so the only ones the wallet signs.
const FEE_FIELDS = Object.freeze(['gasLimit', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas']);
const SHOWN_FIELDS = Object.freeze(new Set(['to', 'from', 'value', 'data', 'nonce', 'type', 'chainId', 'gas', ...FEE_FIELDS]));

const refuse = (why) => { throw new Error(`${why} Nothing was signed.`); };

// pure — a caller's number (hex string, decimal, number, bigint) as a bigint ≥ 0
const amountOf = (field, value) => {
  let n;
  try { n = BigInt(value); } catch { n = -1n; }
  if (n < 0n) refuse(`The transaction's ${field} is not a number.`);
  return n;
};

/**
 * Cut a transaction request down to what the trusted window shows. Refuses a
 * field the window has no row for (an access list, an EIP-7702 authorization,
 * blobs), a chain other than the wallet's, a missing or malformed recipient,
 * and calldata the wallet cannot read. `gas` (the caller's own estimate) is
 * dropped, as it always was: the wallet asks the network. Pure.
 * @param {object} tx - the caller's request
 * @param {number|null} chainId - the wallet's selected chain, or null when unpinned
 * @param {ethers.Interface[]} [known]
 * @returns {Readonly<object>} the request to show AND sign
 */
const normalizeTxRequest = (tx, chainId, known = knownCalls()) => {
  if (!tx || typeof tx !== 'object' || Array.isArray(tx)) refuse('That is not a transaction.');
  const given = Object.keys(tx).filter((k) => tx[k] !== undefined && tx[k] !== null);
  const hidden = given.filter((k) => !SHOWN_FIELDS.has(k));
  if (hidden.length) refuse(`This transaction carries ${hidden.join(', ')}, which the wallet cannot show you.`);
  if (typeof tx.to !== 'string' || !ethers.isAddress(tx.to)) refuse('This transaction names no valid address to send to.');
  const out = { to: ethers.getAddress(tx.to), value: given.includes('value') ? amountOf('value', tx.value) : 0n, data: '0x' };
  if (given.includes('from')) {
    if (typeof tx.from !== 'string' || !ethers.isAddress(tx.from)) refuse('This transaction names a sender that is not an address.');
    out.from = ethers.getAddress(tx.from);
  }
  if (given.includes('data') && tx.data !== '0x') {
    if (!decodeCall(tx.data, known)) refuse('This transaction carries a call the wallet cannot read, so it cannot show you what it does.');
    out.data = tx.data.toLowerCase();
  }
  if (given.includes('type')) {
    const type = Number(amountOf('type', tx.type));
    if (type !== 0 && type !== 2) refuse('This kind of transaction is one the wallet cannot show you.');
    out.type = type;
  }
  const asked = given.includes('chainId') ? Number(amountOf('chain', tx.chainId)) : null;
  if (chainId && asked !== null && asked !== Number(chainId)) refuse(`This transaction is for chain ${asked}, and the wallet is on chain ${chainId}.`);
  if (chainId || asked !== null) out.chainId = Number(chainId || asked);
  for (const field of FEE_FIELDS) if (given.includes(field)) out[field] = amountOf(field, tx[field]);
  if (given.includes('nonce')) out.nonce = Number(amountOf('nonce', tx.nonce));
  return Object.freeze(out);
};

// A fee above this is said out loud in the alert register.
const FEE_WARN_WEI = ethers.parseEther('0.01');

/**
 * What the request says about its own fee. Pure.
 * @param {object} tx - a normalised request
 * @returns {{rows: Array<{label: string, value: string}>, warning: string|null}}
 */
const feeFacts = (tx) => {
  const perGas = tx.maxFeePerGas ?? tx.gasPrice ?? null;
  const rows = [];
  let warning = null;
  if (perGas !== null && tx.gasLimit !== undefined) {
    const max = perGas * tx.gasLimit;
    rows.push({ label: 'MAX FEE', value: `${ethers.formatEther(max)} ETH` });
    if (max > FEE_WARN_WEI) warning = `This request sets its own network fee: up to ${ethers.formatEther(max)} ETH can be spent on the fee alone.`;
  } else if (perGas !== null) {
    rows.push({ label: 'FEE PRICE', value: `${ethers.formatUnits(perGas, 'gwei')} gwei per gas` });
    warning = 'This request sets its own fee price. The total fee depends on the gas the network measures, and is not shown here.';
  } else if (tx.gasLimit !== undefined) {
    rows.push({ label: 'GAS LIMIT', value: tx.gasLimit.toString() });
  }
  if (tx.maxPriorityFeePerGas !== undefined) rows.push({ label: 'TIP PRICE', value: `${ethers.formatUnits(tx.maxPriorityFeePerGas, 'gwei')} gwei per gas` });
  if (tx.nonce !== undefined) rows.push({ label: 'NONCE', value: String(tx.nonce) });
  return { rows, warning };
};

// The calls that hand another address the power to move this wallet's tokens.
const GRANTS = Object.freeze({ approve: 'spender', increaseAllowance: 'spender', permit: 'spender', setApprovalForAll: 'operator' });

/**
 * The warning a decoded call owes the person, or null. Pure.
 * @param {{name: string, args: Array<{name: string, raw: *}>}} call
 * @param {string} to - the contract called
 * @returns {string|null}
 */
const callWarning = (call, to) => {
  const who = GRANTS[call.name] && call.args.find((a) => a.name === GRANTS[call.name])?.raw;
  if (!who) return null;
  if (call.name === 'setApprovalForAll') {
    return call.args[1].raw ? `This lets ${who} move EVERY token of ${to} out of this wallet, now and later.` : null;
  }
  const amount = call.args.find((a) => typeof a.raw === 'bigint')?.raw;
  return amount === MAX_UINT256
    ? `This lets ${who} move an UNLIMITED amount of token ${to} out of this wallet, now and later.`
    : `This lets ${who} move tokens of ${to} out of this wallet, up to the amount shown.`;
};

module.exports = { decodeCall, loadKnownCalls, normalizeTxRequest, feeFacts, callWarning, STANDARD_CALLS, FEE_WARN_WEI };
