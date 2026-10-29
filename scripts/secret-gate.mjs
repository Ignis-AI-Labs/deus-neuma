#!/usr/bin/env node
// secret-gate.mjs — the git hooks' secret check (backend/services/security/secret-gate.js).
//
//   --staged          pre-commit: the lines this commit adds
//   --staged          pre-merge-commit too: a merge's own result, before it is recorded
//   --message <file>  commit-msg: the commit message itself (`-` = read it from stdin)
//   --push            pre-push: every commit the push sends — a merge's own
//                     changes against its first parent too — its diffs, file
//                     names and messages, and every annotated tag's message
//                     (refs on stdin, git's hook format)
//   --tree <dir>      every file under a directory, and its name (the public export, before it is pushed)
//   --names           the variable NAMES the gate guards (never values), for a human check
//
// Exit 1 refuses the commit or push. The gate fails CLOSED: if it cannot read
// the diff, a secret source, or a file too large to read (MAX_FILE_BYTES), it
// refuses, because a check that waves things through on error is how a key
// reaches GitHub. Diffs are forced to TEXT: a NUL byte or a `-diff`
// attribute once turned a file into "Binary files differ", unread.
// impure — reads the secret sources and runs git.

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  liveSecretsFrom, withEncodings, addedLinesOf, judgeAddedLines, refusalText, withheldPath,
} from '../backend/services/security/secret-gate.js';
import { collectLiveSecretSources } from '../backend/services/security/secret-sources.js';

