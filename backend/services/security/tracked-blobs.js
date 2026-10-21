// Tracked blobs — what git HOLDS for a checkout, read from its object store.
//
// The secret sweep used to read the working tree: a tracked file deleted from
// disk, made unreadable, given a leading NUL or grown past the size cap read
// as "nothing here", and the watch verified a claim and closed a finding while
// the secret still sat in HEAD (security-seat recheck, 2026-10-20). Git's own
// objects are what a push or a clone carries, and no working-tree trick
// changes them, so this module lists the index's entries AND HEAD's tree (a
// path removed from the index alone is still committed) and reads each blob
// through one `git cat-file --batch`.
//
// impure — runs git; never writes.

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);
const LIST_MAX_BUFFER = 256 * 1024 * 1024;
const GITLINK_MODE = '160000'; // another repository's commit, not a blob here
const EMPTY = Buffer.alloc(0);

// pure — NUL-separated "<meta>\t<path>" rows → [{meta fields, path}]
const rowsOf = (stdout) => stdout.split('\0').filter(Boolean).map((row) => {
  const tab = row.indexOf('\t');
  return { fields: row.slice(0, tab).split(' '), path: row.slice(tab + 1) };
});

// impure — HEAD's tree as [{path, sha}], [] on an unborn branch (nothing
// committed yet). Any other git failure throws: a blind read is not empty.
const headBlobs = async (cwd) => {
  const born = await execFileP('git', ['rev-parse', '-q', '--verify', 'HEAD^{tree}'], { cwd })
    .then(() => true, (err) => { if (err.code === 1) return false; throw err; });
  if (!born) return [];
  const { stdout } = await execFileP('git', ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'], { cwd, maxBuffer: LIST_MAX_BUFFER });
  // "<mode> <type> <sha>\t<path>"
  return rowsOf(stdout).filter(({ fields }) => fields[1] === 'blob').map(({ fields, path }) => ({ path, sha: fields[2] }));
};

/**
 * Every (path, blob) git tracks for a checkout: the index's entries (all
 * merge stages) first, then HEAD's, each pair once. Throws when git cannot
 * list them.
 * @param {string} cwd the checkout
 * @returns {Promise<Array<{path: string, sha: string}>>}
 */
export const listTrackedBlobs = async (cwd) => {
  const { stdout } = await execFileP('git', ['ls-files', '-s', '-z'], { cwd, maxBuffer: LIST_MAX_BUFFER });
  // "<mode> <sha> <stage>\t<path>"
  const staged = rowsOf(stdout).filter(({ fields }) => fields[0] !== GITLINK_MODE)
    .map(({ fields, path }) => ({ path, sha: fields[1] }));
  const seen = new Set();
  return [...staged, ...await headBlobs(cwd)].filter(({ path, sha }) => {
    const key = `${sha}\0${path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Stream blobs out of the object store. Each blob at or under `maxBytes`
 * reaches `onBlob` whole; a larger one is skipped unbuffered and reported to
 * `onUnread`, as is one the store does not have. Resolves when git exits
 * clean; rejects otherwise.
 * @param {string} cwd the checkout
 * @param {string[]} shas blob ids, each once
 * @param {{maxBytes: number, onBlob: (sha: string, bytes: Buffer) => void, onUnread: (sha: string, why: string) => void}} sink
 * @returns {Promise<void>}
 */
export const readBlobs = (cwd, shas, { maxBytes, onBlob, onUnread }) => new Promise((resolve, reject) => {
  if (!shas.length) { resolve(); return; }
  const child = spawn('git', ['cat-file', '--batch'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let header = EMPTY;
  let body = null; // { sha, size, need, keep, chunks }
  let stderr = '';
  const take = (chunk) => {
    let rest = chunk;
    while (rest.length) {
      if (!body) {
        // only a header split across chunks is joined; a whole chunk is never copied
        const at = header.length ? Buffer.concat([header, rest]) : rest;
        const nl = at.indexOf(0x0a);
        if (nl < 0) { header = at; return; }
        const [sha, type, size] = at.subarray(0, nl).toString('utf8').split(' ');
        rest = at.subarray(nl + 1);
        header = EMPTY;
        if (type === 'missing') { onUnread(sha, 'missing from the object store'); continue; }
        const bytes = Number(size);
        // the body is followed by one LF
        body = { sha, size: bytes, need: bytes + 1, keep: bytes <= maxBytes, chunks: [] };
        continue;
      }
      const n = Math.min(body.need, rest.length);
      if (body.keep) body.chunks.push(rest.subarray(0, n));
      body.need -= n;
      rest = rest.subarray(n);
      if (body.need === 0) {
        if (body.keep) onBlob(body.sha, Buffer.concat(body.chunks).subarray(0, body.size));
        else onUnread(body.sha, `${body.size} bytes, over the ${maxBytes}-byte cap`);
        body = null;
      }
    }
  };
  child.stdout.on('data', (chunk) => {
    try { take(chunk); } catch (err) { child.kill(); reject(err); }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => (code === 0 && !body
    ? resolve()
    : reject(new Error(`git cat-file --batch exited ${code}${stderr ? `: ${stderr.trim()}` : ''}`))));
  child.stdin.on('error', reject);
  child.stdin.end(`${shas.join('\n')}\n`);
});
