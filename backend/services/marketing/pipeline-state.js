/**
 * PIPELINE STATE — the one computed answer to […].
 *
 * The CMO's beings re-orient from zero every turn: queue here, feed there,
 * card specs elsewhere, the algorithm's version nobody could name
 * (x-card-pipeline-cleanup / posting-pipeline-v2, the beings' own report).
 * This module computes the WHOLE posture from the real stores in one call —
 * never a maintained copy (a maintained copy drifts the moment a send
 * happens outside it). Read-only over: the post queue, the weekly plan, the
 * being's own card ground, and the local algorithm clones.
 */
import { execFile } from 'node:child_process';
import { stat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { postQueue } from '../social/post-queue.js';
import { ensureBeingGround } from '../house-workspace.js';

import { ALGORITHM_REPOS, algorithmSyncStampPath } from './algorithm-locations.js';
export { ALGORITHM_REPOS } from './algorithm-locations.js';

// impure — one repo's HEAD short-hash via git itself (a shallow clone's
// HEAD file holds a ref, not a sha). Null on any failure — an absent
// reading is honest; a guessed one is not.
const gitHead = (repo) => new Promise((resolve) => {
  execFile('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { timeout: 2000 }, (err, stdout) => {
    resolve(err ? null : String(stdout).trim() || null);
  });
});

const algorithmPulse = async () => {
  const out = {};
  for (const [name, repo] of Object.entries(ALGORITHM_REPOS)) {
    let cloned = false;
    try { cloned = (await stat(path.join(repo, '.git'))).isDirectory(); } catch { /* not cloned */ }
    out[name] = {
      localPath: repo,
      cloned,
      head: cloned ? await gitHead(repo) : null,
    };
  }
  try {
    out.lastSynced = JSON.parse(await readFile(algorithmSyncStampPath(), 'utf8')).syncedAt ?? null;
  } catch { out.lastSynced = null; }
  return out;
};

// impure — the queue folded by what the operator must DO with it. Shared: the
// marketing pipeline_state tool and the Optio's house-state fold read the
// SAME posture (one computation, never a maintained copy). Placeholders
// (the CoS audit's G4 — staging that holds a slot without copy) count
// SEPARATELY: an operator decision is waiting only when real copy waits.
export const queuePosture = async () => {
  const entries = await postQueue.load();
  const now = Date.now();
  const by = { draft: 0, approved: 0, sending: 0, sent: 0, failed: 0, rejected: 0, withdrawn: 0 };
  let nextScheduled = null;
  let placeholders = 0;
  for (const e of entries) {
    by[e.status] = (by[e.status] || 0) + 1;
    if (e.status === 'draft' && e.placeholder === true) placeholders += 1;
    if ((e.status === 'draft' || e.status === 'approved') && e.scheduledFor) {
      const t = Date.parse(e.scheduledFor);
      if (!Number.isNaN(t) && t > now && (nextScheduled === null || t < Date.parse(nextScheduled))) {
        nextScheduled = e.scheduledFor;
      }
    }
  }
  return {
    counts: by,
    pendingApproval: by.draft - placeholders,
    placeholders,
    awaitingSend: by.approved,
    failed: by.failed,
    nextScheduled,
  };
};

// impure — the being's own card ground: where every rendered card lands.
const cardGround = async (wallet, laneId) => {
  if (!wallet || !laneId) return null;
  try {
    const { path: ground } = await ensureBeingGround(wallet, laneId);
    if (!ground) return null;
    const cards = path.join(ground, 'cards');
    const names = await readdir(cards).catch(() => []);
    return { dir: cards, cards: names.filter((n) => n.endsWith('.png')).length };
  } catch {
    return null;
  }
};

/**
 * The whole posture, computed. impure (disk, git, stores).
 * @param {{laneId?: string|null, wallet?: string|null}} who
 * @returns {Promise<{queue: object, weeklySlot: object|null, cardGround: object|null,
 *   algorithm: object}>}
 */
export const computePipelineState = async ({ laneId = null, wallet = null } = {}) => {
  const [queue, weekly, ground, algorithm] = await Promise.all([
    queuePosture().catch(() => ({ error: 'queue store unreadable' })),
    // The weekly plan is the house's own (no wallet, no house, no slot).
    wallet
      ? import('./weekly-plan.js').then(({ weeklyPlanStoreFor }) => weeklyPlanStoreFor(wallet)).then((plan) => plan.todaysSlot()).catch(() => null)
      : Promise.resolve(null),
    cardGround(wallet, laneId),
    algorithmPulse(),
  ]);
  return { queue, weeklySlot: weekly, cardGround: ground, algorithm };
};
