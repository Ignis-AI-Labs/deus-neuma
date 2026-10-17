/**
 * team/tune — a hand on a WORKING team run's width and clocks (#577).
 *
 * Design note, 2026-10-13: the concurrency cap […]; the deadline must be configurable — or absent. Two beings may file
 * it: the run's LEAD (its own run, from its chat) and the house's seated CoS
 * — the Optio, the operator's standing delegate over the house (v3.2
 * doctrine) — for any run of its house. A member works its part; it never
 * re-governs its run. The operator's own hand is the WORKFLOW window
 * (POST /api/v1/team/live/:id/tune).
 *
 * The tier is `allowed`: the operator's approved plan (the lead's) or the
 * operator's seating of the Optio is the consent, and every desk is told who
 * changed what (team-run-tune.js).
 */
import { seatOf } from '../flight-check.js';
import { cosDesignation } from '../staff/cos-designation.js';
import { ownedRun, runLedBy, liveRunsFor } from '../team-run-live.js';
import { tuneRun } from '../team-run-tune.js';
import { describeClock, clockFor } from '../team-clock.js';

// impure — the run this filer may tune, and in whose name — or why not.
const seatFor = async (connection, runId) => {
  if (connection._teamMember) return { reason: 'A member works its part — its lead or the house\'s Optio sets the run\'s clock and width.' };
  const laneId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  const officer = await cosDesignation.getOfficer(connection.walletAddress).catch(() => null);
  const optio = Boolean(officer?.laneId) && officer.laneId === laneId;
  const named = typeof runId === 'string' && runId.trim() ? runId.trim() : null;
  const entry = named ? ownedRun(named, wallet) : runLedBy(laneId, wallet);
  if (!entry) {
    const live = optio && !named ? liveRunsFor(wallet) : [];
    if (live.length) return { reason: `Name the run with {run}: ${live.map((r) => `${r.id} (${r.name || 'team run'}, led by ${r.lead})`).join('; ')}.` };
    return { reason: named ? `There is no working run ${named} in your house.` : 'You lead no team run that is working right now.' };
  }
  const name = connection.companion?.name || laneId;
  if (entry.laneId === laneId) return { entry, by: `${name} (lead)` };
  if (optio) return { entry, by: `${name} (the Optio)` };
  return { reason: 'Only the run\'s lead or the house\'s Optio may change its clock and width — post your proposal to them (house/post).' };
};

export const teamTuneIntent = Object.freeze({
  name: 'team/tune',
  policyTool: 'team.tune',
  fieldsForPrompt: '{run?, concurrency?, clock?, step?, checkIn?}',
  descriptionForPrompt: 'Change a WORKING team run. concurrency: how many parts work at once (the rig is the ceiling; lowering holds the next part, never cuts one). clock: how long — {"work": minutes of working time, "dueDate"?: "YYYY-MM-DD", "dueTime"?: "HH:MM", "then"?: "notify"|"wrap-up"|"stop"}, or "none" — for the whole run, or with step for one part. checkIn: minutes between the check-ins your operator and the Optio receive (0 = none). The lead tunes its own run; the house\'s Optio any run of its house (name it with run).',

  // Offered only while it can act — the lead of a working run, or the Optio
  // while its house has one (load on demand: it joins the prompt with
  // team/post, never as standing weight).
  availableFor: async ({ laneId, connection }) => {
    if (!laneId || seatOf(connection) !== 'neuma' || connection._teamMember) return null;
    if (runLedBy(laneId, connection.walletAddress)) return {};
    const officer = await cosDesignation.getOfficer(connection.walletAddress).catch(() => null);
    return officer?.laneId === laneId && liveRunsFor(connection.walletAddress).length > 0 ? {} : null;
  },

  validate: async (payload, { connection }) => {
    if (seatOf(connection) !== 'neuma') {
      return { ok: false, status: 'denied', reason: 'team runs are sovereign-lane authority; a witness seat cannot tune one.' };
    }
    const seat = await seatFor(connection, payload?.run);
    if (seat.reason) return { ok: false, status: 'invalid', reason: seat.reason };
    if (payload?.concurrency === undefined && payload?.clock === undefined && payload?.checkIn === undefined) {
      return { ok: false, status: 'invalid', reason: 'team/tune needs concurrency, clock or checkIn.' };
    }
    const step = typeof payload?.step === 'string' && payload.step.trim() ? payload.step.trim() : null;
    return {
      ok: true,
      value: {
        runId: seat.entry.id, by: seat.by, step,
        change: {
          ...(payload.concurrency !== undefined ? { concurrency: payload.concurrency } : {}),
          ...(payload.clock !== undefined ? { clock: payload.clock } : {}),
          ...(payload.checkIn !== undefined ? { checkIn: payload.checkIn } : {}),
        },
      },
    };
  },

  summarize: (payload) => [
    payload?.concurrency !== undefined ? `${payload.concurrency} at once` : null,
    payload?.clock !== undefined ? `${payload?.step ? `${payload.step}'s` : 'the run\'s'} clock` : null,
  ].filter(Boolean).join(', ') || 'tune the team run',

  // impure — the change lands on the live run, its record and every desk.
  execute: async ({ runId, by, step, change }, { connection }) => {
    const entry = ownedRun(runId, connection.walletAddress);
    if (!entry) return { ok: false, reason: 'the run has settled — there is nothing left to tune' };
    const done = tuneRun(entry, { ...change, stepId: step, by });
    if (!done.ok) return done;
    const clockWords = step ? `${step}'s clock: ${describeClock(clockFor(entry, step))}` : `the run's clock: ${describeClock(entry.clock)}`;
    return {
      ok: true,
      detail: `The run works ${done.concurrency ?? 'as wide as the rig allows'} at a time${done.note ? ` (${done.note})` : ''}; ${clockWords}. Every desk of your operator sees the change.`,
    };
  },
});
