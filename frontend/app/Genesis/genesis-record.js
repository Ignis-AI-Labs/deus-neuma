// genesis-record.js — the install's genesis inscription. Pure.
//
// GENESIS plays once per install, ever (Design note, 2026-09-29: skippable, never
// replayable). What makes the first-ever opening unique is the RECORD it
// inscribes: this install's genesis moment and a hash of it, arced once
// around the mark. The same moment seeds the construct's resting turn, so
// every later IGNITION wakes this install's construct, no other's.

const pad = (n) => String(n).padStart(2, '0');

/**
 * The inscription for a genesis record: `GENESIS · 2026-09-29 03:14:07 UTC
 * · #A3F9C2E1`. The time is UTC, to the second — the moment is the fact.
 * @param {{ at: string, hash: string }} record at = ISO-8601, hash = hex
 * @returns {string}
 */
export const genesisInscription = ({ at, hash }) => {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) throw new Error('genesis record: at must be an ISO-8601 time');
  if (!/^[0-9a-fA-F]{8,}$/.test(hash)) throw new Error('genesis record: hash must be hex');
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return `GENESIS · ${day} ${time} UTC · #${hash.slice(0, 8).toUpperCase()}`;
};

/**
 * The construct's resting turn for this install, in radians (0..2π) — read
 * from the record's hash, so one install always rests the same way and two
 * installs almost never alike. Pure.
 * @param {{ hash: string }} record
 */
export const restingTurn = ({ hash }) => (parseInt(hash.slice(0, 8), 16) / 0x100000000) * Math.PI * 2;
