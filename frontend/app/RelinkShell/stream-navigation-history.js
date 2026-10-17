// impure - publish every navigation's history gate before returning to the UI.
import { loadLatestSession } from './session-history.js';
import { loadSessionMessagesStrict } from './workspace-sessions.js';
import { RECENT_ROWS } from '../../../core/runtime/memory-section.js';

/** Load one navigation's transcript; obsolete outcomes have no side effects. */
export const loadNavigationHistory = ({
  historyReadyRef, historyFailedRef, navigationSeqRef, navigationSeq, dispatch,
  neumaId, sessionId, onLoaded,
}) => {
  historyFailedRef.current = false;
  const gate = (async () => {
    try {
      const result = sessionId
        ? { sessionId, messages: await loadSessionMessagesStrict(neumaId, sessionId, RECENT_ROWS) }
        : await loadLatestSession(neumaId);
      if (navigationSeq !== navigationSeqRef.current) return;
      if (result.failed) throw new Error(result.error || 'History unavailable');
      dispatch({ type: 'LOAD', messages: result.messages,
        threadKey: `${neumaId}:${result.sessionId || 'fresh'}:${navigationSeq}` });
      onLoaded?.(result);
    } catch (error) {
      if (navigationSeq !== navigationSeqRef.current) return;
      historyFailedRef.current = true;
      dispatch({ type: 'ERROR', text: `Chat history unavailable; messages were not sent: ${error.message}` });
    }
  })();
  historyReadyRef.current = gate;
  return gate;
};
