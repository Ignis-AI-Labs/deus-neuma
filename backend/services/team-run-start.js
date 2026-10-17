// team-run-start.js — put a team to work in the BACKGROUND, fresh or RESUMED.
//
// One door for both: the lead filing team/run (intents/team-run.js), the lead
// picking up its own crashed run, and the operator's RESUME from the WORKFLOW
// window (team-live-routes.js). A resume reopens the SAME record in the SAME
// workspace — the members' files are where they left them — seeds the
// finished parts (never re-asked), statuses, batons and the operator's notes,
// and runs only what was left (Design note, 2026-10-12: […]).
//
// impure — prepares the workspace, writes the run store and the plan stamp,
// registers the live run, starts it.

import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { ensureFilesystemRoots } from './mcp-filesystem.js';
import { getDataRoot } from './data-root.js';
import { stampPlanRun, DEFAULT_WORKSPACE_BUDGET_BYTES } from './team-plan.js';
import { openRunRecord, reopenRunRecord } from './team-run-record.js';
import { registerRun, broadcastRun, claimLane, releaseLane } from './team-run-live.js';
import { runTeamInBackground, memberSlots } from './team-run-background.js';
import { runWidth } from './team-run-gate.js';
import { governsOf } from './team-clock.js';
import { startWatch } from './team-watch.js';
import { withLineKind } from './substrate-lease.js';
import { createTeamRoom } from './team-channel.js';
import { askNeuma } from './neuma-probe.js';
import { createLogger } from './logger.js';

const log = createLogger('TeamRunStart');

