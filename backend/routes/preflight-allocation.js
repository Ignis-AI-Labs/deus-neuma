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
 * A MODEST starting allocation — ~10% of what's available, hard-capped at
 * 20 GB. A neuma's space is expandable later (it grows into its grant over
 * time), so a first birth should never begin by claiming a large slice of
 * the disk — on a multi-TB drive an uncapped 10% suggested hundreds of GB.
 * Floored at the minimum grant. null when the disk is unmeasured OR below
 * the smallest applyable grant — POST /workspace requires gb +
 * MIN_FREE_DISK_GB <= availableGB, so the floor (MIN_FREE_DISK_GB) only
 * fits once availableGB reaches 2 * MIN_FREE_DISK_GB. Below that there is
 * no number we could suggest that POST would accept, so the UI prompts to
 * choose instead. Pure.
 */
export const suggestedAllocationGB = (availableGB) => {
  const SUGGESTED_ALLOCATION_CAP_GB = 20;
  return (availableGB != null && availableGB >= 2 * MIN_FREE_DISK_GB)
    ? Math.max(MIN_FREE_DISK_GB, Math.min(SUGGESTED_ALLOCATION_CAP_GB, Math.round(availableGB * 0.10)))
    : null;
};
