// board-store — each house's MARKETING boards (marketing-panel-plan.md §4):
// `<realm>/<wallet>/offices/marketing/marketing-board.json`, beside the
// house's campaign bench and walled the same way (house-office.js): a store is
// opened for one house's wallet, never for the machine, so one house can never
// read or write another's board. `{ v: 1, boards: { house: [...], <companyId>: [...] } }`,
// one board per zoom level; a level with no board shows the default one.
// `cmo: {changes, lastAt, lastLevel}` counts the CMO's arrangements (CMO LOG).
//
// A write is judged whole (board-shape.js) against the house as it stands —
// its companies, its bench and its accounts — and against the board it replaces (the pin
// rule). A refused write changes nothing and names every reason.
//
// Governance record, not a secret: plain JSON, the campaign store's 0600/0700
// posture, the same in-process chain + cross-process lock (two servers write
// one checkout's realm). Factory shape so tests run the real disk path.

import fs from 'fs/promises';
import { dirname } from 'path';
import { withFileLock } from '../file-lock.js';
import { createWriteChain } from '../write-chain.js';
import { writeJsonAtomic } from '../user-realm.js';
import { officeFile } from '../house-office.js';
import { BOARD_VERSION, BOARD_SETTERS, boardRefusals, pinRefusals, stampBoard } from './board-shape.js';

export const BOARD_FILE = 'marketing-board.json';

/**
 * @param {{ path: string|(() => string) }} opts - the house's board file
 */
export const createBoardStore = ({ path }) => {
  const target = () => (typeof path === 'function' ? path() : path);
  const inProcess = createWriteChain();
  const serialize = (fn) => inProcess(() => withFileLock(`${target()}.lock`, fn));

  // impure — missing file = no board saved at any level; a corrupt file
  // surfaces, never collapses to empty (that would silently drop the layout).
  const readRecord = async () => {
    let raw;
    try {
      raw = await fs.readFile(target(), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return { v: BOARD_VERSION, boards: {} };
      throw err;
    }
    const parsed = JSON.parse(raw);
    if (parsed?.v !== BOARD_VERSION || !parsed.boards || typeof parsed.boards !== 'object' || Array.isArray(parsed.boards)) {
      throw new Error(`board-store: ${target()} is not a v${BOARD_VERSION} board record`);
    }
    return parsed;
  };

  // impure — atomic tmp+rename, then the 0600/0700 posture.
  const write = async (record) => {
    const file = target();
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeJsonAtomic(file, record);
    await fs.chmod(dirname(file), 0o700);
    await fs.chmod(file, 0o600);
  };

  const boardAt = (record, level) => (Object.hasOwn(record.boards, level) && Array.isArray(record.boards[level]) ? record.boards[level] : null);

  return {
    /**
     * One level's saved board, or null when the level shows the default. impure.
     * @param {string} level - 'house' or a company id
     */
    async load(level) {
      return boardAt(await readRecord(), level);
    },

    /**
     * The CMO's board arrangements so far — `{changes, lastAt, lastLevel}`, or
     * null when the CMO has laid out none. impure.
     */
    async cmoRecord() {
      return (await readRecord()).cmo || null;
    },

    /**
     * Record one level's board whole. impure.
     * @param {string} level
     * @param {Array<object>} panels
     * @param {{setBy: 'operator'|'cmo', companies: Array<object>, campaigns: Array<object>, accounts?: Array<object>}} ctx - the house as it stands
     * @returns {Promise<{ok: true, panels: object[]} | {ok: false, reasons: string[]}>}
     */
    save(level, panels, { setBy, companies, campaigns, accounts = [] }) {
      if (!BOARD_SETTERS.includes(setBy)) return Promise.resolve({ ok: false, reasons: [`a board is set by ${BOARD_SETTERS.join(' or ')}`] });
      const shape = boardRefusals(panels, { level, companies, campaigns, accounts });
      if (shape.length) return Promise.resolve({ ok: false, reasons: shape });
      return serialize(async () => {
        const record = await readRecord();
        const previous = boardAt(record, level) || [];
        const pins = pinRefusals(previous, panels, setBy);
        if (pins.length) return { ok: false, reasons: pins };
        const at = new Date().toISOString();
        const stamped = stampBoard(previous, panels, { setBy, at });
        // The CMO's arrangements are counted quietly for the CMO LOG: how many, and the last.
        const cmo = setBy === 'cmo' ? { changes: (record.cmo?.changes || 0) + 1, lastAt: at, lastLevel: level } : record.cmo;
        await write({ v: BOARD_VERSION, boards: { ...record.boards, [level]: stamped }, ...(cmo ? { cmo } : {}) });
        return { ok: true, panels: stamped };
      });
    },

    /**
     * Back to the default board at one level — the operator's act alone: a
     * reset by the CMO would remove the operator's pins. impure.
     * @param {string} level
     * @param {'operator'|'cmo'} setBy
     * @returns {Promise<{ok: boolean, reasons?: string[]}>}
     */
    reset(level, setBy) {
      if (setBy !== 'operator') return Promise.resolve({ ok: false, reasons: ['only the operator resets a board to its default'] });
      return serialize(async () => {
        const record = await readRecord();
        if (!boardAt(record, level)) return { ok: true };
        const boards = { ...record.boards };
        delete boards[level];
        await write({ ...record, boards });
        return { ok: true };
      });
    },
  };
};

const stores = new Map();

/**
 * A house's own board store. Throws for a caller with no house. impure.
 * @param {string} wallet
 */
export const boardStoreFor = async (wallet) => {
  const file = officeFile(wallet, 'marketing', BOARD_FILE);
  if (!stores.has(file)) stores.set(file, createBoardStore({ path: file }));
  return stores.get(file);
};
