import { randomUUID } from 'node:crypto';

const SIGHT_TTL_MS = 2 * 60_000;
const MAX_SIGHT_ENTRIES = 32;
const MAX_SIGHT_BYTES = 16 * 1024 * 1024;
const ACCEPTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const entries = new Map();
let totalBytes = 0;

const safeLane = (value) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);

const remove = (key) => {
  const existing = entries.get(key);
  if (!existing) return;
  totalBytes -= existing.bytes.length;
  entries.delete(key);
};

const prune = (now) => {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) remove(key);
  }
  while (entries.size > MAX_SIGHT_ENTRIES || totalBytes > MAX_SIGHT_BYTES) {
    remove(entries.keys().next().value);
  }
};

/**
 * Register bounded, one-use image bytes for the next model tool round. The
 * bytes never land in a being's permanent art or benchmark record. Impure.
 * @param {string} laneId
 * @param {Array<{mime: string, bytes: Buffer, width?: number, height?: number}>} frames
 * @param {number} [now]
 * @returns {string[]} opaque sight ids
 */
export const registerEphemeralSight = (laneId, frames, now = Date.now()) => {
  const lane = safeLane(laneId);
  if (!lane) throw new Error('ephemeral sight requires a sovereign lane');
  prune(now);
  const ids = [];
  for (const frame of frames || []) {
    if (!ACCEPTED_MIME.has(frame?.mime) || !Buffer.isBuffer(frame?.bytes) || frame.bytes.length === 0) {
      throw new Error('ephemeral sight requires non-empty JPEG, PNG, or WebP bytes');
    }
    if (frame.bytes.length > MAX_SIGHT_BYTES) throw new Error('ephemeral sight frame exceeds the memory ceiling');
    const id = randomUUID();
    entries.set(id, Object.freeze({
      laneId: lane,
      mime: frame.mime,
      bytes: frame.bytes,
      width: Number(frame.width) || null,
      height: Number(frame.height) || null,
      expiresAt: now + SIGHT_TTL_MS,
    }));
    totalBytes += frame.bytes.length;
    ids.push(id);
    prune(now);
  }
  return Object.freeze(ids.filter((id) => entries.has(id)));
};

/** Resolve and consume one live-view frame. A second read is refused. Impure. */
export const takeEphemeralSight = (laneId, imageId, now = Date.now()) => {
  prune(now);
  const entry = entries.get(imageId);
  if (!entry || entry.laneId !== safeLane(laneId)) return null;
  remove(imageId);
  return entry;
};