// impure — the one workspace object every member shares (one byte budget).
// A plan that named none gets a fresh arena in the platform's data root —
// never inside a being's lane. A resume reuses the arena the run wrote into.
const prepareWorkspace = async (workspace) => {
  const root = workspace?.root ?? path.join(getDataRoot(), 'team-arenas', `run-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  await ensureFilesystemRoots([root]);
  return { root, budgetBytes: workspace?.budgetBytes ?? DEFAULT_WORKSPACE_BUDGET_BYTES, usedBytes: 0 };
};

// pure — the member conduit: a real turn with its own hands when the member
// turn is wired; otherwise the no-tools probe, which says why a wordless
// reply ended.
const conduitFor = ({ memberTurn, names, wallet, teamWs }) => (memberTurn
  ? async (neumaId, messages, _step, hooks) => {
    // The part's own sitting: minted by the turn on a first attempt and
    // reported at once (onSession); a continuation names it (team-part.js).
    // teamRun seats the member in its run — the team channel is its to speak in.
    const { text } = await memberTurn({
      neumaId, name: names[neumaId] || neumaId, wallet,
      brief: messages.map((m) => m.content).join('\n\n'), workspace: teamWs, sessionId: hooks?.sessionId ?? null,
      teamRun: hooks?.teamRun ?? null,
      signal: hooks?.signal ?? null, onText: hooks?.onText, onReasoning: hooks?.onReasoning, onTool: hooks?.onTool,
      onSession: hooks?.onSession, onLine: hooks?.onLine,
    });
    if (!text) throw new Error('no reply — the member\'s turn ended with no words');
    return text;
  }
  : async (neumaId, messages, _step, hooks) => {
    let finish = null;
    const raw = await askNeuma(neumaId, messages, { ...hooks, onFinishReason: (r) => { finish = r; } });
    if (!String(raw).trim()) throw new Error(`no reply — the model stopped (finish: ${finish ?? 'unknown'}) before any words`);
    return raw;
  });

/**
 * @param {Object} args
 * @param {Object} args.plan - { name?, goal, steps, memberNames, workspace?, approvedAt? }
 * @param {{neumaId: string, name: string}} args.lead
 * @param {string} args.wallet - the operator's wallet
 * @param {?Object} [args.ws] - the filing socket (frames fan out by wallet anyway)
 * @param {?Object} [args.resume] - the prior record as read (reopened, not re-run)
 * @param {Object} args.deps - { checkSubstrate, getCapacity, memberTurn?, ask?, onSettled?, continueWaits? }
 * @returns {Promise<{ok: true, runId: string} | {ok: false, reason: string}>}
 */
export const startTeamRun = async ({ plan, lead, wallet, ws = null, resume = null, deps }) => {
  // One run per lead lane — claimed before the first await, so two starts
  // can never both pass and run one record (or one arena) twice.
  if (!claimLane(lead.neumaId)) return { ok: false, reason: `${lead.name || lead.neumaId} is already leading a run.` };
  try {
    return await start({ plan, lead, wallet, ws, resume, deps });
  } finally {
    releaseLane(lead.neumaId);
  }
};

// impure — the start itself, under the lane's claim.
const start = async ({ plan, lead, wallet, ws, resume, deps }) => {
  if (!(await deps.checkSubstrate())) return { ok: false, reason: 'The substrate is offline — the team cannot run right now.' };
  const { maxParallel } = await deps.getCapacity();
  const names = plan.memberNames || {};
  const tools = Boolean(deps.memberTurn) && !deps.ask;
  let teamWs = null;
  if (tools || plan.workspace) {
    try {
      teamWs = await prepareWorkspace(plan.workspace);
    } catch (err) {
      return { ok: false, reason: `The team workspace could not be prepared (${err.message}).` };
    }
  }
  const workspace = teamWs ? { root: teamWs.root, budgetBytes: teamWs.budgetBytes } : null;
  const runPlan = workspace ? { ...plan, workspace } : plan;
  const ask = deps.ask || conduitFor({ memberTurn: tools ? deps.memberTurn : null, names, wallet, teamWs });

  // The record is claimed (or reopened) BEFORE the first member starts; its
  // id is the run's id everywhere — frames, registry, the lead's report.
  let record = null;
  if (wallet) {
    try {
      record = resume
        ? await reopenRunRecord({ id: resume.id, wallet, prior: resume })
        : await openRunRecord({ wallet, plan, names, lead, workspace });
    } catch (recErr) {
      log.warn('team_run record claim', { error: recErr.message, resume: resume?.id ?? null });
      if (resume) return { ok: false, reason: `The run could not be reopened (${recErr.message}).` };
    }
  }
  const runId = record?.id ?? randomUUID();
  const statuses = resume?.statuses || {};
  const board = plan.steps.map((s) => ({
    id: s.id, role: s.role ?? null, neumaId: s.neumaId, member: names[s.neumaId] || s.neumaId,
    state: resume?.completed?.[s.id] != null ? 'done' : 'waiting', status: statuses[s.id] ?? null,
  }));
  // THE RUN'S WIDTH AND CLOCKS (#577): the plan's, as a hand last left them —
  // a resume carries each part's working time and the clocks that already acted.
  const ceiling = memberSlots(maxParallel);
  const governs = {
    ceiling,
    concurrency: runWidth(plan.concurrency ?? null, ceiling),
    clock: plan.clock ?? null,
    clocks: resume?.clocks ?? Object.fromEntries(plan.steps.filter((s) => s.clock != null).map((s) => [s.id, s.clock])),
    worked: resume?.worked ?? {},
    clockState: resume?.clockState ?? {},
    checkIn: plan.checkIn ?? null,
  };
  const entry = registerRun({
    id: runId, wallet, laneId: lead.neumaId, lead: lead.name || lead.neumaId,
    name: plan.name ?? null, goal: plan.goal, board, ws, notes: resume?.notes || {}, channel: resume?.channel || [], governs,
  });
  // A steer outlives this process: the record keeps every note — from the
  // first moment the run can be steered. The team channel likewise, and a
  // hand's change to the run's width or clocks.
  if (record?.note) entry.onNote = record.note;
  if (record?.channelPost) entry.onChannel = record.channelPost;
  if (record?.tuned) entry.onTune = record.tuned;
  // THE EYE (team-watch.js, #577): check-ins and alerts to the desk and the CoS, clock or none.
  if (wallet) startWatch(entry, { wallet, lead });
  // THE TEAM ROOM (team-channel.js): the channel, the board and every finished
  // part, kept where members read them with their own file tools.
  if (teamWs) {
    entry.room = createTeamRoom({ root: teamWs.root, name: plan.name ?? null });
    entry.room.board(board.map((e) => ({ ...e, neumaId: plan.steps.find((s) => s.id === e.id)?.neumaId })));
    entry.room.channel(entry.channel);
    for (const [stepId, text] of Object.entries(resume?.completed || {})) {
      const row = board.find((e) => e.id === stepId);
      if (row) entry.room.part(row, text);
    }
  }
  if (resume) {
    entry.parts = { ...(resume.completed || {}) };
    // An unfinished part the prior instance began continues in its own sitting.
    entry.sessions = Object.fromEntries(Object.entries(resume.sessions || {})
      .filter(([stepId]) => resume.completed?.[stepId] == null));
  }
  broadcastRun(entry, {
    type: 'operator:team_start', id: runId, background: true, lead: entry.lead, laneId: lead.neumaId,
    // A resumed run's finished parts and the operator's notes ride its
    // start: the panels show them at once, and parts are never re-run.
    ...(resume ? { resumed: true, parts: resume.completed || {}, notes: entry.notes, channel: entry.channel } : {}),
    ...(plan.name ? { name: plan.name } : {}),
    goal: plan.goal, board,
    ...governsOf(entry), worked: entry.worked, clockState: entry.clockState,
  });
  if (plan.approvedAt) await stampPlanRun(lead.neumaId, plan.approvedAt, { id: runId, status: 'running', startedAt: entry.startedAt });
  const connection = { ws, walletAddress: wallet, companion: { neumaId: lead.neumaId, name: lead.name } };
  // The run leaves the filing turn's place in the substrate line: a lead files
  // team/run MID-turn, and a run started inside that turn's context rode its
  // lease — every member decoded beside the lead without a place of its own.
  // Each member takes its own place (kind 'member'); the run's housekeeping
  // waits behind the people (kind 'background').
  const settled = withLineKind('background', () => runTeamInBackground({
    entry, plan: runPlan, connection, record, ask, maxParallel, memberTools: tools, continueWaits: deps.continueWaits,
    resume: resume ? {
      completed: resume.completed || {}, statuses, torches: resume.torches || {}, order: resume.order || [],
      // Why each part stopped — said to it as it continues. A run whose
      // backend died recorded no reason; the part is told the run stopped.
      failures: resume.failures || {},
    } : null,
  }));
  deps.onSettled?.(settled);
  return { ok: true, runId };
};
