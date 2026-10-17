#!/usr/bin/env node
/** Dev is the sole inbound source. Never hide dirty work or manufacture a merge. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// impure — Git owns repository locking and checks the working tree again on merge.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const fail = (message) => { throw new Error(message); };
const clean = () => {
  if (git('status', '--porcelain=v1', '--untracked-files=normal')) {
    fail('Working tree is not clean. Finish and commit the owned work before syncing; do not stash or sweep other work.');
  }
  for (const directory of ['rebase-merge', 'rebase-apply', 'sequencer']) {
    if (existsSync(git('rev-parse', '--git-path', directory))) fail(`Unfinished Git operation (${directory}).`);
  }
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    try { git('rev-parse', '-q', '--verify', marker); } catch { continue; }
    fail(`Unfinished Git operation (${marker}). Resolve it before syncing.`);
  }
};

// impure — reads refs, fetches only dev, optionally performs a fast-forward.
const sync = () => {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--check', '--apply'].includes(arg)) || args.length > 1) {
    fail('Usage: node scripts/sync-from-dev.mjs [--check|--apply]. The source is always origin/dev.');
  }
  clean();
  const branch = git('branch', '--show-current');
  if (!/^[^/]+\/dev$/.test(branch)) fail('Run this from the operator personal branch ({name}/dev).');
  const head = git('rev-parse', 'HEAD');
  const remote = git('ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`).split(/\s/)[0];
  if (remote !== head) fail('Local and published branch tips differ. Finish publishing/reconciling your own work first; never pull the personal branch to hide divergence.');
  git('fetch', '--no-tags', 'origin', 'refs/heads/dev:refs/remotes/origin/dev');
  const dev = git('rev-parse', 'refs/remotes/origin/dev');
  try { git('merge-base', '--is-ancestor', head, dev); }
  catch { fail('dev does not contain this branch yet. Submit/update its PR to dev and wait for the approved merge before syncing.'); }
  clean();
  if (git('rev-parse', 'HEAD') !== head) fail('The branch changed during preflight. Start again.');
  if (args[0] !== '--apply') {
    process.stdout.write(`Ready: ${branch} can fast-forward from ${head.slice(0, 9)} to origin/dev ${dev.slice(0, 9)}. Use --apply to sync.\n`);
    return;
  }
  git('merge', '--ff-only', '--no-autostash', dev);
  process.stdout.write(`Synced ${branch} from origin/dev at ${dev.slice(0, 9)}. No merge commit created.\n`);
};
try { sync(); } catch (error) {
  process.stderr.write(`Dev sync refused: ${error.message}\n`);
  process.exitCode = 1;
}
