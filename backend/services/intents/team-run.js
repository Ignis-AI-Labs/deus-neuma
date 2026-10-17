/**
 * The team intents — the LEAD's dispatch of the approved plan of record and
 * the team's executable review, filed as intents (Stage 3 of the
 * being-tool-surface doctrine). These were the `team_run` / `workspace_run`
 * tools (portal-stream.js); `plan_submit` STAYS a tool — it is already a
 * submission mechanism.
 *
 * Tiers (unchanged): team/run is `allowed` by default — the operator's
 * approved plan of record IS the consent, so the run never carried a card
 * (observe still holds the settle, as it held the tool, W2-007).
 * team/workspace-run is requireApproval — it carried the ACTS card before.
 * Both are sovereign-lane authority: a witness seat is refused at validate.
 */
import { seatOf } from '../flight-check.js';
import { cosDesignation } from '../staff/cos-designation.js';
import { rehydrateApprovedPlan, runUnderApproval } from '../team-plan.js';
import { isLaneRunning } from '../team-run-live.js';
import { resolveTeamCapacity } from '../team-coordinator.js';
import { runWorkspaceFile } from '../workspace-run.js';
import { testConnection as testSubstrateConnection } from '../llm-provider.js';
import { startTeamRun } from '../team-run-start.js';
import { readRun } from '../team-run-store.js';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';


// TEST SEAMS (the same three the tool carried: conduit, substrate probe,
// capacity — plus onSettled, the background run's settle promise, so a suite
// can await the run it started, and continueWaits, the rig's pause before a
// part that stopped short is continued) — set only by tests; production never does.
let seams = {};
export const setTeamRunSeams = (next) => { seams = next || {}; };

// THE MEMBER TURN — a member works its step as a real turn with its own
// tools (team-member-turn.js). Wired by the routes layer at boot
// (team-live-routes.js): that module imports the turn pipeline, which
// reaches back into the intents, so a direct import here would close a
// cycle. Unwired, members answer through the no-tools probe and their
// brief says so.
let memberTurn = null;
export const setMemberTurn = (fn) => { memberTurn = typeof fn === 'function' ? fn : null; };

// The seat law both team intents share. impure — reads the connection only.
const seatRefusal = (connection) => (
  connection.companion?.neumaId && seatOf(connection) === 'neuma'
    ? null
    : { ok: false, status: 'denied', reason: 'team runs are sovereign-lane authority; witness seats cannot invoke local-custody authority.' }
);

// THE DISPATCH GATE (the Optio office, v3.2 doctrine, Design note, 2026-09-13: while
// the operator keeps a chief of staff seated, dispatch authority rests with
// that lane — a team filing from any other lane is denied and pointed at the
// house post. NO officer seated (or an unreadable designation) = no gate: the
// read fails soft to null and behavior is byte-identical to before the
// office existed. The Optio is ITS operator's delegate over ITS house: the
// seat read is the filer's house's own (each house seats its own Optio, Founder
// 2026-10-16), and the roster check stands as the second fence — an office
// that is not a lane of this house never gates it (2026-10-12: Omberly's
// Optio denied every Aldmere team run). impure — reads the designation store
// and the filer's own lanes.
const dispatchGate = async (connection) => {
  const officer = await cosDesignation.getOfficer(connection.walletAddress).catch(() => null);
  if (!officer?.laneId || officer.laneId === connection.companion?.neumaId) return null;
  const house = await neumaWorkspace.listNeumaByOwner(connection.walletAddress).catch(() => []);
  if (!house.some((lane) => (lane?.neumaId ?? lane) === officer.laneId)) return null;
  // The Optio's own yes IS dispatch: a plan it approved inside the house's
  // charter (house-clock/wake-plan.js) is the lead's to run.
  const standing = await neumaWorkspace.readPlanRecord(connection.companion.neumaId).catch(() => null);
  if (standing?.approvedBy?.kind === 'optio' && standing.approvedBy.laneId === officer.laneId) return null;
  return {
    ok: false,
    status: 'denied',
    reason: 'The Optio holds dispatch for this house — post your proposal to it (house/post), or ask the operator to unseat the office.',
  };
};

