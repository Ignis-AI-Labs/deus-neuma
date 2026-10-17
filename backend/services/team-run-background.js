// team-run-background.js — a lead's team run, working OUTSIDE the lead's turn.
//
// Design note, 2026-10-10: […] The run used to be awaited inside the lead's tool round, so the
// operator's next message was held for the whole run and an interjection
// killed it. Here it starts, returns at once, and lives on the live registry
// (team-run-live.js): every desk of the operator watches it — each member's
// reasoning and words as they arrive, then its finished part — STOP reaches
// the decode of one member or of all of them, and the lead learns how it ended
// through its plan of record and a report file in its own lane.
//
// impure — runs the members, writes the run store, the lead's lane, the
// members' journals, and the operator's desks.

import fs from 'fs/promises';
import path from 'path';
import { runCoordinatedTeam, composeRunReport } from './team-run.js';
import { snapshotDelivery } from './team-delivery.js';
import { recordTeamRunMemories } from './team-memory.js';
import { stampPlanRun } from './team-plan.js';
import { broadcastRun, endRun, flushStepStreams } from './team-run-live.js';
import { createPartRunner } from './team-part.js';
import { notifyOperator } from './notification-bus.js';
import { KIND, STANDING } from '../../core/runtime/notification-record.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { createLogger } from './logger.js';
import { signalWake } from './house-clock/wake-signal.js';

const log = createLogger('TeamRunBackground');

/**
 * How many members may decode at once. A team works BESIDE the operator's
 * own chat (Design note, 2026-10-10: […]), so it leaves one of the rig's measured slots
 * free — a team using every slot made the operator's next word queue behind
 * the members. A one-slot rig shares its queue: nothing to leave. Pure.
 *
 * @param {number} ceiling - the rig's measured parallel capacity
 * @returns {number}
 */
export const memberSlots = (ceiling) => (Number.isInteger(ceiling) && ceiling > 1 ? ceiling - 1 : 1);

// impure — THE DESK'S ACCOUNT of a team run ending: a run that finished in a
// window the operator was not looking at is exactly the thing they asked to
// be told about.
const notifyRunEnded = (connection, runId, status, recordId) => {
  try {
    const laneId = connection?.companion?.neumaId ?? null;
    const name = connection?.companion?.name ?? 'A being';
    if (!connection?.walletAddress || !laneId) return;
    // The lead has work — the run's synthesis: the house clock may wake it.
    signalWake({ seat: laneId, reason: 'run-ended', ref: runId, detail: { status, record: recordId ?? null } });
    notifyOperator({
      wallet: connection.walletAddress,
      kind: KIND.runDone,
      standing: (connection.companion?.participantKind === 'witness' || laneId.startsWith?.('witness-'))
        ? STANDING.witness
        : STANDING.neuma,
      title: status === 'done'
        ? `${name}'s team run is complete`
        : status === 'stopped' ? `${name}'s team run was stopped` : `${name}'s team run did not finish`,
      actor: { id: laneId, name },
      ref: { runId, status, record: recordId ?? null },
    });
  } catch { /* a card must never cost a run */ }
};

// impure — the lead's full read of the run, in its own lane. The tool result
// it used to read is gone with the turn; this file is where the work waits.
const writeLeadReport = async (laneId, runId, text) => {
  const file = path.join(neumaWorkspace.pathFor(laneId), 'team', 'runs', `${runId}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${text}\n`, 'utf8');
  return file;
};

/**
 * Run the plan in the background. Resolves when the run has settled; never
 * rejects (every failure is settled into the record, the board, the lead's
 * report and the operator's card).
 *
 * @param {Object} args
 * @param {Object} args.entry - the live registry entry (team-run-live.js)
 * @param {Object} args.plan - the approved plan
 * @param {Object} args.connection - the lead's captured connection
 * @param {?Object} args.record - the open run record (team-run-record.js), or null
 * @param {Function} args.ask - (neumaId, messages, step, hooks) => Promise<string>
 * @param {number} args.maxParallel - the rig's measured ceiling (members take one less)
 * @param {?Object} [args.resume] - a prior instance's truth ({ completed, statuses, torches, order,
 *   failures — why each unfinished part stopped, said to it as it continues })
 * @param {number[]} [args.continueWaits] - the rig's waits before a part is continued (team-part.js)
 * @returns {Promise<{status: string, report: ?string}>}
 */
