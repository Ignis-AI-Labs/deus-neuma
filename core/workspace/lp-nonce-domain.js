import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/** Per-wallet LP nonce reservations, assigned onto the NeumaWorkspace facade. */
export const createLpNonceDomain = () => Object.freeze({
  /** Reserve one LP nonce atomically across processes. A crash leaves a gap, never a replacement. */
  async consumeLpNonce(neumaId, pendingNonce) {
    const filePath = path.join(this._path(neumaId), 'config', 'lp-nonce.json');
    let current = null;
    try {
      current = await this._readTrustedJSON(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (current !== null && (!Number.isSafeInteger(current?.next) || current.next < 0)) {
      throw new Error('LP nonce record is invalid');
    }
    let next = Math.max(Number(pendingNonce), current?.next ?? 0);
    if (!Number.isSafeInteger(next) || next < 0) throw new Error('LP nonce record is invalid');
    const dir = path.join(this._path(neumaId), 'config', 'lp-nonces');
    for (let attempts = 0; attempts < 10000; attempts += 1) {
      const finalPath = path.join(dir, `${next}.json`);
      const tempPath = path.join(dir, `${next}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
      await this._writeJSON(tempPath, { next });
      try {
        await fs.link(tempPath, finalPath);
        return next;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        next += 1;
      } finally {
        await fs.rm(tempPath, { force: true });
      }
    }
    throw new Error('LP nonce space is exhausted');
  },
});
