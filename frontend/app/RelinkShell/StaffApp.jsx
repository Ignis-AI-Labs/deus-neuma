// StaffApp — THE CHIEF OF STAFF WINDOW: the Optio office as a first-class
// desk surface, beside the CSO's SECURITY office. One seat, one holder —
// the operator's standing delegate for managing the house's other beings.
//
// Read-mostly by design: the office's truth (seat, roster, dispatches,
// plan, runs) is server truth, re-read while the window can be seen (a run
// that ended reads FINISHED, a charge its holder moved reads moved, with no
// reopen); the only acts here are the operator's own — SEAT and UNSEAT. A
// failed read is its own line, cleared when the reads answer again; an act's
// refusal stays until the next act.
//
// impure shell only: every render decision lives in StaffBody.jsx +
// staff-view.js (both pure, both node-renderable).

import { useEffect, useState } from 'react';
import './StaffApp.css';
import { AppTitle } from './app-title.jsx';
import { useVisibleInterval } from './use-visible-interval.js';
import { uiSound } from '../../services/ui-sound.js';
import {
  getCosSeat, seatCos, clearCosSeat, getCosBoard, endStandingPlan,
} from '../../services/staff-client.js';
import { getRosterForBinding } from '../../services/social-channels-client.js';
import { StaffBody, StaffIcon } from './StaffBody.jsx';

const POLL_MS = 4000;

const StaffAppBody = () => {
  const [seat, setSeat] = useState(null);
  const [board, setBoard] = useState(null);
  const [lanes, setLanes] = useState([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [readError, setReadError] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmEndPlan, setConfirmEndPlan] = useState(false);

  const loadBoard = () => Promise.all([getCosSeat(), getCosBoard()])
    .then(([s, b]) => {
      setSeat(s.cos); setBoard(b); setReadError(null);
    })
    .catch((e) => setReadError(e.message)); // surfaced, never swallowed

  // The holder picker's pool: the operator's own roster. Only neuma lanes —
  // the seat is a house office, and the server refuses anything else.
  const loadLanes = () => getRosterForBinding()
    .then((r) => setLanes(r.filter((p) => p.participantKind === 'neuma')))
    .catch((e) => setError(e.message)); // surfaced, never swallowed

  useEffect(() => { loadLanes(); }, []);
  useVisibleInterval(loadBoard, POLL_MS);

  const onSeat = async () => {
    uiSound('activate');
    setBusy(true);
    try {
      await seatCos(pick);
      setPick('');
      setError(null);
      await loadBoard();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    uiSound('activate');
    setConfirmClear(false);
    setBusy(true);
    try {
      await clearCosSeat();
      setError(null);
      await loadBoard();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onEndPlan = async () => {
    uiSound('activate');
    setConfirmEndPlan(false);
    setBusy(true);
    try {
      await endStandingPlan();
      setError(null);
      await loadBoard();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StaffBody
      seat={seat}
      board={board}
      lanes={lanes}
      pick={pick}
      busy={busy}
      error={[readError, error].filter(Boolean).join(' · ') || null}
      confirmClear={confirmClear}
      onPick={(v) => { uiSound('open'); setPick(v); }}
      onSeat={onSeat}
      onAskClear={() => { uiSound('open'); setConfirmClear(true); }}
      onClear={onClear}
      onCancelClear={() => { uiSound('close'); setConfirmClear(false); }}
      confirmEndPlan={confirmEndPlan}
      onAskEndPlan={() => { uiSound('open'); setConfirmEndPlan(true); }}
      onEndPlan={onEndPlan}
      onCancelEndPlan={() => { uiSound('close'); setConfirmEndPlan(false); }}
    />
  );
};

export const staffApp = {
  label: 'CHIEF OF STAFF',
  labelKey: 'apps.staff',
  icon: <StaffIcon />,
  title: <AppTitle label="CHIEF OF STAFF" labelKey="apps.staff" />,
  Body: StaffAppBody,
  storageKey: 'staff',
};