const ZERO = /^0{40}$/;
// Past this a file is refused, not read: reading a 1 GB blob through a diff
// is not a check anyone waits for, and skipping it would be a hole. (The
// largest tracked file today is under 4 MB; big media rides Git LFS pointers.)
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const git = (args, input) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, input });
// Every diff the gate reads: text whatever the file (--text beats a NUL byte
// and a -diff attribute, --no-textconv shows the bytes not a rendering), raw
// paths, and the a/ b/ prefixes the header parser expects whatever the config.
const DIFF_FLAGS = ['-U0', '--text', '--no-textconv', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
const RAW = ['-c', 'core.quotePath=false'];

// The checkout this commit or push belongs to — plus the main checkout when
// this is a linked worktree, since a worktree's agent may have read the main
// checkout's .env — and the machine's secret stores (secret-sources.js).
const envFilesOf = () => {
  const roots = new Set([git(['rev-parse', '--show-toplevel']).trim()]);
  const common = path.resolve(git(['rev-parse', '--git-common-dir']).trim());
  if (path.basename(common) === '.git') roots.add(path.dirname(common));
  const seen = new Set();
  return [...roots].flatMap(collectLiveSecretSources).filter(({ file, text }) => {
    const key = `${file}\0${text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// (T: a file turned symlink is new text — its target — too)
const stagedDiff = () => git([...RAW, 'diff', '--cached', ...DIFF_FLAGS, '--diff-filter=ACMRT']);

// `--raw` rows ([…]) → files whose new blob
// is too large to read. A gitlink (160000) is another repo's commit, not a blob.
const oversized = (raw) => {
  const blobs = raw.split('\n').map((row) => row.match(/^:\d+ (\d+) [0-9a-f]+ ([0-9a-f]+) [A-Z]\d*\t(?:.*\t)?(.*)$/))
    .filter((m) => m && m[1] !== '160000' && !ZERO.test(m[2]));
  if (!blobs.length) return [];
  const sizes = new Map(git(['cat-file', '--batch-check=%(objectname) %(objectsize)'], blobs.map((m) => m[2]).join('\n'))
    .split('\n').map((row) => row.split(' ')).map(([sha, size]) => [sha, Number(size)]));
  return blobs.filter((m) => !(sizes.get(m[2]) <= MAX_FILE_BYTES)).map((m) => ({
    file: m[3], line: null, commit: null, kind: 'unread',
    what: `too large for the gate to read (${sizes.get(m[2]) ?? '?'} bytes; the cap is ${MAX_FILE_BYTES}) — refused, never skipped`,
  }));
};

// git's pre-push stdin: […] per line.
const pushRanges = (stdin) => stdin.split('\n').filter(Boolean).map((row) => {
  const [, localSha, , remoteSha] = row.trim().split(/\s+/);
  if (!localSha || ZERO.test(localSha)) return null;
  return remoteSha && !ZERO.test(remoteSha) ? [`${remoteSha}..${localSha}`] : [localSha, '--not', '--remotes'];
}).filter(Boolean);

// A merge shows what it changes against its FIRST parent: plain `log -p`
// shows a merge nothing, which let a --no-verify merge resolution and a
// commit-tree two-parent commit carry a live value to the remote.
const LOG_MERGES = ['--diff-merges=first-parent'];

const pushDiff = (ranges) => ranges
  .map((range) => git([...RAW, 'log', '-p', ...DIFF_FLAGS, ...LOG_MERGES, '--format=commit %H', ...range]))
  .join('\n');

const pushRaw = (ranges) => ranges
  .map((range) => git([...RAW, 'log', '--raw', '--no-abbrev', ...LOG_MERGES, '--diff-filter=ACMRT', '--format=', ...range]))
  .join('\n');

// A message's lines, shaped as added lines of a pseudo-file, so one judge reads both.
const messageLines = (text, commit = null) => String(text).split('\n')
  .map((line, i) => ({ file: '(commit message)', line: i + 1, text: line, commit }));

const pushMessages = (ranges) => ranges.flatMap((range) => git(['log', '--format=%H%x00%B%x1e', ...range])
  .split('\x1e').map((entry) => entry.trim()).filter(Boolean)
  .flatMap((entry) => { const [sha, body = ''] = entry.split('\x00'); return messageLines(body, sha); }));

// What a push sends beside commits: the ref names themselves, and each
// annotated tag's own message, which no commit log shows — every pushed tag
// object is read whole (a tag of a tag, all the way down).
const pushRefLines = (stdin) => stdin.split('\n').filter(Boolean).flatMap((row) => {
  const [localRef, localSha, remoteRef] = row.trim().split(/\s+/);
  const lines = [localRef, remoteRef].filter(Boolean).map((text) => ({ file: '(a pushed ref name)', line: 1, text, commit: null }));
  for (let sha = localSha; sha && !ZERO.test(sha) && git(['cat-file', '-t', sha]).trim() === 'tag';) {
    const tag = git(['cat-file', 'tag', sha]);
    lines.push(...String(tag).split('\n').map((text, i) => ({ file: '(annotated tag)', line: i + 1, text, commit: sha })));
    const [, next, type] = tag.match(/^object ([0-9a-f]+)\ntype (\w+)/) || [];
    sha = type === 'tag' ? next : null;
  }
  return lines;
});

// Every file under a directory as added lines — a snapshot has no diff, so
// all of it is what would go out: each name, each file's bytes as text (a
// binary file too), a link's target. A file past the cap is refused.
const treeLines = (dir) => {
  const lines = [];
  const unread = [];
  const walk = (at) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) { if (entry.name !== '.git') walk(full); continue; }
      const file = path.relative(dir, full);
      lines.push({ file, line: 0, text: file, commit: null });
      if (entry.isSymbolicLink()) { lines.push({ file, line: 1, text: fs.readlinkSync(full), commit: null }); continue; }
      if (!entry.isFile()) continue;
      const size = fs.statSync(full).size;
      if (size > MAX_FILE_BYTES) {
        unread.push({ file, line: null, commit: null, kind: 'unread', what: `too large for the gate to read (${size} bytes; the cap is ${MAX_FILE_BYTES}) — refused, never skipped` });
        continue;
      }
      fs.readFileSync(full).toString('utf8').split('\n').forEach((text, i) => lines.push({ file, line: i + 1, text, commit: null }));
    }
  };
  walk(dir);
  return { lines, unread };
};

const main = () => {
  const flag = (name) => process.argv.includes(name);
  const mode = flag('--push') ? 'push' : flag('--names') ? 'names' : flag('--message') ? 'message' : flag('--tree') ? 'tree' : 'staged';
  const secrets = liveSecretsFrom(envFilesOf());
  if (mode === 'names') {
    for (const s of [...new Map(secrets.map((x) => [`${x.file}:${x.name}`, x])).values()]) console.log(`${s.file}: ${s.name}`);
    return 0;
  }
  let lines;
  let unread = [];
  if (mode === 'push') {
    const stdin = fs.readFileSync(0, 'utf8');
    const ranges = pushRanges(stdin);
    unread = oversized(pushRaw(ranges));
    lines = unread.length ? [] : [...addedLinesOf(pushDiff(ranges)), ...pushMessages(ranges), ...pushRefLines(stdin)];
  } else if (mode === 'tree') {
    ({ lines, unread } = treeLines(path.resolve(process.argv[process.argv.indexOf('--tree') + 1])));
  } else if (mode === 'message') {
    const source = process.argv[process.argv.indexOf('--message') + 1];
    lines = messageLines(fs.readFileSync(source === '-' ? 0 : source, 'utf8'));
  } else {
    unread = oversized(git([...RAW, 'diff', '--cached', '--raw', '--no-abbrev', '--diff-filter=ACMRT']));
    lines = unread.length ? [] : addedLinesOf(stagedDiff());
  }
  const guarded = withEncodings(secrets);
  const findings = [...unread.map((f) => ({ ...f, file: withheldPath(f.file, guarded) })), ...judgeAddedLines(lines, guarded)];
  if (!findings.length) return 0;
  process.stderr.write(refusalText(findings, mode));
  return 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`\nSECRET GATE — could not check this ${process.argv.includes('--push') ? 'push' : 'commit'} (${error.message}); refusing rather than letting it through unchecked.\n\n`);
    process.exitCode = 1;
  }
}