export const runTeamInBackground = async ({ entry, plan, connection, record, ask, maxParallel, memberTools = false, resume = null, continueWaits = undefined }) => {
  const names = plan.memberNames || {};
  const limit = memberSlots(maxParallel);
  const laneId = connection.companion.neumaId;
  const runId = entry.id;
  const send = (frame) => broadcastRun(entry, frame);
  const withNames = (board) => board.map((e) => ({ ...e, member: names[e.neumaId] || e.neumaId }));
  // Each part is worked to its end by the part runner (team-part.js): its
  // own sitting, every attempt logged, STOP reaching its decode, the
  // operator's guidance continuing it, and the run continuing it on its own
  // when an attempt stops short.
  const worked = createPartRunner({ entry, ask, limit, record, resumed: resume?.failures ?? {}, waits: continueWaits });

  let status;
  let reportPath;
  try {
    const run = await runCoordinatedTeam({
      steps: plan.steps,
      goal: plan.goal,
      ask: worked,
      maxParallel: limit,
      workspace: plan.workspace ?? null,
      memberTools,
      lead: connection.companion.name || laneId,
      // A RESUMED run seeds its finished parts (never re-asked), their
      // statuses and batons; only the unfinished steps run again.
      resume,
      // One member's failure no longer costs the parts that finished:
      // independent branches run to their end, dependents never start.
      continueOnFailure: true,
      onEvent: (e) => {
        record?.onEvent(e);
        if (e.type === 'step') {
          flushStepStreams(entry);
          send({ type: 'operator:team_part', id: runId, stepId: e.id, output: e.output, sessionId: entry.sessions[e.id] ?? null });
          // The finished part joins the team room, whole — any teammate may read it.
          const row = (entry.board || []).find((b) => b.id === e.id) || { id: e.id, neumaId: e.neumaId, member: names[e.neumaId], role: e.role };
          entry.room?.part(row, e.output);
        }
        if (e.type === 'board') {
          send({ type: 'operator:team_board', id: runId, board: withNames(e.board) });
          entry.room?.board(withNames(e.board));
        }
        if (e.type === 'torch') {
          send({ type: 'operator:team_torch', id: runId, stepId: e.id, neumaId: e.neumaId, member: names[e.neumaId] || e.neumaId, torch: e.torch });
        }
      },
    });
    // A resumed run's finished-before parts lead the order — the report and
    // the done frame account for the WHOLE run, not just this instance.
    const order = [...(resume?.order || []), ...run.order];
    const failures = run.failures ?? {};
    const failed = Object.keys(failures).length > 0;
    status = !failed ? 'done' : entry.controller.signal.aborted ? 'stopped' : 'failed';
    let delivery = null;
    if (!failed && plan.workspace?.root && connection.walletAddress) {
      try {
        delivery = await snapshotDelivery({ id: runId, by: connection.walletAddress, root: plan.workspace.root });
      } catch (delErr) {
        log.warn('team_run delivery snapshot', { error: delErr.message, runId });
      }
    }
    await record?.settle({
      status,
      statuses: run.statuses,
      torches: run.torches ?? {},
      failures,
      ...(run.evidence ? { evidence: run.evidence } : {}),
    });
    reportPath = await writeLeadReport(laneId, runId, composeRunReport({ ...run, order }, plan.steps, names))
      .catch((err) => { log.warn('team_run lead report', { error: err.message, runId }); return null; });
    send({
      type: 'operator:team_done', id: runId, status: failed ? 'error' : 'done', order,
      ...(failed ? { failures, skipped: [...(run.skipped ?? [])], stopped: status === 'stopped' } : {}),
      ...(delivery ? { delivery: { id: delivery.id, root: delivery.root } } : {}),
      ...(record ? { record: record.id } : {}),
    });
    // The run becomes each member's OWN memory — only a whole run is a
    // finished story (the SSE lane's law).
    if (!failed) {
      await recordTeamRunMemories({
        steps: plan.steps,
        completed: run.results,
        statuses: run.statuses,
        torches: run.torches ?? {},
        teamName: plan.name ?? null,
        goal: plan.goal,
        runId,
      }).catch((memErr) => log.warn('team_run memory write-back', { error: memErr.message, runId }));
    }
  } catch (err) {
    log.error('team_run failed', { error: err.message, runId });
    status = entry.controller.signal.aborted ? 'stopped' : 'failed';
    await record?.settle({ status, failure: err.message });
    reportPath = await writeLeadReport(laneId, runId, `Your team's run did not finish: ${err.message}`).catch(() => null);
    send({ type: 'operator:team_done', id: runId, status: 'error', stopped: status === 'stopped', ...(record ? { record: record.id } : {}) });
  } finally {
    endRun(runId);
  }
  await stampPlanRun(laneId, plan.approvedAt, {
    id: runId, status, startedAt: entry.startedAt, finishedAt: new Date().toISOString(), report: reportPath,
  });
  notifyRunEnded(connection, runId, status, record?.id ?? null);
  return { status, report: reportPath };
};
