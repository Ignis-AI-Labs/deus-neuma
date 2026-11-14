// use-all-chats — the ALL register of the Chats window (deus-neuma #30): every neuma's one-on-ones
// read at once (each lane's own list), and a search fanned out to each lane's own content search.
// Same shape as useChatSearch, so the window draws either. impure (network, timers).
import { useCallback, useEffect, useRef, useState } from 'react';
import { listSessionsStrict } from './workspace-sessions.js';
import { searchChatContents } from '../../services/chat-search.js';
import { mergeAllChats, searchAllRows } from './all-chats-view.js';

export const useAllChats = (members, labels, enabled) => {
  const [lists, setLists] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null); // {term, matches, error?}
  const [attempt, setAttempt] = useState(0);
  // the roster is re-read each render; the lists follow its ids, not the array's identity
  const ids = members.map((m) => m.neumaId).join(',');
  const membersRef = useRef(members);
  membersRef.current = members;

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLists(null);
    setError(null);
    try {
      setLists(await Promise.all(membersRef.current.map(async (member) => ({ member, sessions: await listSessionsStrict(member.neumaId) }))));
    } catch (err) {
      setError(err.message);
    }
  }, [enabled, ids]);
  useEffect(() => { refresh(); }, [refresh]);

  const term = query.trim();
  useEffect(() => {
    if (!enabled || !term) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const each = await Promise.all(membersRef.current.map(async (m) => (await searchChatContents(m.neumaId, term, controller.signal))
          .map((match) => [`${m.neumaId}:${match.id}`, match])));
        if (!controller.signal.aborted) setFound({ term, attempt, matches: new Map(each.flat()) });
      } catch (err) {
        if (!controller.signal.aborted) setFound({ term, attempt, matches: new Map(), error: err.message });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [enabled, term, ids, attempt]);

  const current = found?.term === term && found.attempt === attempt ? found : null;
  const all = lists ? mergeAllChats(lists, labels) : null;
  return {
    sessions: all, error, refresh,
    search: {
      query, setQuery,
      rows: all ? searchAllRows(all, term, current?.matches ?? new Map()) : [],
      loading: Boolean(enabled && term && !current),
      error: term ? current?.error : null,
      retry: () => setAttempt((n) => n + 1),
    },
  };
};
