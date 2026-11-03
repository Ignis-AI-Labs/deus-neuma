/** impure: one status/recovery path for both seats, usable without a working shell. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { readExecutionToolPolicy } from './execution-tool-policy.js';
import { gateAct } from './act-gate.js';
import { annotateToolAccess, GLOBAL_DEFAULTS, normalizeToolMode, resolvePolicy } from './tool-policy.js';
import { focusGroundOf } from './focus-ground.js';
import { withCodingSandboxLock, sandboxStatusText } from './witness-coding-sandbox.js';
import { ensureTurnSandbox } from './turn-sandbox.js';
import { publishCodingDirectory } from './coding-shell-storage.js';
import { codingToolsForState } from './coding-tool-definitions.js';
import { writeJsonAtomic } from './user-realm.js';
import { createLogger } from './logger.js';

const log = createLogger('CodingShellControl');
const interrupted = () => new DOMException('Shell recovery interrupted or its lane/session/focus changed', 'AbortError');
const capture = (connection) => {
  const binding = connection.companion;
  const laneId = binding?.neumaId;
  const source = focusGroundOf(connection);
  const session = connection.sessionId;
  const turn = connection.activeTurn;
  const wallet = connection.walletAddress;
  const socket = connection.ws;
  const controller = new AbortController();
  const isCurrent = () => connection.companion === binding && binding?.neumaId === laneId
    && connection.sessionId === session && connection.activeTurn === turn
    && connection.walletAddress === wallet && connection.ws === socket
    && socket?.readyState === socket?.OPEN && focusGroundOf(connection) === source && !turn?.signal?.aborted;
  const abort = () => controller.abort();
  turn?.signal?.addEventListener('abort', abort, { once: true });
  if (turn?.signal?.aborted) abort();
  const timer = setInterval(() => { if (!isCurrent()) abort(); }, 20);
  timer.unref();
  return { binding, laneId, source, wallet, isCurrent, signal: controller.signal,
    assertCurrent: () => { if (!isCurrent() || controller.signal.aborted) throw interrupted(); },
    close: () => { clearInterval(timer); turn?.signal?.removeEventListener('abort', abort); },
  };
};

const identity = async (directory) => {
  const stat = await fs.lstat(directory);
  return `${stat.dev}:${stat.ino}`;
};

// Each coding schema is restamped, but unrelated tools and prior disclosures stay.
const refreshCatalog = async (connection, origin, sandbox, error = null) => {
  const lanePolicy = await readExecutionToolPolicy(origin.laneId);
  origin.assertCurrent();
  connection._turnSandbox = sandbox;
  connection._turnSandboxError = error?.message || null;
  connection._turnSandboxRecoverable = error?.code === 'OVERLAY_CONFLICT';
  const tools = annotateToolAccess(codingToolsForState(sandbox, connection._turnSandboxRecoverable),
    resolvePolicy(GLOBAL_DEFAULTS, lanePolicy, connection._sessionToolPolicy), normalizeToolMode(connection.toolMode),
    resolvePolicy({}, lanePolicy, connection._sessionToolPolicy));
  connection._turnCatalog = [...(connection._turnCatalog || []).filter((tool) => tool.server !== 'coding'), ...tools];
  connection._turnDisclosedToolIds = new Set([...(connection._turnDisclosedToolIds || []),
    ...tools.filter((tool) => tool.access !== 'denied').map((tool) => `coding/${tool.name}`)]);
};

const prepareRecovery = (origin) => withCodingSandboxLock(origin.laneId, origin.source, async ({ base, current }) => {
  origin.assertCurrent();
  const sourceIdentity = await identity(origin.source);
  const previousIdentity = await identity(current.directory);
  return Object.freeze({ base, current, sourceIdentity, previousIdentity });
});

const recover = (origin, snapshot, onPublished) => withCodingSandboxLock(origin.laneId, origin.source, async ({ base, current, prepareFresh }) => {
  origin.assertCurrent();
  if (base !== snapshot.base || current.directory !== snapshot.current.directory
    || await identity(current.directory) !== snapshot.previousIdentity
    || await identity(origin.source) !== snapshot.sourceIdentity) throw new Error('Shell or project changed after preview; request fresh recovery approval');
  const fresh = await prepareFresh();
  origin.assertCurrent();
  if (await identity(origin.source) !== snapshot.sourceIdentity) throw new Error('Project changed during recovery preparation');
  const next = { directory: path.dirname(fresh.workspace), generation: fresh.generation };
  const receipt = Object.freeze({ version: 1, tool: 'coding/sandbox_recover', at: new Date().toISOString(),
    sourceRoot: origin.source, operator: origin.wallet,
    preservedUpper: path.join(current.directory, 'upper'), preservedWork: path.join(current.directory, 'work'),
    activeUpper: fresh.workspace, projectChanged: false, gitChanged: false,
  });
  await writeJsonAtomic(path.join(next.directory, 'recovery.json'), receipt);
  origin.assertCurrent();
  await publishCodingDirectory(base, next, current, { assertCurrent: origin.assertCurrent, onPublished: () => onPublished(receipt) });
  return { fresh, receipt };
});

/** Status refreshes the active generation; recovery preserves old work then
 * atomically publishes a fully prepared replacement, after the operator's card. */
