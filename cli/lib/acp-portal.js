// The ACP portal — the sink a sitting writes its frames to when the operator
// is in an editor instead of a terminal. It stands where the terminal portal
// stands (terminal-portal.js) and reads the same frames; it turns them into
// Agent Client Protocol messages instead of terminal lines:
//
//   the being's words        → session/update agent_message_chunk
//   a tool starting, ending  → session/update tool_call / tool_call_update
//   an approval the act needs→ session/request_permission, answered by the editor
//   an operator ask          → settled ABSENT (ACP has no question card yet); the being decides
//
// The engine underneath is untouched: the same gates decide what needs an
// approval, and the editor's answer goes through resolveToolApproval exactly
// like a click on the desk card.
//
// impure (sends on the wire, resolves approvals on the connection).

import { classifyFrame } from './terminal-portal.js';

/** The ACP tool kind for one of our tool names. Pure. */
export const acpToolKind = (tool) => {
  const name = String(tool || '').toLowerCase();
  if (/(^|\/)(read|view|list|tree|stat|info)/.test(name) || name.startsWith('read_')) return 'read';
  if (/(^|\/)(search|grep|find|glob)/.test(name)) return 'search';
  if (/(^|\/)delete/.test(name)) return 'delete';
  if (/(^|\/)(move|rename)/.test(name)) return 'move';
  if (/(^|\/)(write|edit|copy|create|replace)/.test(name)) return 'edit';
  if (/(^|\/)(execute|inspect|run|shell)/.test(name)) return 'execute';
  if (/^(web|http|fetch)|\/(fetch|browse)/.test(name)) return 'fetch';
  return 'other';
};

/** Our tool status as an ACP tool call status. Pure. */
export const acpToolStatus = (status) => {
  if (status === 'executing') return 'in_progress';
  if (status === 'ok' || status === 'success') return 'completed';
  if (status === 'pending') return 'pending';
  return 'failed';
};

/** The editor's chosen option as our approval decision. Pure. */
export const decisionFor = (outcome) => {
  if (outcome?.outcome !== 'selected') return 'deny';
  if (outcome.optionId === 'allow-once') return 'allow';
  if (outcome.optionId === 'allow-always') return 'always';
  return 'deny';
};

/** The three answers an approval offers in the editor. */
export const PERMISSION_OPTIONS = Object.freeze([
  Object.freeze({ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }),
  Object.freeze({ optionId: 'allow-always', name: 'Allow for this session', kind: 'allow_always' }),
  Object.freeze({ optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }),
]);

const parseArgs = (args) => {
  if (typeof args !== 'string') return args ?? {};
  try { return JSON.parse(args); } catch { return { preview: args }; }
};

/**
 * A ws-shaped sink for one ACP session.
 * @param {object} opts
 * @param {{ notify: Function, request: Function }} opts.wire
 * @param {string} opts.sessionId - the ACP session id
 * @param {object} opts.connection - the sitting this portal serves
 * @param {(connection: object, id: string, decision: string) => unknown} opts.resolveToolApproval
 * @param {(connection: object, id: string, how: string) => unknown} opts.settleOperatorAsk
 * @param {(line: string) => void} [opts.log]
 */
export const createAcpPortal = ({ wire, sessionId, connection, resolveToolApproval, settleOperatorAsk, log = () => {} }) => {
  const state = { acts: 0, completed: false, sessionId: null };
  const open = new Map(); // tool name → the ACP call id it is running under
  let calls = 0;
  const update = (body) => wire.notify('session/update', { sessionId, update: body });
  const newCallId = () => { calls += 1; return `call-${calls}`; };

  const onTool = (frame) => {
    const status = acpToolStatus(frame.status);
    let id = open.get(frame.tool);
    if (!id) {
      id = newCallId();
      update({ sessionUpdate: 'tool_call', toolCallId: id, title: frame.summary || frame.tool, kind: acpToolKind(frame.tool), status });
    }
    if (status === 'in_progress') {
      open.set(frame.tool, id);
      if (frame.summary) update({ sessionUpdate: 'tool_call_update', toolCallId: id, status, title: frame.summary });
      return;
    }
    open.delete(frame.tool);
    state.acts += 1;
    update({
      sessionUpdate: 'tool_call_update', toolCallId: id, status,
      ...(frame.summary ? { content: [{ type: 'content', content: { type: 'text', text: frame.summary } }] } : {}),
    });
  };

  const onApproval = async (frame) => {
    const id = newCallId();
    // The act that follows the yes runs under the same call id.
    open.set(frame.tool, id);
    let decision = 'deny';
    try {
      const answer = await wire.request('session/request_permission', {
        sessionId,
        toolCall: { toolCallId: id, title: frame.tool, kind: acpToolKind(frame.tool), status: 'pending', rawInput: parseArgs(frame.args) },
        options: PERMISSION_OPTIONS,
      });
      decision = decisionFor(answer?.outcome);
    } catch (error) {
      log(`acp: permission for ${frame.tool} not answered — ${error.message}; refused`);
    }
    if (decision === 'deny') {
      open.delete(frame.tool);
      update({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'refused' } }] });
    }
    resolveToolApproval(connection, frame.id, decision);
  };

  return {
    readyState: 1,
    OPEN: 1,
    state,
    send(raw) {
      const frame = classifyFrame(raw);
      if (frame.kind === 'speech') {
        if (frame.content) update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: frame.content } });
        return;
      }
      if (frame.kind === 'tool') { onTool(frame); return; }
      if (frame.kind === 'approval') { void onApproval(frame); return; }
      if (frame.kind === 'ask') {
        log('acp: an operator ask has no card in this editor — the being decides');
        settleOperatorAsk(connection, frame.id, 'absent');
        return;
      }
      if (frame.kind === 'complete') {
        state.completed = true;
        state.sessionId = frame.sessionId;
      }
    },
  };
};
