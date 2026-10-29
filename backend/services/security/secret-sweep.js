// Secret sweep — the […] law, enforced over every
// watched repo: the TRACKED content (the index and HEAD, read from git's own
// objects — tracked-blobs.js — so .gitignore is honored by construction and
// no working-tree trick hides a committed file) scanned for high-signal
// secret patterns. A blob it cannot read makes the sweep say so (`error`),
// and an errored sweep is never a whole scope: the watch closes and verifies
// nothing on a blind read.
//
// Two rules make this sweep honest:
//   1. Findings carry the file, the line, the pattern id and a short one-way
//      fingerprint of the value — NEVER the matched text. A report that
//      quotes the secret it found is a second leak wearing a badge.
//   2. The pattern table is deliberately narrow. Every entry is a shape that
//      is a secret or is nothing — no generic `password = "..."` guessing
//      that buries real findings under false ones.
//
// Read-only over the target repo by law: the sweep never writes inside a
// watched checkout.

import fs from 'fs/promises';
import { createHash } from 'crypto';
import { isPublicDevKey } from './public-dev-keys.js';
import { listTrackedBlobs, readBlobs } from './tracked-blobs.js';

// The commit gate's cap (scripts/secret-gate.mjs): past it a blob is not read,
// and the sweep reports itself blind rather than clean.
const MAX_BLOB_BYTES = 16 * 1024 * 1024;
const UNREAD_NAMED = 5;

