/**
 * Secret twin finder — every other name, under some roots, of each known
 * secret that has more than one link (secret-inodes.js linkedSecrets).
 *
 * The coding shell's mask sweep judges names, and never walks node_modules
 * (a dependency tree is not secret-shaped). A hard link to a secret can sit
 * anywhere, node_modules included, so when — and only when — a known secret
 * actually has a second link, the shell asks `find` for every file under its
 * ground with that inode number, then keeps those whose (dev, ino) truly
 * match (an inode number repeats across devices). A secret with a second
 * link is abnormal — nothing the platform makes does it — so this costs
 * nothing on a healthy machine.
 *
 * Fails CLOSED: a find that errors (an unreadable folder, a timeout) throws,
 * because a shell over a tree that was not fully searched for twins could
 * show one. impure — spawns find, stats its results.
 */
import { execFile } from 'child_process';
import fs from 'fs/promises';

const FIND_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 64 * 1024 * 1024;

// impure — find's NUL-separated paths; rejects with find's own complaint.
const runFind = (args) => new Promise((resolve, reject) => {
  execFile('find', args, { encoding: 'utf8', timeout: FIND_TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (error, out, err) => {
    if (error) reject(new Error(`the hard-link search could not finish (${String(err || error.message).trim().split('\n')[0]})`, { cause: error }));
    else resolve(out.split('\0').filter(Boolean));
  });
});

/**
 * Every path under `roots` that is another name of a linked secret (the
 * secrets' own paths included when they lie under the roots).
 * @param {string[]} roots - absolute directories
 * @param {Array<{dev: string, ino: string}>} linked - from linkedSecrets()
 * @returns {Promise<string[]>}
 */
export const findSecretTwins = async (roots, linked) => {
  if (roots.length === 0 || linked.length === 0) return [];
  const wanted = new Set(linked.map((l) => `${l.dev}:${l.ino}`));
  const inums = [...new Set(linked.map((l) => l.ino))].flatMap((ino, i) => [...(i ? ['-o'] : []), '-inum', ino]);
  const found = await runFind([...roots, '-type', 'f', '-links', '+1', '(', ...inums, ')', '-print0']);
  const stats = await Promise.all(found.map((p) => fs.stat(p, { bigint: true }).catch(() => null)));
  return found.filter((p, i) => stats[i] && wanted.has(`${stats[i].dev}:${stats[i].ino}`));
};
