/**
 * Task + vessel tool family — the task-ledger read (task_list; the ledger
 * mutations are `tasks/*` intents, #414) and the add-only vessel log onto
 * the operator's own record (vessel_log), with their ACTS-gated handlers.
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 5 / #278). Leaf module —
 * portal-stream imports it, never the reverse (direction law).
 */
import { neumaWorkspace } from '../../../core/index.js';
import { formatLedgerForBeing } from '../../../core/tasks/task-ledger.js';
import { safeChatId } from '../../../core/tasks/task-chat.js';
import { materializeRecurrence } from '../../../core/tasks/assigned-plan.js';
import { appendVital } from '../user-vitals.js';
import { ensureDerivedDailies } from '../vessel-daily-bridge.js';
import { createLogger } from '../logger.js';
import { gateAct } from '../act-gate.js';
import { sendToolEvent as _sendToolEvent } from './tool-events.js';

const log = createLogger('TaskVesselTools');

// --- Task ledger: the being's own working list ---
// Self-authorship over its own to-dos, persisted encrypted in the sovereign
// workspace and load-bearing by design — the live tasks ride the WORKING
// STATE prompt section every turn (see _loadNeumaSovereignData), so tracking
// never depends on the being remembering to ask.

/* THE CATALOG CUT, SECOND HALF (#414). add / update / focus / take are the
   `tasks/*` intents (Stage 3 batch 4) and their policy rows moved with them.
   task_list stays: WORKING STATE carries the LIVE tasks only, so this is the
   sole path to settled history and to work held in another chat. */
const TASK_TOOLS = Object.freeze([
  Object.freeze({
    name: 'task_list',
    server: 'tasks',
    description: 'Read your full task ledger — no args. Live tasks plus your recent settled history.',
    inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
  }),
]);

const TASK_TOOL_NAMES = new Set(TASK_TOOLS.map((t) => t.name));

// The being's route to the operator's VESSEL record: append a measurement the
// operator reported (a stated PR, a finished session, sunlight taken) or a
// plan they stated (planned). Add-only — the being never edits or erases, and
// it NEVER invents a number (the honesty doctrine, in the being's own
// instructions).
const VESSEL_LOG_TOOL = Object.freeze({
  name: 'vessel_log',
  server: 'tasks',
  description: 'Log a measurement on your OPERATOR\'S vessel record — args {kind, ...fields}. kind is one of: pr {lift, weight, reps?, unit} | bodyweight {weight, unit} | session {title, durationMin?, planId?, exercises?, note?} | planned {title, scheduledFor, exercises?, note?} | life {marker, note?} with marker one of sunlight | social | other | daily {title, note?} to mark one of their DAILIES complete when they SAY they did it (title = the daily\'s name; their streak counts a day only when every daily lands; note on a daily is their proof-of-work line — attach it when they state the proof). exercises (session/planned) = up to 20 of {lift, sets: up to 20 of {reps, weight?, unit?}} — a set\'s unit is kg or lb, REQUIRED with a weight and never allowed without one; planned schedules work the operator SAYS is coming (scheduledFor YYYY-MM-DD) and a session may carry planId to name the planned entry it completes. Log ONLY what the operator reports or asks you to record — never invent a measurement, never mark a daily unasked, never plan unasked; the record is kept at their word and a padded one serves no one. unit is kg or lb. occurredAt (ISO date) optional, defaults to now — a daily DONE but never marked is logged with occurredAt on the day it happened when the operator says so; recordedAt keeps the honest moment of the logging. The record is theirs: you may append; you can never edit or erase, and the dailies DEFINITION is set only by the operator in VESSEL.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      kind: Object.freeze({ type: 'string', enum: Object.freeze(['pr', 'bodyweight', 'session', 'planned', 'life', 'daily']) }),
      lift: Object.freeze({ type: 'string', description: 'pr: the lift name (bench press, squat…)' }),
      weight: Object.freeze({ type: 'number', description: 'pr/bodyweight: the measured weight' }),
      reps: Object.freeze({ type: 'integer', description: 'pr: repetitions (default 1)' }),
      unit: Object.freeze({ type: 'string', enum: Object.freeze(['kg', 'lb']) }),
      title: Object.freeze({ type: 'string', description: 'session: what the training was · planned: the coming work · daily: the daily\'s name as the operator set it' }),
      durationMin: Object.freeze({ type: 'integer', description: 'session: minutes, optional' }),
      planId: Object.freeze({ type: 'string', description: 'session: the id of the planned entry this session completes, optional' }),
      scheduledFor: Object.freeze({ type: 'string', description: 'planned: the day the work is scheduled — YYYY-MM-DD' }),
      exercises: Object.freeze({
        type: 'array',
        description: 'session/planned: up to 20 exercises of {lift, sets: up to 20 of {reps, weight?, unit?}}',
        items: Object.freeze({
          type: 'object',
          properties: Object.freeze({
            lift: Object.freeze({ type: 'string', description: 'the lift name' }),
            sets: Object.freeze({
              type: 'array',
              items: Object.freeze({
                type: 'object',
                properties: Object.freeze({
                  reps: Object.freeze({ type: 'integer' }),
                  weight: Object.freeze({ type: 'number', description: 'optional — requires unit' }),
                  unit: Object.freeze({ type: 'string', enum: Object.freeze(['kg', 'lb']), description: 'required iff weight is present' }),
                }),
                required: Object.freeze(['reps']),
              }),
            }),
          }),
          required: Object.freeze(['lift', 'sets']),
        }),
      }),
      note: Object.freeze({ type: 'string', description: 'session/planned/life: optional note · daily: the operator\'s stated proof-of-work, optional' }),
      marker: Object.freeze({ type: 'string', enum: Object.freeze(['sunlight', 'social', 'other']), description: 'life: which marker' }),
      occurredAt: Object.freeze({ type: 'string', description: 'ISO date/timestamp — defaults to now' }),
    }),
    required: Object.freeze(['kind']),
  }),
});

