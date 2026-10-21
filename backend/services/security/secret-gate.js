// Secret gate — nothing secret leaves this machine through git.
//
// 2026-04-14, commit 422f95aff: an AI session wrote audit notes that quoted
// the live values out of .env — the deployer wallet key, the Alchemy RPC key,
// the OpenAI, Anthropic and xAI keys — and the notes were committed and
// pushed. The .env files were gitignored the whole time; ignoring a FILE
// guards nothing once its VALUES are copied into another one. Nothing
// between […] and […] ever looked.
//
// So the gate looks at what is about to be committed or pushed, two ways:
//
//   1. LIVE VALUES — every secret-named value in this checkout's env-style
//      files (.env, .env.*, env.*, *.env — at the root, and any git ignores
//      deeper in) and in the machine's secret stores (secret-sources.js). Any
//      added line, file name or tag message that contains one — as is, or
//      base64-, hex- or URL-encoded — in any file, is refused. No allowlist, no marker, no
//      exception: a live secret is never legitimate in history. This is the
//      check that makes the 422f95aff class impossible, because it does not
//      depend on recognising the key's shape.
//   2. SHAPES — the secret sweep's own rules (secret-sweep.js), for a key
//      that is not in any local env file (pasted from a dashboard, another
//      machine). The sweep's allowlist applies (examples, test fixtures,
//      vendored libraries), and the public Anvil dev keys are skipped.
//
// Findings name the file, line, and the variable or rule — never the value.
// Pure throughout; scripts/secret-gate.mjs does the reading and the git.

import { SECRET_PATTERNS, scanLine, isAllowlisted } from './secret-sweep.js';

// A variable whose name says it holds a credential. ADDRESS is public by
// nature and excluded; anything else that merely LOOKS like a key is caught by
// the shape rules below.
// Widened 2026-10-20 after a recheck slipped *_PK, SMTP_PASS and *_BEARER past it.
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|MNEMONIC|SEED|CREDENTIALS?|AUTH|RPC_URL|WEBHOOK(_URL)?|DSN|COOKIE|SESSION|BEARER|CLIENT_SECRET|SIGNING|_PK$|(^|_)PASS(WORD|PHRASE)?($|_))/i;
const PUBLIC_NAME = /(ADDRESS|_PATH|_FILE|_DIR|_ROOT|_PORT|_HOST|_MODE|_ENABLED|_MODEL)$/i;

// Shorter than this, a value is a flag or a word, and would match honest text.
const MIN_SECRET_LENGTH = 12;

// pure — is this env-style file name one the gate reads secrets from? Code
// that happens to be named env.* (env.js, env.py — vendored all through
// node_modules and venvs) is not: its `NAME = expr` lines are not values.
export const isEnvFileName = (name) => (
  /^\.env(\..+)?$/.test(name) || /^env\..+/.test(name) || /.+\.env$/.test(name)
) && !/\.(example|sample|template)$/.test(name)
  && !/\.(c?js|mjs|tsx?|jsx|map|py[co]?|h|hpp|cc?|cpp|rs|go|rb|java|sh)$/.test(name);

