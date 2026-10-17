// use-reconnect-reload — a surface reads what settled in its sitting while it
// was not the one speaking.
//
// Four ways in. The socket linking up (a socket that recovered, or a page
// that was reloaded mid-turn — the turn's frames belong to the dead
// connection). The page becoming visible again (a phone unlocking — its
// socket may be a zombie the OS froze and never closed, so the service is
// nudged first). And a SIBLING surface — the phone while this is the desk,
// the desk while this is the phone — starting or settling a turn in the same
// wallet + being + session (backend/services/session-follow.js), which is
// how the desk follows the phone along.
//
// Every road ends the same way: LOOK at the session on disk and apply it
// through the stream hook's own resumeSession — only when disk holds a reply
// the screen lacks, or a sibling says the sitting moved; never on a guess
// (that erased a half-streamed answer once). While this surface is still
// owed a reply it looks again, 5 s doubling to 30 s.
//
// The stream hook and the reducer are frozen by the size law, so this lives
// beside them rather than inside them. impure (timers, socket + document
// events, network).
import { useEffect, useRef } from 'react';
import { loadSessionMessages } from './workspace-sessions.js';
import { awaitingReply, replyLanded, pollDelay, POLL_ATTEMPTS, POLL_MIN_MS } from './reconnect-reload.js';

// A link-up races the stream hook's own history load: an empty screen right
// after one is "not loaded yet", not "nothing owed" — look again a few times.
const EMPTY_LOOKS = 3;

/**
 * @param {import('../../services/WebSocketService.js').WebSocketService} wsService
 * @param {{ resumeSession: (bind: { neumaId: string, companionName: string, sessionId: string }) => Promise<void>, messages: readonly object[] }} stream
 */
export const useReconnectReload = (wsService, { resumeSession, messages }) => {
  const latest = useRef({ messages, resumeSession });
  latest.current = { messages, resumeSession };

  useEffect(() => {
    let timer = null;
    let attempt = 0;
    let alive = true;

    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const again = () => {
      if (attempt >= POLL_ATTEMPTS) return;
      timer = setTimeout(look, pollDelay(attempt));
      attempt += 1;
    };
    const bound = () => {
      const bind = wsService.getSessionState();
      return bind?.sessionId ? { neumaId: bind.neumaId, companionName: bind.companionName || 'Unknown', sessionId: bind.sessionId } : null;
    };

    const look = async () => {
      timer = null;
      if (!alive) return;
      const rows = latest.current.messages;
      if (rows.length === 0) {
        if (attempt < EMPTY_LOOKS) again();
        return;
      }
      const bind = bound();
      if (!bind || !awaitingReply(rows)) return;
      const onDisk = await loadSessionMessages(bind.neumaId, bind.sessionId);
      if (!alive || !awaitingReply(latest.current.messages)) return;
      if (replyLanded(onDisk)) {
        await latest.current.resumeSession(bind);
        return;
      }
      again();
    };
    const lookNow = () => {
      stop();
      attempt = 0;
      look();
    };
    // After a link-up the stream hook is loading history itself; give it a beat.
    const lookSoon = () => {
      stop();
      attempt = 0;
      timer = setTimeout(look, POLL_MIN_MS);
    };

    const onDown = () => stop();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      wsService.nudge();
      lookNow();
    };
    // A sibling spoke in this sitting. Owed a reply here already (our own
    // turn, or a reload that showed their words): look now, the poll takes
    // it from there. Otherwise the sitting moved under us: read it, and if
    // the turn only started, keep looking until it settles.
    const onSibling = async (frame) => {
      const bind = bound();
      if (!alive || !bind || frame?.sessionId !== bind.sessionId) return;
      if (awaitingReply(latest.current.messages)) { lookNow(); return; }
      await latest.current.resumeSession(bind);
      if (alive && frame?.phase === 'started') lookSoon();
    };

    wsService.on('disconnection', onDown);
    wsService.on('connection', lookSoon);
    wsService.on('portal:sibling', onSibling);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      stop();
      wsService.off('disconnection', onDown);
      wsService.off('connection', lookSoon);
      wsService.off('portal:sibling', onSibling);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [wsService]);
};
