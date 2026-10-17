// SessionClock — the HUD's session age, ticking in its OWN component.
//
// It ticks every second. Held in the desk host, that tick re-rendered the whole
// desk — every window, every body — once a second at rest (2026-09-28
// smoothness pass). Here it re-renders one <span>.

import { useTranslation } from 'react-i18next';
import { useSessionClock } from './use-session-clock.js';
import { formatSessionClock } from './desk-pulse.js';

export const SessionClock = ({ linkCls }) => {
  const { t } = useTranslation('desk');
  const seconds = useSessionClock(linkCls);
  return <span className="relink-status-session">{t('hud.session', { clock: formatSessionClock(seconds) })}</span>;
};
