import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const validAmount = (value) => Number.isSafeInteger(value) && value > 0;
const claimName = (value) => `${value}.json`;

/** Daily LP notional reservations, assigned onto the NeumaWorkspace facade. */
export const createLpNotionalDomain = () => Object.freeze({
  /**
   * Atomically reserve one action's notional. Lower-numbered claims are counted
   * after the unique claim lands, so concurrent processes cannot both spend the
   * same allowance. An over-cap own claim is removed; a crash leaves it spent.
   */
  async consumeLpNotional(neumaId, { day, amountMicro, capMicro }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !validAmount(amountMicro) || !validAmount(capMicro)) {
      throw new Error('LP notional reservation is invalid');
    }
    const dir = path.join(this._path(neumaId), 'config', 'lp-notional', day);
    let ticket = -1;
    let finalPath;
    for (let candidate = 0; candidate < 100000; candidate += 1) {
      const target = path.join(dir, claimName(candidate));
      const temp = path.join(dir, `${candidate}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
      await this._writeJSON(temp, { day, amountMicro });
      try {
        await fs.link(temp, target);
        ticket = candidate;
        finalPath = target;
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      } finally {
        await fs.rm(temp, { force: true });
      }
    }
    if (ticket < 0) throw new Error('LP notional reservation space is exhausted');

    const names = (await fs.readdir(dir)).filter((name) => name.endsWith('.json'));
    let usedMicro = 0;
    for (const name of names) {
      const index = Number(name.slice(0, -5));
      if (!Number.isSafeInteger(index) || index < 0) throw new Error('LP notional record is invalid');
      if (index >= ticket) continue;
      const claim = await this._readTrustedJSON(path.join(dir, name));
      if (claim?.day !== day || !validAmount(claim?.amountMicro)) throw new Error('LP notional record is invalid');
      usedMicro += claim.amountMicro;
      if (!Number.isSafeInteger(usedMicro)) throw new Error('LP notional record is invalid');
    }
    if (usedMicro + amountMicro > capMicro) {
      await fs.unlink(finalPath);
      return null;
    }
    return ticket;
  },
});
