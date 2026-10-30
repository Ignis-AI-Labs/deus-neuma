/**
 * Plan Mode — the chat's PLAN bearing: strictly planning, never acting.
 *
 * One of the three standing chat modes (tool-policy.js CHAT_MODES). In PLAN
 * the being is read-only by construction — the mode derives the observe ACTS
 * tier, so every acting tool is held at the same gates that enforce observe —
 * and it is told to research, then present EXACTLY ONE plan through
 * plan_present. The plan rises on the same operator:plan card a team plan
 * uses, with the chat verdicts every harness carries: ACCEPT (the operator
 * chooses the execution bearing — DEFAULT or AUTO), ADJUST with notes (the
 * being revises and re-presents), DENY (the plan dies; the being awaits
 * direction). Accepting flips the connection's chat mode, so the being walks
 * out of the verdict already carrying the authority to execute.
 *
 * Sibling of team-plan.js: same per-connection pending-map broker, same
 * settle-everywhere guarantee (verdict / interrupt / close), same honesty
 * rule — an unanswered presentation tells the being nobody answered, never a
 * fabricated verdict. NO clock on the card.
 */

import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { notifyAwaitingAnswer } from './desk-notices.js';
import { noteLiveCard, clearLiveCard } from './waiting/live-cards.js';
import { submitPlan, persistApprovedPlan, PLAN_UNANSWERED, operatorRoster } from './team-plan.js';
import { teamRoster } from './team-workers.js';
import { ensureFilesystemRoots } from './mcp-filesystem.js';
import { normalizeChatMode, toolModeForChatMode } from './tool-policy.js';
import { createLogger } from './logger.js';

const log = createLogger('PlanMode');

// Does this parsed call target the plan-mode tool? Matched by NAME — like
// plan_submit, it lives on its own server so no allowlist absorbs it.
export const isPlanPresentTool = (match) => match.toolName === 'plan_present';

export const PLAN_PRESENT_TOOL = Object.freeze({
  name: 'plan_present',
  server: 'plan',
  description: 'Present your finished plan to your operator and WAIT for their verdict — args {goal, steps, notes?}. goal: the one sentence every step serves. steps: [{id, task, done?}] — the ordered acts you will take once accepted, done says when a step counts as complete. notes: anything the operator should know before ruling (optional). You may present ONE plan at a time. Verdicts: ACCEPT runs the plan (your operator picks the bearing), ADJUST returns their notes so you revise and present again, DENY ends the plan — you do not execute a denied or unanswered plan.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      goal: Object.freeze({ type: 'string', description: 'The one sentence every step serves' }),
      steps: Object.freeze({
        type: 'array',
        description: 'The ordered steps: [{id, task, done?}]',
        items: Object.freeze({
          type: 'object',
          properties: Object.freeze({
            id: Object.freeze({ type: 'string' }),
            task: Object.freeze({ type: 'string' }),
            done: Object.freeze({ type: 'string' }),
          }),
          required: Object.freeze(['id', 'task']),
        }),
      }),
      notes: Object.freeze({ type: 'string', description: 'What the operator should know before ruling (optional)' }),
    }),
    required: ['goal', 'steps'],
  }),
});

const GOAL_MAX_CHARS = 1000;
const TASK_MAX_CHARS = 2000;
const DONE_MAX_CHARS = 500;
const NOTES_MAX_CHARS = 4000;
const MAX_STEPS = 16;

/** What the being reads when no verdict came — honest, path forward named. */
export const PRESENT_UNANSWERED = Object.freeze({
  interrupted: 'The turn was interrupted before your operator ruled on the plan — it is NOT accepted. Do not execute it.',
  closed: 'The portal closed before your operator ruled on the plan — it is NOT accepted. Do not execute it.',
});

export const PRESENT_DECISIONS = Object.freeze(['accept_default', 'accept_auto', 'adjust', 'deny']);

/**
 * The PLAN MODE prompt section — a sibling string in the turn envelope, ''
 * (prompt byte-identical) for every lane not in PLAN. Pure.
 * @param {Object} connection - Portal connection (chatMode)
 * @returns {string}
 */
export const planModeSection = (connection) => {
  if (normalizeChatMode(connection?.chatMode) !== 'plan') return '';
  return [
    'PLAN MODE — your operator set this conversation to STRICTLY PLANNING.',
    'You research and think, but you NEVER act: no writes, no deletes, no sends, no intents — every acting tool is held in this mode, and reaching for one only spends a refusal.',
    'Read what you need (fs/read, fs/list, fs/search, memory recall, your own record), ask your operator anything unclear (ask_operator), and when the plan is ready present it ONCE with plan_present: the goal, the ordered steps, what "done" means for each.',
    'Your operator will ACCEPT (choosing how it runs), ADJUST it with notes — you revise and present again — or DENY it. A plan you have not presented, or one still waiting on a verdict, is never executed by you.',
  ].join('\n');
};

