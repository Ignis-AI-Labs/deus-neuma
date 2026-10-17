/** Turn retry evidence. No operation with an unknown outcome is automatically replayed. */
import { createHash } from 'node:crypto';
import workspace from '../../core/workspace/neuma-workspace.js';
import { OPERATION_CHECKPOINT_BYTE_CAP } from '../../core/workspace/workspace-operations.js';
import { createTurnToolEpochs } from './portal-tool-epochs.js';
import { toolCallKey } from './witness-tool-epochs.js';
import { startTimer, startOperationTiming, recordApprovalTiming, finishOperationTiming } from './operation-timing.js';

const checkpointError = (error, connection) => {
  connection._operationRecoveryStopped = true;
  return Object.assign(error, { code: 'TURN_OPERATION_CHECKPOINT' });
};
const savedResult = (result) => {
  const saved = { ...result };
  for (const key of ['content', 'error']) {
    if (typeof saved[key] === 'string' && saved[key].length > 60000) {
      saved[key] = `${saved[key].slice(0, 60000).toWellFormed()}\n[Receipt excerpt; ${saved.ref ? `retrieve ${saved.ref} from this session` : 'full result not retained here'}.]`;
    }
  }
  return saved;
};

/** impure — load only the captured lane/session/turn; unresolved work blocks inference. */
export const openTurnOperations = async (connection, take) => {
  const turn = createTurnToolEpochs();
  if (!take?.turnId) return turn; // constituent/ceremony paths have no ordinary turn point
  const scope = { laneId: connection.companion?.neumaId, sessionId: connection.sessionId, turnId: take.turnId };
  // A lane-less portal (a bare companion, no sovereign workspace) has no
  // operation record to verify and nowhere to persist one — the same standing
  // as the ceremony guard above, not a checkpoint failure.
  if (!scope.laneId || !scope.sessionId) return turn;
  try {
    const record = await workspace.readTurnOperations(scope.laneId, scope.sessionId, scope.turnId);
    if (record.inFlight) {
      const message = `Operation ${record.inFlight.id} (${record.inFlight.tool}) has an uncertain outcome. Automatic retry is stopped. Inspect its actual effects before starting a new action; do not repeat it to discover whether it ran.`;
      throw Object.assign(new Error(message), { publicMessage: message });
    }
    turn.epoch = record.epoch;
    turn.priorByKey = new Map(record.prior);
    turn.operations = { ...scope, revision: record.revision, connection };
    connection._operationRecoveryStopped = false;
    return turn;
  } catch (error) { throw checkpointError(error, connection); }
};

/** impure — durable start precedes dispatch, including any approval wait. */
export const beginTurnOperation = async (turn, call, epoch) => {
  const scope = turn.operations;
  if (!scope) return null;
  try {
    if (scope.connection._operationRecoveryStopped) throw new Error('Operation recovery stopped this turn; dispatch refused');
    if (scope.connection.companion?.neumaId !== scope.laneId || scope.connection.sessionId !== scope.sessionId) {
      throw new Error('Operation lane changed; dispatch refused');
    }
    const key = toolCallKey(call, epoch);
    const operation = {
      id: `op_${createHash('sha256').update(`${scope.turnId}\n${key}`).digest('hex').slice(0, 32)}`,
      tool: call.tool || `${call.server}/${call.toolName}`, state: 'running',
    };
    operation.startedAt = startOperationTiming(operation);
    const next = await workspace.updateTurnOperations(scope.laneId, scope.sessionId, scope.turnId, scope.revision, (record) => {
      if (record.inFlight) throw new Error(`Operation ${record.inFlight.id} is unresolved; dispatch refused`);
      if (Buffer.byteLength(JSON.stringify(record)) > OPERATION_CHECKPOINT_BYTE_CAP - 256000) {
        throw new Error('Operation receipt budget exhausted; start a new turn after reviewing existing receipts');
      }
      return { ...record, inFlight: { ...operation, request: call } };
    });
    scope.revision = next.revision;
    scope.connection._runningToolOperation = { turn, operation };
    return operation;
  } catch (error) { throw checkpointError(error, scope.connection); }
};

/** impure — receipt persistence must succeed before any dependent operation starts. */
export const finishTurnOperation = async (turn, operation, result) => {
  if (!operation) return;
  const scope = turn.operations;
  try {
    if (!result) throw new Error(`Operation ${operation.id} has no result; outcome uncertain`);
    const state = result.status === 'ok' ? 'succeeded'
      : ['held', 'denied'].includes(result.status) ? 'cancelled' : 'failed';
    const timing = finishOperationTiming(operation);
    const receipt = { ...operation, state, finishedAt: timing.finishedAt, timing };
    result.operationId = operation.id;
    result.operationState = state;
    result.operationTiming = timing;
    const next = await workspace.updateTurnOperations(scope.laneId, scope.sessionId, scope.turnId, scope.revision, (record) => {
      if (record.inFlight?.id !== operation.id) throw new Error('Operation receipt does not match the running operation');
      return { ...record, epoch: turn.epoch,
        prior: [...turn.priorByKey].map(([key, value]) => [key, savedResult(value)]),
        receipts: [...record.receipts, receipt], inFlight: null };
    });
    scope.revision = next.revision;
    if (scope.connection._operationRecoveryStopped) throw new Error('Receipt saved, but this turn stopped for operation recovery');
  } catch (error) { throw checkpointError(error, scope.connection); }
  finally {
    if (scope.connection._runningToolOperation?.operation.id === operation.id) delete scope.connection._runningToolOperation;
  }
};

/** impure — durable approval state brackets the real broker, without changing consent. */
export const withOperationApproval = async (connection, ask) => {
  const active = connection._runningToolOperation;
  if (!active) return ask();
  const { turn, operation } = active;
  const scope = turn.operations;
  const mark = async (state) => {
    try {
      const next = await workspace.updateTurnOperations(scope.laneId, scope.sessionId, scope.turnId, scope.revision, (record) => {
        if (record.inFlight?.id !== operation.id) throw new Error('Approval belongs to a departed operation');
        return { ...record, inFlight: { ...record.inFlight, state } };
      });
      scope.revision = next.revision;
    } catch (error) { throw checkpointError(error, connection); }
  };
  await mark('pending approval');
  const timer = startTimer();
  let decision = 'failed';
  try { decision = await ask(); }
  finally { recordApprovalTiming(operation, timer, decision); }
  if (decision === 'allow' || decision === 'always') await mark('running');
  return decision;
};

/** impure — settled intents move the epoch even when no further tool is requested. */
export const checkpointTurnEpoch = async (turn, receipts) => {
  const scope = turn.operations;
  if (!scope || !receipts.length) return;
  try {
    const next = await workspace.updateTurnOperations(scope.laneId, scope.sessionId, scope.turnId, scope.revision,
      (record) => ({ ...record, epoch: turn.epoch }));
    scope.revision = next.revision;
  } catch (error) { throw checkpointError(error, scope.connection); }
};
