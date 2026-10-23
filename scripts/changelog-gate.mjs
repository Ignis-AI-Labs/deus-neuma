#!/usr/bin/env node
// changelog-gate — the commit-msg hook's second check: a commit that changes the product carries
// its changelog line (scripts/changelog-rules.js). // impure (git, fs)
//
//   node scripts/changelog-gate.mjs <commit-message-file>

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { changelogVerdict } from './changelog-rules.js';

const file = process.argv[2];
if (!file) process.exit(0);
const message = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n');
// Under `git commit -- <paths>` the hook's index is git's temporary one, so this names exactly
// what the commit holds.
const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' })
  .split('\n').filter(Boolean);
const verdict = changelogVerdict({ message, staged });
if (!verdict.ok) {
  process.stderr.write(`\n✗ changelog gate: ${verdict.why}\n\n`);
  process.exit(1);
}
