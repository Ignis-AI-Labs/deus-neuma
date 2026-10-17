/**
 * Storage health — the single source of truth for disk-headroom judgment.
 *
 * Until the 2026-07-04 isolation audit, free space was measured ONLY at
 * birth preflight; past that ceremony the system was blind to disk
 * pressure while several write paths lose memory silently on a full disk
 * (journal entries, over-cap tool results). Every surface that judges
 * storage — the preflight gate, runtime health, the heartbeat's witness
 * warning — must share these thresholds so the boundary is one boundary.
 */

import { promises as fs } from 'fs';

import { MIN_FREE_DISK_GB, RECOMMENDED_FREE_DISK_GB } from './storage-thresholds.js';
export { MIN_FREE_DISK_GB, RECOMMENDED_FREE_DISK_GB } from './storage-thresholds.js';

// impure — free gigabytes at a path, or null when unmeasurable
export const freeGBAt = async (target) => {
  try {
    const stat = await fs.statfs(target);
    return (stat.bavail * stat.bsize) / 1e9;
  } catch {
    return null;
  }
};

/**
 * pure — judge free space against the shared thresholds.
 * @param {number|null} freeGB - measured free gigabytes, null when unmeasurable
 * @returns {{ level: 'ok'|'low'|'critical'|'unknown', freeGB: number|null,
 *             minGB: number, recommendedGB: number }}
 */
export const assessStorage = (freeGB) => {
  const level = freeGB === null ? 'unknown'
    : freeGB < MIN_FREE_DISK_GB ? 'critical'
    : freeGB < RECOMMENDED_FREE_DISK_GB ? 'low'
    : 'ok';
  return {
    level,
    freeGB: freeGB === null ? null : Number(freeGB.toFixed(1)),
    minGB: MIN_FREE_DISK_GB,
    recommendedGB: RECOMMENDED_FREE_DISK_GB,
  };
};

// impure — measure + judge in one step, for callers that hold only a root path
export const checkStorage = async (root) => assessStorage(await freeGBAt(root));
