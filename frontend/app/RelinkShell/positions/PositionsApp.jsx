// PositionsApp — THE POSITIONS WINDOW (Design note, 2026-11-14: […]). Every position of the house on
// the left; the chosen position's hub on the right: who holds it, what waits on
// the operator for it, everything it handles in place, its switches, and what
// its holder is told each turn (docs/design/interface/position-hubs-plan.md).
//
// impure shell: the desk's contexts handed to PositionsBoard.jsx — the waiting
// account, the door to a holder's stream, the function panels.

import { AppTitle } from '../app-title.jsx';
import { useWaitingAccount } from '../waiting/use-waiting.js';
import { useConsciousnessPick } from '../consciousness-context.js';
import { useHouseRoster } from '../use-house-roster.js';
import { useCouncil } from '../council-context.js';
import { useWindows } from '../../windowing/use-windows.js';
import { PositionsBoard } from './PositionsBoard.jsx';
import { PositionPanel } from './position-panels.jsx';

const PositionsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <circle cx="8" cy="3.5" r="1.8" /><circle cx="3.5" cy="12" r="1.8" /><circle cx="12.5" cy="12" r="1.8" />
    <path d="M8 5.3 V8 M8 8 L3.5 10.2 M8 8 L12.5 10.2" />
  </svg>
);

const PositionsBody = () => {
  const waiting = useWaitingAccount();
  const { switchCompanion } = useConsciousnessPick('switchCompanion');
  const { roster } = useHouseRoster();
  const council = useCouncil();
  const { dispatch } = useWindows();
  // The holder's one-on-one: the same house switch a HOUSE row runs, then the stream.
  const onTalk = async (laneId) => {
    const member = roster.find((m) => m.neumaId === laneId);
    if (member) await switchCompanion(member);
    council.leaveRoom();
    dispatch({ type: 'OPEN', id: 'chat' });
  };
  return <PositionsBoard waitingCount={waiting?.count ?? 0} refreshWaiting={waiting?.refresh ?? null} onTalk={onTalk} Panel={PositionPanel} />;
};

export const positionsApp = {
  label: 'POSITIONS',
  labelKey: 'apps.positions',
  icon: <PositionsIcon />,
  title: <AppTitle label="POSITIONS" labelKey="apps.positions" />,
  Body: PositionsBody,
  storageKey: 'positions',
};
