// use-link-changes — the link changes the house's CMO proposed for ONE
// company, as the server holds them. A new proposal is heard through the
// WAITING ON YOU account (its rows name it), and lands through the calm gate:
// never under the operator's pointer. The operator's own decision lands at once.
//
// impure — network.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getLinkChanges } from '../../../services/company-sources-client.js';
import { useWaitingAccount } from '../waiting/use-waiting.js';
import { useCalmGate } from '../use-calm-gate.js';

const READER = 'link-changes';

/**
 * impure — {changes, error, settle, handlers}: `settle()` re-reads now (after
 * the operator decided) and tells WAITING ON YOU; spread `handlers` on the
 * section's root so a background arrival waits while the operator is there.
 * @param {string} companyId
 */
export const useLinkChanges = (companyId) => {
  const waiting = useWaitingAccount();
  const gate = useCalmGate();
  const [changes, setChanges] = useState([]);
  const [error, setError] = useState(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const read = useCallback(async () => (await getLinkChanges()).changes.filter((c) => c.companyId === companyId), [companyId]);
  // The proposals WAITING ON YOU names for this company — a change in them is news worth a read.
  const stamp = (waiting?.account?.items || [])
    .filter((i) => i.kind === 'link-change' && i.where?.companyId === companyId).map((i) => i.id).join(',');

  // The first read is the section opening — the operator asked for it; every later one is background.
  const shown = useRef(false);
  useEffect(() => {
    read().then((list) => {
      if (!live.current) return;
      setError(null);
      (shown.current ? gate.offer : gate.now)(READER, () => setChanges(list));
      shown.current = true;
    })
      .catch((e) => { if (live.current) setError(e.message); });
  }, [read, stamp, gate]);

  const settle = useCallback(async () => {
    const list = await read();
    if (live.current) gate.now(READER, () => setChanges(list));
    await waiting?.refresh?.();
  }, [read, gate, waiting]);

  return { changes, error, settle, handlers: gate.handlers };
};
