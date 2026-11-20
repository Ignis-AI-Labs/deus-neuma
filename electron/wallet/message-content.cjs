// What a signature request really carries — read before the trusted window
// shows it and before the wallet signs it (audit PR600 P6-09).
//
// Three gaps closed here. Raw bytes handed over as a byte array were shown as
// a list of numbers with no warning, while the wallet signed them as bytes.
// Any message whose first line ended in the sign-in phrase got the calm SIGN IN
// dress, whatever followed. And typed data was shown as JSON in the caller's
// own key order, cut at 600 characters, so the field that mattered could be
// pushed out of sight. Pure throughout.

const { ethers } = require('ethers');

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// Control characters a person cannot read (tab, line feed and carriage return are text).
const UNREADABLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// pure — bytes that crossed IPC as a typed array, a Buffer or a plain byte list
const isByteList = (m) => m instanceof Uint8Array || (Array.isArray(m) && m.length > 0 && m.every((b) => Number.isInteger(b) && b >= 0 && b <= 255));

/**
 * One message, as the wallet will sign it and as the window will show it.
 * A 0x string and a byte list are both BYTES (personal_sign); any other string
 * is text. Bytes read as text only when they are valid UTF-8 with nothing
 * unreadable in it; otherwise they are opaque, and the window warns. Anything
 * else is refused. Pure.
 * @param {*} message
 * @returns {{sign: string|Uint8Array, text: string, opaque: boolean}}
 */
const readMessage = (message) => {
  if (isByteList(message)) return readMessage(ethers.hexlify(Uint8Array.from(message)));
  if (typeof message !== 'string') throw new Error('That is not a message the wallet can show you. Nothing was signed.');
  if (!message.startsWith('0x')) return { sign: message, text: message, opaque: false };
  if (!ethers.isHexString(message) || message.length % 2) throw new Error('That message is not valid hex. Nothing was signed.');
  const sign = ethers.getBytes(message);
  try {
    const text = ethers.toUtf8String(sign);
    if (!UNREADABLE.test(text)) return { sign, text, opaque: false };
  } catch {
    /* not UTF-8 — opaque */
  }
  return { sign, text: message, opaque: true };
};

const SIGN_IN_HEAD = /^(\S+) wants you to sign in with your Ethereum account:$/;
// The fields of an EIP-4361 challenge, in the one order the standard allows.
const SIGN_IN_FIELDS = Object.freeze([
  { key: 'uri', prefix: 'URI: ', need: true, shape: /^\S+$/ },
  { key: 'version', prefix: 'Version: ', need: true, shape: /^1$/ },
  { key: 'chainId', prefix: 'Chain ID: ', need: true, shape: /^[0-9]+$/ },
  { key: 'nonce', prefix: 'Nonce: ', need: true, shape: /^[A-Za-z0-9]{8,}$/ },
  { key: 'issuedAt', prefix: 'Issued At: ', need: true, shape: /^\S+$/ },
  { key: 'expirationTime', prefix: 'Expiration Time: ', need: false, shape: /^\S+$/ },
  { key: 'notBefore', prefix: 'Not Before: ', need: false, shape: /^\S+$/ },
  { key: 'requestId', prefix: 'Request ID: ', need: false, shape: /^\S*$/ },
]);

/**
 * A Sign-In with Ethereum (EIP-4361) challenge, parsed line by line, or null.
 * The WHOLE message has to be a challenge: the head line, the account, an
 * optional one-line statement, then the fields in order and nothing else. A
 * message that only opens with the sign-in phrase is not one. Pure.
 * @param {string} text
 * @returns {{domain: string, address: string, statement: string|null, uri: string, chainId: number, nonce: string, issuedAt: string}|null}
 */
const parseSignIn = (text) => {
  const lines = String(text ?? '').split('\n');
  const domain = SIGN_IN_HEAD.exec(lines[0])?.[1];
  if (!domain || !ADDRESS_RE.test(lines[1] || '') || lines[2] !== '') return null;
  const hasStatement = lines[3] !== '';
  if (hasStatement && lines[4] !== '') return null;
  const out = { domain, address: lines[1], statement: hasStatement ? lines[3] : null };
  let at = hasStatement ? 5 : 4;
  for (const field of SIGN_IN_FIELDS) {
    const line = lines[at];
    if (typeof line === 'string' && line.startsWith(field.prefix)) {
      const value = line.slice(field.prefix.length);
      if (!field.shape.test(value)) return null;
      out[field.key] = value;
      at += 1;
    } else if (field.need) {
      return null;
    }
  }
  if (lines[at] === 'Resources:') {
    at += 1;
    while (typeof lines[at] === 'string' && /^- \S+$/.test(lines[at])) at += 1;
  }
  if (at !== lines.length) return null;
  return { ...out, chainId: Number(out.chainId) };
};

const MAX_UINT256 = (1n << 256n) - 1n;

// pure — one typed-data leaf as words
const leafWords = (type, value) => {
  if (/^u?int/.test(type)) {
    const n = BigInt(value);
    return n === MAX_UINT256 ? `UNLIMITED (${n})` : n.toString();
  }
  return String(value);
};

// pure — the lines of one value of one type, fields in the order the TYPE declares them
const typedLines = (types, type, value, name, depth) => {
  const pad = '  '.repeat(depth);
  const array = /^(.*)\[\d*\]$/.exec(type);
  if (array) {
    if (!Array.isArray(value)) throw new Error(`typed data: ${name} is not a list`);
    return [`${pad}${name}: ${value.length ? '' : '(empty list)'}`.trimEnd(),
      ...value.flatMap((item, i) => typedLines(types, array[1], item, `[${i}]`, depth + 1))];
  }
  if (types[type]) {
    if (!value || typeof value !== 'object') throw new Error(`typed data: ${name} is not a ${type}`);
    return [`${pad}${name}: ${type}`.replace(/^: /, ''),
      ...types[type].flatMap((field) => typedLines(types, field.type, value[field.name], field.name, depth + 1))];
  }
  return [`${pad}${name}: ${leafWords(type, value)}`];
};

// Field names that hand another address power over this wallet's tokens.
const GRANT_FIELDS = Object.freeze(['spender', 'operator']);

/**
 * Typed data as the person reads it: every signed field, in the order its type
 * declares, nothing cut. Throws when the data does not fit its types (the
 * wallet could not sign it either). Pure.
 * @param {object} domain
 * @param {object} types - without EIP712Domain
 * @param {object} value
 * @returns {{primaryType: string, body: string, grantee: string|null}}
 */
const describeTypedData = (domain, types, value) => {
  ethers.TypedDataEncoder.hash(domain || {}, types, value); // refuses anything the wallet could not sign
  const { primaryType } = ethers.TypedDataEncoder.from(types);
  const lines = typedLines(types, primaryType, value, '', 0);
  const granted = types[primaryType].find((f) => GRANT_FIELDS.includes(f.name) && f.type === 'address');
  return {
    primaryType,
    body: [primaryType, ...lines.slice(1)].join('\n'),
    grantee: granted || /permit/i.test(primaryType) ? String(value[granted?.name ?? 'spender'] ?? 'another address') : null,
  };
};

module.exports = { readMessage, parseSignIn, describeTypedData };
