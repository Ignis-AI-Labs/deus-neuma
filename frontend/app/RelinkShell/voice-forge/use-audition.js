// use-audition.js — HEAR IT TALK: ask the being to speak in the candidate voice.
//
// impure hook over the portal. The audition rides the EXACT chat path
// (docs/work/one-voice.md INTEGRATION): the desk sends
//   voice:audition {sessionId, line?}
// on the portal; the backend speaks the being's lines in the forge's pinned
// take and streams them back as ordinary voice:audio frames, which the chat's
// one voice sink plays (use-consciousness-stream.js). Audition turns are never
// written to history. Without `line` the being says a short exchange of its
// own; with it, that line.
//
// The backend answers a refusal as voice:audition_error {sessionId, error} and
// the end of an audition as voice:audition_done {sessionId}.

import { useCallback, useEffect, useState } from 'react';

const IDLE = Object.freeze({ phase: 'idle', error: null, last: null });

/**
 * @param {{wsService: object|null, sessionId: string|null}} args
 * @returns {{phase: 'idle'|'sent'|'done'|'error', error: string|null, speak: (line?: string) => boolean, again: () => boolean}}
 */
export const useAudition = ({ wsService, sessionId }) => {
  const [s, setS] = useState(IDLE);

  useEffect(() => {
    setS(IDLE);
    if (!wsService) return undefined;
    const mine = (data) => !data?.sessionId || data.sessionId === sessionId;
    const onError = (data) => { if (mine(data)) setS((prev) => ({ ...prev, phase: 'error', error: data?.error || 'the audition failed' })); };
    const onDone = (data) => { if (mine(data)) setS((prev) => ({ ...prev, phase: 'done' })); };
    wsService.on('voice:audition_error', onError);
    wsService.on('voice:audition_done', onDone);
    return () => {
      wsService.off('voice:audition_error', onError);
      wsService.off('voice:audition_done', onDone);
    };
  }, [wsService, sessionId]);

  const speak = useCallback((line) => {
    if (!wsService?.isConnected || !sessionId) {
      setS((prev) => ({ ...prev, phase: 'error', error: 'disconnected' }));
      return false;
    }
    const text = typeof line === 'string' ? line.trim() : '';
    const payload = { sessionId, ...(text ? { line: text } : {}) };
    wsService.send('voice:audition', payload);
    setS({ phase: 'sent', error: null, last: payload });
    return true;
  }, [wsService, sessionId]);

  const again = useCallback(() => speak(s.last?.line), [speak, s.last]);

  return { phase: s.phase, error: s.error, speak, again };
};
