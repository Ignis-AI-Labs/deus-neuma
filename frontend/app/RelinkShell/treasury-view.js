// treasury-view.js — how the TREASURY window reads. Pure.
//
// JŌHŌ SEKKEI: the window opens on what needs the operator now (spends and
// flags waiting, flight marks not OK), then how much the house holds and has
// received; the rows are the drill-down. SHINKEI: a figure the chain did not
// answer reads UNREAD, never 0; totals are summed in wei, never in floats.

import { parseEther, formatEther } from 'ethers';

const MARK = Object.freeze({
  ok: { word: 'OK', cls: 'is-ok' },
  warn: { word: 'CHECK', cls: 'is-warn' },
  fail: { word: 'FAIL', cls: 'is-fail' },
  unread: { word: 'UNREAD', cls: 'is-unread' },
});

/** A flight mark's word and class. */
export const markOf = (state) => MARK[state] || MARK.unread;

/** A balance as shown: exact ETH, or why there is none. */
export const ethLabel = (value, { configured = true } = {}) => {
  if (value === null || value === undefined) return configured ? 'UNREAD' : 'NO RPC SET';
  return `${value} ETH`;
};

/**
 * The exact sum of every balance read on one chain, and how many were unread.
 * @param {ReadonlyArray<object>} wallets
 * @param {'base'|'ethereum'} chain
 * @returns {{total: string, unread: number}}
 */
export const heldOn = (wallets, chain) => {
  let wei = 0n;
  let unread = 0;
  for (const w of wallets || []) {
    const v = w?.balances?.[chain];
    if (v === null || v === undefined) { unread += 1; continue; }
    try { wei += parseEther(String(v)); } catch { unread += 1; }
  }
  return { total: formatEther(wei), unread };
};

/** Whose wallet a row is. */
export const walletName = (w) => (w?.kind === 'operator' ? 'YOU' : String(w?.name || w?.neumaId || 'A BEING').toUpperCase());

/** A being's standing limit, in plain words. */
export const limitLabel = (w) => (w?.kind !== 'being' ? 'YOUR OWN WALLET — YOU SEND FROM IT YOURSELF' : Number(w.thresholdEth) > 0 ? `UP TO ${w.thresholdEth} ETH WITHOUT YOU` : 'EVERY SEND NEEDS YOU');

const CUSTODY = Object.freeze({ sealed: 'SEALED', bare: 'UNSEALED KEY ON DISK', none: 'NO KEY' });
/** Where a being's key stands. */
export const custodyLabel = (w) => (w?.kind === 'being' ? CUSTODY[w.custody] || 'UNKNOWN' : '—');

const STATUS = Object.freeze({ executed: 'SENT ON YOUR SIGNATURE', rejected: 'DENIED', expired: 'EXPIRED', failed: 'FAILED', executing: 'SENDING' });
/** A settled spend's outcome. */
export const historyStatus = (h) => (h?.status === 'executed' && h.autonomous ? 'SENT UNDER ITS LIMIT' : STATUS[h?.status] || String(h?.status || '').toUpperCase());

/** Whether a history row is a refusal or failure (loud) rather than a send. */
export const historyLoud = (h) => h?.status === 'failed' || h?.status === 'executing';

/**
 * The overview: what waits, what is not OK, what is held, what came in.
 * @param {?object} board
 */
export const treasuryOverview = (board) => {
  const marks = board?.marks || [];
  return {
    waiting: (board?.pending?.length || 0) + (board?.flags?.length || 0),
    pending: board?.pending?.length || 0,
    flags: board?.flags?.length || 0,
    notOk: marks.filter((m) => m.state !== 'ok').length,
    failing: marks.filter((m) => m.state === 'fail').length,
    base: heldOn(board?.wallets, 'base'),
    received: board?.moneyIn?.count || 0,
  };
};

/** The seat, in one line. */
export const seatLine = (seat) => (seat ? `QUAESTOR — ${String(seat.name || seat.laneId).toUpperCase()}` : 'NO QUAESTOR SEATED');
