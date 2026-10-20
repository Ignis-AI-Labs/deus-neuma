// HouseClockApp — THE HOUSE CLOCK WINDOW: the operator's control and vision
// over a house that wakes itself for its own work (Design note, 2026-10-16: […]). The charter and its approval, the PAUSE switch,
// who is awake and what waits, every wake on the ledger, what came back to
// the operator and their answers, and what the house earned.
//
// impure shell only: state and IO live in use-house-clock.js and
// use-money-in.js; every render decision in HouseClockBody.jsx and the pure
// view modules beside it.

import { useEffect, useState } from 'react';
import { AppTitle } from '../app-title.jsx';
import { uiSound } from '../../../services/ui-sound.js';
import { useWindows } from '../../windowing/use-windows.js';
import { encodeStreamTransfer, openSittingActions } from '../stream-tab-transfer.js';
import { useResidency } from './use-residency.js';
import { HouseClockBody, HouseClockIcon } from './HouseClockBody.jsx';
import { useHouseClock } from './use-house-clock.js';
import { useMoneyIn } from './use-money-in.js';
import { takeHouseClockTab, onHouseClockTab } from './house-clock-focus.js';

const TABS = Object.freeze(['charter', 'now', 'ledger', 'asks', 'money']);
// pure — a requested tab the window has, else null
const knownTab = (tab) => (TABS.includes(tab) ? tab : null);

const HouseClockAppBody = () => {
  // A tray card may ask for a tab (house-clock-focus.js): latched for a window it opens, announced to an open one.
  const [tab, setTab] = useState(() => knownTab(takeHouseClockTab()) ?? 'charter');
  useEffect(() => onHouseClockTab((t) => { if (knownTab(t)) setTab(t); }), []);
  const clock = useHouseClock();
  const residency = useResidency();
  const money = useMoneyIn(tab === 'money');
  const windows = useWindows();

  // A wake's sitting opens the way a torn-out tab does: its own stream
  // window, seated with that being, on that sitting — beside the desk
  // stream, opened first when closed (openSittingActions).
  const onOpenSitting = ({ seat, name, sessionId }) => {
    const payload = encodeStreamTransfer({ id: `wake-${sessionId}`, kind: 'local', neumaId: seat, name, sessionId, focus: null });
    if (!payload || !windows?.dispatch) return;
    uiSound('activate');
    for (const action of openSittingActions(payload, windows.state?.windows)) windows.dispatch(action);
  };

  // Every operator act carries the desk's activate sound; the hooks stay silent.
  const sounded = (fn) => (...args) => { uiSound('activate'); return fn(...args); };

  return (
    <div className="hclock-root" ref={clock.watch}>
      <HouseClockBody
        {...clock}
        {...money}
        tab={tab}
        onTab={(t) => { uiSound('open'); setTab(t); }}
        onOpenSitting={onOpenSitting}
        onSave={sounded(clock.onSave)}
        onApprove={sounded(async (version) => { if (await clock.onApprove(version)) await residency.afterApproval(); })}
        residency={residency}
        error={clock.error || residency.error}
        onResidency={sounded(residency.onToggle)}
        onPause={sounded(clock.onPause)}
        onCloseAsk={sounded(clock.onCloseAsk)}
        onAnswerAsk={sounded(clock.onAnswerAsk)}
        onScan={sounded(money.onScan)}
        onDeclare={sounded(money.onDeclare)}
        onRemove={sounded(money.onRemove)}
      />
    </div>
  );
};

export const houseClockApp = {
  label: 'HOUSE CLOCK',
  labelKey: 'apps.houseclock',
  icon: <HouseClockIcon />,
  title: <AppTitle label="HOUSE CLOCK" labelKey="apps.houseclock" />,
  Body: HouseClockAppBody,
  storageKey: 'houseclock',
};
