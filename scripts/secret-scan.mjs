#!/usr/bin/env node
// THE SECRET GATE — CI's copy of the standing watch's own sweep.
//
// One implementation, one pattern table, one verdict: this runs
// `backend/services/security/secret-sweep.js`, the same module the CSO office's
// 24-hour watch runs (security-scheduler.js). A second scanner with a second
// ruleset would eventually disagree with the watch, and then neither would be
// trustworthy.
//
// Exists because #160 happened: on 2026-04-14 a sprint pasted a live OpenAI
// key, Anthropic key, xAI key, Alchemy RPC URL and the deployer's private key
// into an audit write-up, it was committed, and it reached origin. Nothing in
// CI could have stopped it, and the watch that would have caught it did not
// exist yet — and once it did, it exempted `docs/audit/` (fixed with this).
//
// Output carries the file, the line and the pattern id, NEVER the matched text
// (secret-sweep.js's own rule 1): a CI log that quotes the secret it found is a
// second leak, and CI logs are far more public than a working tree.
//
// Deliberately dependency-free — node + git only, no `npm ci` needed. A
// security gate that cannot run until an install succeeds is a gate that opens
// itself on the days it is most needed.
//
// Usage: node scripts/secret-scan.mjs [repoPath]
// Exit 0 = clean, 1 = findings, 2 = the sweep itself could not run.
//
// impure (spawns git, reads files, exits the process)

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { sweepRepo } from '../backend/services/security/secret-sweep.js';

const repoPath = resolve(process.argv[2] || dirname(dirname(fileURLToPath(import.meta.url))));

const { scanned, findings, error } = await sweepRepo({ id: 'checkout', path: repoPath });

if (error) {
  console.error(`secret-scan: the sweep could not run — ${error}`);
  process.exit(2);
}

if (findings.length === 0) {
  console.log(`secret-scan: ${scanned} tracked files, no secrets found.`);
  process.exit(0);
}

console.error(`secret-scan: ${findings.length} finding(s) in ${scanned} tracked files.\n`);
for (const { file, line, patternId } of findings) {
  console.error(`  ${file}:${line}  [${patternId}]`);
}
console.error(
  '\nThe matched text is deliberately not printed — read the line yourself.\n'
  + 'If it is a real credential: rotate it at the provider FIRST, then remove it.\n'
  + 'Redacting the working tree is not enough once a commit exists (#160).\n'
  + 'If it is a placeholder, give it a shape no pattern matches — the archive\n'
  + 'convention is to replace the value entirely, e.g. `sk-proj-…REDACTED`.',
);
process.exit(1);
