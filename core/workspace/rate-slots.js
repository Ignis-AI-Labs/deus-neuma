import path from 'node:path';
import { writeExclusiveJson } from './exclusive-json.js';

// impure — an active legacy counter is migrated by claiming its remaining slots.
const legacyWindow = async (workspace, neumaId, legacyFile, windowMs, now) => {
  if (!legacyFile) return { windowStart: null, firstSlot: 0 };
  let current = null;
  try {
    current = await workspace._readTrustedJSON(path.join(workspace._path(neumaId), 'config', legacyFile));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const active = current && Number.isSafeInteger(current.windowStart)
    && now >= current.windowStart && now - current.windowStart < windowMs;
  if (!active) return { windowStart: null, firstSlot: 0 };
  const firstSlot = Number(current.count);
  if (!Number.isSafeInteger(firstSlot) || firstSlot < 0) throw new Error('Spend rate record is invalid');
  return { windowStart: current.windowStart, firstSlot };
};

/**
 * Claim one slot in a fixed window, or in an active legacy rolling window.
 * Every contender uses the same exclusive records, across backend processes.
 * impure — durable filesystem claims.
 */
export const consumeRateSlot = async (workspace, neumaId, { namespace, limit, windowMs, now = Date.now(), legacyFile = null }) => {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
    throw new Error('Rate limit configuration is invalid');
  }
  const legacy = await legacyWindow(workspace, neumaId, legacyFile, windowMs, now);
  const windowStart = legacy.windowStart ?? Math.floor(now / windowMs) * windowMs;
  const directory = path.join(workspace._path(neumaId), 'config', namespace);
  for (let slot = legacy.firstSlot; slot < limit; slot += 1) {
    const claimed = await writeExclusiveJson(workspace, {
      directory,
      name: `${windowStart}-${slot}`,
      record: { version: 1, windowStart, slot, consumedAt: new Date(now).toISOString() },
    });
    if (claimed) return true;
  }
  return false;
};
