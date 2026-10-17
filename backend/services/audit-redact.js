/**
 * Audit redaction — turn a tool call's arguments into something safe to write
 * down forever.
 *
 * The journal is durable and it feeds recall, so it is not the approval card.
 * A witness looking at an approval preview is the operator glancing at their
 * own secret for one second; the journal is that same secret sitting on disk
 * for the life of the being and liable to be recalled into a later prompt.
 * Those are different acts, so they get different treatment: the preview shows
 * args whole (`tool-approval.js`), this scrubs them first.
 *
 * Two independent screens, because neither alone is enough:
 *
 *   BY KEY   — `password`, `token`, `apiKey`, `authorization`, `mnemonic`… A
 *              value is a secret because of the slot it sits in, whatever it
 *              looks like. This catches a weak or short credential.
 *   BY SHAPE — PEM blocks, `Bearer …`, JWTs, AWS/GitHub/OpenAI key prefixes,
 *              long high-entropy hex. A secret is a secret in a slot named
 *              `value` or `body` too. This catches a credential smuggled
 *              through an innocent key.
 *
 * Everything else is KEPT, because the point of the record is to answer […] — a `write_file` whose path is redacted is no audit trail at
 * all. Long values (a file's whole content) are cut to a head plus an honest
 * length, so the journal stays a ledger and never becomes a copy of the disk.
 */

/**
 * Slots whose value is a credential regardless of its shape. Matched per WORD,
 * not per substring: `monkey` and `keyword` are not keys, `apiKey` and
 * `session_token` are. `key` alone is on the list, so a benign arg named `key`
 * is redacted too — that is the safe direction to be wrong in.
 *
 * `session` is deliberately ABSENT: a `sessionId` is forensically useful and
 * not itself a credential, while a `sessionToken` is already caught by `token`.
 */
const SECRET_WORDS = new Set([
  'auth', 'authorization', 'bearer', 'cookie', 'credential', 'credentials',
  'dek', 'jwt', 'key', 'mnemonic', 'pass', 'passphrase', 'passwd', 'password',
  'privkey', 'private', 'pw', 'pwd', 'salt', 'secret', 'seed', 'signature',
  'token',
]);

// Pure — split a key into words across camelCase, snake_case, and kebab-case.
const keyWords = (key) => String(key)
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .split(/[^A-Za-z0-9]+/)
  .filter(Boolean)
  .map((word) => word.toLowerCase());

/** Shapes that are a credential wherever they appear. */
const SECRET_SHAPE = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,          // JWT
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,                           // AWS access key id
  /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}/,            // GitHub
  /\bsk-[A-Za-z0-9_-]{20,}/,                                 // OpenAI-style
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,                         // Slack
  /\b0x[0-9a-fA-F]{64}\b/,                                   // 32-byte hex — a private key
];

const REDACTED = '[redacted]';

/** One value is kept in full up to this; past it the head plus a length. */
export const VALUE_HEAD_CHARS = 200;
/** The whole redacted record is capped here — a ledger line, not an archive. */
export const RECORD_MAX_CHARS = 2000;
const MAX_DEPTH = 4;
const MAX_KEYS = 40;
const MAX_ITEMS = 20;

/** Pure — does this string carry a credential by shape alone? */
export const looksSecret = (value) =>
  typeof value === 'string' && SECRET_SHAPE.some((re) => re.test(value));

/** Pure — is this key a slot that holds a credential? */
export const isSecretKey = (key) => keyWords(key).some((word) => SECRET_WORDS.has(word));

// Pure — keep the head of a long value and say honestly how much was cut, so a
// reader never mistakes a truncated path for the whole path.
const clampValue = (text) => (text.length <= VALUE_HEAD_CHARS
  ? text
  : `${text.slice(0, VALUE_HEAD_CHARS)}… [+${text.length - VALUE_HEAD_CHARS} chars]`);

// Pure — recursive scrub. Depth, key count, and array length are all bounded:
// a hostile or merely enormous argument object must cost a fixed amount.
const scrub = (value, depth) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return looksSecret(value) ? REDACTED : clampValue(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[depth capped]';

  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ITEMS).map((item) => scrub(item, depth + 1));
    return value.length > MAX_ITEMS ? [...head, `[+${value.length - MAX_ITEMS} more]`] : head;
  }
  if (typeof value !== 'object') return String(typeof value);

  const out = {};
  const keys = Object.keys(value);
  for (const key of keys.slice(0, MAX_KEYS)) {
    out[key] = isSecretKey(key) ? REDACTED : scrub(value[key], depth + 1);
  }
  if (keys.length > MAX_KEYS) out['[+more]'] = keys.length - MAX_KEYS;
  return out;
};

/**
 * Render tool args as a bounded, secret-free record for the journal. Pure.
 *
 * @param {*} args - parsed tool call args (any shape; hostile input expected)
 * @returns {string|null} JSON record, or null when there is nothing to record
 */
export const redactArgs = (args) => {
  if (!args || typeof args !== 'object' || Object.keys(args).length === 0) return null;
  let text;
  try {
    text = JSON.stringify(scrub(args, 0));
  } catch {
    // A cyclic or unserializable argument object still owes the ledger a line.
    return '[unserializable args]';
  }
  if (typeof text !== 'string') return null;
  return text.length > RECORD_MAX_CHARS
    ? `${text.slice(0, RECORD_MAX_CHARS)}… [record capped]`
    : text;
};
