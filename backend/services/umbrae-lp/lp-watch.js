// lp-watch.js — round the clock (Design note, 2026-11-13: […]).
//
// Every few minutes, for each house member with an LP wallet while the Umbrae
// liquidity connection is on, the watch looks once (no model turn) and wakes
// the member only when there is something to act on:
//
//   · its portfolio round, every `pace` minutes, while the wallet holds anything;
//   · money arrived (the operator funded it, a housemate sent to it);
//   · a position left its range (it stops earning fees there);
//   · a price spread opened between two pools of one pair (a round trip may pay).
//
// A wake goes through the house clock (house-clock/wake-signal.js), so the
// operator's charter still decides: only a member it seats wakes, inside its
// daily cap and quiet hours, held in view otherwise. The look itself also
// keeps the earnings book current (lp-book.js bookTick).

import path from 'node:path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { signedUsd } from '../../../core/wallet/lp-book-math.js';
import { isConnectionOn } from '../connections/connection-switches.js';
import { signalWake } from '../house-clock/wake-signal.js';
import { readCharter } from '../house-clock/charter-read.js';
import { charterStanding, charterSeat } from '../house-clock/charter-shape.js';
import { createLogger } from '../logger.js';
import { callUmbrae, UMBRAE_LP_CONNECTION } from './umbrae-lp-client.js';
import { lpWalletAddress } from './lp-wallet.js';
import { readHoldings } from './lp-holdings.js';
import { readPositions } from './lp-view.js';
import { bookTick } from './lp-book.js';
import { pairSpreads } from './lp-market.js';

const log = createLogger('LpWatch');

/** How often the watch looks. */
export const WATCH_EVERY_MS = 5 * 60_000;
/** The paces an operator may set, in minutes; 0 = no rounds (events still wake). */
export const PACES = Object.freeze([0, 30, 60, 120, 240, 480]);
export const DEFAULT_PACE = 60;
/** A spread between two pools of one pair at or past this wakes the members holding funds. */
export const SPREAD_WAKE_PCT = 1;
/** Below this a wallet is "empty": no rounds, no spread wakes. */
const HOLDS_USD = 1;

const paceFile = (neumaId) => path.join(neumaWorkspace._path(neumaId), 'config', 'lp-pace.json');

/** The member's pace in minutes (the operator's, else the default). impure. */
export const readLpPace = async (neumaId) => {
  const rec = await neumaWorkspace._readTrustedJSON(paceFile(neumaId)).catch(() => null);
  return PACES.includes(rec?.minutes) ? rec.minutes : DEFAULT_PACE;
};

/** Set the member's pace; the operator's act. impure — writes config and the audit line. */
export const writeLpPace = async (neumaId, minutes) => {
  if (!PACES.includes(minutes)) throw new Error(`A pace is one of ${PACES.join(', ')} minutes (0 = rounds off).`);
  await neumaWorkspace._writeJSON(paceFile(neumaId), { minutes, setAt: new Date().toISOString() });
  await neumaWorkspace.audit(neumaId, 'LP_PACE_SET', { minutes });
  return minutes;
};

/**
 * Whether this member runs round the clock, as the desk shows it: its pace,
 * and whether the house charter seats it (no seat = the watch keeps its book
 * but cannot wake it). impure — reads config and the charter.
 * @param {string} neumaId
 * @returns {Promise<{pace: number, standing: string, seated: boolean, dailyCap: number|null, quietHours: object|null}>}
 */
export const roundTheClock = async (neumaId) => {
  const pace = await readLpPace(neumaId);
  const owner = await neumaWorkspace.readOwner(neumaId).catch(() => null);
  const charter = owner?.wallet ? await readCharter(owner.wallet.toLowerCase()).catch(() => null) : null;
  const seat = charterSeat(charter, neumaId);
  return { pace, standing: charterStanding(charter), seated: Boolean(seat), dailyCap: seat?.dailyCap ?? null, quietHours: charter?.quietHours ?? null };
};

