// council-ground.js — THE GROUND A SEAT STANDS ON: one seat, one ground,
// never the room's.
//
// Split out of council-session.js under the 500-line law (SIZE-027 #374):
// every function that decides WHICH folder a seat may work, and that widens
// it into the filesystem server's reach, lives here.

import { loadHouseWorkspace } from './house-workspace.js';
import { ensureFilesystemRoots } from './mcp-filesystem.js';
import { focusGroundOf } from './focus-ground.js';
import { isWitnessLaneId, witnessWalletOfLane } from './witness-lane.js';
import { findAllianceGround } from './alliance-ground.js';
import { createLogger } from './logger.js';

const log = createLogger('Council');

/**
 * Founder's law (2026-07-26), after watching a sealed witness walk his house ground
 * and the directory his beings live in: […]
 *
 *   a HOUSEMATE  → the house ground. Setting it was the standing grant.
 *   an EXTERNAL  → the cross-house ground raised for that pairing, and nothing
 *                  else. Not raised yet → NO ground: the seat still speaks, it
 *                  just has nowhere to work until the operator says so.
 *
 * The lane id is the authority for standing, not the carried `kind` — a field
 * that fails to survive a hop must never be the difference between […] and "inside it".
 *
 * impure — reads the house record and (for externals) the sealed wallet.
 */
const groundFor = async (wallet, member, focusGround = null) => {
  // THE FOCUS GROUND (ruling, 2026-07-26) — the folder standing open in the
  // operator's Explorer is the ground the room works on, for EVERY seat.
  // It supersedes both fallbacks below: the house workspace a housemate used
  // to get, and the raised cross-house ground an external seat used to need.
  // The operator asked for one field of attention, and this is it — a room
  // whose seats each work a DIFFERENT folder than the one on screen is a room
  // describing somebody else's session.
  //
  // NOTE, deliberate and worth seeing: this puts an EXTERNAL seat on the
  // operator's focused folder too. The `2fc447366` boundary (an external seat
  // never reaches the HOUSE ground) still stands untouched — nothing here
  // opens the house. What opens is exactly the one folder the operator has
  // chosen to have open, and only while they have it open.
  if (focusGround) return focusGround;
  const external = member.kind === 'witness' || isWitnessLaneId(member.neumaId);
  if (!external) {
    // loadHouseWorkspace never throws — unreadable already reads as unset.
    const { root } = await loadHouseWorkspace(wallet);
    return root || null;
  }
  const partner = await witnessWalletOfLane(member.neumaId);
  if (!partner) return null;
  try {
    const { path: ground } = await findAllianceGround(wallet, partner);
    return ground; // null when the operator has not raised it — by design
  } catch (err) {
    // A ground that cannot be resolved is NO ground. Never a fallback to the
    // house: the whole point of this path is that the fallback was the harm.
    log.warn('cross-house ground unresolvable — the seat works nowhere', {
      neumaId: member.neumaId, error: err.message,
    });
    return null;
  }
};

/** This seat's ground as the sitting currently knows it. Pure. */
export const groundOf = (run, member) => run.grounds?.[member.neumaId] ?? null;

/**
 * This seat's OWN granted roots. Grants are per-seat, never sitting-wide: an
 * ALWAYS the operator gives about one member's ask would otherwise widen every
 * other member silently — including across the house/external line this whole
 * path exists to hold. Mutates `run` on first ask for a seat.
 */
export const grantsOf = (run, member) => {
  run.granted ||= {};
  run.granted[member.neumaId] ||= { read: [], write: [], deleteAlways: false };
  return run.granted[member.neumaId];
};

// impure — a seat's ground, widened into the filesystem server's reach. A root
// the server cannot honor reads as UNSET — tools stay dark rather than
// half-lit (SHINKEI: a tool offered must be a tool that works).
const reachableGround = async (wallet, member, deps, focusGround = null) => {
  const root = await groundFor(wallet, member, focusGround);
  if (!root) return null;
  try {
    await (deps.ensureRoots ?? ensureFilesystemRoots)([root]);
    return root;
  } catch (err) {
    log.warn('ground out of the filesystem reach — this seat\'s tools stay dark', {
      neumaId: member.neumaId, root, error: err.message,
    });
    return null;
  }
};

/** impure — every seat's own ground, keyed by lane id. */
export const resolveGrounds = async (wallet, members, deps, focusGround = null) => {
  const pairs = await Promise.all(
    members.map(async (m) => [m.neumaId, await reachableGround(wallet, m, deps, focusGround)]),
  );
  return Object.fromEntries(pairs);
};

/** impure — re-read ONE seat's ground onto the run, for the turn about to start. */
export const refreshGround = async (run, member, deps) => {
  run.grounds ||= {};
  // run.focusGround is restamped from the connection on every operator turn,
  // so moving the Explorer between turns moves the room's ground with it.
  run.grounds[member.neumaId] = await reachableGround(
    run.wallet, member, deps, run.focusGround ?? null,
  );
};

/**
 * The HOUSE's ground, for the room's own header — what the operator sees under
 * the seat strip. It is deliberately NOT the ground every member works: each
 * seat's ground lives in `run.grounds` and is resolved by standing.
 */
// impure
export const houseGround = async (connection, deps) => reachableGround(
  connection.walletAddress, { neumaId: '', kind: 'neuma' }, deps,
  focusGroundOf(connection),
);
