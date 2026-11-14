// use-lead-engine.js — the LEAD ENGINE section's state: the engine as the
// server holds it, and the operator's presses (move a segment, approve its
// list, approve or return the facts sheet, add to the do-not-contact list), each followed by a fresh read. Every failure
// is surfaced, never swallowed.
// impure — talks to the backend through revenue-client.js.

import { useCallback, useEffect, useState } from 'react';
import { uiSound } from '../../../services/ui-sound.js';
import { getLeadEngine, setSegmentState, suppressContact, approveSegmentList, reviewSalesFacts } from '../../../services/revenue-client.js';

export const useLeadEngine = () => {
  const [engine, setEngine] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setEngine(await getLeadEngine());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const press = async (fn, said) => {
    uiSound('activate');
    setBusy(true);
    try {
      await fn();
      setNotice(said);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return {
    engine, busy, error, notice,
    refresh: () => { uiSound('activate'); load(); },
    moveSegment: (segment, state) => press(() => setSegmentState(segment.id, state), `"${segment.name}" is ${state}.`),
    approveList: (segment, count) => press(() => approveSegmentList(segment.id), `${count} compan${count === 1 ? 'y' : 'ies'} on "${segment.name}" approved for outreach.`),
    reviewFacts: (sheet, verdict, note) => press(() => reviewSalesFacts(sheet.id, verdict, note), verdict === 'approved' ? 'The facts sheet is approved: emails to leads may now go, checked against it.' : 'The facts sheet went back to the Mercator.'),
    suppress: (target, reason) => press(() => suppressContact(target.trim(), reason), `${target.trim()} is on the do-not-contact list.`),
  };
};
