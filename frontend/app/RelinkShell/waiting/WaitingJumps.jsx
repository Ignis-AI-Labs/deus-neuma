// WaitingJumps — the window manager's hand for WAITING ON YOU: a row pressed
// in the notification tray or a platform band's OPEN is announced
// once (waiting-jump.js), and this carries it out — the card's window raised
// or opened, the card brought into view. Renders nothing.

import { useEffect, useRef } from 'react';
import { useWindows } from '../../windowing/use-windows.js';
import { jumpTo, onWaitingJump } from './waiting-jump.js';

export const WaitingJumps = () => {
  const { state, dispatch } = useWindows();
  const windows = useRef(state.windows);
  windows.current = state.windows;
  useEffect(() => onWaitingJump((item) => {
    if (item) jumpTo(item, { windows: windows.current, dispatch });
  }), [dispatch]);
  return null;
};
