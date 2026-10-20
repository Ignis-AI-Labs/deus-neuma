// agenda-machine.js — the MACHINE row: what this machine runs for every
// house at once. Its loops tick from process start (no phase to project), so
// each reads as one standing line with its real interval; a benchmark night
// has a real window and lands as an item (it decides when the GPU is busy).
import { getAppConfig } from '../../config.js';
import { standbySettings } from '../standby-settings.js';
import { readLatestNightStatus } from '../bench/bench-status.js';
import { CLOCK_TICK_MS } from '../house-clock/house-clock.js';
import { MONEY_IN_TICK_MS } from '../money-in/money-in-scheduler.js';
import { STATUS_TICK_MS } from '../staff/status-sweep.js';
import { TICK_MS as POST_TICK_MS } from '../social/post-scheduler.js';
import { TICK_MS as MEDITATION_TICK_MS } from '../meditation/meditation-scheduler.js';
import { TICK_MS as SECURITY_TICK_MS } from '../security/security-scheduler.js';
import { TICK_MS as LEGAL_TICK_MS } from '../legal/legal-scheduler.js';
import { stampOf, everyLabel } from './agenda-time.js';

const LOOPS = Object.freeze([
  ['post-scheduler', 'Post scheduler — sends approved posts when due', POST_TICK_MS],
  ['house-clock', 'House clock — checks every house\'s wakes', CLOCK_TICK_MS],
  ['meditation-tick', 'Meditation — checks which lanes are due', MEDITATION_TICK_MS],
  ['money-in-tick', 'Money-in — scans every house\'s watched addresses', MONEY_IN_TICK_MS],
  ['security-tick', 'Security watch — checks whether a 24 h run is due', SECURITY_TICK_MS],
  ['legal-tick', 'Legal watch — checks whether a 24 h run is due', LEGAL_TICK_MS],
  ['status-sweep', 'Optio status sweep — asks after open charges', STATUS_TICK_MS],
]);

/**
 * The machine's standing loops, the heartbeat when it is on, and the model's
 * idle unload when standby is on. Pure.
 * @param {{heartbeatMinutes: number, standby: ?{enabled: boolean, idleMinutes: number}}} cfg
 */
export const machineStanding = ({ heartbeatMinutes, standby }) => [
  ...LOOPS.map(([id, title, ms]) => ({ id, source: 'machine', lane: 'machine', title, every: everyLabel(ms) })),
  ...(heartbeatMinutes > 0
    ? [{ id: 'heartbeat', source: 'machine', lane: 'machine', title: 'Heartbeat — reflection between sessions', every: everyLabel(heartbeatMinutes * 60_000) }]
    : []),
  ...(standby?.enabled && standby.idleMinutes > 0
    ? [{ id: 'model-idle', source: 'machine', lane: 'machine', title: `Model unloads after ${standby.idleMinutes} min idle`, every: 'when idle' }]
    : []),
];

/** The latest benchmark night as an item, when its window touches the agenda's. Pure. */
export const benchItems = (night, win) => {
  const startMs = Date.parse(night?.startedAt);
  if (!Number.isFinite(startMs)) return [];
  const endMs = Date.parse(night.deadline);
  const lastMs = Number.isFinite(endMs) ? endMs : startMs;
  if (startMs > win.toMs || lastMs < win.fromMs) return [];
  const end = Number.isFinite(endMs) ? stampOf(endMs) : null;
  return [{
    id: `bench:${night.file || night.startedAt}`, source: 'bench', lane: 'machine',
    title: 'Benchmark night', ...stampOf(startMs), status: night.status || null,
    ...(end ? { endDay: end.day, endTime: end.time } : {}),
  }];
};

// the heartbeat's configured interval; a process that never loaded the app
// config (a script, a test) runs no heartbeat, so 0 is the truth there
const heartbeatMinutes = () => {
  try {
    return getAppConfig().heartbeatIntervalMinutes || 0;
  } catch {
    return 0;
  }
};

/** impure — the machine row. */
export const machineSource = async ({ win }) => {
  const [standby, night] = await Promise.all([
    standbySettings.read().catch(() => null),
    readLatestNightStatus().catch(() => null),
  ]);
  return {
    items: benchItems(night, win),
    standing: machineStanding({ heartbeatMinutes: heartbeatMinutes(), standby }),
  };
};
