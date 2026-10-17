// use-house-clock — the HOUSE CLOCK window's state and the operator's acts on
// it: the charter (edit, save, approve the version on screen, pause, resume),
// the queue, the ledger page and the asks. Reads poll only while the window
// can be seen (use-visible-interval.js). Every failure is surfaced, never
// swallowed: a window that could not act must never look like it did.
//
// impure — fetch, timers, React state.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getCharter, putCharter, approveCharter, pauseHouse, resumeHouse,
  getWakeQueue, getWakeLedger, getHouseAsks, closeHouseAsk,
} from '../../../services/house-clock-client.js';
import { getRosterForBinding } from '../../../services/social-channels-client.js';
import { useVisibleInterval } from '../use-visible-interval.js';
import { draftFromCharter, charterFromDraft } from './house-clock-view.js';

const LEDGER_PAGE = 20;
const POLL_MS = 4000;

export const useHouseClock = () => {
  const [charter, setCharter] = useState(null);
  const [history, setHistory] = useState([]);
  const [queue, setQueue] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [asks, setAsks] = useState([]);
  const [lanes, setLanes] = useState([]);
  const [filter, setFilter] = useState({ seat: '', outcome: '' });
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // The seat pool: the operator's own neuma lanes (the server refuses any other seat).
  useEffect(() => {
    getRosterForBinding()
      .then((r) => setLanes(r.filter((p) => p.participantKind === 'neuma')))
      .catch((e) => setError(e.message));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [c, q, l, a] = await Promise.all([
        getCharter(), getWakeQueue(), getWakeLedger({ offset: page * LEDGER_PAGE, limit: LEDGER_PAGE, ...filter }), getHouseAsks(),
      ]);
      setCharter(c.charter);
      setHistory(c.history ?? []);
      setQueue(q);
      setLedger(l);
      setAsks(a.asks ?? []);
    } catch (e) {
      setError(e.message);
    }
  }, [page, filter]);

  const watch = useVisibleInterval(refresh, POLL_MS, { key: `${page}|${filter.seat}|${filter.outcome}` });

  // One act: busy while it runs, the window re-read after, its refusal shown.
  const act = async (fn) => {
    setBusy(true);
    try {
      await fn();
      setError(null);
      await refresh();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const names = useMemo(() => Object.fromEntries(lanes.map((l) => [l.neumaId, l.name || l.neumaId])), [lanes]);
  const seats = useMemo(() => [...new Set([...(charter?.seats ?? []).map((s) => s.laneId), ...lanes.map((l) => l.neumaId)])], [charter, lanes]);

  return {
    charter, history, queue, ledger, asks, lanes, names, seats, filter, page, draft, busy, error, watch,
    pageSize: LEDGER_PAGE,
    onEdit: () => setDraft(draftFromCharter(charter, lanes)),
    onCancel: () => setDraft(null),
    onDraft: (key, value) => setDraft((d) => ({ ...d, [key]: value })),
    onSeat: (laneId, field, value) => setDraft((d) => ({ ...d, seats: { ...d.seats, [laneId]: { ...d.seats[laneId], [field]: value } } })),
    onSave: async () => { if (await act(() => putCharter(charterFromDraft(draft)))) setDraft(null); },
    onApprove: (version) => act(() => approveCharter(version)),
    onPause: () => act(() => (charter?.paused ? resumeHouse() : pauseHouse())),
    onCloseAsk: (id) => act(() => closeHouseAsk(id)),
    onFilter: (f) => { setPage(0); setFilter(f); },
    onPage: setPage,
  };
};
