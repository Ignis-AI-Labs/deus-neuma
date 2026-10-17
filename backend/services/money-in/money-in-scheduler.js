// The money-in watch — every 10 minutes, scan every house this backend
// serves (house-served.js, via watch-set listHouses) for what it received.
// A scheduler leg beside the security and legal watches: a platform
// guarantee, not a being's habit.
//
// The chain-access switch is read EVERY tick: off means the tick does
// nothing at all — no RPC, no price feed. Ticks never overlap: a slow scan
// (a long catch-up after the machine was off) makes the next tick skip, not
// stack.
//
// impure (timers; the scan's RPC + fs).

import { chainSettings } from '../chain/chain-access.js';
import { listHouses } from './watch-set.js';
import { scanHouse } from './money-in-scan.js';
import { createLogger } from '../logger.js';

const log = createLogger('MoneyIn.Scheduler');

/** How often the watch looks. */
export const MONEY_IN_TICK_MS = 10 * 60 * 1000;

let running = false;

/**
 * One pass over every house. Never throws. impure.
 * @returns {Promise<{ skipped?: string, houses: number }>}
 */
export const moneyInTick = async () => {
  if (running) return { skipped: 'previous scan still running', houses: 0 };
  running = true;
  try {
    if (!(await chainSettings.isEnabled())) return { skipped: 'chain access off', houses: 0 };
    const houses = await listHouses();
    for (const house of houses) {
      const result = await scanHouse(house).catch((err) => ({ ok: false, code: 'SCAN_FAILED', message: err.message }));
      if (!result.ok && result.code !== 'CHAIN_ACCESS_OFF') log.warn('money-in scan failed for a house', { house, code: result.code, message: result.message });
    }
    return { houses: houses.length };
  } finally {
    running = false;
  }
};

/**
 * Start the watch. The interval is unref'd so it never holds the process
 * open. impure.
 * @returns {() => void} stop
 */
export const startMoneyInScheduler = ({ intervalMs = MONEY_IN_TICK_MS } = {}) => {
  const timer = setInterval(() => {
    moneyInTick().catch((err) => log.error('money-in tick failed', { error: err.message }));
  }, intervalMs);
  timer.unref?.();
  log.info('money-in watch standing', { everyMs: intervalMs });
  return () => clearInterval(timer);
};
