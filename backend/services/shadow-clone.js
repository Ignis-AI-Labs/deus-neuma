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
// A CLEAR GOAL, AND A RESUME (Design note, 2026-11-19: […]). Every clone is
// summoned with its GOAL — what done is — beside its task; it works to it and says in its report whether it got
// there. Each split is kept from its first moment (clone-splits.js), so a clone a crash, a quit or an error stopped
// is resumed in its OWN sitting — its words and acts so far are that sitting's record — by its original
// ({resume: splitId}) or by the operator (RESUME on its tab, the portal's clone:resume frame).
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
import { saveSplit, updateSplit, readSplit, stoppedClones } from './clone-splits.js';
import { createLogger } from './logger.js';

const log = createLogger('ShadowClone');

export const CLONES_MAX = 16;
const TASK_MAX = 4000;
const GOAL_MIN = 12;
const GOAL_MAX = 600;
const SHARED_MAX = 6000;
const TOOL = 'team/shadow_clone';

export const SHADOW_CLONE_TOOL = Object.freeze({
  name: 'shadow_clone',
  server: 'team',
  description: `SHADOW CLONE — split into copies of YOURSELF to work a wave of independent tasks at once — args {tasks, shared?}. tasks: 2 to ${CLONES_MAX} tasks, each {title, goal, task}: one clone per task. goal is what DONE is for that clone — the result it must reach, specific enough to check (e.g. "10 Neuma funding emails staged, each to a named partner at a fund not yet emailed"); every clone works to its goal and says in its report whether it got there. task is the complete job (what to read, what to do, what to write, what to report). RESUME: a clone a crash, a quit or an error stopped carries on in its own sitting from where it left off — args {resume: the split's id, clones?: [its numbers]} (all the stopped ones when clones is left out); the split's id is in the report that told you they stopped. shared (optional): what every clone needs to know that the tasks do not say. Each clone is you — your identity, memory and model, your tools and your reach (your lane, your granted folders, the folder in focus) — working one task in a sitting of its own. As many work at once as the rig has slots; the rest wait and start as others finish. In a chat with your operator they work IN THE BACKGROUND: the call returns at once, you carry on with your operator (do not wait for them, and do not redo their tasks), and when the last one finishes the chat is given a new turn with every report — what each did, what it found, the files it changed. In a wake or a team part the call waits and returns the reports. Use it when a job splits into parts that do not depend on each other — a set of files to review, a list of sources to research, separate features to build — and you would otherwise do them one after another. For one focused task, work it yourself. Give clones parts that never edit the same file. A clone cannot ask your operator or take an act that needs their approval: it names what still needs them in its report, and you take it from there.`,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      tasks: Object.freeze({
        type: 'array',
        description: `2 to ${CLONES_MAX} tasks, one per clone: {title, goal, task}`,
        items: Object.freeze({
          type: 'object',
          properties: Object.freeze({
            title: Object.freeze({ type: 'string' }),
            goal: Object.freeze({ type: 'string', description: 'What DONE is for this clone — the result, specific enough to check' }),
            task: Object.freeze({ type: 'string' }),
          }),
          required: Object.freeze(['goal', 'task']),
        }),
      }),
      shared: Object.freeze({ type: 'string', description: 'What every clone needs to know that its task does not say' }),
      resume: Object.freeze({ type: 'string', description: 'The id of a split whose stopped clones should carry on where they left off' }),
      clones: Object.freeze({ type: 'array', items: Object.freeze({ type: 'number' }), description: 'With resume: which clones (their numbers); all the stopped ones when left out' }),
    }),
  }),
});

export const isCloneTool = (match) => match?.toolName === 'shadow_clone';

