import { useEffect, useState } from 'react';
import { searchChatContents } from '../../services/chat-search.js';
import { chatRows, filterRows } from './stream-chats-view.js';

/** impure — debounce reads and keep late responses out of another query/lane. */
export const useChatSearch = (neumaId, sessions, labels, enabled = true, chatId = null) => {
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const term = query.trim();
  useEffect(() => {
    if (!enabled || !neumaId || !term) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const matches = await searchChatContents(neumaId, term, controller.signal);
        if (!controller.signal.aborted) setResult({ neumaId, term, sessions, attempt, matches });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ neumaId, term, sessions, attempt, error: error.message });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [neumaId, term, enabled, sessions, attempt]);
  const current = enabled && result?.neumaId === neumaId && result.term === term
    && result.sessions === sessions && result.attempt === attempt ? result : null;
  const all = chatRows(sessions, labels, neumaId, chatId);
  const titles = new Set(filterRows(all, term).map((row) => row.id));
  const matches = new Map((current?.matches || []).map((match) => [match.id, match]));
  const rows = term ? all.filter((row) => titles.has(row.id) || matches.has(row.id))
    .map((row) => ({ ...row, excerpt: matches.get(row.id)?.excerpt })) : all;
  return {
    query, setQuery, rows,
    loading: Boolean(enabled && neumaId && term && !current),
    error: term ? current?.error : null,
    retry: () => setAttempt((value) => value + 1),
  };
};
