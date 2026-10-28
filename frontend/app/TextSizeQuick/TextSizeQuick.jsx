// TextSizeQuick — the reading size, one corner away before the desk exists.
//
// Design note, 2026-10-28: […]. The LOOK tab's
// TEXT SIZE slider (RelinkShell/TextSizeControl.jsx) lives in Settings, which
// a new person cannot reach until a being is born. This is the SAME setting
// (services/text-size.js — one key, one scale), on every screen the desk is
// not: the gateway, the first-run choice, the rite, the full-screen rites.

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { getTextSize, setTextSize, subscribeTextSize } from '../../services/text-size.js';
import { uiSound } from '../../services/ui-sound.js';
import './TextSizeQuick.css';

const MIN = 100;
const MAX = 200;
const STEP = 10;

export const TextSizeQuick = () => {
  const { t } = useTranslation('common');
  const panelId = useId();
  const size = useSyncExternalStore(subscribeTextSize, getTextSize);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const root = useRef(null);

  // A press anywhere else, or Escape, puts it away — it never holds a screen.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!root.current?.contains(e.target)) setOpen(false); };
    const escape = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);

  const change = (next) => {
    try {
      setTextSize(Math.min(MAX, Math.max(MIN, next)));
      setError(null);
      uiSound('tick');
    } catch (cause) {
      setError(cause.message);
    }
  };

  const toggle = () => {
    uiSound(open ? 'close' : 'open');
    setOpen(!open);
  };

  return (
    <div className="tsq" ref={root}>
      {open ? (
        <div className="tsq-panel" id={panelId} role="group" aria-label={t('textSize.title')}>
          <span className="tsq-title label-data">{t('textSize.title')}</span>
          <div className="tsq-row">
            <button type="button" className="tsq-step" aria-label={t('textSize.smaller')}
              disabled={size <= MIN} onClick={() => change(size - STEP)}>A−</button>
            <output className="tsq-value label-data" aria-live="polite">{size}%</output>
            <button type="button" className="tsq-step" aria-label={t('textSize.larger')}
              disabled={size >= MAX} onClick={() => change(size + STEP)}>A+</button>
          </div>
          <button type="button" className="tsq-reset" disabled={size === MIN} onClick={() => change(MIN)}>
            {t('textSize.reset')}
          </button>
          {error ? <p className="tsq-err" role="alert">{error}</p> : null}
        </div>
      ) : null}
      <button type="button" className="tsq-open" aria-expanded={open} aria-controls={open ? panelId : undefined}
        aria-label={t('textSize.open')} title={t('textSize.open')} onClick={toggle}>Aa</button>
    </div>
  );
};