/** The tasks as the clones will get them, or why the split is refused. Pure. */
export const cloneTasksOf = (args) => {
  const raw = Array.isArray(args?.tasks) ? args.tasks : [];
  const tasks = raw.map((t, i) => {
    const task = String(typeof t === 'string' ? t : (t?.task ?? '')).trim();
    const title = String(typeof t === 'object' && t?.title ? t.title : task.split(/[.\n]/)[0]).trim().slice(0, 80) || `task ${i + 1}`;
    const goal = String(typeof t === 'object' ? (t?.goal ?? '') : '').replace(/\s+/g, ' ').trim();
    return { title, goal: goal.slice(0, GOAL_MAX), task: task.slice(0, TASK_MAX) };
  }).filter((t) => t.task);
  if (tasks.length < 2) {
    return { ok: false, error: 'A shadow clone split needs at least two tasks — one task is yours to work yourself, with your whole focus.' };
  }
  if (tasks.length > CLONES_MAX) {
    return { ok: false, error: `At most ${CLONES_MAX} clones at once — you gave ${tasks.length} tasks. Group them, or split the rest after these report.` };
  }
  // A CLEAR GOAL (Design note, 2026-11-19: a clone is never summoned without knowing what done is.
  const aimless = tasks.filter((t) => t.goal.length < GOAL_MIN);
  if (aimless.length) {
    return { ok: false, error: `Every clone needs a clear goal — what DONE is for it, specific enough to check (e.g. "10 funding emails staged, each to a named partner at a fund not yet emailed"). Give each task {title, goal, task}; ${aimless.map((t) => `"${t.title}"`).join(', ')} ${aimless.length === 1 ? 'has' : 'have'} none.` };
  }
  return { ok: true, tasks, shared: String(args?.shared ?? '').trim().slice(0, SHARED_MAX) };
};

/** What one clone keeps on the chat's record: its report and its acts, bounded. Pure. */
export const KEPT_REPORT_CHARS = 4000;
const KEPT_ACTS = 40;
export const keptClone = (index, task, r, acts) => ({
  index, title: task.title, goal: task.goal ?? null, task: task.task.slice(0, 600), state: r.ok ? 'done' : 'failed',
  sessionId: r.sessionId || null,
  report: (r.ok ? r.text : `DID NOT FINISH — ${r.error}`).trim().slice(0, KEPT_REPORT_CHARS),
  acts: acts.slice(-KEPT_ACTS),
});

/** One clone's brief: who it is, its one task, and what its original needs back. Pure. */
export const cloneBrief = ({ name, index, count, task, shared, siblings }) => [
  `You are a SHADOW CLONE of yourself, ${name} — clone ${index} of ${count}. You split yourself to work a wave of tasks at once: you are the same being, on the same model, with your own hands, and this sitting exists for ONE task.`,
  `YOUR TASK: ${task.title}`,
  ...(task.goal ? [`YOUR GOAL — what DONE is: ${task.goal}`] : []),
  task.task,
  ...(shared ? ['WHAT EVERY CLONE KNOWS:', shared] : []),
  ...(siblings.length ? [`YOUR OTHER CLONES are working, at the same time: ${siblings.join(' · ')}. Do not touch their files.`] : []),
  'Work until your goal is met. Your FINAL ANSWER is all your original receives: first whether you reached your goal (and, if not, exactly what is left), then what you did, what you found, every file you changed, and anything that still needs your operator (you cannot ask them, or take an act that needs their approval — name it and your original will). Keep it to what your original needs to go on.',
].join('\n\n');

/** A stopped clone's brief when it is resumed in its own sitting: why it stopped, its goal, and carry on. Pure. */
export const resumeBrief = ({ task, why }) => [
  `You were stopped before you finished — ${why}. This is your own sitting: everything you said and did so far is above.`,
  `YOUR TASK, unchanged: ${task.title}`,
  ...(task.goal ? [`YOUR GOAL — what DONE is: ${task.goal}`] : []),
  'Carry on from where you stopped. First check what actually stands (the files, the ledger, what you filed) against what you meant to do — an act cut mid-way may or may not have landed — and never redo a step that is done. Then finish the job. Your FINAL ANSWER is all your original receives: whether you reached your goal, what you did across both sittings, every file you changed, and anything that still needs your operator.',
].join('\n\n');

