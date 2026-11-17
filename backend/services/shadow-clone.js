// shadow-clone — a being splits into copies of itself to work a wave of tasks at once.
//
// Design note, 2026-11-16: […]
//
// THE TRUE VERSION, ON THE ENGINE THAT EXISTS. A clone is the being itself: the same lane, so the
// same identity, memory and model, running the same turn the operator's chat runs
// (team-member-turn.js runMemberTurn → streamConsciousness), each in a sitting of its own, with the
// original's own reach (its lane, its granted folders, the folder in focus; a plan of record's
// workspace when one confines it). No plan, no card: the being decides to split, as it decides to
// read a file — and every act a clone takes passes the same gates any of the being's acts do.
//
// THE RIG'S SLOTS. A split from a wake or a part waits for its clones OUTSIDE the model line
// (substrate-lease.js linePlace) — it is only waiting — so its slot goes to them; it steps back in
// for their reports. A split from the chat does not wait at all. Clones take their places as the original's own kind of work: from the
// operator's chat they are the operator's work and may fill every slot the rig was measured to
// hold; from a wake or a team part they are house work and leave the operator's slot free. More
// clones than slots wait in line and start as others finish.
//
// EACH CLONE HAS ITS OWN SUB-CHANNEL in the chat (Design note, 2026-11-16: […]). The split streams clone:* frames to the operator's desk — each
// clone's place in line, its words as they come, its acts, its report — and the chip's record keeps
// every clone's report and acts, so the sub-channels stand again when the chat is reopened.
//
// LIKE THE JUTSU, WHAT A CLONE LEARNED COMES BACK — WITHOUT STOPPING THE ORIGINAL (Design note, 2026-11-16:
// […]). From the
// operator's chat the call returns at once: the clones work in the background, the original carries
// on with its operator, and when the last clone reports, the chat is given a new turn carrying every
// report (a WATCH on the split, chat-watch.js: never mid-turn, held for a chat that is closed). From
// a wake or a team part there is no conversation to come back to: the call waits for the reports,
// stepping out of the model line while it does. Either way every report is kept whole in its lane at
// clones/<stamp>.md.
//
// impure — runs model turns, writes the clones' sittings and the record.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { linePlace, leaseKind, withLineKind } from './substrate-lease.js';
import { listingRoom } from './read-room.js';
import { sendToolEvent } from './portal-tools/tool-events.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { noteSubChat } from './chat-threads.js';
import { armWatch, fireWatches } from './chat-watch.js';
import { createLogger } from './logger.js';

const log = createLogger('ShadowClone');

export const CLONES_MAX = 16;
const TASK_MAX = 4000;
const SHARED_MAX = 6000;
const TOOL = 'team/shadow_clone';

export const SHADOW_CLONE_TOOL = Object.freeze({
  name: 'shadow_clone',
  server: 'team',
  description: `SHADOW CLONE — split into copies of YOURSELF to work a wave of independent tasks at once — args {tasks, shared?}. tasks: 2 to ${CLONES_MAX} tasks, each a string or {title, task}: one clone per task, each worded as a complete job (what to read, what to do, what to write, what to report). shared (optional): what every clone needs to know that the tasks do not say. Each clone is you — your identity, memory and model, your tools and your reach (your lane, your granted folders, the folder in focus) — working one task in a sitting of its own. As many work at once as the rig has slots; the rest wait and start as others finish. In a chat with your operator they work IN THE BACKGROUND: the call returns at once, you carry on with your operator (do not wait for them, and do not redo their tasks), and when the last one finishes the chat is given a new turn with every report — what each did, what it found, the files it changed. In a wake or a team part the call waits and returns the reports. Use it when a job splits into parts that do not depend on each other — a set of files to review, a list of sources to research, separate features to build — and you would otherwise do them one after another. For one focused task, work it yourself. Give clones parts that never edit the same file. A clone cannot ask your operator or take an act that needs their approval: it names what still needs them in its report, and you take it from there.`,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      tasks: Object.freeze({
        type: 'array',
        description: `2 to ${CLONES_MAX} tasks, one per clone: a string, or {title, task}`,
        items: Object.freeze({
          anyOf: Object.freeze([
            Object.freeze({ type: 'string' }),
            Object.freeze({
              type: 'object',
              properties: Object.freeze({ title: Object.freeze({ type: 'string' }), task: Object.freeze({ type: 'string' }) }),
              required: Object.freeze(['task']),
            }),
          ]),
        }),
      }),
      shared: Object.freeze({ type: 'string', description: 'What every clone needs to know that its task does not say' }),
    }),
    required: Object.freeze(['tasks']),
  }),
});