// The rig and conduit the start uses — the declared seams when a suite set
// them, the real ones otherwise.
const startDeps = () => ({
  checkSubstrate: seams.checkSubstrate || testSubstrateConnection,
  getCapacity: seams.getCapacity || resolveTeamCapacity,
  memberTurn,
  ask: seams.ask || null,
  onSettled: seams.onSettled || null,
  ...(seams.continueWaits ? { continueWaits: seams.continueWaits } : {}),
});

// Statuses a run may be picked up from: it crashed, a member failed, or the
// operator stopped it. A done run is finished — nothing to pick up.
const RESUMABLE = Object.freeze(new Set(['lost', 'failed', 'stopped']));

// pure — the plan a recorded run ran, rebuilt from its record.
const planFromRecord = (record) => Object.freeze({
  name: record.name ?? null,
  goal: record.goal,
  steps: record.steps,
  memberNames: record.names || {},
  ...(record.workspace ? { workspace: record.workspace } : {}),
  ...(record.approvedAt ? { approvedAt: record.approvedAt } : {}),
  // The width and clock as a hand last left them (#577).
  ...(record.clock ? { clock: record.clock } : {}),
  ...(record.concurrency ? { concurrency: record.concurrency } : {}),
  ...(record.checkIn != null ? { checkIn: record.checkIn } : {}),
});

/**
 * impure — the OPERATOR picks a run up where it stopped (the WORKFLOW
 * window's RESUME): a crashed, failed or stopped lead-lane run, theirs,
 * whose lead is not leading another run right now.
 *
 * @param {{id: string, wallet: string}} args
 * @returns {Promise<{ok: true, runId: string} | {ok: false, reason: string, status?: number}>}
 */
export const resumeTeamRun = async ({ id, wallet }) => {
  const record = await readRun(id, wallet);
  if (!record || record.lane !== 'lead' || !record.lead?.neumaId) return { ok: false, status: 404, reason: 'no such run to pick up' };
  if (!RESUMABLE.has(record.status)) return { ok: false, status: 409, reason: `this run is ${record.status} — there is nothing to pick up` };
  if (isLaneRunning(record.lead.neumaId)) return { ok: false, status: 409, reason: `${record.lead.name || record.lead.neumaId} is already leading a run` };
  return startTeamRun({ plan: planFromRecord(record), lead: record.lead, wallet, resume: record, deps: startDeps() });
};

