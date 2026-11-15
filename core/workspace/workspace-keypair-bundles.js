import fs from 'node:fs/promises';
import path from 'node:path';

const bundleFile = (root) => path.join(root, 'keys', 'keypair-bundle.json');
const codesFile = (root) => path.join(root, 'keys', 'rotation-codes.json');

export const createKeypairBundlesDomain = ({ locks }) => Object.freeze({
  async readRotationBundle(neumaId) {
    try {
      return await this._readTrustedJSON(bundleFile(this._path(neumaId)));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  },

  async writeRotationBundle(neumaId, bundle, { beforeCommit } = {}) {
    const file = bundleFile(this._path(neumaId));
    return locks.withFileLock(file, () => this._writeJSON(file, { version: 1, ...bundle }, { beforeCommit }));
  },

  async clearRotationBundle(neumaId) {
    await fs.rm(bundleFile(this._path(neumaId)), { force: true });
  },

  async writeRotationCodes(neumaId, address, codes) {
    await this._writeJSON(codesFile(this._path(neumaId)), { version: 1, address, codes: [...codes], createdAt: new Date().toISOString() });
  },

  async readRotationCodes(neumaId) {
    try {
      const record = await this._readTrustedJSON(codesFile(this._path(neumaId)));
      const current = await this.readEncryptedKeypair(neumaId);
      return record?.address && current?.address === record.address && Array.isArray(record.codes)
        ? Object.freeze({ address: record.address, codes: Object.freeze([...record.codes]) })
        : null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  },

  async acknowledgeRotationCodes(neumaId, address) {
    const pending = await this.readRotationCodes(neumaId);
    if (!pending || pending.address !== address) throw new Error('No delivered rotation codes await acknowledgment for the current key');
    await fs.rm(codesFile(this._path(neumaId)), { force: true });
  },
});
