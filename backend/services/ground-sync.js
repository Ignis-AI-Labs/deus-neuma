/** Approved live sync: immutable target, exclusive ground lease, fetch then ff-only. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { groundConfigDigest, runGroundGit, validateGroundRemote, gitFailure } from './ground-git-exec.js';
import { fetchGroundTarget } from './ground-git-fetch.js';
import { isGitHubRemote } from './ground-git-remote.js';
import { assertGenericSyncAllowed } from './ground-sync-workflow.js';
import { releaseGroundSyncLock } from './ground-sync-lock.js';

const OID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const REF = /^refs\/(?:heads|remotes)\/[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = async (root, args, options) => (await runGroundGit(root, args, options)).trim();

/** impure - private snapshot includes remote URL; only previewGroundSync may render it. */
export const prepareGroundSync = async (sourceRoot, options = {}) => {
  const root = await fs.realpath(sourceRoot);
  const top = await fs.realpath(await read(root, ['rev-parse', '--show-toplevel'], options));
  // Consent must name the checkout whose entire tree the merge will update.
  if (top !== root) throw gitFailure('changed');
  await assertGenericSyncAllowed(root, options);
  const gitDir = await fs.realpath(await read(root, ['rev-parse', '--absolute-git-dir'], options));
  const commonDir = await fs.realpath(path.resolve(root, await read(root, ['rev-parse', '--git-common-dir'], options)));
  const branch = await read(root, ['symbolic-ref', '--quiet', 'HEAD'], options);
  const head = await read(root, ['rev-parse', '--verify', 'HEAD'], options);
  if (!branch.startsWith('refs/heads/') || !REF.test(branch) || !OID.test(head)) throw gitFailure('no_upstream');
  const name = branch.slice('refs/heads/'.length);
  let remote, merge, upstream;
  try {
    remote = await read(root, ['config', '--get-all', `branch.${name}.remote`], options);
    merge = await read(root, ['config', '--get-all', `branch.${name}.merge`], options);
    upstream = await read(root, ['rev-parse', '--symbolic-full-name', '@{u}'], options);
  } catch (error) {
    if (error.code !== 'git_failed') throw error;
    throw gitFailure('no_upstream');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(remote) || !REF.test(merge) || !merge.startsWith('refs/heads/')
    || !REF.test(upstream) || !upstream.startsWith(`refs/remotes/${remote}/`)) throw gitFailure('no_upstream');
  const url = validateGroundRemote(await read(root, ['config', '--get-all', `remote.${remote}.url`], options));
  const config = await groundConfigDigest(root, options);
  const upstreamHead = await read(root, ['rev-parse', '--verify', upstream], options);
  if (!OID.test(upstreamHead)) throw gitFailure('no_upstream');
  const { dev, ino } = await fs.stat(gitDir);
  return Object.freeze({ root, branch, head, upstream, merge, url, config, gitDir, commonDir, dev, ino, upstreamHead });
};

/** Pure - all four consent fields fit the broker's 600-char preview or refuse. */
export const previewGroundSync = (snapshot) => {
  const preview = Object.freeze({ root: snapshot.root, branch: snapshot.branch, HEAD: snapshot.head, upstream: snapshot.upstream,
    ...(isGitHubRemote(snapshot.url) ? { github: snapshot.url, authentication: 'Operator GitHub CLI login, if available' } : {}),
  });
  if (JSON.stringify(preview, null, 2).length > 600) throw gitFailure('changed');
  return preview;
};

/** impure - re-read disk truth, never silently retarget a pending approval. */
export const revalidateGroundSync = async (snapshot, options) => {
  if (!same(snapshot, await prepareGroundSync(snapshot.root, options))) throw gitFailure('changed');
};

/** impure - only backend callers can supply a snapshot, never model args. */
export const syncGround = async (sourceRoot, { snapshot, signal, assertCurrent = () => {} } = {}) => {
  let lock;
  let result;
  let lockPath;
  let refsMayHaveChanged = false;
  let checkoutMayHaveChanged = false;
  let objectsMayHaveChanged = false;
  try {
    assertCurrent();
    if (signal?.aborted) throw gitFailure('cancelled');
    if (!snapshot || sourceRoot !== snapshot.root) throw gitFailure('changed');
    lockPath = path.join(snapshot.commonDir, 'neuma-ground-sync.lock');
    try { lock = await fs.open(lockPath, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw gitFailure('locked'); throw error; }
    await revalidateGroundSync(snapshot, { signal });
    if (await read(snapshot.root, ['status', '--porcelain=v1', '--ignore-submodules=all'], { signal })) throw gitFailure('dirty');
    assertCurrent();
    objectsMayHaveChanged = true;
    const target = await fetchGroundTarget(snapshot, signal);
    assertCurrent();
    await revalidateGroundSync(snapshot, { signal });
    // Git permits non-ff refs/remotes updates even without '+'. Do not delegate
    // that decision to fetch: prove ancestry, then compare-and-swap the old OID.
    await runGroundGit(snapshot.root, ['merge-base', '--is-ancestor', snapshot.upstreamHead, target], { signal });
    assertCurrent();
    refsMayHaveChanged = true;
    await runGroundGit(snapshot.root, ['update-ref', snapshot.upstream, target, snapshot.upstreamHead], { signal });
    // Prove ff ancestry before invoking merge. No auto-stash, rebase or commit.
    await runGroundGit(snapshot.root, ['merge-base', '--is-ancestor', snapshot.head, target], { signal });
    assertCurrent();
    await revalidateGroundSync(Object.freeze({ ...snapshot, upstreamHead: target }), { signal });
    checkoutMayHaveChanged = true;
    await runGroundGit(snapshot.root, ['merge', '--ff-only', '--no-edit', '--no-stat', '--no-verify', target], { signal });
    const head = await read(snapshot.root, ['rev-parse', '--verify', 'HEAD'], { signal });
    if (head !== target) throw gitFailure('changed');
    result = Object.freeze({ ok: true, code: 'fast_forward', output: 'Fast-forward sync completed.', head,
      refsMayHaveChanged, checkoutMayHaveChanged, objectsMayHaveChanged });
  } catch (error) {
    const reason = gitFailure(error.code, error.category);
    result = Object.freeze({ ok: false, code: reason.code, output: reason.message,
      refsMayHaveChanged, checkoutMayHaveChanged, objectsMayHaveChanged });
  } finally {
    if (!await releaseGroundSyncLock(lock, lockPath)) {
      result = Object.freeze({ ok: false, code: 'lock_release', output: gitFailure('lock_release').message,
        refsMayHaveChanged, checkoutMayHaveChanged, objectsMayHaveChanged });
    }
  }
  return result;
};

/** impure - shared seat result, no raw Git stdout/stderr/state assumptions. */
export const handleGroundSync = async ({ ws, companion, sandbox, sendToolEvent, snapshot, signal, assertCurrent }) => {
  const tool = 'coding/ground_sync';
  const result = await syncGround(sandbox.sourceRoot, { snapshot, signal, assertCurrent });
  const content = JSON.stringify(result);
  const status = result.ok ? 'ok' : 'error';
  sendToolEvent(ws, companion, { tool, status, summary: result.output, detail: content });
  return { tool, status, ...(result.ok ? { content } : { error: content }) };
};