/**
 * Normalize plan_present args into a presentable plan, throwing an honest,
 * correctable message on any malformed part (the thrown text goes straight
 * back to the being as the tool result). Pure.
 * @param {Object|undefined} args - { goal, steps, notes? }
 * @returns {{goal: string, steps: Array, notes: string|null}}
 */
export const normalizePresentArgs = (args) => {
  const goal = typeof args?.goal === 'string' ? args.goal.trim() : '';
  if (!goal) throw new Error('plan_present needs a goal — the one sentence every step serves.');
  if (goal.length > GOAL_MAX_CHARS) throw new Error(`the goal must stay under ${GOAL_MAX_CHARS} characters.`);

  const rawSteps = Array.isArray(args?.steps) ? args.steps : [];
  if (rawSteps.length === 0) throw new Error('plan_present needs steps — at least one, each with {id, task}.');
  if (rawSteps.length > MAX_STEPS) throw new Error(`a plan holds at most ${MAX_STEPS} steps.`);

  const steps = rawSteps.map((s, i) => {
    const id = typeof s?.id === 'string' ? s.id.trim() : '';
    if (!id) throw new Error(`step ${i + 1} needs an id (a short unique label like "research" or "build").`);
    const task = typeof s?.task === 'string' ? s.task.trim() : '';
    if (!task) throw new Error(`step "${id}" needs a task — what you will do at that step.`);
    if (task.length > TASK_MAX_CHARS) throw new Error(`step "${id}" task must stay under ${TASK_MAX_CHARS} characters.`);
    const done = typeof s?.done === 'string' && s.done.trim() ? s.done.trim() : null;
    if (done && done.length > DONE_MAX_CHARS) throw new Error(`step "${id}" done criteria must stay under ${DONE_MAX_CHARS} characters.`);
    return { id, task, ...(done ? { done } : {}) };
  });

  const notes = typeof args?.notes === 'string' && args.notes.trim()
    ? args.notes.trim().slice(0, NOTES_MAX_CHARS)
    : null;
  return { goal, steps, notes };
};

// impure — try to send; a portal that closed mid-review must not throw,
// but the drop is logged so it never disappears silently.
const _safeSend = (ws, payload) => {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  } catch (err) {
    log.debug('plan-present send dropped — portal closed', { type: payload.type, error: err.message });
  }
};

const _pending = (connection) => {
  if (!connection._pendingPresents) connection._pendingPresents = new Map();
  return connection._pendingPresents;
};

// impure — the mode a verdict leaves standing, declared to the desk the same
// way the composer's own chip declares it: connection state first, then the
// ack pair so the desk never shows a mode the portal isn't holding.
const _applyChatMode = (connection, mode) => {
  connection.chatMode = normalizeChatMode(mode);
  connection.toolMode = toolModeForChatMode(connection.chatMode);
  _safeSend(connection.ws, { type: 'chat:mode', mode: connection.chatMode });
  _safeSend(connection.ws, { type: 'tool:mode', mode: connection.toolMode });
};

/**
 * impure — put a presented plan before the operator and wait for the verdict.
 * Resolves { status: 'accept_default' | 'accept_auto' | 'deny' } or
 * { status: 'adjust', notes } on a real decision, or
 * { status: 'interrupted' | 'closed' }. Never rejects — and never times out:
 * the card waits for the human. The plan rides the SAME operator:plan frame
 * a team plan uses, marked kind: 'chat' so the card shows the chat verdicts.
 *
 * @param {Object} connection - Portal connection (ws + pending map)
 * @param {Object} req - { goal, steps, notes, member, signal? }
 * @returns {Promise<{status: string, notes?: string}>}
 */
