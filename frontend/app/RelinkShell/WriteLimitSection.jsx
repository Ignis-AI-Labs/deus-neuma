// WriteLimitSection — the operator's WRITE LIMIT inside SETTINGS → SECURITY (backend/services/write-limit.js). Founder,
// 2026-11-19: […] On by default; on, it holds a number a message and asks past it.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { getWriteLimit, setWriteLimit } from '../../services/write-limit-client.js';

export const WriteLimitSection = () => {
  const { t } = useTranslation('settingsSecurity');
  const [rule, setRule] = useState(null); // {on, cap, default, max}
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getWriteLimit().then((r) => { setRule(r); setCap(String(r.cap)); }).catch((e) => setError(e.message));
  }, []);

  const change = async (next) => {
    if (busy) return;
    uiSound('toggle');
    setBusy(true);
    setError(null);
    try {
      const r = await setWriteLimit(next);
      setRule(r);
      setCap(String(r.cap));
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };
  const typed = Number(cap);
  const capReady = rule && Number.isInteger(typed) && typed >= 1 && typed <= rule.max && typed !== rule.cap;

  return (
    <section className="settings-sec" data-write-limit={rule ? (rule.on ? 'on' : 'off') : ''}>
      <div className="label-data settings-h">{t('writeLimit.heading')}</div>
      <p className="settings-note">{t('writeLimit.note')}</p>
      {error ? <p className="settings-err">{error}</p> : null}
      {rule ? (
        <div className="settings-realm">
          <div className="settings-row">
            <span className="settings-k">{t('writeLimit.key')}</span>
            <span className="settings-v">{rule.on ? t('writeLimit.on', { cap: rule.cap }) : t('writeLimit.off')}</span>
          </div>
        </div>
      ) : !error && <p className="settings-note">{t('writeLimit.reading')}</p>}
      <div className="settings-control">
        <button type="button" className="settings-set" onClick={() => change({ on: !rule.on })} disabled={!rule || busy}>
          {busy ? t('writeLimit.switching') : rule?.on ? t('writeLimit.turnOff') : t('writeLimit.turnOn')}
        </button>
      </div>
      {rule?.on ? (
        <div className="settings-control">
          <input className="settings-input" type="number" min={1} max={rule.max} step={1} value={cap}
            onChange={(e) => setCap(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && capReady) change({ cap: typed }); }}
            aria-label={t('writeLimit.capAria', { max: rule.max })} />
          <button type="button" className="settings-set" onClick={() => change({ cap: typed })} disabled={!capReady || busy}>{t('writeLimit.setCap')}</button>
        </div>
      ) : <p className="settings-warn">{t('writeLimit.offNote')}</p>}
    </section>
  );
};
