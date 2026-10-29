// Secret sources — WHERE this machine's live secret values sit, read as the
// env-style {file, text} list liveSecretsFrom (secret-gate.js) takes.
//
// The 2026-10-20 recheck pushed a value out of backend/.env, and showed the
// packaged app's own keys (~/.neuma/secrets.json: authSecret,
// dnaEncryptionKey — raw hex, no shape rule knows them) were never guarded:
// the gate read only the env files at the checkout root. So the sources are:
//
//   1. every env-style file at the checkout root, ignored or not;
//   2. every env-style file deeper in that git IGNORES — an ignored file is
//      exactly where a live value lives (a tracked one is public already);
//   3. the machine's secret stores outside the repo: ~/.neuma/secrets.json
//      and NEUMA_SECRETS_FILE — each JSON string under a secret-ish key,
//      rendered as a NAME=value line so one parser reads every source.
//
// Symlinks are followed (a linked .env holds the same live value). A source
// that exists but cannot be read THROWS: callers decide, and the gate refuses
// rather than guard less than it claims. Shared by the gate and the leak
// liveness check (leak-liveness.js), so both mean the same "live".
// impure — reads files and runs git.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { isEnvFileName } from './secret-gate.js';
import { UNTRUSTED_GIT_ARGS, untrustedGitEnv } from '../untrusted-git.js';

// Any key on the way to a value that says it holds one (privateKey,
// authSecret, apiKeys.openai, dnaEncryptionKey, smtpPassword, accessToken).
const SECRETISH_KEY = /(key|secret|token|password)/i;

const GONE = new Set(['ENOENT', 'ENOTDIR', 'ELOOP']);

// pure — dnaEncryptionKey / api-keys.openai → DNA_ENCRYPTION_KEY / API_KEYS_OPENAI,
// so the gate's name rules (PUBLIC_NAME's _PATH, _FILE…) read a JSON key as an env name.
const envNameOf = (segments) => segments
  .map((s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_'))
  .join('_').replace(/^_+|_+$/g, '').toUpperCase() || 'VALUE';

/**
 * A JSON secret store as env-style text: one NAME=value line per string that
 * sits under a secret-ish key (a multi-line string gives one line per line).
 * Pure.
 * @param {unknown} json
 * @returns {string}
 */
const envTextOfJson = (json) => {
  const lines = [];
  const walk = (node, trail, secretish) => {
    if (typeof node === 'string') {
      if (secretish) for (const part of node.split(/\r?\n/)) lines.push(`${envNameOf(trail)}=${part}`);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) walk(value, [...trail, key], secretish || SECRETISH_KEY.test(key));
  };
  walk(json, [], false);
  return lines.join('\n');
};

// impure — the text of one source, or null when it is not there (missing, a
// dangling link, a directory). Anything else unreadable throws.
const readSource = (full) => {
  try {
    if (!fs.statSync(full).isFile()) return null;
    return fs.readFileSync(full, 'utf8');
  } catch (error) {
    if (GONE.has(error.code)) return null;
    throw new Error(`secret source ${full} could not be read (${error.code || error.message})`, { cause: error });
  }
};

/** impure — the secret store paths this machine uses, de-duplicated. */
const secretStorePaths = () => [...new Set(
  [path.join(os.homedir(), '.neuma', 'secrets.json'), process.env.NEUMA_SECRETS_FILE]
    .filter(Boolean).map((p) => path.resolve(p)),
)];

// impure — env-style files under a checkout: the root's, plus every ignored one deeper.
const envFilesUnder = (repoRoot) => {
  const root = fs.readdirSync(repoRoot).filter(isEnvFileName);
  const ignored = execFileSync('git', [...UNTRUSTED_GIT_ARGS, '-C', repoRoot, 'ls-files', '-z', '--others', '--ignored', '--exclude-standard'],
    { encoding: 'utf8', env: untrustedGitEnv(), maxBuffer: 1024 * 1024 * 1024 })
    .split('\0').filter((rel) => rel && isEnvFileName(path.basename(rel)));
  return [...new Set([...root, ...ignored])];
};

/**
 * Every live secret source for a checkout, as {file, text} — repo files
 * labelled by their path in the checkout, stores by their path (~ for home).
 * Throws if git cannot list the checkout or a source exists but cannot be read.
 * @param {string} repoRoot the checkout's top level
 * @returns {Array<{file: string, text: string}>}
 */
export const collectLiveSecretSources = (repoRoot) => {
  const sources = [];
  for (const rel of envFilesUnder(repoRoot)) {
    const text = readSource(path.join(repoRoot, rel));
    if (text !== null) sources.push({ file: rel, text });
  }
  const home = os.homedir();
  for (const store of secretStorePaths()) {
    const text = readSource(store);
    if (text === null) continue;
    let json;
    // (no cause attached: a JSON parse error quotes the text it choked on)
    try { json = JSON.parse(text); } catch { throw new Error(`secret store ${store} is not valid JSON`); }
    const file = store.startsWith(`${home}${path.sep}`) ? `~/${path.relative(home, store)}` : store;
    sources.push({ file, text: envTextOfJson(json) });
  }
  return sources;
};
