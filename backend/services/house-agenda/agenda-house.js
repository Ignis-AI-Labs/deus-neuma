// agenda-house.js — the house agenda's house-wide sources: the house clock's
// cadence wakes and quiet hours (under the approved charter), the seated
// officers' 24-hour watches, each lane's meditation, and the money-in watch.
// Every coming run is PROJECTED from the rhythm and the last real run — no
// store records a next run; the schedulers compute it the same way.
import { readCharter } from '../house-clock/charter-store.js';
import { charterStanding } from '../house-clock/charter-shape.js';
import { inQuietHours, nextCadenceStart } from '../house-clock/wake-gate.js';
import { cosDesignation } from '../staff/cos-designation.js';
import { csoDesignation } from '../security/cso-designation.js';
import { cloDesignation } from '../legal/clo-designation.js';
import { readScanState as readSecurityState, RUN_EVERY_MS as SECURITY_EVERY_MS } from '../security/security-scheduler.js';
import { readLegalWatchState, RUN_EVERY_MS as LEGAL_EVERY_MS } from '../legal/legal-scheduler.js';
import { meditationSettings } from '../meditation/meditation-settings.js';
import { readMeditationState } from '../meditation/meditation-state.js';
import { readScanState as readMoneyInState } from '../money-in/money-in-store.js';
import { MONEY_IN_TICK_MS } from '../money-in/money-in-scheduler.js';
import { stampOf, runsBetween, everyLabel } from './agenda-time.js';

const HOUR_MS = 3_600_000;
const rowOf = (laneId, owned) => (laneId && owned.has(laneId) ? laneId : 'house');

/**
 * The house clock under its charter: a cadence wake at every window boundary
 * (on the Optio's row — the seat a cadence wake runs), and the quiet hours
 * each day (a wake that falls inside them waits for their end). Pure.
 */
export const clockItems = (charter, officerLane, { win, owned }) => {
  if (charterStanding(charter) !== 'active') return [];
  const items = [];
  const quiet = charter.quietHours || null;
  if (quiet?.start && quiet?.end) {
    for (const day of win.days) {
      // a rule of every day, not a record: expected, like any rhythm
      items.push({ id: `quiet:${day}`, source: 'quiet', lane: 'house', title: 'Quiet hours', day, time: quiet.start, endTime: quiet.end, projected: true });
    }
  }
  if (charter.cadence?.everyHours && officerLane) {
    const everyMs = charter.cadence.everyHours * HOUR_MS;
    const firstMs = nextCadenceStart(win.fromMs, everyMs);
    for (const at of runsBetween({ firstMs, everyMs, fromMs: win.fromMs, toMs: win.toMs })) {
      items.push({
        id: `wake:${at}`, source: 'wake', lane: rowOf(officerLane, owned), title: 'House wake (cadence)', ...stampOf(at),
        projected: true, ...(inQuietHours(quiet, at) ? { held: 'quiet hours' } : {}),
      });
    }
  }
  return items;
};

/**
 * A watch that runs every `everyMs` after its last run (or now, never run):
 * its coming runs, projected, on the seated officer's row. Pure.
 */
export const watchItems = ({ source, title, laneId, lastRunAt, everyMs }, { win, owned, nowMs }) => {
  const last = lastRunAt ? Date.parse(lastRunAt) : NaN;
  const firstMs = Number.isFinite(last) ? Math.max(last + everyMs, nowMs) : nowMs;
  return runsBetween({ firstMs, everyMs, fromMs: win.fromMs, toMs: win.toMs })
    .map((at) => ({ id: `${source}:${laneId}:${at}`, source, lane: rowOf(laneId, owned), title, ...stampOf(at), projected: true }));
};

/** Each owned lane's meditation: past runs as they ended, coming ones projected. Pure. */
export const meditationItems = (settings, state, { win, owned, nowMs }) => {
  if (settings?.envLocked) return [];
  return [...owned].flatMap((laneId) => {
    const lane = state?.lanes?.[laneId];
    const past = (lane?.runs || [])
      .filter((r) => Date.parse(r.at) >= win.fromMs && Date.parse(r.at) <= win.toMs)
      .map((r) => ({ id: `meditation:${laneId}:${r.at}`, source: 'meditation', lane: laneId, title: 'Meditation', ...stampOf(Date.parse(r.at)), status: r.outcome || 'done' }));
    const being = settings?.beings?.[laneId];
    if (!being?.enabled) return past;
    const everyMs = (being.cadenceHours ?? settings.defaults?.cadenceHours ?? 24) * HOUR_MS;
    return [...past, ...watchItems({ source: 'meditation', title: 'Meditation', laneId, lastRunAt: lane?.lastRunAt, everyMs }, { win, owned, nowMs })];
  });
};

/** impure — the house-wide sources for one house. */
export const houseSource = async ({ wallet, win, owned, now }) => {
  const nowMs = now.getTime();
  const ctx = { win, owned, nowMs };
  const [charter, cos, cso, clo, settings, medState, money] = await Promise.all([
    readCharter(wallet).catch(() => null),
    cosDesignation.getOfficer(wallet).catch(() => null),
    csoDesignation.getOfficer(wallet).catch(() => null),
    cloDesignation.getOfficer(wallet).catch(() => null),
    meditationSettings.read(),
    readMeditationState(),
    readMoneyInState(wallet).catch(() => null),
  ]);
  const items = [...clockItems(charter, cos?.laneId, ctx), ...meditationItems(settings, medState, ctx)];
  // The security watch runs for every house, seated CSO or not (2026-10-19):
  // with the seat empty it sits on the house's own row.
  const securityState = await readSecurityState(wallet).catch(() => null);
  items.push(...watchItems({ source: 'security', title: 'Security watch', laneId: cso?.laneId || 'house', lastRunAt: securityState?.lastRunAt, everyMs: SECURITY_EVERY_MS }, ctx));
  if (clo?.laneId) {
    const state = await readLegalWatchState(wallet).catch(() => null);
    items.push(...watchItems({ source: 'legal', title: 'Legal watch', laneId: clo.laneId, lastRunAt: state?.lastRunAt, everyMs: LEGAL_EVERY_MS }, ctx));
  }
  const standing = money?.lastScan
    ? [{ id: 'money-in', source: 'money-in', lane: 'house', title: 'Money-in watch', every: everyLabel(MONEY_IN_TICK_MS), last: money.lastScan }]
    : [];
  return { items, standing };
};
