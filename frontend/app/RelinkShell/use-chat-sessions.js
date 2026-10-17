import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeadersOrNull } from '../../utils/http.js';
import { listSessionsStrict } from './workspace-sessions.js';
import { isCouncilSession } from './session-history.js';

/** Load one being's chat shelf without painting read failure as empty history. */
// impure — HTTP and request-lifetime state.
export const useChatSessions = (neumaId) => {
  const [result, setResult] = useState({ owner: neumaId, sessions: null, error: null });
  const request = useRef(0);
  useEffect(() => () => { request.current += 1; }, [neumaId]);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setResult({ owner: neumaId, sessions: null, error: null });
    try {
      if (neumaId && !authHeadersOrNull()) throw new Error('Sign in to read this history.');
      const sessions = await listSessionsStrict(neumaId);
      if (request.current !== current) return;
      setResult({ owner: neumaId, sessions: sessions.filter((id) => !isCouncilSession(id)), error: null });
    } catch (error) {
      if (request.current !== current) return;
      setResult({ owner: neumaId, sessions: null, error: error.message || 'History could not be read.' });
    }
  }, [neumaId]);
  const visible = result.owner === neumaId ? result : { sessions: null, error: null };
  return { sessions: visible.sessions, error: visible.error, refresh };
};
