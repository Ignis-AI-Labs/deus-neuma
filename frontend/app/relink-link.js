// relink-link.js — bind the portal to THIS WINDOW's companion.
//
// impure — portal IO. Covers both arrival paths into the relink phase:
// a socket that opened during the ceremony (before the being existed, so
// re-manifest it) and a returning witness whose socket is cold (connect,
// which manifests from held state on open). The binding resolves
// window-first (F-01): a companion switch made in a sibling window must
// never decide who THIS window speaks with.

import { resolveBoundCompanion } from '../utils/companion-data.js';

/**
 * Set the session resume state and ensure the link is live for this
 * window's bound companion. No-op if no companion is resolvable.
 * @param {import('../services/WebSocketService.js').WebSocketService} wsService
 */
// impure
export const openCompanionLink = (wsService) => {
  const companion = resolveBoundCompanion();
  if (!companion) return;

  // Re-entering relink (or a dev double-mount) must not clobber the chat
  // binding: keep the held sessionId when it belongs to this same being —
  // wiping it here would make the next reconnect fork a fresh session.
  const prior = wsService.getSessionState();
  const neumaId = companion.neumaId || null;
  wsService.setSessionState({
    neumaId,
    companionName: companion.name,
    sessionId: prior && prior.neumaId === neumaId ? prior.sessionId ?? null : null,
  });

  if (wsService.isConnected) {
    // The socket opened before this being existed (post-ceremony) — bind
    // this connection to them now (parity with the old App.js:207 manifest).
    wsService.send('companion:manifest', {
      companion: companion.name,
      neumaId: companion.neumaId || null,
    });
  } else {
    // Cold link — connect() sends the manifest itself from storage on open.
    wsService.connect();
  }
};
