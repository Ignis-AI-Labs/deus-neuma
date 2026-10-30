// The cost meter's reading — once a minute, the GPU's power draw (every
// NVIDIA GPU on the machine, summed) is written for each house this backend
// serves whose meter its operator turned on (house-served.js: one desk, one
// house). A house with the meter off is never read for; with every meter off
// the tick runs nothing at all. Off until the operator sets the rate.
//
// A minute the GPU gives no reading (no NVIDIA driver, a probe that timed
// out) writes nothing: the statement counts it as unmeasured, never as zero.
// Ticks never overlap.
//
// impure (timers, nvidia-smi, the house's office files).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { servedHouses } from '../house-served.js';
import { readMeter, recordPower } from './cost-store.js';
import { powerOf } from './cost-shape.js';
import { createLogger } from '../logger.js';

const log = createLogger('CostMeter');
const execFileAsync = promisify(execFile);

/** How often the meter reads. */
export const COST_METER_TICK_MS = 60 * 1000;
const PROBE_MS = 5000;

/** The watts every NVIDIA GPU draws now, summed — or null when none answers. impure. */
export const gpuWatts = async () => {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=power.draw', '--format=csv,noheader,nounits'], { timeout: PROBE_MS, encoding: 'utf8' });
    return powerOf(stdout);
  } catch {
    return null;
  }
};

let running = false;

/**
 * One reading for every served house whose meter is on. Never throws. impure.
 * @returns {Promise<{skipped?: string, houses: number, watts?: ?number}>}
 */
export const costMeterTick = async (nowMs = Date.now()) => {
  if (running) return { skipped: 'previous reading still running', houses: 0 };
  running = true;
  try {
    const houses = [];
    for (const house of await servedHouses()) {
      const meter = await readMeter(house).catch((err) => { log.warn('a cost meter could not be read', { house, error: err.message }); return null; });
      if (meter?.on) houses.push(house);
    }
    if (!houses.length) return { houses: 0 };
    const watts = await gpuWatts();
    if (watts === null) return { houses: houses.length, watts: null };
    for (const house of houses) await recordPower(house, watts, nowMs);
    return { houses: houses.length, watts };
  } finally {
    running = false;
  }
};

/**
 * Start the meter's minute. The interval is unref'd so it never holds the
 * process open. impure.
 * @returns {() => void} stop
 */
export const startCostMeter = ({ intervalMs = COST_METER_TICK_MS } = {}) => {
  const timer = setInterval(() => {
    costMeterTick().catch((err) => log.error('cost meter tick failed', { error: err.message }));
  }, intervalMs);
  timer.unref?.();
  log.info('cost meter standing', { everyMs: intervalMs });
  return () => clearInterval(timer);
};
