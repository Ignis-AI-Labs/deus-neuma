/**
 * Pre-flight Allocation — the pure space arithmetic behind the launch
 * verdict and the POST /workspace gate in `preflight-routes.js`. Kept
 * pure so the verdict row and the apply-time validation can never
 * disagree on the boundary they enforce.
 */
import { MIN_FREE_DISK_GB } from '../services/storage-thresholds.js';

/**
 * Gigabytes a NEW neuma may claim: free space minus what existing neuma
 * already reserved (logical commitments they grow into). null free stays null
 * (unmeasurable). Single source of truth for the "available" rule. Pure.
 */
export const computeAvailable = (freeGB, committedGB) =>
  freeGB === null ? null : Math.max(0, freeGB - committedGB);

/**
 * Does the chosen allocation fit the space left for a NEW neuma? An
 * unset allocation (null) is "not chosen yet" — not a block. Unmeasurable space
 * (null available) can't be enforced, so it allows. Otherwise the grant plus the
 * same MIN_FREE_DISK_GB headroom the POST /workspace gate enforces must fit
 * available — so the launch verdict and apply-time validation agree on the exact
 * boundary (an allocation that READY accepts is one POST would also accept).
 * Pure.
 */
export const isAffordable = (allocationGB, availableGB) =>
  allocationGB == null ? null
    : availableGB == null ? true
    : allocationGB + MIN_FREE_DISK_GB <= availableGB;

/**
 * The starting allocation a new neuma is given without a click: 5 GB (a neuma's space grows
 * later, so a first birth never claims a large slice of the disk), capped by what is available.
 * It is always a number POST /workspace accepts (gb + MIN_FREE_DISK_GB <= availableGB), floored
 * at the minimum grant. null when the disk is unmeasured or too full for any grant. Pure.
 */
export const STARTING_ALLOCATION_GB = 5;
export const suggestedAllocationGB = (availableGB) => {
  if (availableGB == null || availableGB < 2 * MIN_FREE_DISK_GB) return null;
  return Math.max(MIN_FREE_DISK_GB, Math.min(STARTING_ALLOCATION_GB, Math.floor(availableGB - MIN_FREE_DISK_GB)));
};