export const requestPlanVerdict = (connection, { goal, steps, notes, member, signal }) =>
  new Promise((resolve) => {
    const id = randomUUID();
    const pending = _pending(connection);

    const settle = (outcome) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      clearLiveCard(id);
      if (signal) signal.removeEventListener('abort', entry.onAbort);
      // The desk learns the card settled on EVERY path — no dangling buttons.
      _safeSend(connection.ws, {
        type: 'operator:plan_resolved', id, status: outcome.status,
        ...(outcome.notes ? { notes: outcome.notes } : {}),
      });
      resolve(outcome);
    };

    const onAbort = () => settle({ status: 'interrupted' });
    pending.set(id, { settle, onAbort });

    if (signal) {
      if (signal.aborted) { settle({ status: 'interrupted' }); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    notifyAwaitingAnswer(connection, { what: 'plan', detail: goal });
    _safeSend(connection.ws, {
      type: 'operator:plan',
      id,
      kind: 'chat',
      goal,
      ...(notes ? { detail: notes } : {}),
      // The card renders each step's owner — in PLAN MODE the planner is the
      // only hands the plan names.
      steps: steps.map((s) => ({ id: s.id, member, task: s.task, ...(s.done ? { done: s.done } : {}), needs: [] })),
    });
    noteLiveCard(connection, { id, kind: 'plan', title: goal });
  });

/**
 * impure — deliver the operator's verdict to a pending presentation.
 * Untrusted: unknown ids and unknown decisions are dropped; adjust notes are
 * clipped at the boundary. On ACCEPT the connection's chat mode flips HERE,
 * at the verdict — the being's next act already carries the new bearing.
 * @param {Object} connection - Portal connection
 * @param {string} id - Plan id from operator:plan
 * @param {string} decision - PRESENT_DECISIONS member
 * @param {string} [notes] - The operator's adjustment notes (adjust only)
 * @returns {boolean} Whether a pending presentation was settled
 */
export const resolvePlanVerdict = (connection, id, decision, notes) => {
  if (!PRESENT_DECISIONS.includes(decision)) return false;
  const entry = connection._pendingPresents?.get(id);
  if (!entry) return false;
  const text = typeof notes === 'string' ? notes.trim().slice(0, NOTES_MAX_CHARS) : '';
  if (decision === 'accept_default' || decision === 'accept_auto') {
    _applyChatMode(connection, decision === 'accept_auto' ? 'auto' : 'default');
    entry.settle({ status: decision });
    return true;
  }
  entry.settle(decision === 'adjust'
    ? { status: 'adjust', ...(text ? { notes: text } : {}) }
    : { status: 'deny' });
  return true;
};

/**
 * impure — settle everything still pending as closed (portal torn down).
 * @param {Object} connection - Portal connection being torn down
 */
export const expirePendingPresents = (connection) => {
  const pending = connection._pendingPresents;
  if (!pending) return;
  for (const entry of [...pending.values()]) entry.settle({ status: 'closed' });
};

/**
 * The full presentation path used by the portal dispatcher: PLAN MODE only
 * (the tool is advertised only there; a stale call refuses honestly),
 * normalize the args, wait on the operator's verdict, answer what the being
 * does next. Never throws on the verdict path; malformed input returns the
 * correction as an error result.
 *
 * impure (broker + connection state)
 *
 * @param {Object} connection - Portal connection
 * @param {Object|undefined} args - raw tool args
 * @returns {Promise<Object>} the tool result
 */
export const handlePlanPresent = async (connection, args) => {
  const tool = 'plan/plan_present';
  if (normalizeChatMode(connection.chatMode) !== 'plan') {
    return { tool, status: 'error', error: 'plan_present only answers in PLAN MODE — your operator sets the mode at the composer. If you are ready to act, say so in words instead.' };
  }

  let goal, steps, notes;
  try {
    ({ goal, steps, notes } = normalizePresentArgs(args));
  } catch (err) {
    return { tool, status: 'error', error: err.message };
  }

  const outcome = await requestPlanVerdict(connection, {
    goal, steps, notes,
    member: connection.companion?.name || 'you',
    signal: connection.activeTurn?.signal,
  });

  if (outcome.status === 'accept_default') {
    return {
      tool, status: 'ok',
      content: 'Your operator ACCEPTED the plan — it runs NOW, under their eye: gated acts raise their card per act (the mode is DEFAULT). Execute the steps in order and keep your operator posted as each completes.',
    };
  }
  if (outcome.status === 'accept_auto') {
    return {
      tool, status: 'ok',
      content: 'Your operator ACCEPTED the plan — it runs NOW, hands-off (the mode is AUTO): gated acts flow without the per-act card, but the protocol guard still holds deletes, outbound posts, spends, and shell runs for their card. Execute the steps in order and keep your operator posted as each completes.',
    };
  }
  if (outcome.status === 'adjust') {
    return {
      tool, status: 'ok',
      content: outcome.notes
        ? `Your operator asked for ADJUSTMENTS before this plan can run:\n${outcome.notes}\n\nRevise the plan and present it again.`
        : 'Your operator asked for ADJUSTMENTS before this plan can run. Ask them what should change (ask_operator), then revise and present again.',
    };
  }
  if (outcome.status === 'deny') {
    return {
      tool, status: 'ok',
      content: 'Your operator DENIED this plan — it does not run. Do not execute any part of it; await their direction (you may ask what they would rather see, ask_operator).',
    };
  }
  return { tool, status: 'ok', content: PRESENT_UNANSWERED[outcome.status] || PRESENT_UNANSWERED.closed };
};

// --- Team plan submission (team/plan_submit) — the OTHER plan broker's
// portal-side handler. Moved verbatim from portal-stream.js (size-law
// breakdown Part 1 step 7 / #278): the chat-modes module now holds both
// plan handlers — plan_present (PLAN mode, above) and plan_submit (the
// team plan, brokered by team-plan.js). Direction law holds: this module
// imports team-plan.js, never portal-stream.

// impure — normalize, resolve against the house, validate with the ENGINE's
// gate, then pause on the operator's verdict. An approved plan is frozen onto
// the connection as the plan of record (the team_run gate reads it there).
const _handlePlanSubmit = async (connection, args, opts = {}) => {
  const tool = 'team/plan_submit';
  if (!connection.walletAddress) {
    return { tool, status: 'error', error: 'This portal has no operator wallet bound — a plan needs a house to draw its team from.' };
  }

  let outcome, plan, roster;
  try {
    // the house's beings, and its workers (team-workers.js: steps, never seats)
    roster = await teamRoster(connection.walletAddress, await operatorRoster(connection.walletAddress));
    ({ outcome, plan } = await submitPlan(connection, args, {
      roster,
      signal: connection.activeTurn?.signal,
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      // A house wake has no one at the desk: its plan goes the charter's way.
      ...(connection._planRoute ? { decide: connection._planRoute } : {}),
    }));
  } catch (err) {
    // Malformed input — the message names the correction, so hand it back.
    return { tool, status: 'error', error: err.message };
  }

  if (outcome.status === 'approve') {
    // The plan of record — team_run executes exactly this, so the display
    // names ride along frozen (the roster could change between now and then).
    const memberNames = Object.freeze(Object.fromEntries(roster.map((m) => [m.neumaId, m.name || m.neumaId])));
    connection._approvedPlan = Object.freeze({ ...plan, memberNames, approvedAt: new Date().toISOString() });
    // The ASSIGNED WORKSPACE takes effect AT APPROVAL (#171): from here on,
    // every write on this portal — the LEAD assembling artifacts included —
    // is confined to this root and metered against its byte budget. The
    // arena is created if absent and reachable by the filesystem server.
    let wsLine = '';
    if (plan.workspace) {
      try {
        await fs.mkdir(plan.workspace.root, { recursive: true });
        await ensureFilesystemRoots([plan.workspace.root]);
      } catch (err) {
        connection._approvedPlan = null;
        return { tool, status: 'error', error: `The assigned workspace could not be prepared (${err.message}) — fix the root path and submit again.` };
      }
      connection._teamWorkspace = {
        root: plan.workspace.root, budgetBytes: plan.workspace.budgetBytes, usedBytes: 0,
      };
      wsLine = ` The team's assigned workspace is ${plan.workspace.root} with a ${Math.round(plan.workspace.budgetBytes / (1024 * 1024))}MB space budget — ALL file work stays inside it.`;
    } else {
      connection._teamWorkspace = null;
    }
    // The approval becomes durable HERE: the record to the workspace (it
    // survives relink and rides the PLAN OF RECORD prompt section every
    // turn), the LEAD's own steps onto its ledger — when tasks are formed.
    // Only the operator's own card says yes on this road (a wake's route never
    // approves here): the yes is stamped theirs, and the dispatch gate honours it
    // as it honours their yes in the house clock (ruled 2026-10-19: […]).
    const { note } = await persistApprovedPlan(connection, plan, roster, {
      approvedAt: connection._approvedPlan.approvedAt,
      ...(connection._planRoute ? {} : { approvedBy: { kind: 'operator', via: 'chat' } }),
    });
    const label = plan.name ? `"${plan.name}"` : 'you submitted';
    return {
      tool, status: 'ok',
      content: `Your operator APPROVED the plan ${label}. It is now the standing plan of record — it survives this session and stands until a new plan supersedes it. File the team/run intent to put the team to work on it, and keep your operator posted as parts complete.${wsLine}${note}`,
    };
  }
  if (outcome.status === 'revise') {
    return {
      tool, status: 'ok',
      content: outcome.notes
        ? `Your operator asked for REVISIONS before this plan can run:\n${outcome.notes}\n\nRevise the plan and submit it again.`
        : 'Your operator asked for REVISIONS before this plan can run. Ask them what should change (ask_operator), then revise and submit again.',
    };
  }
  // A wake's route says itself where the plan went (house-clock/wake-plan.js).
  if (outcome.note) return { tool, status: 'ok', content: outcome.note };
  return { tool, status: 'ok', content: PLAN_UNANSWERED[outcome.status] || PLAN_UNANSWERED.closed };
};

// portal-stream re-imports this under its old private name for the dispatch
// fan and the `__test` proof set.
export { _handlePlanSubmit as handlePlanSubmit };
