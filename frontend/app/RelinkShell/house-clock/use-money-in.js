// use-money-in — the MONEY IN panel's state: totals for this week, this month
// and all time, the latest receipts, the watch set; and the operator's three
// acts — scan now, declare an extra receive address, remove one. Loaded only
// while the panel is open (load on demand). Receive-only: nothing here sends.
//
// impure — fetch, React state.

import { useCallback, useEffect, useState } from 'react';
import {
  getMoneyInTotals, getMoneyInLedger, getMoneyInWatch, scanMoneyIn, declareReceiveAddress, removeReceiveAddress,
} from '../../../services/money-in-client.js';
import { periodStarts } from './money-in-view.js';

const RECEIPTS_SHOWN = 10;
const EMPTY_ADDR = Object.freeze({ address: '', label: '', member: '' });

/** @param {boolean} open - the panel is showing */
export const useMoneyIn = (open) => {
  const [money, setMoney] = useState(null);
  const [addr, setAddr] = useState(EMPTY_ADDR);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (note = null) => {
    try {
      const starts = periodStarts(Date.now());
      const [week, month, all, ledger, watch] = await Promise.all([
        getMoneyInTotals({ from: starts.week }), getMoneyInTotals({ from: starts.month }), getMoneyInTotals(),
        getMoneyInLedger({ limit: RECEIPTS_SHOWN }), getMoneyInWatch(),
      ]);
      setMoney({
        totals: { week: week.summary, month: month.summary, all: all.summary },
        receipts: ledger.receipts ?? [],
        watch,
        note,
      });
    } catch (e) {
      setMoney((m) => ({ ...(m ?? {}), note: e.message }));
    }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  // One act, then the panel re-read with what the act said.
  const act = async (fn, said) => {
    setBusy(true);
    try {
      const result = await fn();
      await load(said(result));
      return true;
    } catch (e) {
      setMoney((m) => ({ ...(m ?? {}), note: e.message }));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    money, addr, moneyBusy: busy,
    onAddr: (field, value) => setAddr((a) => ({ ...a, [field]: value })),
    onScan: () => act(scanMoneyIn, (r) => `SCANNED — ${r.appended} NEW RECEIPT${r.appended === 1 ? '' : 'S'}`),
    onDeclare: async () => {
      const ok = await act(() => declareReceiveAddress(addr.address.trim(), { label: addr.label.trim(), member: addr.member || null }),
        () => 'ADDRESS DECLARED — IT IS WATCHED FROM THE NEXT SCAN');
      if (ok) setAddr(EMPTY_ADDR);
    },
    onRemove: (address) => act(() => removeReceiveAddress(address), () => 'ADDRESS REMOVED — ITS RECEIPTS STAY ON THE LEDGER'),
  };
};
