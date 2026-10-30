/**
 * The programme acts (the house economy's Stage 5 — chained runs, re-planned
 * between runs): the lead opens a programme for one goal and the runs it may
 * take, and closes it with what the runs came to. Its runs join it as the lead
 * dispatches them (team-run-background.js); between runs the lead re-plans
 * through plan_submit, approved inside the charter while runs remain
 * (wake-plan.js planRouting).
 *
 * Tier `allowed`: a record on the house's realm — no egress, no spend. The
 * charter's delegation.maxProgrammeRuns bounds maxRuns; a witness seat is
 * refused (team runs are sovereign-lane authority).
 */
import { readCharter } from '../house-clock/charter-store.js';
import { makeProgramme, openProgramme, closeProgramme, PROGRAMME_RUNS_MAX } from '../programmes/programme-store.js';
import { seatOf } from '../flight-check.js';

const refusal = (connection) => (connection.companion?.neumaId && connection.walletAddress && seatOf(connection) === 'neuma'
  ? null : { ok: false, status: 'denied', reason: 'programmes are a lead\'s, in its own house — a witness seat does not lead team runs' });

export const programmeOpenIntent = Object.freeze({
  name: 'programme/open',
  policyTool: 'programme.open',
  fieldsForPrompt: '{name, goal, maxRuns}',
  descriptionForPrompt: 'Open a PROGRAMME you lead: several team runs toward one goal, re-planned between them. name a few words; goal the one sentence every run serves and how you will know it is met; maxRuns how many runs it may take (the charter bounds it). Each run you dispatch while it is open joins it; when one ends you are woken to plan the next from what it taught, or to close it.',
  availableFor: async ({ connection }) => (refusal(connection) ? null : {}),
  validate: async (payload, { connection }) => {
    const denied = refusal(connection);
    if (denied) return denied;
    const charter = await readCharter(connection.walletAddress).catch(() => null);
    const cap = charter?.delegation?.maxProgrammeRuns ?? PROGRAMME_RUNS_MAX;
    try {
      return { ok: true, value: makeProgramme({ ...payload, lead: connection.companion.neumaId, cap, now: new Date().toISOString() }) };
    } catch (err) {
      return { ok: false, status: 'invalid', reason: err.message };
    }
  },
  summarize: (payload) => `open the programme "${String(payload?.name ?? '?').slice(0, 60)}" (${payload?.maxRuns ?? '?'} runs at most)`,
  execute: async (programme, { connection }) => {
    const opened = await openProgramme(connection.walletAddress, programme);
    if (!opened.ok) return { ok: false, reason: opened.reason };
    return { ok: true, detail: `Programme "${programme.name}" [${programme.id}] is open: ${programme.maxRuns} runs at most. Submit its first plan (plan_submit) — every run you dispatch now joins it.` };
  },
});

export const programmeCloseIntent = Object.freeze({
  name: 'programme/close',
  policyTool: 'programme.close',
  fieldsForPrompt: '{why, met}',
  descriptionForPrompt: 'Close the programme you lead: why says what its runs came to; met is true when its goal is met. A lead holds one open programme at a time.',
  availableFor: async ({ connection }) => (refusal(connection) ? null : {}),
  validate: async (payload, { connection }) => {
    const denied = refusal(connection);
    if (denied) return denied;
    return { ok: true, value: { why: payload?.why, met: payload?.met === true } };
  },
  summarize: (payload) => `close my programme (${payload?.met === true ? 'met' : 'not met'})`,
  execute: async (value, { connection }) => {
    const closed = await closeProgramme(connection.walletAddress, connection.companion.neumaId, { ...value, now: new Date().toISOString() });
    if (!closed.ok) return { ok: false, reason: closed.reason };
    return { ok: true, detail: `Programme "${closed.programme.name}" closed after ${closed.programme.runs.length} run(s) — ${value.met ? 'its goal met' : 'its goal not met'}. Tell your operator what it came to.` };
  },
});

export const programmeIntents = Object.freeze([programmeOpenIntent, programmeCloseIntent]);