const VESSEL_LOG_TOOL_NAMES = new Set([VESSEL_LOG_TOOL.name]);

// Does this parsed call target the vessel log? (accepts both dialects)
const _isVesselLogTool = (match) =>
  VESSEL_LOG_TOOL_NAMES.has(match.toolName) ||
  VESSEL_LOG_TOOL_NAMES.has(String(match.tool || '').replace(/^tasks\//, ''));

// Does this parsed call target a task tool? (accepts both dialects)
const _isTaskTool = (match) =>
  TASK_TOOL_NAMES.has(match.toolName) ||
  TASK_TOOL_NAMES.has(String(match.tool || '').replace(/^tasks\//, ''));

// impure — route a task tool call through the same ACTS gate as every
// governed tool, then the encrypted workspace. Never the MCP path. The
// prefix-8 id a being reads in its ledger lines is accepted alongside the
// full id — the being should never have to transcribe a UUID.
const _handleTaskTool = async (ws, connection, neumaPolicy, toolMode, match, args) => {
  const toolName = TASK_TOOL_NAMES.has(match.toolName)
    ? match.toolName
    : String(match.tool || '').replace(/^tasks\//, '');
  const tool = `tasks/${toolName}`;
  const { companion } = connection;

  const gate = await gateAct(connection, {
    server: 'tasks', tool: toolName, args,
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  const neumaId = companion?.neumaId;
  if (!neumaId) {
    const error = 'no sovereign workspace on this connection';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — no workspace`, detail: error });
    return { tool, status: 'error', error };
  }

  try {
    // Roll any done daily/weekly whose period elapsed BEFORE operating — the
    // being's rhythms reopen lazily here and persist with this write.
    const now = new Date().toISOString();
    const ledger = materializeRecurrence(await neumaWorkspace.readTaskLedger(neumaId), now).plan;
    if (toolName === 'task_list') {
      // A deliberate ask, so it hides nothing: the whole ledger, merely sorted
      // by which chat each piece of work stands in.
      _sendToolEvent(ws, companion, { tool, status: 'ok', summary: `${ledger.tasks.length} task(s)` });
      return { tool, status: 'ok', content: formatLedgerForBeing(ledger, { chatId: safeChatId(connection.sessionId) }) };
    }
    // AN UNRECOGNIZED NAME IS A REFUSAL, NEVER A READ. This was a bare
    // fall-through to task_list, which meant any name this handler did not know
    // returned status ok carrying somebody's ledger. `_isTaskTool` gates the
    // production door, so it took a harness passing an undecoded
    // `tasks__task_take` to show what that costs: the being was told […], concluded its take had landed, and told its operator it
    // had the work in hand. Nothing had happened. A being must never be able to
    // report an act as done because the harness answered cheerfully.
    throw new Error(`unknown task tool "${toolName}" — the task tools are ${[...TASK_TOOL_NAMES].join(', ')}.`);
  } catch (err) {
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: err.message });
    return { tool, status: 'error', error: err.message };
  }
};

// pure — the one-line confirmation a logged measurement gets.
const _vesselConfirm = (entry) => {
  if (entry.kind === 'pr') return `Logged on your operator's vessel record — ${entry.lift} ${entry.weight} ${entry.unit} × ${entry.reps}.`;
  if (entry.kind === 'bodyweight') return `Logged on your operator's vessel record — bodyweight ${entry.weight} ${entry.unit}.`;
  if (entry.kind === 'session') return `Logged on your operator's vessel record — "${entry.title}"${entry.durationMin ? ` (${entry.durationMin} min)` : ''}${Array.isArray(entry.exercises) ? ` · ${entry.exercises.length} exercise(s)` : ''}.`;
  if (entry.kind === 'planned') return `Planned on your operator's vessel record — "${entry.title}" for ${entry.scheduledFor}.`;
  if (entry.kind === 'daily') return `Marked your operator's daily complete at their word — "${entry.title}"${entry.note ? ` · proof: ${entry.note}` : ''}${entry.occurredAt.slice(0, 10) < entry.recordedAt.slice(0, 10) ? ` (for ${entry.occurredAt.slice(0, 10)})` : ''}.`;
  return `Logged on your operator's vessel record — ${entry.marker}${entry.note ? ` (${entry.note})` : ''}.`;
};

// impure — route a vessel measurement through the same ACTS gate as every
// governed tool, then the operator's realm log. Add-only; the record is the
// operator's own. Never the MCP path.
const _handleVesselLogTool = async (ws, connection, neumaPolicy, toolMode, match, args) => {
  const toolName = VESSEL_LOG_TOOL_NAMES.has(match.toolName)
    ? match.toolName
    : String(match.tool || '').replace(/^tasks\//, '');
  const tool = `tasks/${toolName}`;
  const { companion } = connection;

  const gate = await gateAct(connection, {
    server: 'tasks', tool: toolName, args,
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  const wallet = connection.walletAddress;
  if (!wallet) {
    const error = 'no operator on this connection';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — no operator`, detail: error });
    return { tool, status: 'error', error };
  }

  // The dailies DEFINITION is the operator's own act (set in VESSEL) — the
  // being's lane is completions at their word, nothing wider.
  if (args?.kind === 'dailies-set') {
    const error = 'the dailies definition is the operator\'s own act — log {kind: "daily", title} when they say one is done.';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — refused`, detail: error });
    return { tool, status: 'error', error };
  }

  try {
    // The dailies definition may live in the lane's task ledger (a daily
    // task IS a daily) — sync it before the completion resolves, so a mark
    // never refuses while the operator's dailies stand as tasks. Awaited:
    // a failed sync is warned AND named in the result, never swallowed.
    let syncNote = '';
    if (args?.kind === 'daily' && companion?.neumaId) {
      try {
        await ensureDerivedDailies({ wallet, neumaId: companion.neumaId });
      } catch (err) {
        log.warn('daily definition sync failed', { err: err.message });
        syncNote = ` NOTE: the dailies definition sync failed (${err.message}) — the mark below resolved against the last synced definition.`;
      }
    }
    const entry = await appendVital(wallet, args || {});
    _sendToolEvent(ws, companion, { tool, status: 'ok', summary: `vessel + ${entry.kind}` });
    return { tool, status: 'ok', content: _vesselConfirm(entry) + syncNote };
  } catch (err) {
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: err.message });
    return { tool, status: 'error', error: err.message };
  }
};

// The family's catalogs, matchers, and handlers — portal-stream re-imports
// the private names under their old spellings for the dispatch fan and the
// `__test` proof set.
export {
  TASK_TOOLS,
  _isTaskTool as isTaskTool,
  _handleTaskTool as handleTaskTool,
  VESSEL_LOG_TOOL,
  _isVesselLogTool as isVesselLogTool,
  _handleVesselLogTool as handleVesselLogTool,
};