// The frozen pattern table. Each id names a class; each regex is anchored to
// shapes that do not occur in honest code or data (a tx hash is 64 hex but
// never follows `PRIVATE_KEY=`). `ere` is the same shape in POSIX ERE, read
// case-insensitively — a looser prefilter the history sweep hands to git's
// pickaxe (git has no JS regex); the `regex` stays the only judge.
export const SECRET_PATTERNS = Object.freeze([
  Object.freeze({
    id: 'private-key-block',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/,
    ere: '-----BEGIN (RSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY',
  }),
  Object.freeze({
    id: 'evm-private-key',
    regex: /(?:PRIVATE[_-]?KEY|SECRET[_-]?KEY|MNEMONIC|SEED[_-]?PHRASE)["'\s:=]+(0x[0-9a-fA-F]{64})\b/i,
    ere: '(PRIVATE[_-]?KEY|SECRET[_-]?KEY|MNEMONIC|SEED[_-]?PHRASE)["\'[:space:]:=]+0x[0-9a-f]{64}',
  }),
  Object.freeze({ id: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}/, ere: 'gh[pousr]_[a-z0-9]{36}' }),
  // Anthropic keys share OpenAI's sk- prefix; named apart so a leak's remedy
  // sends the operator to the right console.
  Object.freeze({ id: 'anthropic-key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/, ere: 'sk-ant-[a-z0-9_-]{20}' }),
  Object.freeze({ id: 'openai-key', regex: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}/, ere: 'sk-[a-z0-9_-]{20}' }),
  // Slack's real shape: the prefix is followed by a NUMERIC workspace id
  // (10-13 digits in practice) before the secret segment. The looser
  // `xox[baprs]-[A-Za-z0-9-]{10,}` matched any dashed word run, so a UI
  // placeholder string (`authPlaceholder: 'xoxb-your-token…'`) reported as a
  // live token — which violates this table's own law that an entry is a shape
  // that is a secret or is nothing. A finding nobody can act on teaches
  // everyone to skip the report.
  Object.freeze({ id: 'slack-token', regex: /\bxox[baprs]-\d{6,}-[A-Za-z0-9-]{10,}/, ere: 'xox[baprs]-[0-9]{6,}-[a-z0-9-]{10}' }),
  Object.freeze({ id: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/, ere: 'AKIA[0-9A-Z]{16}' }),
  // xAI keys and RPC URLs that carry their key in the path both leaked in
  // 2026-04 and no rule above saw either one.
  Object.freeze({ id: 'xai-key', regex: /\bxai-[A-Za-z0-9]{40,}/, ere: 'xai-[a-z0-9]{40}' }),
  Object.freeze({
    id: 'rpc-url-key',
    // a host label starts where a run of label characters starts, and is at most 63 long: the open
    // \b[a-z0-9-]+ retried from every character of a long run, quadratic (re-audit 2026-10-29, NEW-M7)
    regex: /(?<![a-z0-9-])[a-z0-9-]{1,63}\.(?:g\.alchemy\.com|infura\.io|quiknode\.pro)\/(?:v2\/|v3\/)?[A-Za-z0-9_-]{20,}/i,
    ere: '(alchemy[.]com|infura[.]io|quiknode[.]pro)/(v2/|v3/)?[a-z0-9_-]{20}',
  }),
]);

// pure — paths the sweep never reports: examples meant to hold placeholders,
// test fixtures (which plant fakes on purpose), lockfiles and minified
// bundles (hash-dense, never operator-authored), and binary media.
//
// `docs/audit/` was on this list until 2026-08-13 (#160), exempted because
// audit write-ups quote remediated shapes. That exemption made the ONE
// directory secrets were actually leaked into the one place the standing watch
// could not see: on 2026-04-14 a sprint pasted a live OpenAI key, Anthropic
// key, xAI key, Alchemy RPC URL and the deployer's 64-hex private key into
// `docs/audit/archive/sector-infrastructure.md`, and it reached origin. The
// exemption is gone, and it cost nothing: all 39 tracked files under
// `docs/audit/` scan CLEAN, because a remediated quote is written
// `sk-proj-…REDACTED` — the value is replaced, so no pattern can match it.
// An archive that quotes a LIVE secret is now a finding, which is the only
// honest verdict for one.
const ALLOWLIST = Object.freeze([
  /\.(example|sample|template)$/,
  /(^|\/)test\//,
  /(^|\/)scripts\/verify-clean-host\.sh$/,
  /package-lock\.json$/,
  // Vendored upstream libraries (Foundry's lib/ submodules, a checked-in
  // node_modules): their code is not where this house's secrets live, and
  // forge-std ships public demo RPC keys that every Foundry repo carries.
  /(^|\/)lib\/forge-std\//,
  /(^|\/)node_modules\//,
  /\.(min\.(js|css)|lock|png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|mp3|mp4|webm|opus|wav|bvh|vrm|glb|gltf|pdf|zip|gz|onnx|wasm|snap|jpg_large)$/,
]);

// pure
export const isAllowlisted = (path) => ALLOWLIST.some((re) => re.test(path));

// pure — a short one-way tag for a matched value: it tells two values apart
// across scans (so a moved line is the same finding) and cannot give the
// value back (8 hex of a sha256 over a high-entropy secret).
const fingerprintOf = (material) => createHash('sha256').update(material).digest('hex').slice(0, 8);

// pure — the material a match stands for. An EVM key is its hex alone, so a
// renamed variable is not a new finding; a PEM header is the same for every
// key, so the first body line is what tells two keys apart.
const materialOf = (patternId, match, nextLine) => {
  if (patternId === 'private-key-block') return `${match[0]}\n${String(nextLine || '').trim()}`;
  return match[1] || match[0];
};

/**
 * pure — scan one line; returns [{patternId, fingerprint}], the matched text
 * itself deliberately dropped. `nextLine` lets a PEM header be told apart
 * from another key's.
 * @param {string} line
 * @param {string} [nextLine]
 * @returns {Array<{patternId: string, fingerprint: string}>}
 */
export const scanLine = (line, nextLine = '') => {
  const hits = [];
  for (const { id, regex } of SECRET_PATTERNS) {
    // The ten published Anvil/Hardhat dev keys are skipped: public by design,
    // they guard nothing, and reporting them hid the findings that do. Every
    // key on the line is read, so a dev key first never hides a real one
    // after it (re-audit 2026-10-29, NEW-L3).
    const match = id === 'evm-private-key'
      ? [...line.matchAll(new RegExp(regex.source, `${regex.flags}g`))].find((m) => !isPublicDevKey(m[1]))
      : regex.exec(line);
    if (!match) continue;
    hits.push({ patternId: id, fingerprint: fingerprintOf(materialOf(id, match, nextLine)) });
  }
  return hits;
};

/**
 * pure — scan one text document; returns [{line, patternId, fingerprint}]
 * with the matched text itself deliberately dropped. Also the shape an
 * outbound scan uses: any hit means the text carries a secret.
 * @param {string} text
 */
export const scanText = (text) => {
  const lines = String(text).split('\n');
  return lines.flatMap((line, i) => scanLine(line, lines[i + 1]).map((hit) => ({ line: i + 1, ...hit })));
};

// pure — one finding per file + pattern + value: a path whose index and HEAD
// blobs differ is read twice, and the index (listed first) names the line.
const uniqueFindings = (findings) => {
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.file}\0${f.patternId}\0${f.fingerprint}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Sweep one watched repo's tracked content. Never throws — a repo that
 * cannot be listed or read lands as an honest error on the summary.
 * Every blob is read as text, a binary one too: a key inside a committed
 * binary is as public as one in a README.
 *
 * impure — spawns git
 * @param {{id: string, path: string}} repo
 * @returns {Promise<{repo: string, scanned: number, findings: Array<{file: string, line: number, patternId: string, fingerprint: string}>, error: string|null}>}
 */
export const sweepRepo = async (repo) => {
  // A missing checkout must say so: git's own answer is "spawn git ENOENT",
  // which reads as a broken git rather than a repo that moved.
  const at = await fs.stat(repo.path).catch(() => null);
  if (!at?.isDirectory()) return { repo: repo.id, scanned: 0, findings: [], error: `watched repo path is gone: ${repo.path}` };
  let targets;
  try {
    targets = (await listTrackedBlobs(repo.path)).filter(({ path }) => !isAllowlisted(path));
  } catch (err) {
    return { repo: repo.id, scanned: 0, findings: [], error: `git could not list the tracked files: ${err.message}` };
  }
  const pathsOf = new Map();
  for (const { path, sha } of targets) pathsOf.set(sha, [...(pathsOf.get(sha) || []), path]);
  const findings = [];
  const unread = [];
  try {
    await readBlobs(repo.path, [...pathsOf.keys()], {
      maxBytes: MAX_BLOB_BYTES,
      onBlob: (sha, bytes) => {
        const hits = scanText(bytes.toString('utf8'));
        for (const file of pathsOf.get(sha)) findings.push(...hits.map((hit) => ({ file, ...hit })));
      },
      onUnread: (sha, why) => unread.push(...pathsOf.get(sha).map((file) => `${file} (${why})`)),
    });
  } catch (err) {
    return { repo: repo.id, scanned: 0, findings: [], error: `git could not read the tracked files: ${err.message}` };
  }
  const scanned = new Set(targets.map(({ path }) => path)).size;
  const error = unread.length
    ? `${unread.length} tracked file(s) could not be read, so this sweep is not whole: ${unread.slice(0, UNREAD_NAMED).join(', ')}${unread.length > UNREAD_NAMED ? ', …' : ''}`
    : null;
  return { repo: repo.id, scanned, findings: uniqueFindings(findings), error };
};

// pure — sweep findings as ledger-ready threat shapes. The dedup key is
// file + pattern + value fingerprint, never the line: an edit above a hit
// used to mint a fresh entry and orphan the old one.
export const sweepFindingsAsThreats = (repo, findings) =>
  findings.map((f) => ({
    layer: 'software',
    source: 'secret-sweep',
    repo: repo.id,
    externalId: `sweep:${f.patternId}:${f.file}:${f.fingerprint}`,
    title: `possible exposed secret (${f.patternId}) in ${f.file}`,
    severity: 'high',
    summary: `The secret sweep matched "${f.patternId}" at ${f.file}:${f.line}. The matched text is deliberately not recorded. Verify by hand; if real, rotate the credential FIRST, then purge it from history — deleting the line alone leaves it in git.`,
    surfaces: [f.file],
  }));
