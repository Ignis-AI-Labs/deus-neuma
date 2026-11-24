// signedAt is the feed's freshness counter; the exact accepted bytes are its local floor.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { compareVersions } = require('./update-notes.cjs');

const MAX_FEED_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const FLOOR_VERSION = 2;

const signedMsOf = (signed) => {
  const value = signed?.signedAt;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const freshnessProblem = (signed, nowMs = Date.now()) => {
  const signedMs = signedMsOf(signed);
  if (signedMs === null) return 'the signed feed has no valid signedAt';
  if (signedMs > nowMs + MAX_FUTURE_SKEW_MS) return 'the signed feed signedAt is in the future';
  if (signedMs < nowMs - MAX_FEED_AGE_MS) return 'the signed feed was signed more than 30 days ago';
  return null;
};

const readFloor = (file) => {
  try {
    const floor = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (![1, FLOOR_VERSION].includes(floor?.version) || typeof floor.releaseVersion !== 'string'
      || !Number.isSafeInteger(floor.version === 1 ? floor.releasedMs : floor.signedMs)
      || !/^[0-9a-f]{64}$/.test(floor.digest)) {
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
const acceptFreshFeed = ({ floorFile = null, signed, ymlBytes, nowMs = Date.now(), currentVersion = null }) => {
  const problem = freshnessProblem(signed, nowMs);
  if (problem) return { ok: false, reason: problem };
  if (currentVersion !== null && !/^\d+\.\d+\.\d+$/.test(String(signed?.minimumVersion ?? ''))) {
    return { ok: false, reason: 'the signed feed has no valid minimumVersion' };
  }
  if (currentVersion !== null && compareVersions(signed?.minimumVersion, currentVersion) > 0) {
    return { ok: false, reason: `this install runs ${currentVersion}, older than the signed minimumVersion ${signed.minimumVersion}` };
  }
  if (!floorFile) return { ok: true };
  const signedMs = signedMsOf(signed);
  const digest = createHash('sha256').update(ymlBytes).digest('hex');
  try {
    const floor = readFloor(floorFile);
    const floorSignedMs = floor?.version === 1 ? null : floor?.signedMs;
    if (floorSignedMs !== null && floorSignedMs !== undefined && signedMs < floorSignedMs) {
      return { ok: false, reason: 'the signed feed is older than the newest release already seen' };
    }
    if (floorSignedMs === signedMs && floor) {
      return floor.digest === digest
        ? { ok: true }
        : { ok: false, reason: 'a different signed feed replays the newest signature timestamp' };
    }
    writeFloor(floorFile, {
      version: FLOOR_VERSION,
      releaseVersion: String(signed.version),
      signedMs,
      digest,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
};

module.exports = { MAX_FEED_AGE_MS, MAX_FUTURE_SKEW_MS, freshnessProblem, readFloor, acceptFreshFeed };
