// Channel rate limiter — a PURE token-bucket reducer (C-01).
//
// The bridge owns the Map of bucket states (per chatKey, plus one global
// per-connection bucket — Telegram enforces an undocumented per-bot flood
// cap on top of per-chat limits) and threads state through this reducer on
// every outbound send/edit. Platform `retry-after` responses fold back in.
// No clocks in here: `now` is always an argument. Pure.

/**
 * A fresh bucket, full.
 * @param {{ capacity: number, refillPerSec: number }} limits
 * @param {number} now - epoch ms
 */
export const createBucket = ({ capacity, refillPerSec }, now) => {
  if (!(capacity > 0) || !(refillPerSec > 0)) throw new Error('createBucket: capacity and refillPerSec must be > 0');
  return Object.freeze({ capacity, refillPerSec, tokens: capacity, lastRefill: now, blockedUntil: 0 });
};

const refilled = (b, now) => {
  const tokens = Math.min(b.capacity, b.tokens + ((now - b.lastRefill) / 1000) * b.refillPerSec);
  return { ...b, tokens, lastRefill: now };
};

/**
 * Ask to spend `cost` tokens at `now`.
 * @returns {{ state: object, allowed: boolean, delayMs: number }} —
 *   allowed:false comes with the delay after which the same ask would pass.
 */
export const consult = (state, now, cost = 1) => {
  const b = refilled(state, now);
  if (now < b.blockedUntil) {
    return { state: Object.freeze(b), allowed: false, delayMs: b.blockedUntil - now };
  }
  if (b.tokens >= cost) {
    return { state: Object.freeze({ ...b, tokens: b.tokens - cost }), allowed: true, delayMs: 0 };
  }
  const delayMs = Math.ceil(((cost - b.tokens) / b.refillPerSec) * 1000);
  return { state: Object.freeze(b), allowed: false, delayMs };
};

/**
 * The platform said "slow down" — drain the bucket and hold until the
 * moment it names. Honoring the server always beats local arithmetic.
 * @param {object} state
 * @param {number} now
 * @param {number} retryAfterMs
 */
export const applyRetryAfter = (state, now, retryAfterMs) =>
  Object.freeze({
    ...refilled(state, now),
    tokens: 0,
    blockedUntil: Math.max(state.blockedUntil, now + Math.max(0, retryAfterMs)),
  });
