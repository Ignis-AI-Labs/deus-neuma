/** Encrypted, revision-checked checkpoints for one lane's persisted turn. */
import path from 'node:path';

export const OPERATION_CHECKPOINT_BYTE_CAP = 8 * 1024 * 1024;
const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const checkpointPath = (workspace, laneId, sessionId, turnId) => {
  if (!validId(sessionId) || !validId(turnId)) throw new Error('Invalid operation session or turn ID');
  // Replay authority belongs in the existing keys protection boundary: raw
  // filesystem tools and coding shells must not edit or erase these receipts.
  return path.join(workspace.pathFor(laneId), 'keys', 'operations', sessionId, `${turnId}.json`);
};
const validate = (record) => {
  if (!record || !Object.hasOwn(record, 'inFlight') || (record.inFlight !== null
    && (typeof record.inFlight !== 'object' || typeof record.inFlight.id !== 'string'
      || typeof record.inFlight.tool !== 'string' || !['running', 'pending approval'].includes(record.inFlight.state)))
    || record.version !== 1 || !Number.isSafeInteger(record.revision) || record.revision < 0
    || !Number.isSafeInteger(record.epoch) || record.epoch < 0 || !Array.isArray(record.prior)
    || !Array.isArray(record.receipts) || record.prior.some((row) => !Array.isArray(row)
      || row.length !== 2 || typeof row[0] !== 'string' || typeof row[1]?.status !== 'string')) {
    throw new Error('Invalid operation checkpoint; automatic replay refused');
  }
  return record;
};

/** @param {{locks: {withFileLock: Function}}} deps Workspace lock owner. */
export const createOperationsDomain = ({ locks }) => Object.freeze({
  /** impure — absence is empty; unreadable or malformed evidence is an error. */
  async readTurnOperations(laneId, sessionId, turnId) {
    const filePath = checkpointPath(this, laneId, sessionId, turnId);
    try { return validate(await this._readJSON(filePath)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { version: 1, revision: 0, epoch: 0, prior: [], receipts: [], inFlight: null };
    }
  },

  /** impure — serialize updates and reject stale writers before atomic encryption. */
  async updateTurnOperations(laneId, sessionId, turnId, revision, mutate) {
    const filePath = checkpointPath(this, laneId, sessionId, turnId);
    return locks.withFileLock(filePath, async () => {
      const current = await this.readTurnOperations(laneId, sessionId, turnId);
      if (current.revision !== revision) throw new Error('Operation checkpoint changed; reload before continuing');
      const next = validate({ ...mutate(current), revision: revision + 1 });
      if (Buffer.byteLength(JSON.stringify(next)) > OPERATION_CHECKPOINT_BYTE_CAP) {
        throw new Error('Operation checkpoint budget exhausted; automatic execution stopped');
      }
      await this._writeJSON(filePath, next);
      return next;
    });
  },
});
