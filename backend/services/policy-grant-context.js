import workspace from '../../core/workspace/neuma-workspace.js';

/** Capture a grant's origin before awaits; this is cancellation, not consent. impure. */
export const capturePolicyGrant = (connection, { signal = connection.activeTurn?.signal, isCurrent } = {}) => {
  const companion = connection.companion;
  const laneId = companion?.neumaId;
  const sessionId = connection.sessionId;
  const root = workspace.root;
  const lanePath = laneId ? workspace.pathFor(laneId) : null;
  const beforeCommit = () => {
    if (signal?.aborted || connection.companion !== companion
      || connection.companion?.neumaId !== laneId || connection.sessionId !== sessionId
      || workspace.root !== root || (laneId && workspace.pathFor(laneId) !== lanePath)
      || connection.ws?.readyState > 1 || (isCurrent && !isCurrent())) {
      throw new DOMException('Permission grant origin interrupted or changed', 'AbortError');
    }
  };
  return Object.freeze({ laneId, signal, beforeCommit });
};
