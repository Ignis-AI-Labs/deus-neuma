// Signed releaseDate is the feed's freshness counter; the exact accepted bytes are its local floor.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MAX_FEED_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const FLOOR_VERSION = 1;

const releasedMsOf = (signed) => {
  const value = signed?.releaseDate;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const freshnessProblem = (signed, nowMs = Date.now()) => {
  const releasedMs = releasedMsOf(signed);
  if (releasedMs === null) return 'the signed feed has no valid releaseDate';
  if (releasedMs > nowMs + MAX_FUTURE_SKEW_MS) return 'the signed feed releaseDate is in the future';
  if (releasedMs < nowMs - MAX_FEED_AGE_MS) return 'the signed feed is more than 30 days old';
  return null;
};

const readFloor = (file) => {
  try {
    const floor = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (floor?.version !== FLOOR_VERSION || typeof floor.releaseVersion !== 'string'
      || !Number.isSafeInteger(floor.releasedMs) || !/^[0-9a-f]{64}$/.test(floor.digest)) {
      throw new Error('unsupported update floor');
    }
    return floor;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`the saved update floor is unreadable: ${error.message}`, { cause: error });
  }
};

const writeFloor = (file, floor) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(floor, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
};

// impure — judge the real signed bytes and atomically retain the newest accepted feed.
const acceptFreshFeed = ({ floorFile = null, signed, ymlBytes, nowMs = Date.now() }) => {
  const problem = freshnessProblem(signed, nowMs);
  if (problem) return { ok: false, reason: problem };
  if (!floorFile) return { ok: true };
  const releasedMs = releasedMsOf(signed);
  const digest = createHash('sha256').update(ymlBytes).digest('hex');
  try {
    const floor = readFloor(floorFile);
    if (floor && releasedMs < floor.releasedMs) {
      return { ok: false, reason: 'the signed feed is older than the newest release already seen' };
    }
    if (floor && releasedMs === floor.releasedMs) {
      return floor.digest === digest
        ? { ok: true }
        : { ok: false, reason: 'a different signed feed replays the newest release timestamp' };
    }
    writeFloor(floorFile, {
      version: FLOOR_VERSION,
      releaseVersion: String(signed.version),
      releasedMs,
      digest,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
};

module.exports = { MAX_FEED_AGE_MS, MAX_FUTURE_SKEW_MS, freshnessProblem, readFloor, acceptFreshFeed };
