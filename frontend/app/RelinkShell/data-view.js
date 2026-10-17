// data-view.js — pure view helpers for the DATA panel (a being's data integrity:
// how its own store is encrypted, isolated, and kept healthy). Kept free of
// React/DOM so the status-derivation is unit-testable. `tone` maps to a CSS
// class in DataApp; the words here are the honest, non-alarmist labels.

/**
 * Encryption posture: a being holding its OWN key (per-neuma DEK) is the strong
 * state; SHARED means it rides the global master key.
 * @param {boolean} secured  keys/dek.json present for this being
 */
export const securedTag = (secured) =>
  (secured ? { tag: 'OWN KEY', tone: 'ok' } : { tag: 'SHARED KEY', tone: 'warn' });

/**
 * Recovery posture — whether a lost key could be recovered.
 * @param {{hasRecoveryCodes?:boolean}|null|undefined} recovery
 */
export const recoveryTag = (recovery) =>
  (recovery?.hasRecoveryCodes ? { tag: 'RECOVERY SET', tone: 'ok' } : { tag: 'NO RECOVERY', tone: 'warn' });

/**
 * Storage headroom for the workspace root (host-level).
 * @param {'ok'|'low'|'critical'|'unknown'|string} level
 */
export const storageTag = (level) => {
  if (level === 'ok') return { tag: 'HEALTHY', tone: 'ok' };
  if (level === 'low') return { tag: 'LOW', tone: 'warn' };
  if (level === 'critical') return { tag: 'CRITICAL', tone: 'alert' };
  return { tag: 'UNMEASURED', tone: 'dim' };
};

/**
 * Residency — resident vs dormant. Dormancy is NOT loss (a being's essence
 * persists on disk; the substrate is just down), so it reads dim, never a warning.
 * @param {boolean} resident
 */
export const residencyTag = (resident) =>
  (resident ? { tag: 'RESIDENT', tone: 'ok' } : { tag: 'DORMANT', tone: 'dim' });

/**
 * Root alignment — whether the active workspace root matches the persisted one.
 * A mismatch (or unknown) is worth flagging before any data operation.
 * @param {boolean|'unknown'|undefined} aligned
 */
export const alignmentTag = (aligned) =>
  (aligned === true ? { tag: 'ALIGNED', tone: 'ok' } : { tag: aligned === 'unknown' ? 'UNKNOWN' : 'MISMATCH', tone: 'warn' });
