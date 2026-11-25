// lead-run-scheduler — the pass that starts each house's due daily lead runs (lead-run-schedule.js), every ten
// minutes. Started at boot; the timer never holds the process open. impure.
import { listHouses } from '../money-in/watch-set.js';
import { readCharter } from '../house-clock/charter-store.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { startLeadRun } from './lead-run.js';
import { scheduleTick, SCHEDULE_EVERY_MS } from './lead-run-schedule.js';
import { createLogger } from '../logger.js';

const log = createLogger('LeadRunScheduler');

/** One pass, with the house's real parts. Never throws. */
export const leadRunScheduleTick = async (now = Date.now()) => {
  // The seat's acts are handed to the run here, as the operator's own press hands them (no cycle at import).
  const { salesIntents } = await import('../intents/sales-acts.js');
  return scheduleTick({
    now,
    houses: listHouses,
    start: (wallet, ask) => startLeadRun(wallet, ask, { intents: salesIntents }),
    paused: async (wallet) => (await readCharter(wallet).catch(() => null))?.paused === true,
    tell: (wallet, title, detail) => notifyOperator({ wallet, kind: KIND.companyLine, standing: STANDING.system, actor: { id: 'lead-run', name: 'daily lead run' }, ref: { schedule: 'lead-run' }, title, detail }),
  });
};

/** Start the pass; returns the stop. */
export const startLeadRunSchedule = ({ intervalMs = SCHEDULE_EVERY_MS } = {}) => {
  const timer = setInterval(() => { leadRunScheduleTick().then((r) => { if (r.started.length) log.info('daily lead runs started', { runs: r.started.length }); }, (err) => log.warn('the daily lead run pass failed', { error: err.message })); }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
};
