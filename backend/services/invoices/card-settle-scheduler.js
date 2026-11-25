// The card-invoice watch: every ten minutes each house's open card invoices are asked of Stripe (invoice-store.js
// settleCardInvoices). A webhook would tell the house at once, and needs a public address this desk does not have;
// asking is how it learns here. Nothing is asked while CARD PAYMENTS is off or no key is attached (settleCardInvoices
// checks both before any call). impure.
import { listHouses } from '../money-in/watch-set.js';
import { settleCardInvoices } from './invoice-store.js';
import { createLogger } from '../logger.js';

const log = createLogger('CardInvoices');
export const CARD_SETTLE_EVERY_MS = 10 * 60 * 1000;
let running = false;

/** One pass over every house. Never throws. */
export const cardSettleTick = async () => {
  if (running) return { skipped: 'the last pass is still running', paid: [] };
  running = true;
  try {
    const paid = [];
    for (const house of await listHouses().catch(() => [])) paid.push(...(await settleCardInvoices(house)).paid);
    return { paid };
  } finally {
    running = false;
  }
};

/** Start the watch; returns the stop. The timer never holds the process open. */
export const startCardSettle = ({ intervalMs = CARD_SETTLE_EVERY_MS } = {}) => {
  const timer = setInterval(() => { cardSettleTick().catch((err) => log.warn('the card-invoice pass failed', { error: err.message })); }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
};