// pure — strip quotes and an inline comment from one env value.
const cleanValue = (raw) => {
  const trimmed = raw.trim();
  const quoted = trimmed.match(/^(["'])(.*)\1$/);
  if (quoted) return quoted[2];
  return trimmed.replace(/\s+#.*$/, '');
};

// pure — the pieces of one value that would identify it if quoted alone. A
// plain value is itself. A URL is a secret only through what it carries — a
// long path segment (an RPC URL's key), a query value, a password — and each
// of those is guarded alone too, since quoting only the key still leaks it. A
// URL that carries none (https://mainnet.base.org) is a public endpoint.
const piecesOf = (value) => {
  let url;
  try { url = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? new URL(value) : null; } catch { url = null; }
  if (!url) return value.length >= MIN_SECRET_LENGTH ? [value] : [];
  const carried = [
    ...url.pathname.split('/').filter((part) => part.length >= 16),
    ...[...url.searchParams.values()].filter((v) => v.length >= 16),
    ...(url.password && url.password.length >= MIN_SECRET_LENGTH ? [url.password] : []),
  ];
  return carried.length ? [value, ...carried] : [];
};

/**
 * The live secrets in a set of env-style files. Pure.
 * @param {Array<{file: string, text: string}>} envFiles
 * @returns {Array<{value: string, name: string, file: string}>}
 */
export const liveSecretsFrom = (envFiles) => {
  const secrets = [];
  for (const { file, text } of envFiles) {
    for (const line of String(text).split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const [, name, raw] = m;
      const value = cleanValue(raw);
      if (value.length < MIN_SECRET_LENGTH || /^(\/|\.\/|~\/|[a-z]+:\/\/(localhost|127\.0\.0\.1)[:/])/.test(value)) continue;
      const named = SECRET_NAME.test(name) && !PUBLIC_NAME.test(name);
      const shaped = SECRET_PATTERNS.some(({ regex }) => regex.test(line));
      if (!named && !shaped) continue;
      for (const piece of piecesOf(value)) secrets.push({ value: piece, name, file });
    }
  }
  return secrets;
};

// pure — a path as git prints it in a header, its quotes, side prefix and the
// tab git appends to a name with a space in it off.
const headerPath = (raw) => raw.replace(/\t$/, '').replace(/^"(.*)"$/, '$1').replace(/^[ab]\//, '');

// pure — the new path out of `diff --git a/P b/P`, for a new file that has no
// `+++` row (an empty one). Same path twice, so its length is fixed; anything
// else (quoted, renamed) comes back whole, which still holds the name as text.
const pathOfGitHeader = (rest) => {
  const half = (rest.length - 5) / 2;
  return Number.isInteger(half) && rest.startsWith('a/') && rest.slice(half + 2, half + 5) === ' b/'
    ? rest.slice(2, half + 2) : rest;
};

/**
 * Added lines out of a unified diff (`git diff -U0` / `git log -p -U0`), with
 * the file, its new line number and the commit when the diff is a log. A new,
 * renamed or copied file's NAME is an added line too (line 0): a value can be
 * leaked as a file name. Headers are read only where git writes them — after
 * `diff --git`, before the first `@@` — because an added content line that
 * itself begins `++ ` arrives as `+++ …` and once passed for a header. Pure.
 * @param {string} diff
 * @returns {Array<{file: string, line: number, text: string, commit: string|null}>}
 */
export const addedLinesOf = (diff) => {
  const added = [];
  let file = null;
  let line = 0;
  let commit = null;
  let header = null; // {rest, fresh, renamed} while inside a file's header
  const closeHeader = () => {
    if (header && header.fresh) {
      const name = header.renamed || file || pathOfGitHeader(header.rest);
      added.push({ file: name, line: 0, text: header.renamed ? `${header.rest} ${header.renamed}` : header.rest, commit });
    }
    header = null;
  };
  for (const row of String(diff).split('\n')) {
    const commitRow = row.match(/^commit ([0-9a-f]{40})$/);
    if (commitRow) { closeHeader(); commit = commitRow[1]; file = null; continue; }
    if (row.startsWith('diff --git ')) { closeHeader(); header = { rest: row.slice(11), fresh: false, renamed: null }; file = null; continue; }
    const hunk = row.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      if (row.startsWith('new file mode ')) header.fresh = true;
      const moved = row.match(/^(?:rename|copy) to (.*)$/);
      if (moved) { header.fresh = true; header.renamed = headerPath(moved[1]); }
      if (row.startsWith('+++ ')) file = row === '+++ /dev/null' ? null : headerPath(row.slice(4));
      if (hunk) { closeHeader(); line = Number(hunk[1]); }
      continue;
    }
    if (hunk) { line = Number(hunk[1]); continue; }
    if (file && row.startsWith('+')) { added.push({ file, line, text: row.slice(1), commit }); line += 1; }
  }
  closeHeader();
  return added;
};

// pure — the base64 text that stands for these bytes wherever they sit in a
// longer encoded run (a Basic-auth header is base64 of "user:token"): one
// form per alignment, trimmed to the characters only these bytes decide.
const alignedBase64 = (bytes, encoding) => [0, 1, 2].map((lead) => {
  const text = Buffer.concat([Buffer.alloc(lead), bytes]).toString(encoding);
  return text.slice(Math.ceil((lead * 8) / 6), Math.floor(((lead + bytes.length) * 8) / 6));
});

/**
 * Each live value plus the encodings it realistically travels in — base64,
 * base64url, hex and URL-encoding — computed once, so the judge stays a plain
 * substring test. Not split lines, reversals or escapes: those are deliberate
 * hiding, not a session quoting what it saw. Pure.
 * @param {Array<{value: string, name: string, file: string}>} secrets
 * @returns {Array<{value: string, name: string, file: string, encoding?: string}>}
 */
export const withEncodings = (secrets) => {
  const seen = new Set();
  const out = [];
  const add = (secret, value, encoding) => {
    if (value.length < MIN_SECRET_LENGTH || seen.has(value)) return;
    seen.add(value);
    out.push(encoding ? { ...secret, value, encoding } : { ...secret, value });
  };
  for (const secret of secrets) add(secret, secret.value, null);
  for (const secret of secrets) {
    const bytes = Buffer.from(secret.value, 'utf8');
    for (const form of alignedBase64(bytes, 'base64')) add(secret, form, 'base64');
    for (const form of alignedBase64(bytes, 'base64url')) add(secret, form, 'base64url');
    add(secret, bytes.toString('hex'), 'hex');
    add(secret, bytes.toString('hex').toUpperCase(), 'hex');
    add(secret, encodeURIComponent(secret.value), 'URL-encoded');
  }
  return out;
};

/**
 * A path as the refusal may print it. A path is printed, and a path can BE
 * the leak: any live value in it is withheld, and a key-shaped one is not
 * shown at all. Pure.
 * @param {string} file
 * @param {Array<{value: string}>} secrets
 * @returns {string}
 */
export const withheldPath = (file, secrets) => (scanLine(file).length ? '(a file whose name is shaped like a secret)'
  : secrets.reduce((at, s) => (at.includes(s.value) ? at.split(s.value).join('<live value withheld>') : at), file));

/**
 * Judge added lines. Live values block everywhere; shapes block outside the
 * sweep's allowlist. Never returns a value. Pure.
 * @param {Array<{file: string, line: number, text: string, commit: string|null}>} lines
 * @param {Array<{value: string, name: string, file: string}>} secrets
 * @returns {Array<{file: string, line: number, commit: string|null, kind: 'live'|'shape', what: string}>}
 */
export const judgeAddedLines = (lines, secrets) => {
  const findings = [];
  const shown = (file) => withheldPath(file, secrets);
  for (const { file, line, text, commit } of lines) {
    const live = secrets.find((s) => text.includes(s.value));
    if (live) {
      findings.push({ file: shown(file), line, commit, kind: 'live', what: `the live value of ${live.name} (from ${live.file})${live.encoding ? `, ${live.encoding}` : ''}` });
      continue;
    }
    if (isAllowlisted(file)) continue;
    for (const hit of scanLine(text)) findings.push({ file: shown(file), line, commit, kind: 'shape', what: `something shaped like a secret (${hit.patternId})` });
  }
  return findings;
};

/** pure — the refusal the operator (or agent) reads. Values never appear. */
export const refusalText = (findings, mode) => [
  '',
  `SECRET GATE — ${({ push: 'push', tree: 'export' })[mode] || 'commit'} refused: ${findings.length} line(s) would put a secret into git history.`,
  ...findings.slice(0, 40).map((f) => `  ${f.commit ? `${f.commit.slice(0, 9)} ` : ''}${f.file}${f.line ? `:${f.line}` : f.line === 0 ? ' (its name)' : ''} — ${f.what}`),
  findings.length > 40 ? `  …and ${findings.length - 40} more` : null,
  '',
  'Remove the value (reference the variable NAME instead), then try again.',
  'Once in a pushed commit, a key is public to everyone who can read the repo: it must be rotated, and deleting it later does not undo that.',
  '',
].filter((l) => l !== null).join('\n');
