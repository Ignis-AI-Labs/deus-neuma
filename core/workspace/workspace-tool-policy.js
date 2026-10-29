// impure: tool-policy IO shares the facade's ONE per-file queue with every domain.
import fs from 'node:fs/promises';
import path from 'node:path';

// Capture before enqueueing: neither a queued transaction nor its rename may
// follow a root switch into a different home (including the witness ground).
const policyTarget = (workspace, neumaId, opts = {}) => {
  const root = workspace.root;
  const lanePath = workspace._path(neumaId);
  const beforeCommit = () => {
    opts.signal?.throwIfAborted();
    opts.beforeCommit?.();
    opts.signal?.throwIfAborted();
    if (workspace.root !== root || workspace._path(neumaId) !== lanePath) {
      throw new Error('Workspace root changed during tool-policy operation');
    }
  };
  return { filePath: path.join(lanePath, 'config', 'tool-policy.json'), beforeCommit };
};

// Only an absent policy is empty authority. Corruption, decryption and access
// failures propagate; a writer must never replace unreadable authority with {}.
const readCurrent = async (workspace, filePath, cached = false) => {
  try {
    const stat = await fs.stat(filePath);
    const key = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
    const hit = cached && workspace._toolPolicyCache?.get(filePath);
    if (hit && hit.key === key) return structuredClone(hit.value);
    // only an envelope the platform wrote is policy (workspace-json-io.js _readTrustedJSON)
    const value = await workspace._readTrustedJSON(filePath);
    if (cached) {
      workspace._toolPolicyCache ??= new Map();
      workspace._toolPolicyCache.set(filePath, { key, value: structuredClone(value) });
    }
    return value;
  } catch (error) {
    workspace._toolPolicyCache?.delete(filePath);
    if (error.code === 'ENOENT' && error.path === filePath) return null;
    throw error;
  }
};

/** Policy methods using the facade's existing deps.locks, never a second queue. */
export const createToolPolicyDomain = ({ locks }) => Object.freeze({
  /** Read current authority after preceding updates, mtime-cached and detached. */
  async readToolPolicy(neumaId) {
    const target = policyTarget(this, neumaId);
    return locks.withFileLock(target.filePath, async () => {
      target.beforeCommit();
      const policy = await readCurrent(this, target.filePath, true);
      target.beforeCommit();
      return policy;
    });
  },

  /** Whole replacement, serialized with reads and callback updates. */
  async writeToolPolicy(neumaId, policy, opts = {}) {
    const target = policyTarget(this, neumaId, opts);
    return locks.withFileLock(target.filePath, async () => {
      target.beforeCommit();
      await this._writeJSON(target.filePath, policy, { signal: opts.signal, beforeCommit: target.beforeCommit });
      this._toolPolicyCache?.delete(target.filePath);
      await opts.afterCommit?.();
    });
  },

  /**
   * Atomically read, transform and persist current policy. transform may be async;
   * return undefined for no write. It must not call public policy IO (same lock).
   * @param {string} neumaId
   * @param {(policy: Object|null) => Object|undefined|Promise<Object|undefined>} transform
   * @param {{signal?: AbortSignal, beforeCommit?: Function, afterCommit?: Function}} [opts]
   * beforeCommit is synchronous; afterCommit runs inside the queue even on no-op,
   * so revoke can clear runtime authority before any new turn reads the policy.
   * @returns {Promise<Object|null>} resulting policy
   */
  async updateToolPolicy(neumaId, transform, opts = {}) {
    const target = policyTarget(this, neumaId, opts);
    return locks.withFileLock(target.filePath, async () => {
      target.beforeCommit();
      const current = await readCurrent(this, target.filePath);
      target.beforeCommit();
      const next = await transform(current);
      target.beforeCommit();
      if (next !== undefined) {
        await this._writeJSON(target.filePath, next, { signal: opts.signal, beforeCommit: target.beforeCommit });
        this._toolPolicyCache?.delete(target.filePath);
      }
      await opts.afterCommit?.();
      return next === undefined ? current : next;
    });
  },
});
