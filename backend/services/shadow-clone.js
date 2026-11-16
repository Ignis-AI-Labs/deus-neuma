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
// THE RIG'S SLOTS. While its clones work, the original steps OUT of the model line
// (substrate-lease.js linePlace) — it is only waiting — so its slot goes to them; it steps back in
// for their reports. Clones take their places as the original's own kind of work: from the
// operator's chat they are the operator's work and may fill every slot the rig was measured to
// hold; from a wake or a team part they are house work and leave the operator's slot free. More
// clones than slots wait in line and start as others finish.
//
// LIKE THE JUTSU, WHAT A CLONE LEARNED COMES BACK. The call returns when every clone has reported;
// each clone's final word is the original's to read (fitted to its room), and every report is kept
// whole in its lane at clones/<stamp>.md.
//
// impure — runs model turns, writes the clones' sittings and the record.

import fs from 'node:fs/promises';
import path from 'node:path';
import { linePlace, leaseKind, withLineKind } from './substrate-lease.js';
import { listingRoom } from './read-room.js';
import { sendToolEvent } from './portal-tools/tool-events.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { createLogger } from './logger.js';

const log = createLogger('ShadowClone');

export const CLONES_MAX = 16;
const TASK_MAX = 4000;
const SHARED_MAX = 6000;
const TOOL = 'team/shadow_clone';

export const SHADOW_CLONE_TOOL = Object.freeze({
  name: 'shadow_clone',
  server: 'team',
  description: `SHADOW CLONE — split into copies of YOURSELF to work a wave of independent tasks at once — args {tasks, shared?}. tasks: 2 to ${CLONES_MAX} tasks, each a string or {title, task}: one clone per task, each worded as a complete job (what to read, what to do, what to write, what to report). shared (optional): what every clone needs to know that the tasks do not say. Each clone is you — your identity, memory and model, your tools and your reach (your lane, your granted folders, the folder in focus) — working one task in a sitting of its own. As many work at once as the rig has slots (while they work, your own slot is theirs); the rest wait and start as others finish. The call returns when every clone has reported, with each one's report: what it did, what it found, the files it changed. Use it when a job splits into parts that do not depend on each other — a set of files to review, a list of sources to research, separate features to build — and you would otherwise do them one after another. For one focused task, work it yourself. Give clones parts that never edit the same file. A clone cannot ask your operator or take an act that needs their approval: it names what still needs them in its report, and you take it from there.`,
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
  const name = companion.name || laneId;
  const signal = connection.activeTurn?.signal || null;
  // From the operator's chat the clones are the operator's work; from a wake or a part, house work.
  const kind = ['wake', 'member'].includes(leaseKind()) ? 'member' : 'turn';
  const reach = {
    grantedReadRoots: connection._grantedReadRoots || [],
    grantedWriteRoots: connection._grantedWriteRoots || [],
    toolWorkspace: connection.toolWorkspace || null,
  };
  sendToolEvent(ws, companion, { tool: TOOL, status: 'executing', summary: `splitting into ${tasks.length} shadow clones` });

  // Loaded on use: the turn engine imports the tool dispatch this handler is reached from.
  const { runMemberTurn } = await import('./team-member-turn.js');
  const started = Date.now();
  let running = 0;
  let together = 0;
  const place = linePlace();
  place?.stepOut();
  let results;
  try {
    results = await Promise.all(tasks.map((task, i) => withLineKind(kind, async () => {
      const brief = cloneBrief({
        name, index: i + 1, count: tasks.length, task, shared,
        siblings: tasks.filter((_, j) => j !== i).map((t) => t.title),
      });
      try {
        const out = await runMemberTurn({
          neumaId: laneId, name, wallet: connection.walletAddress, brief,
          workspace: connection._teamWorkspace || null, signal,
          onLine: ({ state }) => { if (state === 'running') { running += 1; together = Math.max(together, running); } },
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
        return { ok: true, title: task.title, text: out.text, sessionId: out.sessionId };
      } catch (err) {
        return { ok: false, title: task.title, error: err.message, sessionId: null };
      } finally {
        running = Math.max(0, running - 1);
      }
    })));
  } finally {
    await place?.stepBackIn({ signal }).catch(() => {});
  }

  const record = await keepRecord(laneId, { tasks, results, shared }).catch((err) => {
    log.warn('the clones\' record could not be kept', { laneId, error: err.message });
    return null;
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  const content = cloneReport({ results, budget: listingRoom(connection._turnRoom), record, seconds, together: Math.max(1, together) });
  const finished = results.filter((r) => r.ok).length;
  sendToolEvent(ws, companion, {
    tool: TOOL,
    status: finished ? 'ok' : 'error',
    summary: `${finished} of ${tasks.length} shadow clones reported · ${Math.max(1, together)} at once · ${seconds}s`,
    detail: content.slice(0, 2000),
  });
  return finished
    ? { tool: TOOL, status: 'ok', content, cap: content.length + 200 }
    : { tool: TOOL, status: 'error', error: content };
};
