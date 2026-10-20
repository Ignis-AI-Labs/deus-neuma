// stream-link-history.js — the link-up history load: bind the portal to the
// chat on screen, retry a failed load once, hold sends on a confirmed failure.
//
// Extracted from stream-message-handlers.js (size law, 2026-08-31). One
// responsibility: the promise the reload-race gate (historyReadyRef) waits
// on. The laws it carries:
//
//   D5 — THE RELOAD RACE: the load's promise is published BEFORE any turn can
//     stamp turnStartedRef; a thought fired in this window waits on the gate
//     (stream-actions.js) instead of skipping the resume bind and forking the
//     session server-side.
//   FAIL LOUD, NEVER FORK (ruling, 2026-08-31): a failed load used to read as an
//     empty chat, and the next send minted a forked session over an intact
//     one. Warn, retry ONCE inside the gate (a gated send simply waits out
//     the retry), and only then set historyFailedRef — stream-actions holds
//     every send on the ground with a loud bubble until a load succeeds.
//
// impure — fetches (via loadLatestSession), dispatches, sends the resume bind.
import { loadLatestSession } from './session-history.js';

export const runLinkHistoryLoad = ({
  wsService, dispatch, portalFocusFrame,
  companionRef, navigationSeqRef, turnStartedRef, projectChatSeenRef,
  focusRef, projectsRef, historyFailedRef,
  target, navigationSeq,
}) => (async () => {
  let result = await loadLatestSession(target?.neumaId);
  if (navigationSeq !== navigationSeqRef.current) return;
  if (target?.neumaId !== companionRef.current?.neumaId) return;
  if (result.failed) {
    dispatch({ type: 'ERROR', text: '«WARNING» chat history unavailable — retrying…' });
    await new Promise((resolve) => { setTimeout(resolve, 1500); });
    if (navigationSeq !== navigationSeqRef.current) return;
    if (target?.neumaId !== companionRef.current?.neumaId) return;
    result = await loadLatestSession(target?.neumaId);
    if (navigationSeq !== navigationSeqRef.current) return;
    if (target?.neumaId !== companionRef.current?.neumaId) return;
  }
  if (result.failed) {
    historyFailedRef.current = true;
    dispatch({ type: 'ERROR', text: '«WARNING» chat history unavailable — messages are HELD. Reload to retry; your chat is intact on disk.' });
    return;
  }
  historyFailedRef.current = false;
  const { sessionId, messages } = result;
  if (navigationSeq !== navigationSeqRef.current) return;
  if (target?.neumaId !== companionRef.current?.neumaId) return;
  if (messages.length) dispatch({ type: 'HISTORY', messages });
  // Chatbot parity: the chat shown on screen IS the chat the next
  // message continues. Bind the portal to the displayed session —
  // without this the display says continuation while the server mints
  // a fresh session, forking the record (and the neuma's context).
  // Skip if the operator already started talking on this link: the
  // server has session truth for that turn and echoes it on complete.
  if (!sessionId || turnStartedRef.current) return;
  const neumaId = target?.neumaId;
  if (!neumaId) return;
  // This session already exists — account for it so its first complete
  // is not mistaken for a new project chat (the same guard resumeSession
  // sets; without it a link-up under a project spuriously refreshes).
  projectChatSeenRef.current = sessionId;
  const bind = { neumaId, companionName: target?.name || 'Unknown', sessionId };
  wsService.setSessionState(bind); // reconnects re-bind the same chat
  wsService.send('portal:resume', { ...bind, ...portalFocusFrame(focusRef.current, projectsRef.current) });
  // A failed load must never swallow a gated thought — the gate resolves
  // either way and the send checks historyFailedRef before flying.
})().catch((error) => {
  if (navigationSeq !== navigationSeqRef.current) return;
  if (target?.neumaId !== companionRef.current?.neumaId) return;
  historyFailedRef.current = true;
  dispatch({ type: 'ERROR', text: `Chat history unavailable; messages were not sent: ${error.message}` });
});
