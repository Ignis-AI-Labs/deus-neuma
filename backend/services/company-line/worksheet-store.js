// The worksheets a company's founding line hands on, kept twice: the TRUE
// copy in the company's record on the realm (`worksheets/<stage>-r<round>.json`,
// where no being can write — the desk and every later check read it), and a
// readable MIRROR on the house ground (`repos/<company>/line/<stage>-r<round>.json`)
// so the inspecting being can open the work with its own hands. A later stage
// is checked against the true copies, never the mirror.
// impure.

import path from 'path';
import fs from 'fs/promises';
import { writeJsonAtomic } from '../user-realm.js';
import { companyPath } from './company-store.js';
import { containedFile } from '../no-follow-write.js';

const STAGES = Object.freeze(['survey', 'measure', 'shape', 'choose', 'prove']);
const nameOf = (stage, round) => {
  if (!STAGES.includes(stage) || !Number.isSafeInteger(round) || round < 1) {
    throw new Error('a worksheet needs a known stage and a positive integer round');
  }
  return `${stage}-r${round}.json`;
};

/** The mirror's path on the house ground, as a being cites it. pure. */
export const mirrorPath = (companyId, stage, round) => `repos/${companyId}/line/${nameOf(stage, round)}`;

/**
 * Keep a handed-on worksheet: the true copy, then the mirror on the ground.
 * @param {{wallet: string, companyId: string, stage: string, round: number, worksheet: object, groundRoot: string}} args
 */
export const saveWorksheet = async ({ wallet, companyId, stage, round, worksheet, groundRoot }) => {
  await writeJsonAtomic(companyPath(wallet, companyId, path.join('worksheets', nameOf(stage, round))), worksheet);
  const relativeMirror = mirrorPath(companyId, stage, round);
  const mirror = await containedFile(groundRoot, path.dirname(path.join(groundRoot, relativeMirror)), path.basename(relativeMirror));
  await writeJsonAtomic(mirror, worksheet);
};

/**
 * The round's true worksheets so far, by stage id.
 * @returns {Promise<Record<string, object>>}
 */
export const readRoundWorksheets = async (wallet, companyId, round) => {
  const read = await Promise.all(STAGES.map(async (stage) => {
    try {
      return [stage, JSON.parse(await fs.readFile(companyPath(wallet, companyId, path.join('worksheets', nameOf(stage, round))), 'utf8'))];
    } catch (err) {
      if (err?.code === 'ENOENT') return [stage, null];
      throw err;
    }
  }));
  return Object.fromEntries(read.filter(([, w]) => w));
};
