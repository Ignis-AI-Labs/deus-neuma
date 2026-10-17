// session-history.js — load the latest session for display on relink.
//
// impure — fetches the active neuma's most recent session so returning to
// them doesn't read as memory loss. Returns the session's ID alongside its
// messages: the caller binds the portal to that session, so what the screen
// shows as a continuing chat IS the chat the next message lands in (the
// display and the record must never fork). Rides the STRICT workspace-sessions
// variants (Design note, 2026-08-31 — […]): a failed load comes
// back marked `failed: true` so the relink can hold sends and say so, instead
// of reading as an empty chat and silently minting a forked session over an
// intact one.

import { listSessionsStrict as listSessions, loadSessionMessagesStrict as loadSessionMessages } from './workspace-sessions.js';
import { RECENT_ROWS } from '../../../core/runtime/memory-section.js';


/**
 * @param {string|null|undefined} neumaId - The WINDOW's bound neuma (F-01:
 *   callers pass their window-local binding; this module no longer reads the
 *   shared last-used companion, which a sibling window may have moved).
 * @returns {Promise<{sessionId: string|null, messages: Array<{role: 'user'|'assistant', content: string}>, failed?: boolean, error?: string}>}
 *   `failed: true` marks a LOAD FAILURE (server error, dropped connection) —
 *   never confused with the legitimate empty of a being with no chats yet.
 */
// A council sitting writes into the member's OWN session lane (their
// memory of the room) — but it is the COUNCIL's conversation, not this
// window's one-on-one. The stream must never resume it as a private chat:
// reopening a council is the shelf's door (PAST COUNCILS), in the full
// council format.
export const isCouncilSession = (sessionId) => String(sessionId).startsWith('council-');

// impure
export const loadLatestSession = async (neumaId) => {
  if (!neumaId) return { sessionId: null, messages: [] };
  try {
    const sessions = (await listSessions(neumaId)).filter((s) => !isCouncilSession(s));
    if (sessions.length === 0) return { sessionId: null, messages: [] };
    const sessionId = sessions[0];
    return { sessionId, messages: await loadSessionMessages(neumaId, sessionId, RECENT_ROWS) };
  } catch (err) {
    // FAIL LOUD, NEVER FORK (Design note, 2026-08-31: a failed load is not an empty
    // chat. The relink surfaces this and HOLDS sends — silently minting a
    // fresh session over an intact one is the fork this flag exists to kill.
    return { sessionId: null, messages: [], failed: true, error: String(err?.message || err) };
  }
};