/**
 * The pairs whose pools part by at least SPREAD_WAKE_PCT, from Umbrae's pool
 * list. Pure.
 * @param {object} payload
 * @returns {Array<{pair: string, pct: number, low: string, high: string}>}
 */
export const openSpreads = (payload) => pairSpreads(payload).filter((s) => s.pct >= SPREAD_WAKE_PCT)
  .map((s) => ({ pair: s.pair, pct: Math.round(s.pct * 100) / 100, low: s.low.address, high: s.high.address }));

// Spreads already open at the last look: a spread wakes when it opens, not every look.
let spreadsSeen = new Set();

// pure — the one-line state a wake carries, so the member starts informed.
const brief = (figures, exits) => `value $${figures.valueUsd.toFixed(2)} · earned ${signedUsd(figures.earnedUsd)} · free for rewards $${figures.freeUsd.toFixed(2)}${exits.length ? ` · ${exits.length} position(s) just left range` : ''}`;

// impure — one member's look; the wakes it raised.
const watchOne = async (neumaId, payload, opened, nowMs) => {
  const address = await lpWalletAddress(neumaId);
  if (!address) return [];
  const [holdings, held, pace] = await Promise.all([
    readHoldings(address, { pools: payload }).catch(() => null), readPositions(neumaId).catch(() => ({})), readLpPace(neumaId),
  ]);
  if (!holdings) return [];
  const look = await bookTick(neumaId, { holdings, positions: held.pools ?? null, nowMs, watch: true });
  const { figures, arrivals, exits } = look;
  const line = brief(figures, exits);
  const wakes = [];
  for (const a of arrivals) {
    if (Math.abs(a.usd) < 0.01) continue;
    wakes.push({ ref: `arrived-${a.at}`, detail: { event: 'arrived', usd: Math.round(a.usd * 100) / 100, moved: a.moved.map((m) => `${Number(m.amount.toPrecision(6))} ${m.symbol}`).join(', '), brief: line } });
  }
  for (const e of exits) wakes.push({ ref: `range-${e.id}-${nowMs}`, detail: { event: 'out-of-range', position: e.id, pool: e.pool, name: e.name, bins: e.bins, active: e.active, brief: line } });
  const holds = figures.valueUsd >= HOLDS_USD;
  if (holds) for (const s of opened) wakes.push({ ref: `spread-${s.pair}-${nowMs}`, detail: { event: 'spread', ...s, brief: line } });
  if (holds && pace > 0) wakes.push({ ref: `round-${pace}m-${Math.floor(nowMs / (pace * 60_000))}`, detail: { event: 'round', everyMinutes: pace, brief: line } });
  for (const w of wakes) signalWake({ seat: neumaId, reason: 'lp', ...w });
  return wakes;
};

/**
 * One look over every LP wallet. impure, never throws.
 * @param {number} [nowMs]
 * @returns {Promise<Record<string, Array<object>>>} the wakes raised, by member
 */
export const watchLpTick = async (nowMs = Date.now()) => {
  if (!isConnectionOn(UMBRAE_LP_CONNECTION)) return {};
  const out = await callUmbrae('pools');
  const payload = out.ok ? out.payload : null;
  const spreads = payload ? openSpreads(payload) : [];
  const opened = spreads.filter((s) => !spreadsSeen.has(s.pair));
  if (payload) spreadsSeen = new Set(spreads.map((s) => s.pair));
  const raised = {};
  for (const neumaId of await neumaWorkspace.listNeuma().catch(() => [])) {
    try {
      const wakes = await watchOne(neumaId, payload, opened, nowMs);
      if (wakes.length) raised[neumaId] = wakes;
    } catch (err) {
      log.warn('LP watch could not look', { neumaId, error: err.message });
    }
  }
  return raised;
};

/**
 * Stand the watch up: a look now and every WATCH_EVERY_MS, unref'd. impure.
 * @returns {() => void} stop
 */
export const startLpWatch = () => {
  watchLpTick().catch(() => {});
  const timer = setInterval(() => { watchLpTick().catch(() => {}); }, WATCH_EVERY_MS);
  timer.unref?.();
  return () => clearInterval(timer);
};
