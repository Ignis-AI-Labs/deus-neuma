// OsNoticeToggle — DESKTOP ALERTS, the operator's one switch for notices that
// leave the app for the operating system (os-notice.js; default ON). It sits
// at the foot of the opened tray, and only where such a road exists — the
// desktop app's bridge, or a browser whose permission the operator already
// granted — so it never offers a switch that does nothing.
//
// The shape carries the state (a filled box is on); the words only confirm.

import { useEffect, useState } from 'react';
import { OS_NOTICE_EVENT, isOsNoticeOn, osNoticeAvailable, setOsNoticeOn } from '../../../services/os-notice.js';
import { uiSound } from '../../../services/ui-sound.js';

export const OsNoticeToggle = () => {
  const [available] = useState(osNoticeAvailable);
  const [on, setOn] = useState(isOsNoticeOn);
  useEffect(() => {
    const refresh = () => setOn(isOsNoticeOn());
    window.addEventListener(OS_NOTICE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(OS_NOTICE_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  if (!available) return null;
  return (
    <div className="ntray-panel-foot">
      <button
        type="button"
        className="ntray-os-toggle"
        aria-pressed={on}
        title="A desktop notification when something arrives while the desk is out of sight"
        onClick={() => { uiSound('toggle'); setOsNoticeOn(!on); }}
      >
        <span className="ntray-os-box" aria-hidden="true" />
        DESKTOP ALERTS {on ? 'ON' : 'OFF'}
      </button>
    </div>
  );
};
