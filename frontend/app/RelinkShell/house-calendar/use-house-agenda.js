// use-house-agenda.js — the house calendar's one read, kept live. // impure
//
// GET /api/v1/tasks/agenda for the window on screen; re-read when a being
// acts (any successful tool frame — scheduling happens in many tools, and a
// burst collapses into one trailing read), and on a slow poll while the
// window is visible (a projected run comes due, a scheduler ticks). A failed
// re-read keeps the last truth the calendar honestly had.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiCall } from '../../../utils/http.js';
import { useConsciousnessPick } from '../consciousness-context.js';
import { useVisibleInterval } from '../use-visible-interval.js';

const POLL_MS = 60_000;
const BURST_MS = 600;

/**
 * @param {{from: string, to: string}} range - day keys, inclusive
 * @returns {{agenda: ?object, error: string, reload: () => void, ref: (node: Element|null) => void}}
 */
export const useHouseAgenda = ({ from, to }) => {
  const { wsService } = useConsciousnessPick('wsService');
  const [agenda, setAgenda] = useState(null);
  const [error, setError] = useState('');
  const asked = useRef('');

  const reload = useCallback(() => {
    const key = `${from}|${to}`;
    asked.current = key;
    apiCall('GET', `/api/v1/tasks/agenda?from=${from}&to=${to}`)
      .then((body) => {
        if (asked.current !== key) return; // a newer window was asked for meanwhile
        setAgenda(body);
        setError('');
      })
      .catch((err) => { if (asked.current === key) setError(err?.message || 'unreadable'); });
  }, [from, to]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!wsService) return undefined;
    let timer = null;
    const onTool = (frame) => {
      if (frame?.status !== 'ok') return;
      clearTimeout(timer);
      timer = setTimeout(reload, BURST_MS);
    };
    wsService.on('tool:usage', onTool);
    return () => {
      clearTimeout(timer);
      wsService.off('tool:usage', onTool);
    };
  }, [wsService, reload]);

  // (the poll always calls the newest `reload`, so a new window needs no restart)
  const ref = useVisibleInterval(reload, POLL_MS);
  return { agenda, error, reload, ref };
};
