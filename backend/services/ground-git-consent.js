/** Both coding seats use one Git consent boundary, independent of shell/network grants. */
import { readExecutionToolPolicy } from './execution-tool-policy.js';
import { gateAct } from './act-gate.js';
import { normalizeToolMode } from './tool-policy.js';
import { formatGroundGit, readGroundGit } from './ground-git.js';
import { prepareGroundSync, previewGroundSync, handleGroundSync } from './ground-sync.js';
import { gitFailure } from './ground-git-exec.js';

// impure - captured origin survives the card; rebind cancels the running tree.
const capture = (connection) => {
  const companion = connection.companion;
  const lane = companion?.neumaId;
  const session = connection.sessionId;
  const turn = connection.activeTurn;
  const root = connection.toolWorkspace;
  const sandbox = connection._turnSandbox;
  const sourceRoot = sandbox?.sourceRoot;
  const wallet = connection.walletAddress;
  const ws = connection.ws;
  const controller = new AbortController();
  const isCurrent = () => !turn?.signal?.aborted && connection.companion === companion
    && connection.companion?.neumaId === lane && connection.sessionId === session
    && connection.activeTurn === turn && connection.toolWorkspace === root
    && connection._turnSandbox === sandbox && sandbox?.sourceRoot === sourceRoot
    && connection.walletAddress === wallet && connection.ws === ws && ws?.readyState === ws?.OPEN;
  const assertCurrent = () => {
    if (!isCurrent() || controller.signal.aborted) throw gitFailure('context_changed');
  };
  const abort = () => controller.abort();
  turn?.signal?.addEventListener('abort', abort, { once: true });
  if (turn?.signal?.aborted) abort();
  const timer = setInterval(() => { if (!isCurrent()) abort(); }, 20);
  timer.unref();
  return { companion, lane, signal: controller.signal, assertCurrent, isCurrent,
    close: () => { clearInterval(timer); turn?.signal?.removeEventListener('abort', abort); } };
};

// impure - refresh persisted policy at the Git act, not a stale turn catalog.
const gate = async (connection, origin, { tool, args, cardArgs, emit }) => gateAct(connection, {
  server: tool.split('/')[0], tool: tool.split('/')[1], toolLabel: tool,
  args, cardArgs, emit, signal: origin.signal, isCurrent: origin.isCurrent,
  lanePolicy: await readExecutionToolPolicy(origin.lane),
  mode: normalizeToolMode(connection.toolMode),
});

/** impure - Git-only dispatch. No shell-grant or shell-run behavior lives here. */
export const handleGroundGitTool = async ({ ws, connection, toolName, args, sandbox, sendToolEvent }) => {
  const tool = `coding/${toolName}`;
  const origin = capture(connection);
  const emit = (event) => sendToolEvent(ws, origin.companion, event);
  try {
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw gitFailure('invalid_args');
    origin.assertCurrent();
    const snapshot = toolName === 'ground_sync'
      ? await prepareGroundSync(sandbox.sourceRoot, { signal: origin.signal }) : null;
    const cardArgs = snapshot ? previewGroundSync(snapshot) : { root: sandbox.sourceRoot };
    const granted = await gate(connection, origin, { tool, args, cardArgs, emit });
    if (!granted.ok) return granted.result;
    origin.assertCurrent();
    if (snapshot) return await handleGroundSync({ ws, companion: origin.companion,
      sandbox, sendToolEvent, snapshot, signal: origin.signal, assertCurrent: origin.assertCurrent });
    const content = formatGroundGit(await readGroundGit(sandbox.sourceRoot, { signal: origin.signal }));
    origin.assertCurrent();
    emit({ tool, status: 'ok', summary: 'live Git state read', detail: content });
    return { tool, status: 'ok', content };
  } catch (error) {
    const reason = gitFailure(error.code, error.category).message;
    emit({ tool, status: 'error', summary: 'Git refused', detail: reason });
    return { tool, status: 'error', error: reason };
  } finally { origin.close(); }
};

/** impure - map history's approval uses the same exact per-tool policy class. */
export const gateGroundHistory = async (connection, args, emit) => {
  const origin = capture(connection);
  try {
    if (!args || typeof args !== 'object' || Array.isArray(args)
      || Object.keys(args).some((key) => !['ref', 'path', 'limit'].includes(key))
      || (args.ref !== undefined && typeof args.ref !== 'string')
      || (args.path !== undefined && typeof args.path !== 'string')
      || (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50))) {
      throw gitFailure('invalid_history_args');
    }
    const result = await gate(connection, origin, { tool: 'map/read_history', args,
      cardArgs: { root: connection.toolWorkspace, ...args }, emit });
    origin.assertCurrent();
    if (!result.ok) { origin.close(); return result; }
    return { ...result, assertCurrent: origin.assertCurrent, signal: origin.signal, close: origin.close };
  } catch (error) {
    origin.close();
    return { ok: false, result: { tool: 'map/read_history', status: 'error', error: gitFailure(error.code, error.category).message } };
  }
};
