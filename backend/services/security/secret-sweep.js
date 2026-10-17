// Secret sweep — the […] law, enforced over every
// watched repo: the TRACKED file set (`git ls-files`, so .gitignore is
// honored by construction) scanned for high-signal secret patterns.
//
// Two rules make this sweep honest:
//   1. Findings carry the file, the line, and the pattern id — NEVER the
//      matched text. A report that quotes the secret it found is a second
//      leak wearing a badge.
//   2. The pattern table is deliberately narrow. Every entry is a shape that
//      is a secret or is nothing — no generic `password = "..."` guessing
//      that buries real findings under false ones.
//
// Read-only over the target repo by law: the sweep never writes inside a
// watched checkout.

import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';

const execFileP = promisify(execFile);

const MAX_FILE_BYTES = 1024 * 1024;
const BINARY_PROBE_BYTES = 8192;

// The frozen pattern table. Each id names a class; each regex is anchored to
// shapes that do not occur in honest code or data (a tx hash is 64 hex but
// never follows `PRIVATE_KEY=`).
export const SECRET_PATTERNS = Object.freeze([
  Object.freeze({ id: 'private-key-block', regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ }),
  Object.freeze({ id: 'evm-private-key', regex: /(?:PRIVATE[_-]?KEY|SECRET[_-]?KEY|MNEMONIC|SEED[_-]?PHRASE)["'\s:=]+0x[0-9a-fA-F]{64}\b/i }),
  Object.freeze({ id: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}/ }),
  Object.freeze({ id: 'openai-key', regex: /\bsk-[A-Za-z0-9_-]{20,}/ }),
  // Slack's real shape: the prefix is followed by a NUMERIC workspace id
  // (10-13 digits in practice) before the secret segment. The looser
  // `xox[baprs]-[A-Za-z0-9-]{10,}` matched any dashed word run, so a UI
  // placeholder string (`authPlaceholder: 'xoxb-your-token…'`) reported as a
  // live token — which violates this table's own law that an entry is a shape
  // that is a secret or is nothing. A finding nobody can act on teaches
  // everyone to skip the report.
  Object.freeze({ id: 'slack-token', regex: /\bxox[baprs]-\d{6,}-[A-Za-z0-9-]{10,}/ }),
  Object.freeze({ id: 'aws-access-key', regex: /\bAKIA[0-9A-Z]{16}\b/ }),
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
  /\.(min\.(js|css)|lock|png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|mp3|mp4|webm|opus|wav|bvh|vrm|glb|gltf|pdf|zip|gz|onnx|wasm|snap|jpg_large)$/,
]);

// pure
export const isAllowlisted = (path) => ALLOWLIST.some((re) => re.test(path));

/**
 * pure — scan one text document; returns [{line, patternId}] with the
 * matched text itself deliberately dropped.
 */
export const scanText = (text) => {
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const { id, regex } of SECRET_PATTERNS) {
      if (regex.test(line)) findings.push({ line: i + 1, patternId: id });
    }
  });
  return findings;
};

// impure — one file's findings, or [] for binary/oversized/unreadable.
const sweepFile = async (repoPath, rel) => {
  const full = join(repoPath, rel);
  const stat = await fs.stat(full).catch(() => null);
  if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) return [];
  const handle = await fs.open(full, 'r').catch(() => null);
  if (!handle) return [];
  try {
    const probe = Buffer.alloc(BINARY_PROBE_BYTES);
    const { bytesRead } = await handle.read(probe, 0, BINARY_PROBE_BYTES, 0);
    if (probe.subarray(0, bytesRead).includes(0)) return []; // binary
    const text = await fs.readFile(full, 'utf8');
    return scanText(text).map((f) => ({ file: rel, ...f }));
  } finally {
    await handle.close();
  }
};

/**
 * Sweep one watched repo's tracked files. Never throws — a repo that cannot
 * be listed lands as an honest error on the summary.
 *
 * impure — spawns git, reads files
 * @param {{id: string, path: string}} repo
 * @returns {Promise<{repo: string, scanned: number, findings: Array<{file: string, line: number, patternId: string}>, error: string|null}>}
 */
export const sweepRepo = async (repo) => {
  let listed;
  try {
    const { stdout } = await execFileP('git', ['ls-files', '-z'], { cwd: repo.path, maxBuffer: 32 * 1024 * 1024 });
    listed = stdout.split('\0').filter(Boolean);
  } catch (err) {
    return { repo: repo.id, scanned: 0, findings: [], error: `git ls-files failed: ${err.message}` };
  }
  const targets = listed.filter((rel) => !isAllowlisted(rel));
  const findings = [];
  for (const rel of targets) {
    findings.push(...await sweepFile(repo.path, rel));
  }
  return { repo: repo.id, scanned: targets.length, findings, error: null };
};

// pure — sweep findings as ledger-ready threat shapes (dedup key: one entry
// per file+pattern, so a fixed leak stops refreshing the moment it is gone).
export const sweepFindingsAsThreats = (repo, findings) =>
  findings.map((f) => ({
    layer: 'software',
    source: 'secret-sweep',
    repo: repo.id,
    externalId: `sweep:${f.patternId}:${f.file}:${f.line}`,
    title: `possible exposed secret (${f.patternId}) in ${f.file}`,
    severity: 'high',
    summary: `The secret sweep matched "${f.patternId}" at ${f.file}:${f.line}. The matched text is deliberately not recorded. Verify by hand; if real, rotate the credential FIRST, then purge it from history — deleting the line alone leaves it in git.`,
    surfaces: [f.file],
  }));
