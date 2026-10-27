// KeyLockBlock — Settings › Security › MASTER KEY: what holds the key that opens
// every being this launch, and the Recovery Kit (electron/key-lock/). The kit is
// read from the app's own main process on request and never kept in the page
// longer than it is shown.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { InlineActionConfirm } from './InlineActionConfirm.jsx';

// impure — the app's key-lock doors (preload), absent in a plain browser
const doors = () => (typeof window !== 'undefined' ? window.neuma?.keyLock : undefined) || null;

/**
 * @param {{ keyLock: ?{source: string, backend: ?string, kitPending: boolean}, onChanged: () => void }} props
 */
export const KeyLockBlock = ({ keyLock, onChanged }) => {
  const { t } = useTranslation('settingsSecurity');
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmNew, setConfirmNew] = useState(false);
  if (!keyLock) return null;
  const locked = keyLock.source === 'keychain';
  const lockDoors = doors();

  const run = async (fn, after) => {
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);
    if (!result?.ok) { setError(result?.error || t('keyLock.failed')); return; }
    after(result);
  };
  const show = () => { uiSound('open'); run(lockDoors.revealKit, (r) => setCode(r.code)); };
  const saved = () => { uiSound('toggle'); run(lockDoors.confirmKit, () => { setCode(null); onChanged(); }); };
  const replace = () => run(lockDoors.newKit, (r) => { setConfirmNew(false); setCode(r.code); onChanged(); });

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('keyLock.heading')}</div>
      <div className="settings-realm">
        <div className="settings-row">
          <span className="settings-k">{t('keyLock.heldBy')}</span>
          <span className="settings-v">{locked ? t('keyLock.keychain', { backend: keyLock.backend }) : t('keyLock.plain')}</span>
        </div>
        {locked ? (
          <div className="settings-row">
            <span className="settings-k">{t('keyLock.kit')}</span>
            <span className="settings-v">{keyLock.kitPending ? `«${t('keyLock.kitPending')}»` : t('keyLock.kitSaved')}</span>
          </div>
        ) : null}
      </div>
      {!locked ? <p className="settings-warn">{t('keyLock.plainNote')}</p> : null}
      {locked && !lockDoors ? <p className="settings-note">{t('keyLock.appOnly')}</p> : null}
      {locked && lockDoors && code ? (
        <>
          <p className="settings-note">{t('keyLock.kitNote')}</p>
          <code className="settings-v settings-kit-code">{code}</code>
          <div className="settings-key-actions">
            <button type="button" className="settings-set" disabled={busy} onClick={saved}>{busy ? t('keyLock.busy') : t('keyLock.saved')}</button>
          </div>
        </>
      ) : null}
      {locked && lockDoors && !code ? (
        <div className="settings-key-actions">
          {keyLock.kitPending ? (
            <button type="button" className="settings-set" disabled={busy} onClick={show}>{busy ? t('keyLock.busy') : t('keyLock.show')}</button>
          ) : confirmNew ? (
            <InlineActionConfirm label={t('keyLock.newKit')} confirmLabel={t('keyLock.newKit')} busy={busy}
              onConfirm={replace} onCancel={() => { uiSound('close'); setConfirmNew(false); }}>
              {t('keyLock.newKitConfirm')}
            </InlineActionConfirm>
          ) : (
            <button type="button" className="settings-set" disabled={busy} onClick={() => { uiSound('open'); setConfirmNew(true); }}>{t('keyLock.newKit')}</button>
          )}
        </div>
      ) : null}
      {error ? <p className="settings-err">{error}</p> : null}
    </section>
  );
};
