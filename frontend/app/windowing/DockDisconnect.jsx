import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineActionConfirm } from '../RelinkShell/InlineActionConfirm.jsx';
import { playSound } from '../../services/sound-engine.js';
import './DockDisconnect.css';

const DisconnectGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M5.5 1.75 H2.25 V12.25 H5.5" />
    <path d="M8 7 H13 M10.75 4.5 L13.25 7 L10.75 9.5" />
  </svg>
);

/** The confirmation belongs to this menu opening; closing the menu discards it. */
export const DockDisconnect = ({ onDisconnect }) => {
  const [confirming, setConfirming] = useState(false);
  const { t } = useTranslation('desk');
  if (confirming) return (
    <div className="dock-disconnect-confirm" role="none">
      <InlineActionConfirm label={t('disconnect.confirmAria')} confirmLabel={t('disconnect.confirmLabel')} buttonRole="menuitem"
        onConfirm={onDisconnect} onCancel={() => { playSound('menuClose'); setConfirming(false); }}>
        {t('disconnect.body')}
      </InlineActionConfirm>
    </div>
  );
  return (
    <button type="button" className="dock-menu-item dock-menu-danger" role="menuitem"
      onClick={() => { playSound('menuOpen'); setConfirming(true); }}>
      <span className="dock-menu-icon"><DisconnectGlyph /></span>
      <span className="dock-menu-label label-data">{t('disconnect.wallet')}</span>
    </button>
  );
};
