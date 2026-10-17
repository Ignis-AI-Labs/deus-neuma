// impure - deferred sends belong to one navigation, never the refs at release.
import { showNotification } from '../../utils/notifications.js';

/** Build the outgoing history gate for one stream's navigation refs. */
export const createStreamSendGate = ({
  wsService, navigationSeqRef, companionRef, historyReadyRef, historyFailedRef,
}) => (fire, draft = 'Retry') => {
  const gate = historyReadyRef?.current;
  const generation = navigationSeqRef?.current;
  const neumaId = companionRef.current?.neumaId;
  const sessionId = wsService.getSessionState?.()?.sessionId;
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    // The portal emitter iterates a mutable listener array; removal in the
    // callback would skip the next queued draft's cancellation.
    queueMicrotask(() => wsService.off('portal:navigation-start', cancel));
    showNotification(`NOT SENT: conversation changed. ${draft}`, 'error', 12000);
  };
  const release = () => {
    if (cancelled) return false;
    wsService.off?.('portal:navigation-start', cancel);
    const currentSession = wsService.getSessionState?.()?.sessionId;
    if (generation !== navigationSeqRef?.current
      || neumaId !== companionRef.current?.neumaId
      || gate !== historyReadyRef?.current
      || (sessionId && sessionId !== currentSession)) {
      cancel();
      return false;
    }
    if (historyFailedRef?.current) {
      showNotification(`NOT SENT: chat history unavailable. Reload to retry. ${draft}`, 'error', 12000);
      return false;
    }
    if (!wsService.isConnected || wsService.ws?.readyState !== 1) {
      showNotification(`NOT SENT: portal disconnected. ${draft}`, 'error', 12000);
      return false;
    }
    fire();
    return true;
  };
  if (!gate) return release();
  wsService.on('portal:navigation-start', cancel);
  return gate.then(release, () => {
    wsService.off('portal:navigation-start', cancel);
    if (!cancelled) showNotification(`NOT SENT: chat history failed. ${draft}`, 'error', 12000);
    return false;
  });
};