export const handleCodingShellControl = async ({ ws, connection, toolName, args, sendToolEvent }) => {
  const tool = `coding/${toolName}`;
  const origin = capture(connection);
  const emit = (event) => sendToolEvent(ws, origin.binding, { tool, ...event });
  let published = null;
  try {
    if (!['sandbox_status', 'sandbox_recover'].includes(toolName)) throw new Error('Unknown shell control action');
    if (!origin.laneId || !origin.source) throw new Error('No focused workspace is open');
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw new Error(`${tool} accepts an empty object only`);
    origin.assertCurrent();
    if (connection.sandboxEnabled === false) {
      const direct = { sourceRoot: origin.source, direct: true };
      const content = `${sandboxStatusText(direct)}${toolName === 'sandbox_recover' ? '\nSANDBOX is OFF — there is no isolated shell to recover.' : ''}`;
      emit({ status: 'ok', summary: 'direct shell — sandbox off', detail: content });
      return { tool, status: 'ok', content };
    }
    const snapshot = toolName === 'sandbox_recover' ? await prepareRecovery(origin) : null;
    const cardArgs = snapshot ? { root: origin.source, preservedUpper: path.join(snapshot.current.directory, 'upper'),
      action: 'Keep prior shell work; activate a fresh masked view. No project or Git changes.' } : args;
    if (JSON.stringify(cardArgs, null, 2).length > 600) throw new Error('Recovery paths exceed the approval preview limit');
    const gated = await gateAct(connection, { server: 'coding', tool: toolName, args, cardArgs,
      lanePolicy: await readExecutionToolPolicy(origin.laneId), mode: normalizeToolMode(connection.toolMode),
      signal: origin.signal, isCurrent: origin.isCurrent, emit,
    });
    if (!gated.ok) return gated.result;
    origin.assertCurrent();
    if (toolName === 'sandbox_status') {
      const sandbox = await ensureTurnSandbox(connection);
      await refreshCatalog(connection, origin, sandbox);
      const content = `${sandboxStatusText(sandbox)}\nUse coding/sandbox_recover to preserve old work and start a fresh shell when blocked.`;
      emit({ status: 'ok', summary: 'active shell ready', detail: content });
      return { tool, status: 'ok', content };
    }
    emit({ status: 'executing', summary: 'preserving old shell; preparing fresh generation' });
    const { fresh, receipt } = await recover(origin, snapshot, (receipt) => { published = receipt; });
    await refreshCatalog(connection, origin, fresh);
    const content = JSON.stringify({ ...receipt, available: ['coding/inspect', 'coding/execute'],
      note: 'Prior shell files remain at preservedUpper for inspection/harvest. They were not copied into the project. Execution tools are available again.' });
    emit({ status: 'ok', summary: 'shell recovered; old work preserved', detail: content });
    return { tool, status: 'ok', content, recoveryState: JSON.stringify([path.dirname(fresh.workspace), 'ready']) };
  } catch (error) {
    if (origin.isCurrent() && !origin.signal.aborted && !published) {
      await refreshCatalog(connection, origin, null, error).catch((refreshError) =>
        log.warn('Unable to refresh coding capabilities after refusal', { error: refreshError.message }));
    }
    const status = error.name === 'AbortError' ? 'interrupted' : toolName === 'sandbox_status' ? 'unavailable' : 'error';
    const detail = published ? `Recovery was published but finalization did not complete; old work is preserved at ${published.preservedUpper}. Refresh sandbox_status.`
      : toolName === 'sandbox_status' ? `The coding shell is unavailable this turn: ${error.message}` : error.message;
    emit({ status, summary: 'shell control did not complete', detail });
    return { tool, status, error: detail };
  } finally { origin.close(); }
};
