// team-trial-store.js — the rig-level home of BRICKWORKS trial scorecards.
//
// A trial scorecard is a SUBSTRATE-layer fact, like a capacity scan: what this
// rig + model + roster achieved on the locked benchmark at a moment in time.
// It is deliberately a PORTABLE, self-describing JSON — trial name + version,
// substrate identity, capacity, roster shape, per-step timings, checks, score,
// and the artifact itself — so witnesses can share scorecards and compare
// models/systems apples-to-apples across the community. Plaintext by design:
// nothing sovereign lives here (a member's name and role, never its inner
// life). The sharing surface itself belongs to UNAVIS; this store only makes
// the artifact worth sharing.
//
// Append-only, one file per run (the capacity-store shape). Test isolation:
// NEUMA_TEAM_TRIAL_PATH overrides the dir, resolved per call, so RULE-0
// real-disk tests never touch the operator's live trial history.

import fs from 'fs/promises';
import { join } from 'path';
import { getDataRoot } from './data-root.js';

const TRIAL_DIR = join(getDataRoot(), 'benchmarks/team-trial');

const trialDir = () => process.env.NEUMA_TEAM_TRIAL_PATH || TRIAL_DIR;

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// runAt ISO stamp → filesystem-safe run id (the capacity-store scheme).
const idFromRunAt = (runAt) => String(runAt).replace(/[:.]/g, '-');

// impure — appends one scorecard as its own file; never overwrites a run.
// A card names the beings that did the work, so it is OWNED: `by` (the witness
// wallet) is required at write and every read is scoped to it.
/**
 * @param {Object} scorecard - must carry an ISO runAt and the owning wallet in `by`
 * @returns {Promise<string>} the trial id
 */
export const writeTrial = async (scorecard) => {
  if (!scorecard || typeof scorecard.runAt !== 'string' || !scorecard.runAt) {
    throw new Error('a trial scorecard must carry a runAt timestamp — no provenance, no record');
  }
  if (typeof scorecard.by !== 'string' || !scorecard.by) {
    throw new Error('a trial scorecard must carry the owning wallet (by) — it names beings');
  }
  const id = idFromRunAt(scorecard.runAt);
  if (!ID_PATTERN.test(id)) {
    throw new Error(`trial id derives to an unsafe filename: ${id}`);
  }
  const dir = trialDir();
  await fs.mkdir(dir, { recursive: true });
  // Exclusive create ('wx') keeps "never overwrites" TRUE even when two runs
  // land on the same millisecond runAt — the collision gets an ordinal suffix
  // instead of silently destroying the first record.
  for (let n = 1; ; n++) {
    const finalId = n === 1 ? id : `${id}-${n}`;
    try {
      await fs.writeFile(
        join(dir, `${finalId}.json`),
        JSON.stringify({ id: finalId, ...scorecard }, null, 2),
        { flag: 'wx' }
      );
      return finalId;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
};

// pure — does this wallet own this card? A legacy card without `by` is owned
// by no one (hidden) rather than by everyone.
const ownedBy = (card, wallet) =>
  typeof card?.by === 'string' && typeof wallet === 'string' && wallet.length > 0 &&
  card.by.toLowerCase() === wallet.toLowerCase();

// impure — one full scorecard (artifact included), or null. Scoped to the
// owning wallet: someone else's run reads as absent, never as forbidden-but-real.
/**
 * @param {string} id
 * @param {string} wallet - the requesting witness wallet
 * @returns {Promise<?Object>}
 */
export const readTrial = async (id, wallet) => {
  if (!ID_PATTERN.test(String(id))) return null;
  try {
    const card = JSON.parse(await fs.readFile(join(trialDir(), `${id}.json`), 'utf8'));
    return ownedBy(card, wallet) ? card : null;
  } catch {
    return null;
  }
};

// impure — the wallet's own scorecards as SUMMARIES (no artifact HTML — the
// list is for comparing runs across time/models, not for replaying games),
// newest first. Sharing a card beyond its owner is a deliberate act, elsewhere.
/**
 * @param {string} wallet - the requesting witness wallet
 * @returns {Promise<Object[]>}
 */
export const listTrials = async (wallet) => {
  let names;
  try {
    names = (await fs.readdir(trialDir())).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const cards = await Promise.all(
    names.map(async (n) => {
      try {
        const card = JSON.parse(await fs.readFile(join(trialDir(), n), 'utf8'));
        if (!ownedBy(card, wallet)) return null;
        const { artifact, ...summary } = card;
        return { ...summary, hasArtifact: typeof artifact === 'string' && artifact.length > 0 };
      } catch {
        return null; // a corrupt file is skipped, never fabricated
      }
    })
  );
  return cards.filter(Boolean).sort((a, b) => String(b.runAt).localeCompare(String(a.runAt)));
};
