import { PURPOSE_WORK } from '../../../core/voice/purpose.js';

/** Pure reconnect wire declarations, in server precedence order. */
export const reconnectFrames = ({ toolMode, chatMode, voiceEnabled, purpose }) => [
  ['tool:mode', { mode: toolMode }],
  ['chat:mode', { mode: chatMode }],
  ['voice:pref', { enabled: voiceEnabled }],
  ...(purpose !== PURPOSE_WORK ? [['session:purpose', { purpose }]] : []),
];

/** Pure session identity used by completion and reset bookkeeping. */
export const streamSession = (companion, sessionId) => ({
  neumaId: companion?.neumaId,
  companionName: companion?.name || 'Unknown',
  sessionId,
});

/** Ignore a resume acknowledgement belonging to a different participant. */
export const resumedSession = (data, companion) => {
  if (!data?.neumaId || data.neumaId !== companion?.neumaId) return null;
  return { neumaId: data.neumaId, companionName: data.companionName || companion?.name || 'Unknown', sessionId: data.sessionId || null };
};

/** Pure translation of lifecycle and tool frames into reducer actions. */
export const lifecycleAction = (channel, data) => {
  switch (channel) {
    case 'tool:usage': return { type: 'TOOL_RESULT', data };
    case 'substrate:activity': return { type: 'ACTIVITY', local: data?.local };
    case 'connection': return { type: 'LINK', connected: true };
    case 'disconnection': return { type: 'LINK', connected: false };
    case 'companion:lane_missing': return { type: 'ERROR', text: data?.message || 'This being has no workspace under the active root.' };
    case 'companion:not_yours': return { type: 'ERROR', text: data?.message || 'This being belongs to another witness — the portal did not bind it.' };
    default: return null;
  }
};