export const isCloneTool = (match) => match?.toolName === 'shadow_clone';

/** The tasks as the clones will get them, or why the split is refused. Pure. */
export const cloneTasksOf = (args) => {
  const raw = Array.isArray(args?.tasks) ? args.tasks : [];
  const tasks = raw.map((t, i) => {
    const task = String(typeof t === 'string' ? t : (t?.task ?? '')).trim();
    const title = String(typeof t === 'object' && t?.title ? t.title : task.split(/[.\n]/)[0]).trim().slice(0, 80) || `task ${i + 1}`;
    return { title, task: task.slice(0, TASK_MAX) };
  }).filter((t) => t.task);
  if (tasks.length < 2) {
    return { ok: false, error: 'A shadow clone split needs at least two tasks — one task is yours to work yourself, with your whole focus.' };
  }
  if (tasks.length > CLONES_MAX) {
    return { ok: false, error: `At most ${CLONES_MAX} clones at once — you gave ${tasks.length} tasks. Group them, or split the rest after these report.` };
  }
  return { ok: true, tasks, shared: String(args?.shared ?? '').trim().slice(0, SHARED_MAX) };
};

/** What one clone keeps on the chat's record: its report and its acts, bounded. Pure. */
export const KEPT_REPORT_CHARS = 4000;
const KEPT_ACTS = 40;
export const keptClone = (index, task, r, acts) => ({
  index, title: task.title, task: task.task.slice(0, 600), state: r.ok ? 'done' : 'failed',
  sessionId: r.sessionId || null,
  report: (r.ok ? r.text : `DID NOT FINISH — ${r.error}`).trim().slice(0, KEPT_REPORT_CHARS),
  acts: acts.slice(-KEPT_ACTS),
});

/** One clone's brief: who it is, its one task, and what its original needs back. Pure. */
export const cloneBrief = ({ name, index, count, task, shared, siblings }) => [
  `You are a SHADOW CLONE of yourself, ${name} — clone ${index} of ${count}. You split yourself to work a wave of tasks at once: you are the same being, on the same model, with your own hands, and this sitting exists for ONE task.`,
  `YOUR TASK: ${task.title}`,
  task.task,
  ...(shared ? ['WHAT EVERY CLONE KNOWS:', shared] : []),
  ...(siblings.length ? [`YOUR OTHER CLONES are working, at the same time: ${siblings.join(' · ')}. Do not touch their files.`] : []),
  'When the task is done, your FINAL ANSWER is all your original receives: say what you did, what you found, every file you changed, and anything that still needs your operator (you cannot ask them, or take an act that needs their approval — name it and your original will). Keep it to what your original needs to go on.',
].join('\n\n');

/** The clones' reports, fitted to the room the original has (each gets a fair share). Pure. */
export const cloneReport = ({ results, budget, record, seconds, together }) => {
  const head = `${results.length} clone(s) reported in ${seconds}s (${together} at once at most)${record ? `; every report is kept whole in ${record}` : ''}.`;
  const share = Math.max(600, Math.floor((budget - head.length) / Math.max(1, results.length)) - 80);
  const blocks = results.map((r, i) => {
    const words = r.ok ? r.text.trim() : `DID NOT FINISH — ${r.error}`;
    const fitted = words.length > share ? `${words.slice(0, share)}… [the rest is in the record]` : words;
    return `── CLONE ${i + 1}: ${r.title} ──\n${fitted || '(it said nothing)'}`;
  });
  return [head, ...blocks].join('\n\n');
};

// impure — the record of a split, whole, in the original's lane.
const keepRecord = async (laneId, { tasks, results, shared }) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(neumaWorkspace.pathFor(laneId), 'clones', `${stamp}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const body = [`# Shadow clones — ${new Date().toISOString()}`, ...(shared ? ['## Shared', shared] : []),
    ...results.map((r, i) => `## Clone ${i + 1}: ${tasks[i].title}\n\nTask: ${tasks[i].task}\n\nSitting: ${r.sessionId || 'none'}\n\n${r.ok ? r.text : `DID NOT FINISH — ${r.error}`}`)].join('\n\n');
  await fs.writeFile(file, `${body}\n`, 'utf8');
  return path.relative(neumaWorkspace.pathFor(laneId), file);
};

