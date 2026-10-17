// RealmSection — the DATA REALM + CHANGE LOCATION pair, extracted whole from
// SettingsApp when Settings gained tabs: the two sections share one realm
// read and one path draft, so they live together. The witness's own copy of
// every conversation — where it is, what it holds, and the control to move it.

import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { getRealm, setRealmLocation } from '../../services/user-realm.js';
import { uiSound } from '../../services/ui-sound.js';
import { InlineActionConfirm } from './InlineActionConfirm.jsx';
import { EmptyState } from './empty-state.jsx';
import { formatBytes } from '../../utils/format.js';

export const RealmSection = () => {
  const { t } = useTranslation(['settings', 'common']);
  const [realm, setRealm] = useState(null);
  const [pathInput, setPathInput] = useState('');
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingPath, setPendingPath] = useState(null);

  const load = () =>
    getRealm()
      .then((r) => { setRealm(r); setPathInput(r.root); setLoadError(null); })
      .catch((e) => setLoadError(e.message));

  useEffect(() => { load(); }, []);

  const save = async () => {
    const next = pendingPath;
    if (!next) return;
    uiSound('activate');
    setBusy(true);
    setError(null);
    try {
      const r = await setRealmLocation(next);
      setRealm(r);
      setPathInput(r.root);
      setPendingPath(null);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  return (
    <>
      <section className="settings-sec">
        <div className="label-data settings-h">{t('settings:realm.heading')}</div>
        <p className="settings-note">{t('settings:realm.note')}</p>

        {loadError ? <p className="settings-err">{loadError}</p> : null}

        {realm ? (
          <div className="settings-realm">
            <div className="settings-row">
              <span className="settings-k">{t('settings:realm.location')}</span>
              <code className="settings-v">{realm.root}</code>
            </div>
            <div className="settings-row">
              <span className="settings-k">{t('settings:realm.yourFolder')}</span>
              <code className="settings-v">{realm.stats.walletDir}</code>
            </div>
            <div className="settings-row">
              <span className="settings-k">{t('settings:realm.chatLogs')}</span>
              <span className="settings-v">
                {realm.stats.chatCount} · {formatBytes(realm.stats.totalBytes)}
              </span>
            </div>

            {realm.stats.files?.length ? (
              <ul className="settings-files">
                {realm.stats.files.map((f) => (
                  <li key={f.neumaId}>
                    <code>{f.neumaId}.jsonl</code>
                    <span>{formatBytes(f.bytes)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title={t('settings:realm.empty')} />
            )}
          </div>
        ) : (
          !loadError && <EmptyState title={t('settings:realm.loading')} />
        )}
      </section>

      <section className="settings-sec">
        <div className="label-data settings-h">{t('settings:realm.change.heading')}</div>
        <p className="settings-note">{t('settings:realm.change.note')}</p>
        <div className="settings-control">
          <input
            className="settings-input"
            type="text"
            aria-label={t('settings:realm.change.pathAria')}
            disabled={busy || pendingPath !== null}
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="/home/you/.neuma/realm"
            spellCheck={false}
            autoComplete="off"
          />
          {pendingPath !== null ? (
            <InlineActionConfirm label={t('settings:realm.change.confirmAria')} confirmLabel={t('settings:realm.change.confirmAction')}
              busy={busy} onConfirm={save} onCancel={() => { uiSound('close'); setPendingPath(null); }}>
              <Trans
                i18nKey="settings:realm.change.confirmBody"
                values={{ path: pendingPath }}
                components={{ code: <code /> }}
              />
            </InlineActionConfirm>
          ) : (
            <button type="button" className="settings-set" disabled={busy || !realm || !pathInput.trim() || pathInput.trim() === realm.root}
              onClick={() => { uiSound('open'); setError(null); setPendingPath(pathInput.trim()); }}>
              {t('common:set')}
            </button>
          )}
        </div>
        {error ? <p className="settings-err">{error}</p> : null}
      </section>
    </>
  );
};
