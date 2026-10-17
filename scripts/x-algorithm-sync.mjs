#!/usr/bin/env node
/** Sync only clean dev checkouts from origin/dev. Failed attempts never
 * replace the last successful stamp. impure: Git and local disk. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ALGORITHM_REPOS, algorithmSyncStampPath } from '../backend/services/marketing/algorithm-locations.js';

const exec = promisify(execFile);
// impure — preserve subprocess failure; never turn a failed fetch into success.
const git = async (repo, args) => (await exec('git', ['-C', repo, ...args], {
  timeout: 120000, maxBuffer: 1024 * 1024,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
})).stdout.trim();

// impure — refuse unpublished work before fetching or integrating anything.
const readyHead = async (repo) => {
  if (await git(repo, ['symbolic-ref', '--short', 'HEAD']) !== 'dev') throw new Error('requires the dev branch');
  if (await git(repo, ['status', '--porcelain'])) throw new Error('requires a clean checkout');
  if (await git(repo, ['rev-parse', '--abbrev-ref', '@{upstream}']) !== 'origin/dev') throw new Error('requires origin/dev upstream');
  if (await git(repo, ['rev-list', '--count', 'origin/dev..HEAD']) !== '0') throw new Error('publish local commits before syncing');
  return git(repo, ['rev-parse', 'HEAD']);
};

/** impure — explicit injected paths select real repositories, never a Git substitute.
 * @param {{repos?: Object<string,string>, stampPath?: string}} options
 */
export const syncAlgorithmRepos = async ({ repos = ALGORITHM_REPOS, stampPath = algorithmSyncStampPath() } = {}) => {
  const results = {};
  for (const [name, repo] of Object.entries(repos)) {
    try {
      const before = await readyHead(repo);
      await git(repo, ['fetch', 'origin', 'refs/heads/dev:refs/remotes/origin/dev']);
      if (await readyHead(repo) !== before) throw new Error('checkout changed during fetch');
      await git(repo, ['merge', '--ff-only', 'origin/dev']);
      const head = await git(repo, ['rev-parse', 'HEAD']);
      results[name] = { head, changed: head !== before };
    } catch (error) {
      results[name] = { head: null, changed: false, error: error.message.split('\n')[0] };
    }
  }
  if (Object.values(results).some((result) => result.error)) return { ok: false, ...results };
  const stamp = { syncedAt: new Date().toISOString(), ...results };
  await mkdir(path.dirname(stampPath), { recursive: true });
  const temporary = `${stampPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(stamp, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, stampPath);
  } finally { await rm(temporary, { force: true }); }
  return { ok: true, ...stamp };
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  syncAlgorithmRepos().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  }).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