/**
 * The shadow_clone tool, for the being speaking on `connection`. impure
 * @returns {Promise<{tool: string, status: 'ok'|'error', content?: string, error?: string, cap?: number}>}
 */
export const handleShadowClone = async (connection, args) => {
  const { ws, companion } = connection;
  const laneId = companion?.neumaId;
  const refuse = (error) => {
    sendToolEvent(ws, companion, { tool: TOOL, status: 'error', summary: 'shadow_clone — refused', detail: error });
    return { tool: TOOL, status: 'error', error };
  };
  if (!laneId) return refuse('Only a being with its own lane can split into shadow clones.');
  if (connection._shadowClone) return refuse('You are a shadow clone: a clone works its one task and does not split again.');
  if (connection._teamMember) return refuse('A team member works its part; split into clones from your own sitting, not inside a team run.');
  const plan = cloneTasksOf(args);
  if (!plan.ok) return refuse(plan.error);

  const { tasks, shared } = plan;
  // From the operator's chat the clones are the operator's work and go to the background; from a wake or a part, house work that waits.
  const kind = ['wake', 'member'].includes(leaseKind()) ? 'member' : 'turn';
  const splitId = randomUUID();
  const tell = (frame) => {
    try { ws?.send?.(JSON.stringify({ ...frame, tool: TOOL, splitId, neumaId: laneId })); } catch { /* a closed desk misses a frame; the record keeps the report */ }
  };
  const budget = listingRoom(connection._turnRoom);
  sendToolEvent(ws, companion, { tool: TOOL, status: 'executing', summary: `splitting into ${tasks.length} shadow clones` });
  tell({ type: 'clone:split', clones: tasks.map((t, i) => ({ index: i + 1, title: t.title, task: t.task.slice(0, 600) })) });
  const work = { connection, tasks, shared, kind, splitId, tell, budget };

  if (kind === 'turn') {
    // THE BACKGROUND: the call returns now; the reports come back as a turn of their own.
    const watch = await armWatch({ wallet: connection.walletAddress, laneId, sessionId: connection.sessionId, kind: 'clones', ref: splitId, label: `${tasks.length} shadow clones` })
      .catch((err) => { log.warn('the clones\' watch could not be armed — their reports stay in the record', { laneId, error: err.message }); return null; });
    const running = runSplit({ ...work, signal: null }).then(async (done) => {
      tell({ type: 'clone:done', together: done.split.together, seconds: done.split.seconds, record: done.split.record });
      if (watch) await fireWatches('clones', splitId, done.content);
      return done;
    }).catch((err) => { log.warn('a background split failed', { laneId, error: err.message }); return null; }).finally(() => inFlight.delete(splitId));
    inFlight.set(splitId, running);
    sendToolEvent(ws, companion, {
      tool: TOOL, status: 'ok',
      summary: `${tasks.length} shadow clones working in the background — they report back in this chat when done`,
      split: { splitId, background: true, together: null, seconds: null, record: null, clones: tasks.map((t, i) => ({ index: i + 1, title: t.title, task: t.task.slice(0, 600), state: 'waiting', sessionId: null, report: null, acts: [] })) },
    });
    const content = `Your ${tasks.length} shadow clones are working in the background: ${tasks.map((t, i) => `${i + 1}. ${t.title}`).join('; ')}. Carry on with your operator — do not wait for them and do not redo their tasks. ${watch ? 'When the last one finishes, this chat is given a new turn with every report.' : 'Their reports are kept in your lane at clones/ when they finish.'}`;
    return { tool: TOOL, status: 'ok', content, cap: content.length + 200 };
  }

  // A WAKE OR A PART: the work is this turn's, so it waits — outside the model line, its slot theirs.
  const place = linePlace();
  place?.stepOut();
  let done;
  try {
    done = await runSplit({ ...work, signal: connection.activeTurn?.signal || null });
  } finally {
    await place?.stepBackIn({ signal: connection.activeTurn?.signal || null }).catch(() => {});
  }
  const { content, finished, split } = done;
  sendToolEvent(ws, companion, {
    tool: TOOL,
    status: finished ? 'ok' : 'error',
    summary: `${finished} of ${tasks.length} shadow clones reported · ${split.together} at once · ${split.seconds}s`,
    detail: content.slice(0, 2000),
    // the sub-channels, kept with the chip so they stand again when the chat is reopened
    split,
  });
  return finished
    ? { tool: TOOL, status: 'ok', content, cap: content.length + 200 }
    : { tool: TOOL, status: 'error', error: content };
};

