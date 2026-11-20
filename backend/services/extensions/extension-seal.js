/**
 * WHAT RUNS IS WHAT WAS CHECKED — the installed copy's code is hashed the moment
 * it passes the security check, and hashed again before every start (PR600 audit
 * P6-61). The check reads the lockfile; nothing tied the files on disk to it, so
 * a file changed after the check would run all the same, outside any sandbox,
 * with the extension's keys.
 *
 * The seal covers what npm installed and the check read: `package.json`,
 * `package-lock.json` and everything under `node_modules`. It leaves out what an
 * extension writes beside them while it runs (the memory extension keeps its
 * graph there).
 *
 * impure — reads the installed folder.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const SEALED = Object.freeze(['package.json', 'package-lock.json', 'node_modules']);

// impure — every sealed entry below a folder, sorted, as "kind path digest" lines
const linesOf = async (root, rel) => {
  const at = path.join(root, rel);
  const stat = await fs.lstat(at).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
  if (!stat) return [`absent ${rel}`];
  if (stat.isSymbolicLink()) return [`link ${rel} ${await fs.readlink(at)}`];
  if (stat.isDirectory()) {
    const names = (await fs.readdir(at)).sort();
    const below = [];
    for (const name of names) below.push(...await linesOf(root, path.posix.join(rel, name)));
    return [`dir ${rel}`, ...below];
  }
  if (!stat.isFile()) return [`other ${rel}`];
  return [`file ${rel} ${createHash('sha256').update(await fs.readFile(at)).digest('hex')}`];
};

/**
 * The SHA-256 of an installed extension's code: every file's path and content,
 * every link's target, in one fixed order. impure.
 * @param {string} dir - the extension's installed folder
 * @returns {Promise<string>} 64 hex characters
 */
export const sealOf = async (dir) => {
  const hash = createHash('sha256');
  for (const rel of SEALED) hash.update(`${(await linesOf(dir, rel)).join('\n')}\n`);
  return hash.digest('hex');
};

/**
 * Why an installed copy may not start, or null when its files are the ones the
 * check read. A record with no seal (installed before seals existed) does not
 * start either: nothing says what was checked. impure.
 * @param {string} dir
 * @param {{ seal?: string }|null} record
 * @returns {Promise<string|null>}
 */
export const sealBroken = async (dir, record) => {
  if (!/^[0-9a-f]{64}$/.test(record?.seal ?? '')) {
    return 'it was added before its files were sealed against change, so nothing ties it to its security check — add it again (its keys are kept)';
  }
  return (await sealOf(dir)) === record.seal ? null
    : 'its files changed after its security check, so it was not started — add it again (its keys are kept), or remove it';
};
