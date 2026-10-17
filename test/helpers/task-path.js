/**
 * Drive a task act the way a being does NOW.
 *
 * The catalog cut (#414) retired `task_add`, `task_update`, `task_focus` and
 * `task_take` to `tasks/*` intents — their policy rows moved with them, so a
 * test that still drives the old tool name fails `checkToolAccess` closed and
 * raises an approval card no harness answers (a 30-second timeout with no
 * message). `task_list` stayed a tool: WORKING STATE carries the LIVE tasks
 * only, so it is the sole path to settled history and to work held elsewhere.
 *
 * This router lets a suite keep reading in tool names — which is how the
 * behaviour under test is actually described — while every ACT goes through
 * the REAL sweep, where the ACTS tier and the session mode gate live.
 */
import { viaIntent } from './intent-path.js';

/** Retired tool name → the intent that carries the same act. */
export const TASK_ACT_OF = Object.freeze({
  task_add: 'tasks/add',
  task_update: 'tasks/update',
  task_focus: 'tasks/focus',
  task_take: 'tasks/take',
});

/**
 * @param {{ws: object, handler: Function, connection: object|Function}} seam
 *   `connection` may be a getter, for suites that rebind it between tests.
 * @returns {(toolName: string, args: object) => Promise<object>} one receipt
 */
export const taskCaller = ({ ws, handler, connection }) => async (toolName, args) => {
  const conn = typeof connection === 'function' ? connection() : connection;
  if (!TASK_ACT_OF[toolName]) return handler(ws, conn, null, 'auto', { toolName }, args);
  const [receipt] = await viaIntent(conn, TASK_ACT_OF[toolName], args, 'auto');
  return receipt;
};
