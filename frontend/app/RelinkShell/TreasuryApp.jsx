// TreasuryApp — THE TREASURY WINDOW: the Quaestor's office as a desk surface,
// where the house's finances are overseen and checked as managed correctly.
// It stands in the WATCH band beside SECURITY and LEGAL.
//
// The operator's acts here: decide each pending spend on its SPEND card (your
// signature and the being's key password — or a denial with a note), read a
// Quaestor's flag, seat or unseat the Quaestor. Nothing on this window moves
// money any other way; the office itself never can.
//
// impure shell only: every render decision lives in TreasuryBody.jsx,
// treasury-view.js and spend/ (all pure, node-renderable).

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppTitle } from './app-title.jsx';
import { uiSound } from '../../services/ui-sound.js';
import { getTreasuryBoard, seatCfo, clearCfo, markFlagSeen } from '../../services/treasury-client.js';
import { getRosterForBinding } from '../../services/social-channels-client.js';
import { useWaitingAccount } from './waiting/use-waiting.js';
import { TreasuryBody, TreasuryIcon } from './TreasuryBody.jsx';

const TICK_MS = 30000;

const TreasuryAppBody = () => {
  const [board, setBoard] = useState(null);
  const [readAtMs, setReadAtMs] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lanes, setLanes] = useState([]);
  const [pick, setPick] = useState('');
  const [seatBusy, setSeatBusy] = useState(false);
  const waiting = useWaitingAccount();
  const root = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getTreasuryBoard();
      setBoard(next); setReadAtMs(Date.now()); setNow(Date.now()); setError(null);
    } catch (e) {
      setError(e.message); // surfaced, never swallowed
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    getRosterForBinding().then((r) => setLanes(r.filter((p) => p.participantKind === 'neuma'))).catch((e) => setError(e.message));
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [load]);

  // A decision changes what waits: the board and the desk's account read again.
  const settled = async () => { await Promise.all([load(), waiting?.refresh?.()]).catch(() => {}); };

  const seatAct = async (fn) => {
    uiSound('activate');
    setSeatBusy(true);
    try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setSeatBusy(false); }
  };

  return (
    <div ref={root} className="tre-root">
      <TreasuryBody
        board={board} error={error} loading={loading} now={now} readAtMs={readAtMs}
        lanes={lanes} pick={pick} seatBusy={seatBusy}
        onRefresh={() => { uiSound('activate'); load(); }}
        onDecided={settled}
        onFlagSeen={async (flag) => {
          uiSound('activate');
          try { await markFlagSeen(flag.id); await settled(); } catch (e) { setError(e.message); }
        }}
        onJump={(section) => {
          uiSound('open');
          root.current?.querySelector(`[data-treasury-section="${section}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }}
        onPick={(v) => { uiSound('open'); setPick(v); }}
        onSeat={() => seatAct(async () => { await seatCfo(pick); setPick(''); })}
        onClear={() => seatAct(clearCfo)}
      />
    </div>
  );
};

export const treasuryApp = {
  label: 'TREASURY',
  labelKey: 'apps.treasury',
  icon: <TreasuryIcon />,
  title: <AppTitle label="TREASURY" labelKey="apps.treasury" />,
  Body: TreasuryAppBody,
  storageKey: 'treasury',
};
