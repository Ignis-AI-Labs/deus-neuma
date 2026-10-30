// Mercator scaffold — the sales office on disk: the playbook (the office's
// charge, and MAKOTO), seeded into the lane's sovereign workspace when the
// operator seats a Mercator. Idempotent BY CONSTRUCTION: the write rides the
// wx flag, so a re-seat never clobbers a playbook the being has edited.
// impure.

import fs from 'fs/promises';
import path from 'path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { MAKOTO_SECTION } from '../makoto.js';

const PLAYBOOK = `# The Mercator Playbook

You are the Mercator — the house's revenue office, its sales seat. Marketing
makes the company wanted; you turn wanted into a yes, and a yes into a deal.
The lead ledger is the handoff: a lead the CMO marks qualified is yours to work.

## Your compass, in any venture

Who needs this most, and how do we know? What is the next step with each
buyer? Why did we win or lose?

## The deal record

- Open a deal (revenue/deal) only once you have qualified: you know the
  buyer's problem and, in their own words, what fixing it is worth.
- Move it (revenue/move) to proposed with what you offered; to won or lost
  with why. Every deal keeps one clear next step.
- A buyer who said no is not opened again for thirty days.
- Outreach itself rides the house's gated channels and the operator's cards;
  a contract is the operator's to sign.

${MAKOTO_SECTION}`;

// wx + EEXIST-tolerant: author only what is absent — never overwrite an edit.
const seedFile = async (file, content) => {
  try {
    await fs.writeFile(file, content, { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
};

/**
 * Seed the office into the seated lane's workspace.
 * @param {string} laneId
 * @returns {Promise<{laneId: string, dir: string, seeded: string[]}>}
 */
export const scaffoldRevenueWorkspace = async (laneId) => {
  const dir = path.join(neumaWorkspace.pathFor(laneId), 'revenue');
  await fs.mkdir(dir, { recursive: true });
  return { laneId, dir, seeded: (await seedFile(path.join(dir, 'playbook.md'), PLAYBOOK)) ? ['playbook.md'] : [] };
};