export const teamRunIntent = Object.freeze({
  name: 'team/run',
  policyTool: 'team.run',
  fieldsForPrompt: '{resume?}',
  descriptionForPrompt: 'Run the approved plan of record — your team works through real sovereign stacks while the operator watches. There must BE an approved plan (plan_submit first, and the operator\'s yes). If your team\'s run was LOST (the backend stopped), file {"resume": "<run id>"} to pick it up where it stopped — its finished parts stand.',

  availableFor: async ({ laneId, connection }) =>
    (laneId && seatOf(connection) === 'neuma' ? {} : null),

  validate: async (payload, { connection }) => {
    const seat = seatRefusal(connection);
    if (seat) return seat;
    const gate = await dispatchGate(connection);
    if (gate) return gate;
    let plan = connection._approvedPlan;
    if (!plan) {
      // A relink dropped the connection copy — the durable record still stands.
      plan = await rehydrateApprovedPlan(connection).catch(() => null);
      if (plan) connection._approvedPlan = plan;
    }
    if (!plan) {
      return { ok: false, status: 'invalid', reason: 'There is no approved plan of record — submit one with plan_submit and wait for your operator\'s approval first.' };
    }
    if (isLaneRunning(connection.companion.neumaId)) {
      return { ok: false, status: 'invalid', reason: 'Your team is already working a run — it is in the background; your plan of record says when it ends.' };
    }
    const ran = await runUnderApproval(connection.companion.neumaId, plan.approvedAt);
    // PICKING UP a run that was LOST under this same approval is that run
    // continuing — the operator's yes still covers it (nothing is lost).
    if (typeof payload?.resume === 'string' && payload.resume.trim()) {
      const record = await readRun(payload.resume.trim(), connection.walletAddress);
      if (!record || record.lead?.neumaId !== connection.companion.neumaId || record.approvedAt !== plan.approvedAt) {
        return { ok: false, status: 'invalid', reason: `There is no run ${payload.resume} of your standing plan to pick up.` };
      }
      if (record.status !== 'lost') {
        return { ok: false, status: 'invalid', reason: `Run ${record.id} is ${record.status} — only a run lost to a stopped backend is yours to pick up; your operator can resume a failed or stopped one.` };
      }
      // The run picks up AS RECORDED — in the arena its members wrote into,
      // never a fresh one beside it (the standing plan names no workspace
      // when the run was given an arena of its own).
      return { ok: true, value: { plan: planFromRecord(record), resume: record } };
    }
    // One approval is ONE run: a plan the team already ran must go back to
    // the operator before it runs again.
    if (ran) {
      const how = ran.status === 'running' ? 'lost when the backend restarted — file {"resume": "' + ran.id + '"} to pick it up' : ran.status;
      return { ok: false, status: 'invalid', reason: `This plan already ran (run ${ran.id}, ${how}). To run it afresh, submit it again (plan_submit) for your operator's approval.` };
    }
    return { ok: true, value: { plan } };
  },

  summarize: (payload) => (payload?.resume ? `pick up team run ${payload.resume} where it stopped` : 'run the approved plan of record'),

  // impure — puts the team to work in the BACKGROUND (team-run-start.js) and
  // answers at once: the lead's turn ends, the operator keeps the
  // conversation, every desk watches and can stop it. The lead learns how it
  // ended from its plan of record and the report file named there.
  execute: async ({ plan, resume = null }, { connection }) => {
    const started = await startTeamRun({
      plan,
      lead: { neumaId: connection.companion.neumaId, name: connection.companion.name || connection.companion.neumaId },
      wallet: connection.walletAddress,
      ws: connection.ws,
      resume,
      deps: startDeps(),
    });
    if (!started.ok) return started;
    return {
      ok: true,
      detail: resume
        ? `Your team is picking run ${started.runId} up where it stopped — its finished parts stand; only what was left runs. Your operator watches it live.`
        : `Your team is at work in the background (run ${started.runId}). Your operator watches every member live and can stop the run; you keep talking with them meanwhile. When it ends, your plan of record says so and names the report file to read.`,
    };
  },
});

export const teamWorkspaceRunIntent = Object.freeze({
  name: 'team/workspace-run',
  policyTool: 'team.workspace-run',
  fieldsForPrompt: '{file, timeoutMs?}',
  descriptionForPrompt: 'Run the deliverable inside the assigned team workspace — the team\'s executable review. The report you read back is the run\'s truth: clean exit, survived-the-budget, or the crash.',

  availableFor: teamRunIntent.availableFor,

  validate: async (payload, { connection }) => {
    const seat = seatRefusal(connection);
    if (seat) return seat;
    const gate = await dispatchGate(connection);
    if (gate) return gate;
    const teamWs = connection._teamWorkspace;
    if (!teamWs?.root) {
      return { ok: false, status: 'invalid', reason: 'There is no assigned team workspace on this session — workspace_run executes only inside an approved plan\'s workspace.' };
    }
    if (typeof payload?.file !== 'string' || !payload.file.trim()) {
      return { ok: false, status: 'invalid', reason: 'workspace_run needs {file} — the deliverable to run, inside the assigned workspace' };
    }
    return { ok: true, value: { file: payload.file, timeoutMs: payload?.timeoutMs, teamWs } };
  },

  summarize: (payload) => `run ${payload?.file ?? '?'} in the assigned team workspace`,

  // impure — a real confined subprocess (workspace-run.js); an invalid
  // request (outside the arena, unrunnable extension) IS the correction.
  execute: async ({ file, timeoutMs, teamWs }) => {
    let outcome;
    try {
      outcome = await runWorkspaceFile(teamWs, { file, timeoutMs });
    } catch (err) {
      return { ok: false, reason: err.message };
    }
    return outcome.ok
      ? { ok: true, detail: outcome.report }
      : { ok: false, reason: outcome.report };
  },
});
