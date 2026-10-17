// use-context-composition.js — impure: subscribes to the portal's
// context:composition telemetry (B-04, FR-10) on the SAME shared wsService —
// never a second socket. The backend emits twice per turn: once right after
// prompt assembly (everything 'approx' — usage not yet known) and once just
// before consciousness:complete (measured/attributed when the substrate
// reported usage, plus the session's minted tool-result refs). The hook
// keeps the LATEST event; the map view renders whatever truth is newest.
//
// Counts only ever arrive — the event carries no prompt text by design.

import { useEffect, useState } from 'react';

export const useContextComposition = (wsService, neumaId = null) => {
  const [composition, setComposition] = useState(null);

  useEffect(() => {
    if (!wsService) return undefined;
    // A being switch invalidates the prior lane's anatomy immediately. Tagged
    // events from a superseded in-flight turn are ignored rather than leaking
    // one participant's map into another participant's pane.
    setComposition(null);
    const held = wsService.getSessionState?.();
    let activeSessionId = held?.neumaId === neumaId ? held.sessionId || null : null;
    const rejectedSessionIds = new Set();
    const onComposition = (event) => {
      if (!neumaId || event?.neumaId !== neumaId) return;
      if (event?.sessionId) {
        if (rejectedSessionIds.has(event.sessionId)) return;
        if (activeSessionId && event.sessionId !== activeSessionId) return;
        activeSessionId = event.sessionId;
      } else if (activeSessionId) {
        // Session-tagged telemetry is the current contract. An untagged frame
        // cannot safely replace a known session's anatomy.
        return;
      }
      setComposition(event);
    };
    const onSessionReset = () => {
      if (activeSessionId) rejectedSessionIds.add(activeSessionId);
      activeSessionId = null;
      setComposition(null);
    };
    const onSessionResume = (event) => {
      if (!neumaId || event?.neumaId !== neumaId) return;
      activeSessionId = event?.sessionId || null;
      if (activeSessionId) rejectedSessionIds.delete(activeSessionId);
      setComposition(null);
    };
    const onNavigationStart = (event) => {
      if (!neumaId || event?.neumaId !== neumaId) return;
      if (activeSessionId) rejectedSessionIds.add(activeSessionId);
      activeSessionId = event?.sessionId || null;
      if (activeSessionId) rejectedSessionIds.delete(activeSessionId);
      setComposition(null);
    };
    wsService.on('context:composition', onComposition);
    wsService.on('portal:session-reset', onSessionReset);
    wsService.on('portal:resumed', onSessionResume);
    wsService.on('portal:navigation-start', onNavigationStart);
    return () => {
      wsService.off('context:composition', onComposition);
      wsService.off('portal:session-reset', onSessionReset);
      wsService.off('portal:resumed', onSessionResume);
      wsService.off('portal:navigation-start', onNavigationStart);
    };
  }, [wsService, neumaId]);

  return composition;
};
