// THE DAILY LEAD RUN — an audience's run started by the house itself, once a day, so leads and staged emails keep
// arriving while the operator is away from the desk.
//
// Design note, 2026-11-22: […]
//
// One setting an audience, the operator's alone: ON or off, how many leads a day, the most credits that day's run may
// spend, and the hour (the machine's own clock) from which it may start. It is OFF until turned on. A due run is
// started exactly as the operator's own press starts one (lead-run.js) — as the sales seat, through the seat's acts,
// under the monthly spending rule — and it STAGES emails for review: nothing is sent by it.
// What holds a due run: the house clock's PAUSE (the operator's master switch), no place free on the model's line
// (tried again at the next pass), or a refusal the run itself gives (said to the operator once that day).
// Append-only events in the house's revenue office:
//   { type: 'set', segmentId, on, leads, credits, hour, by: 'operator', at }
//   { type: 'started', segmentId, runId, day, at }   { type: 'held', segmentId, day, why, at }
// The fold and what is due are PURE; the store and the pass are impure.

import { officeFile } from '../house-office.js';
import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { createLogger } from '../logger.js';

const log = createLogger('LeadRunSchedule');
const FILE = 'lead-run-schedule.jsonl';
export const SCHEDULE_EVERY_MS = 10 * 60 * 1000;
export const DAILY_LEADS_MAX = 200;
export const DAILY_CREDITS_MAX = 1000;
const serialize = createWriteChain();
const fileOf = (wallet) => officeFile(wallet, 'revenue', FILE);
const whole = (v, min, max, fallback) => { const n = parseInt(v, 10); return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : fallback; };

/** pure — the day of a moment on the machine's own clock ("2026-11-23"), and its hour. */
export const dayOf = (now) => { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const hourOf = (now) => new Date(now).getHours();

/**
 * pure — one audience's setting, or a thrown reason.
 * @param {{segmentId: string, on: boolean, leads?: number, credits?: number, hour?: number}} f
 */
export const makeSetting = (f) => {
  const segmentId = String(f?.segmentId ?? '').trim();
  if (!segmentId) throw new Error('segment: the audience this is the daily run of');
  const hour = whole(f?.hour, 0, 23, 9);
  return { segmentId, on: f?.on === true, leads: whole(f?.leads, 1, DAILY_LEADS_MAX, 25), credits: whole(f?.credits, 0, DAILY_CREDITS_MAX, 100), hour };
};

/** pure — each audience's setting as it stands, with the last day a run of it was started or held. */
export const foldSchedule = (events) => {
  const by = new Map();
  for (const e of events) {
    if (!e?.segmentId) continue;
    const prior = by.get(e.segmentId) ?? { segmentId: e.segmentId, on: false, leads: 25, credits: 100, hour: 9, startedDay: null, lastRun: null, held: null };
    if (e.type === 'set') by.set(e.segmentId, { ...prior, on: e.on === true, leads: e.leads, credits: e.credits, hour: e.hour, setAt: e.at });
    else if (e.type === 'started') by.set(e.segmentId, { ...prior, startedDay: e.day, lastRun: e.runId, lastStartedAt: e.at, held: null });
    else if (e.type === 'held') by.set(e.segmentId, { ...prior, held: { day: e.day, why: e.why } });
  }
  return [...by.values()];
};

/** pure — the settings whose run is owed now: on, the hour reached, and none started today. */
export const dueNow = (schedule, now) => schedule.filter((s) => s.on && hourOf(now) >= s.hour && s.startedDay !== dayOf(now));

export const readSchedule = async (wallet) => foldSchedule((await readJsonLines(fileOf(wallet)).catch(() => ({ records: [] }))).records);
/** The operator sets one audience's daily run. */
export const setSchedule = (wallet, setting) => serialize(async () => { await appendJsonLine(fileOf(wallet), { type: 'set', ...setting, by: 'operator', at: new Date().toISOString() }); return { ok: true }; });
const note = (wallet, event) => serialize(() => appendJsonLine(fileOf(wallet), { ...event, at: new Date().toISOString() })).catch(() => {});

let running = false;
/**
 * One pass over every house: each due run is started. Never throws.
 * @param {{houses: () => Promise<string[]>, start: Function, paused: (wallet: string) => Promise<boolean>, tell: Function, now?: number}} deps
 *   start(wallet, {segmentId, want, credits}) → the lead run's own answer · tell(wallet, title, detail): the operator is told
 * @returns {Promise<{started: object[], held: object[]}>}
 */
export const scheduleTick = async ({ houses, start, paused, tell, now = Date.now() }) => {
  if (running) return { started: [], held: [] };
  running = true;
  const out = { started: [], held: [] };
  try {
    for (const wallet of await houses().catch(() => [])) {
      const due = dueNow(await readSchedule(wallet).catch(() => []), now);
      if (!due.length) continue;
      if (await paused(wallet).catch(() => false)) { out.held.push(...due.map((s) => ({ wallet, segmentId: s.segmentId, why: 'the house clock is paused' }))); continue; }
      for (const s of due) {
        const got = await start(wallet, { segmentId: s.segmentId, want: s.leads, credits: s.credits }).catch((err) => ({ ok: false, reason: err.message }));
        if (got.ok) { await note(wallet, { type: 'started', segmentId: s.segmentId, runId: got.run.id, day: dayOf(now) }); out.started.push({ wallet, segmentId: s.segmentId, run: got.run.id }); continue; }
        out.held.push({ wallet, segmentId: s.segmentId, why: got.reason });
        // A place on the line, or a run already working it, frees itself: tried again at the next pass, said to nobody.
        if (/every place your model has|already working/.test(String(got.reason))) continue;
        // Anything else is the operator's to know, once that day.
        if (s.held?.day === dayOf(now) && s.held.why === got.reason) continue;
        await note(wallet, { type: 'held', segmentId: s.segmentId, day: dayOf(now), why: String(got.reason).slice(0, 300) });
        await tell(wallet, 'Today\'s lead run did not start', String(got.reason).slice(0, 300)).catch(() => {});
      }
    }
  } catch (err) {
    log.warn('the daily lead run pass failed', { error: err.message });
  } finally {
    running = false;
  }
  return out;
};
