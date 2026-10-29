// use-house-clock — the HOUSE CLOCK window's state and the operator's acts on
// it: the charter (edit, save, approve the version on screen, pause, resume),
// the queue, the ledger page, the asks and the Optio's packet, and the
// operator's answer to an ask. Reads poll only while the window
// can be seen (use-visible-interval.js). Every failure is surfaced, never
// swallowed: a window that could not act must never look like it did. A poll's
// failed read is its own line (pollError), cleared the moment the reads answer
// again; an act's refusal stays until the next act (error).
//
// impure — fetch, timers, React state.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getCharter, putCharter, approveCharter, pauseHouse, resumeHouse,
  getWakeQueue, getWakeLedger, getHouseAsks, closeHouseAsk, answerHouseAsk,
} from '../../../services/house-clock-client.js';
import { getRosterForBinding } from '../../../services/social-channels-client.js';
import { useVisibleInterval } from '../use-visible-interval.js';
import { draftFromCharter, charterFromDraft, settleReads } from './house-clock-view.js';
import { ASK_FILTER_START } from './asks-view.js';

const LEDGER_PAGE = 20;
const POLL_MS = 4000;
const READS = Object.freeze(['charter', 'queue', 'ledger', 'asks']);

export const useHouseClock = () => {
  // undefined until GET /charter answers: a charter never read is not "no charter".
  const [charter, setCharter] = useState(undefined);
  const [readiness, setReadiness] = useState(null);
  const [history, setHistory] = useState([]);
  const [queue, setQueue] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [asks, setAsks] = useState([]);
  const [packet, setPacket] = useState(null);
  // When the asks were last read: an open ask's age is counted to it.
  const [now, setNow] = useState(() => Date.now());
  const [askFilter, setAskFilter] = useState(ASK_FILTER_START);
  // What an answer did beyond the ask, said once: the seat could not be woken now, and why.
  const [notice, setNotice] = useState(null);
  const [lanes, setLanes] = useState([]);
  const [filter, setFilter] = useState({ seat: '', outcome: '' });
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [pollError, setPollError] = useState(null);

  // The seat pool: the operator's own neuma lanes (the server refuses any other seat).
  useEffect(() => {
    getRosterForBinding()
      .then((r) => setLanes(r.filter((p) => p.participantKind === 'neuma')))
      .catch((e) => setError(e.message));
  }, []);

  // Each read lands on its own: a part that failed keeps what it last read.
  const refresh = useCallback(async () => {
    const { read, error: failed } = settleReads(READS, await Promise.allSettled([
      getCharter(), getWakeQueue(), getWakeLedger({ offset: page * LEDGER_PAGE, limit: LEDGER_PAGE, ...filter }), getHouseAsks(),
    ]));
    if (read.charter) {
      setCharter(read.charter.charter ?? null);
      setReadiness(read.charter.readiness ?? null);
      setHistory(read.charter.history ?? []);
    }
    if (read.queue) setQueue(read.queue);
    if (read.ledger) setLedger(read.ledger);
    if (read.asks) {
      setAsks(read.asks.asks ?? []);
      setPacket(read.asks.packet ?? null);
      setNow(Date.now());
    }
    setPollError(failed);
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
    charter, readiness, history, queue, ledger, asks, packet, now, askFilter, notice, lanes, names, seats, filter, page, draft, busy, error, pollError, watch,
    pageSize: LEDGER_PAGE,
    // A draft only ever builds on a charter the window has read — never on an unread one.
    onEdit: () => { if (charter !== undefined) setDraft(draftFromCharter(charter, lanes)); },
    onCancel: () => setDraft(null),
    onDraft: (key, value) => setDraft((d) => ({ ...d, [key]: value })),
    onSeat: (laneId, field, value) => setDraft((d) => ({ ...d, seats: { ...d.seats, [laneId]: { ...d.seats[laneId], [field]: value } } })),
    onSave: async () => { if (await act(() => putCharter(charterFromDraft(draft)))) setDraft(null); },
    onApprove: (version) => act(() => approveCharter(version)),
    onPause: () => act(() => (charter?.paused ? resumeHouse() : pauseHouse())),
    onCloseAsk: (id) => act(() => closeHouseAsk(id)),
    onAnswerAsk: (id, answer) => act(async () => {
      const { woken } = await answerHouseAsk(id, answer);
      setNotice(woken?.queued ? null : `ANSWERED — THE SEAT COULD NOT BE WOKEN NOW: ${woken?.why ?? 'unknown'}`);
    }),
    onAskFilter: setAskFilter,
    onFilter: (f) => { setPage(0); setFilter(f); },
    onPage: setPage,
  };
};
