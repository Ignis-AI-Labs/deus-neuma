/**
 * Witness coding + context tool handlers.
 *
 * Extracted VERBATIM from witness-tools.js (size law, SIZE breakdown
 * 2026-08-26): the coding-shell handler (sandbox_status / ground_git /
 * inspect / execute) and the lane's context-map read. witness-tools.js keeps
 * the catalog, the act gate, and the dispatch loop; it passes its act gate
 * into `handleCodingTool` so this module never imports the file it was cut
 * from (direction law). `handleContextTool` is re-exported from
 * witness-tools.js for its existing readers.
 */
import { renderCommandResult } from './coding-result.js';
import { executionPresentation } from './execution-presentation.js';
import { pageContextMapField, readContextMapField, readContextMapNode } from './context-map.js';
import { handleGroundGitTool } from './ground-git-consent.js';
import {
  runWitnessCommand,
} from './witness-coding-sandbox.js';
import { sendToolEvent } from './witness-tool-events.js';
import { handleCodingShellControl } from './coding-shell-control.js';
import { focusGroundOf } from './focus-ground.js';

// impure — one coding-shell call. `gateWitnessAct` is the caller's act gate
// (witness-tools.js), injected so the dependency flows orchestrator → family.
export const handleCodingTool = async (ws, connection, identity, args, sandbox, gateWitnessAct) => {
  const tool = `coding/${identity.toolName}`;
  if (identity.toolName === 'sandbox_status' || identity.toolName === 'sandbox_recover') {
    return handleCodingShellControl({ ws, connection, toolName: identity.toolName, args, sendToolEvent });
  }
  if ((identity.toolName === 'ground_git' || identity.toolName === 'ground_sync') && focusGroundOf(connection)) {
    return handleGroundGitTool({ ws, connection, toolName: identity.toolName, args,
      sandbox: sandbox || { sourceRoot: focusGroundOf(connection) }, sendToolEvent });
  }
  if (!sandbox) {
    const error = connection._turnSandboxError
      ? `The coding shell is unavailable this turn: ${connection._turnSandboxError}`
      : 'No focused workspace is open. Focus an opened folder or project before using coding tools.';
    sendToolEvent(ws, connection.companion, { tool, status: 'unavailable', summary: 'coding shell unavailable', detail: error });
    return { tool, status: 'unavailable', error };
  }
  const gate = await gateWitnessAct(ws, connection, identity, args);
  if (!gate.ok) return gate.result;

  const presentation = executionPresentation(args?.command);
  const paint = (r) => sendToolEvent(ws, connection.companion, {
    tool, status: 'executing', ...presentation, ...(r.stream ? { progress: true } : {}),
    detail: renderCommandResult({ exitCode: null, timedOut: false, truncated: false, stdout: r.stdout, stderr: r.stderr }).slice(0, 2000),
  });
  paint({ stdout: '', stderr: '' });
  try {
    const result = await runWitnessCommand({
      ...sandbox, command: args?.command, timeoutMs: args?.timeoutMs,
      mode: identity.toolName === 'inspect' ? 'inspect' : 'write',
      signal: connection.activeTurn?.signal, onChunk: paint,
    });
    const content = renderCommandResult(result);
    const ok = result.exitCode === 0 && !result.timedOut;
    sendToolEvent(ws, connection.companion, {
      tool,
      status: ok ? 'ok' : 'error',
      ...executionPresentation(args?.command, { result }),
      detail: content.slice(0, 2000),
    });
    return ok ? { tool, status: 'ok', content } : { tool, status: 'error', error: content };
  } catch (error) {
    sendToolEvent(ws, connection.companion, { tool, status: 'error', ...executionPresentation(args?.command, { error }), detail: error.message });
    return { tool, status: 'error', error: error.message };
  }
};

// impure — read only the lane bound on this connection. The caller cannot
// name another id; composition is the exact event already sent to the desk.
export const handleContextTool = async (ws, connection, args) => {
  const tool = 'context/map_read';
  const laneId = connection.companion?.neumaId;
  if (!laneId || connection.companion?.participantKind !== 'witness') {
    const error = 'No sealed witness lane is bound to this portal';
    sendToolEvent(ws, connection.companion, { tool, status: 'error', detail: error });
    return { tool, status: 'error', error };
  }

  try {
    const view = args?.view || 'composition';
    if (view !== 'composition' && view !== 'field' && view !== 'node') {
      throw new Error("view must be 'composition', 'field', or 'node'");
    }
    let data;
    if (view === 'field') {
      data = pageContextMapField(await readContextMapField(laneId), {
        offset: args?.offset,
        limit: args?.limit,
        edgeOffset: args?.edgeOffset,
        edgeLimit: args?.edgeLimit,
      });
    } else if (view === 'node') {
      const nodeId = typeof args?.nodeId === 'string' ? args.nodeId.trim() : '';
      if (!nodeId) throw new Error('view "node" needs nodeId — a 16-char hex node id from a field page');
      const result = await readContextMapNode(laneId, nodeId, {
        includeNeighbors: args?.includeNeighbors !== false,
        includeSource: args?.includeSource === true,
      });
      if (!result.ok) throw new Error(result.reason);
      data = result;
    } else {
      // BOTH IDS, not just the being. Comparing neumaId alone was safe only
      // because of the one-session-per-connection law — a law this guard never
      // stated and therefore never held anyone to. A composition carries its
      // sessionId; if it names a sitting this connection is no longer in, it
      // describes another conversation, and handing that to a being as its own
      // context anatomy is the backend twin of the gauge bug (Design note, 2026-08-30:
      // […]).
      const held = connection.contextComposition;
      const isThisSitting = held?.neumaId === laneId
        && (!held.sessionId || !connection.sessionId || held.sessionId === connection.sessionId);
      data = isThisSitting ? held : {
        type: 'context:composition',
        neumaId: laneId,
        status: 'no turn composition has been assembled yet',
      };
    }
    const content = JSON.stringify({ view, data });
    sendToolEvent(ws, connection.companion, {
      tool, status: 'ok', summary: `${view} map read`, detail: content.slice(0, 2000),
    });
    return { tool, status: 'ok', content };
  } catch (error) {
    sendToolEvent(ws, connection.companion, {
      tool, status: 'error', summary: 'context map read failed', detail: error.message,
    });
    return { tool, status: 'error', error: error.message };
  }
};