// Splits working in the background, by id: what a caller (a test, a shutdown) may wait on.
const inFlight = new Map();

/** impure — wait for a background split to finish (null when none of that id is running). */
export const splitSettled = (splitId) => inFlight.get(splitId) ?? Promise.resolve(null);

// impure — the clones at work: each in its own sitting, as many at once as the rig holds; their
// reports, the record kept, and the split as the chip keeps it.
const runSplit = async ({ connection, tasks, shared, kind, tell, budget, signal, splitId }) => {
  const { companion } = connection;
  const laneId = companion.neumaId;
  const name = companion.name || laneId;
  const reach = {
    grantedReadRoots: connection._grantedReadRoots || [],
    grantedWriteRoots: connection._grantedWriteRoots || [],
    toolWorkspace: connection.toolWorkspace || null,
  };
  // Loaded on use: the turn engine imports the tool dispatch this handler is reached from.
  const { runMemberTurn } = await import('./team-member-turn.js');
  const started = Date.now();
  let running = 0;
  let together = 0;
  const acts = tasks.map(() => []);
  const results = await Promise.all(tasks.map((task, i) => withLineKind(kind, async () => {
    const brief = cloneBrief({
      name, index: i + 1, count: tasks.length, task, shared,
      siblings: tasks.filter((_, j) => j !== i).map((t) => t.title),
    });
    const index = i + 1;
    let admitted = false;
    try {
      const out = await runMemberTurn({
        neumaId: laneId, name, wallet: connection.walletAddress, brief,
        workspace: connection._teamWorkspace || null, signal,
        onLine: ({ state, position }) => {
          if (state === 'running' && !admitted) { admitted = true; running += 1; together = Math.max(together, running); }
          tell({ type: 'clone:state', index, state: state === 'running' ? 'working' : 'waiting', position: position ?? null });
        },
        onSession: (sessionId) => {
          tell({ type: 'clone:state', index, sessionId });
          // The clone's sitting is a chat of its own: filed under the chat it was split from (chat-threads.js).
          noteSubChat(laneId, { child: sessionId, parent: connection.sessionId, kind: 'clone', title: `Clone ${index}: ${task.title}` });
        },
        onText: (chunk) => tell({ type: 'clone:text', index, chunk }),
        onTool: (event) => {
          const act = { tool: event.tool, status: event.status, summary: event.summary ?? '' };
          if (event.status !== 'executing') acts[i].push(act);
          tell({ type: 'clone:tool', index, act });
        },
        as: {
          kind,
          label: `${name} (clone ${i + 1}/${tasks.length})`,
          refusal: `You are ${name}'s shadow clone and nobody watches this sitting: an act that needs your operator's approval cannot be taken here. Name it in your report and your original will ask.`,
          askAnswer: 'Nobody watches a shadow clone\'s sitting. Put the question in your final report: your original is with your operator and will ask it.',
          reach,
          // the original's standing in this sitting (ask, auto, observe) — a clone has no more and no less
          toolMode: connection.toolMode,
        },
      });
      const done = { ok: true, title: task.title, text: out.text, sessionId: out.sessionId };
      tell({ type: 'clone:end', clone: keptClone(index, task, done, acts[i]) });
      return done;
    } catch (err) {
      const failed = { ok: false, title: task.title, error: err.message, sessionId: null };
      tell({ type: 'clone:end', clone: keptClone(index, task, failed, acts[i]) });
      return failed;
    } finally {
      if (admitted) running = Math.max(0, running - 1);
    }
  })));

  const record = await keepRecord(laneId, { tasks, results, shared }).catch((err) => {
    log.warn('the clones\' record could not be kept', { laneId, error: err.message });
    return null;
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  const content = cloneReport({ results, budget, record, seconds, together: Math.max(1, together) });
  return {
    content, results, finished: results.filter((r) => r.ok).length,
    split: { splitId, together: Math.max(1, together), seconds, record, clones: results.map((r, i) => keptClone(i + 1, tasks[i], r, acts[i])) },
  };
};