/** The clones' reports, fitted to the room the original has (each gets a fair share). Pure. */
export const cloneReport = ({ results, budget, record, seconds, together }) => {
  const head = `${results.length} clone(s) reported in ${seconds}s (${together} at once at most)${record ? `; every report is kept whole in ${record}` : ''}.`;
  const share = Math.max(600, Math.floor((budget - head.length) / Math.max(1, results.length)) - 80);
  const blocks = results.map((r, i) => {
    const words = r.ok ? r.text.trim() : `DID NOT FINISH — ${r.error}`;
    const fitted = words.length > share ? `${words.slice(0, share)}… [the rest is in the record]` : words;
    return `── CLONE ${i + 1}: ${r.title} ──\n${r.goal ? `Goal: ${r.goal}\n` : ''}${fitted || '(it said nothing)'}`;
  });
  return [head, ...blocks].join('\n\n');
};

// impure — the record of a split, whole, in the original's lane.
const keepRecord = async (laneId, { tasks, results, shared }) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(neumaWorkspace.pathFor(laneId), 'clones', `${stamp}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const body = [`# Shadow clones — ${new Date().toISOString()}`, ...(shared ? ['## Shared', shared] : []),
    ...results.map((r, i) => `## Clone ${i + 1}: ${tasks[i].title}\n\nGoal: ${tasks[i].goal || '—'}\n\nTask: ${tasks[i].task}\n\nSitting: ${r.sessionId || 'none'}\n\n${r.ok ? r.text : `DID NOT FINISH — ${r.error}`}`)].join('\n\n');
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
  if (args?.resume) {
    const resumed = await resumeShadowClones(connection, { splitId: String(args.resume), clones: args.clones });
    if (!resumed.ok) return refuse(resumed.error);
    sendToolEvent(ws, companion, { tool: TOOL, status: 'ok', summary: `${resumed.count} shadow clone(s) resumed where they stopped — they report back in this chat when done` });
    return { tool: TOOL, status: 'ok', content: resumed.content, cap: resumed.content.length + 200 };
  }
  const plan = cloneTasksOf(args);
  if (!plan.ok) return refuse(plan.error);
  // ONE WAVE AT A TIME IN A CHAT (2026-11-19: a second wave of the same funding work was launched 19 minutes into the
  // first, both ran, both were cut off, and the operator saw it twice): a split while another from this chat is at
  // work is refused, naming it — unless the being means a second wave beside it (alongside: true).
  const busy = [...liveSplits.values()].find((l) => l.laneId === laneId && l.sessionId && l.sessionId === connection.sessionId);
  if (busy && args?.alongside !== true) {
    return refuse(`Your clones from this chat are still at work (split ${busy.splitId}: ${busy.titles.join(' · ')}). Wait for their reports, or have your operator stop them; a second wave of different work beside them is {tasks, alongside: true}.`);
  }

  const { tasks, shared } = plan;
  // From the operator's chat the clones are the operator's work and go to the background; from a wake or a part, house work that waits.
  const kind = ['wake', 'member'].includes(leaseKind()) ? 'member' : 'turn';
  const splitId = randomUUID();
  const tell = tellerFor(connection, splitId);
  const budget = listingRoom(connection._turnRoom);
  // KEPT FROM ITS FIRST MOMENT: what a resume finds again (clone-splits.js).
  await saveSplit(laneId, {
    splitId, at: new Date().toISOString(), parentSessionId: connection.sessionId ?? null, kind, shared,
    clones: tasks.map((t, i) => ({ index: i + 1, title: t.title, goal: t.goal, task: t.task, state: 'waiting', sessionId: null, report: null })),
  }).catch((err) => log.warn('the split could not be kept — a stopped clone of it cannot be resumed', { laneId, error: err.message }));
  sendToolEvent(ws, companion, { tool: TOOL, status: 'executing', summary: `splitting into ${tasks.length} shadow clones` });
  tell({ type: 'clone:split', clones: tasks.map((t, i) => ({ index: i + 1, title: t.title, goal: t.goal, task: t.task.slice(0, 600) })) });
  const work = { connection, tasks, shared, kind, splitId, tell, budget };

  if (kind === 'turn') {
    // THE BACKGROUND: the call returns now; the reports come back as a turn of their own.
    const watch = await inBackground({ ...work, sessionId: connection.sessionId, label: `${tasks.length} shadow clones (${tasks.map((t) => t.title).join(' · ')})` });
    sendToolEvent(ws, companion, {
      tool: TOOL, status: 'ok',
      summary: `${tasks.length} shadow clones working in the background — they report back in this chat when done`,
      split: { splitId, background: true, together: null, seconds: null, record: null, clones: tasks.map((t, i) => ({ index: i + 1, title: t.title, goal: t.goal, task: t.task.slice(0, 600), state: 'waiting', sessionId: null, report: null, acts: [] })) },
    });
    const content = `Your ${tasks.length} shadow clones are working in the background (split ${splitId}): ${tasks.map((t, i) => `${i + 1}. ${t.title} — goal: ${t.goal}`).join('; ')}. Carry on with your operator — do not wait for them and do not redo their tasks. ${watch ? 'When the last one finishes, this chat is given a new turn with every report.' : 'Their reports are kept in your lane at clones/ when they finish.'}`;
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

// The frames a split sends the operator's desk, each naming the split.
const tellerFor = (connection, splitId) => (frame) => {
  try { connection.ws?.send?.(JSON.stringify({ ...frame, tool: TOOL, splitId, neumaId: connection.companion?.neumaId })); } catch { /* a closed desk misses a frame; the record keeps the report */ }
};

// Splits working in the background, by id: what a caller (a test, a shutdown) may wait on.
const inFlight = new Map();
// Every split at work in this process, by id: its lane, the chat it came from, its clones' titles, and each clone's
// STOP (Design note, 2026-11-19: […]).
const liveSplits = new Map();

/**
 * impure — STOP: the named clones of a split at work (all of them when none are named) stop now. Each one's sitting
 * keeps what it did; it ends as stopped by the operator, and can be resumed like any stopped clone.
 * @returns {{ok: true, stopping: number[]} | {ok: false, running: false, error: string}}
 */
export const stopShadowClones = ({ laneId, splitId, clones = null }) => {
  const live = liveSplits.get(splitId);
  if (!live || live.laneId !== laneId) return { ok: false, running: false, error: `Split ${splitId} is not at work here — nothing to stop.` };
  const only = Array.isArray(clones) && clones.length ? clones.map(Number) : null;
  const stopping = [...live.stops.entries()].filter(([index]) => !only || only.includes(index));
  for (const [, stop] of stopping) stop.abort(new Error('stopped by the operator'));
  return { ok: true, stopping: stopping.map(([index]) => index) };
};

/** impure — wait for a background split to finish (null when none of that id is running). */
export const splitSettled = (splitId) => inFlight.get(splitId) ?? Promise.resolve(null);
/** Is this process running the split now (its clones at work, or some of them resumed). */
export const isSplitLive = (splitId) => inFlight.has(splitId);

// impure — a split's clones at work in the background, its chat watching for the reports: the call does not wait.
// A resume watches with a ref of its own (splitId:resume:<time>): the first run's watch may still wait, undelivered.
const inBackground = async ({ connection, splitId, tell, sessionId, label, watchRef = splitId, ...work }) => {
  const laneId = connection.companion.neumaId;
  const watch = await armWatch({ wallet: connection.walletAddress, laneId, sessionId, kind: 'clones', ref: watchRef, label })
    .catch((err) => { log.warn('the clones\' watch could not be armed — their reports stay in the record', { laneId, error: err.message }); return null; });
  const running = runSplit({ ...work, connection, splitId, tell, signal: null }).then(async (done) => {
    tell({ type: 'clone:done', together: done.split.together, seconds: done.split.seconds, record: done.split.record });
    if (watch) await fireWatches('clones', watchRef, done.content);
    return done;
  }).catch((err) => { log.warn('a background split failed', { laneId, error: err.message }); return null; }).finally(() => inFlight.delete(splitId));
  inFlight.set(splitId, running);
  return watch;
};

/**
 * impure — RESUME (Design note, 2026-11-19: […]): the stopped clones of a kept split carry on, each in its own sitting, in the background; the chat
 * the split came from is given every report when the last one finishes. The original asks with {resume}, the operator
 * with RESUME on a stopped clone's tab (the portal's clone:resume frame).
 * @returns {Promise<{ok: true, count: number, content: string} | {ok: false, error: string}>}
 */
export const resumeShadowClones = async (connection, { splitId, clones = null }) => {
  const laneId = connection.companion?.neumaId;
  if (!laneId) return { ok: false, error: 'Only a being with its own lane has shadow clones to resume.' };
  if (isSplitLive(splitId)) return { ok: false, error: `Split ${splitId} is still at work — its clones report back when they finish.` };
  const kept = await readSplit(laneId, splitId);
  if (!kept) return { ok: false, error: `No split ${splitId} is kept in this lane — a split from before splits were kept cannot be resumed; split again.` };
  const only = Array.isArray(clones) ? clones.map(Number).filter(Number.isInteger) : null;
  const stopped = stoppedClones(kept, only);
  if (!stopped.length) return { ok: false, error: only?.length ? `None of clones ${only.join(', ')} of split ${splitId} is stopped.` : `Every clone of split ${splitId} already reported.` };
  const tasks = kept.clones.map((c) => ({ title: c.title, goal: c.goal ?? '', task: c.task }));
  const tell = tellerFor(connection, splitId);
  tell({ type: 'clone:resume', clones: stopped.map((c) => c.index) });
  await updateSplit(laneId, splitId, null, { seconds: null, together: null, resumedAt: new Date().toISOString() }).catch(() => {});
  const resume = new Map(stopped.map((c) => [c.index, {
    sessionId: c.sessionId ?? null,
    why: c.state === 'failed' ? `it stopped: ${String(c.report ?? 'an error').replace(/^DID NOT FINISH — /, '').slice(0, 300)}` : 'the app closed, or the run was cut, while you worked',
  }]));
  const label = `${stopped.length} shadow clone(s) resumed (${stopped.map((c) => c.title).join(' · ')})`;
  const watch = await inBackground({ connection, tasks, shared: kept.shared ?? '', kind: 'turn', splitId, tell, budget: listingRoom(connection._turnRoom), sessionId: kept.parentSessionId ?? connection.sessionId, label, watchRef: `${splitId}:resume:${Date.now()}`, resume, carried: kept.clones });
  const content = `Resumed ${stopped.length} stopped clone(s) of split ${splitId} where they left off, each in its own sitting: ${stopped.map((c) => `${c.index}. ${c.title}`).join('; ')}. ${watch ? 'When they finish, the chat they were split from is given a new turn with every report.' : 'Their reports are kept in your lane at clones/ when they finish.'}`;
  return { ok: true, count: stopped.length, content };
};

// impure — the clones at work: each in its own sitting, as many at once as the rig holds; their
// reports, the record kept, and the split as the chip keeps it. A resume runs only its stopped clones (`resume`:
// index → {sessionId, why}), each in its own sitting again; the others stand as they reported (`carried`).
const runSplit = async ({ connection, tasks, shared, kind, tell, budget, signal, splitId, resume = null, carried = [] }) => {
  const { companion } = connection;
  const laneId = companion.neumaId;
  const live = { splitId, laneId, sessionId: connection.sessionId ?? null, titles: tasks.map((t) => t.title), stops: new Map() };
  liveSplits.set(splitId, live);
  const name = companion.name || laneId;
  const reach = {
    grantedReadRoots: connection._grantedReadRoots || [],
    grantedWriteRoots: connection._grantedWriteRoots || [],
    toolWorkspace: connection.toolWorkspace || null,
  };
  // Loaded on use: the turn engine imports the tool dispatch this handler is reached from.
  const { runMemberTurn } = await import('./team-member-turn.js');
  const keep = (index, patch) => updateSplit(laneId, splitId, index, patch).catch(() => {});
  const started = Date.now();
  let running = 0;
  let together = 0;
  const acts = tasks.map(() => []);
  const results = await Promise.all(tasks.map((task, i) => withLineKind(kind, async () => {
    const index = i + 1;
    // A resume leaves a clone that reported as it was.
    if (resume && !resume.has(index)) {
      const was = carried.find((c) => c.index === index) ?? {};
      return { ok: was.state === 'done', title: task.title, goal: task.goal, text: was.report ?? '', error: String(was.report ?? 'it did not report').replace(/^DID NOT FINISH — /, ''), sessionId: was.sessionId ?? null, carried: true };
    }
    const again = resume?.get(index) ?? null;
    const brief = again ? resumeBrief({ task, why: again.why }) : cloneBrief({
      name, index, count: tasks.length, task, shared,
      siblings: tasks.filter((_, j) => j !== i).map((t) => t.title),
    });
    let admitted = false;
    let sitting = again?.sessionId ?? null;
    // This clone's own STOP, beside the split's (a wake's turn ending stops them all).
    const stop = new AbortController();
    live.stops.set(index, stop);
    try {
      const out = await runMemberTurn({
        neumaId: laneId, name, wallet: connection.walletAddress, brief,
        workspace: connection._teamWorkspace || null, signal: signal ? AbortSignal.any([signal, stop.signal]) : stop.signal, sessionId: sitting,
        onLine: ({ state, position }) => {
          if (state === 'running' && !admitted) { admitted = true; running += 1; together = Math.max(together, running); keep(index, { state: 'working' }); }
          tell({ type: 'clone:state', index, state: state === 'running' ? 'working' : 'waiting', position: position ?? null });
        },
        onSession: (sessionId) => {
          sitting = sessionId;
          keep(index, { sessionId });
          tell({ type: 'clone:state', index, sessionId });
          // The clone's sitting is a chat of its own: filed under the chat it was split from (chat-threads.js).
          if (!again) noteSubChat(laneId, { child: sessionId, parent: connection.sessionId, kind: 'clone', title: `Clone ${index}: ${task.title}` });
        },
        onText: (chunk) => tell({ type: 'clone:text', index, chunk }),
        onTool: (event) => {
          const act = { tool: event.tool, status: event.status, summary: event.summary ?? '' };
          if (event.status !== 'executing') acts[i].push(act);
          tell({ type: 'clone:tool', index, act });
        },
        as: {
          kind,
          label: `${name} (clone ${index}/${tasks.length})`,
          refusal: `You are ${name}'s shadow clone and nobody watches this sitting: an act that needs your operator's approval cannot be taken here. Name it in your report and your original will ask.`,
          askAnswer: 'Nobody watches a shadow clone\'s sitting. Put the question in your final report: your original is with your operator and will ask it.',
          reach,
          // the original's standing in this sitting (ask, auto, observe) — a clone has no more and no less
          toolMode: connection.toolMode,
        },
      });
      const done = { ok: true, title: task.title, goal: task.goal, text: out.text, sessionId: out.sessionId };
      const kept = keptClone(index, task, done, acts[i]);
      await keep(index, { state: 'done', report: kept.report, sessionId: out.sessionId });
      tell({ type: 'clone:end', clone: kept });
      return done;
    } catch (err) {
      // Its sitting is kept with it: what it did so far is there, and a resume carries on in it.
      const failed = { ok: false, title: task.title, goal: task.goal, error: err.message, sessionId: sitting };
      const kept = keptClone(index, task, failed, acts[i]);
      await keep(index, { state: 'failed', report: kept.report, sessionId: sitting });
      tell({ type: 'clone:end', clone: kept });
      return failed;
    } finally {
      live.stops.delete(index);
      if (admitted) running = Math.max(0, running - 1);
    }
  }))).finally(() => liveSplits.delete(splitId));

  const record = await keepRecord(laneId, { tasks, results, shared }).catch((err) => {
    log.warn('the clones\' record could not be kept', { laneId, error: err.message });
    return null;
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  const content = cloneReport({ results, budget, record, seconds, together: Math.max(1, together) });
  await updateSplit(laneId, splitId, null, { seconds, together: Math.max(1, together), record }).catch(() => {});
  return {
    content, results, finished: results.filter((r) => r.ok).length,
    split: { splitId, together: Math.max(1, together), seconds, record, clones: results.map((r, i) => keptClone(i + 1, tasks[i], r, acts[i])) },
  };
};
