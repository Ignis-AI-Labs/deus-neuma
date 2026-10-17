// SecuritySection — the witness's data-security panel inside Settings.
//
// This phase surfaces the truth and the safe actions: per-being encryption
// status (does each being hold its OWN key, or share the global one), the
// active-vs-persisted workspace roots (so nobody ever aims a migration or
// backup at the wrong place), storage headroom, per-being key/recovery status,
// and on-demand backups. The two destructive actions — running the DEK
// migration and rotating a key — deliberately stay out of the UI until they're
// made safe to run against a live being; the panel says so plainly rather than
// offering a button that could corrupt.

import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { formatBytes, formatDateTime } from '../../utils/format.js';
import {
  getSecurityStatus, getEncryptionPlan, getRecoveryStatus,
  createBackup, listBackups, deleteBackup,
  getBackupDestination, setBackupDestination,
} from '../../services/security.js';
import { EmptyState } from './empty-state.jsx';
import { InlineActionConfirm } from './InlineActionConfirm.jsx';
import { GuardianSection } from './GuardianSection.jsx';
import { useConsciousnessPick } from './consciousness-context.js';
import { isHarness } from '../harness-mode.js';
import { currentLocale } from '../../i18n/active-locale.js';

// English plural suffix for the {{plural}} slot; the no-plural languages
// (zh/ja/ko) hold the slot for catalog parity and always receive ''.
const pluralSuffix = (n) => (n === 1 || currentLocale() !== 'en' ? '' : 's');

export const SecuritySection = () => {
  const { t } = useTranslation('settingsSecurity');
  // a harness desk is shown the machine, never the house (Design note, 2026-10-14
  const harness = isHarness(useConsciousnessPick('activeCompanion')?.activeCompanion);
  const [status, setStatus] = useState(null);
  const [recovery, setRecovery] = useState({}); // neumaId -> recovery status
  const [loadError, setLoadError] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState(null);
  const [backups, setBackups] = useState([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState(null);
  const [deletingBackup, setDeletingBackup] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // backup id awaiting confirm
  // WHERE backups land, and what that protects against. Held as server truth —
  // the same-drive answer is measured there, never guessed from the path here.
  const [destination, setDestination] = useState(null);
  const [destBusy, setDestBusy] = useState(false);
  const [destError, setDestError] = useState(null);
  // The native folder picker is the desktop app's; a browser tab has none, so
  // the control is absent rather than present-and-broken.
  const canPickFolder = typeof window !== 'undefined' && Boolean(window.neuma?.chooseDirectory);

  const loadStatus = () =>
    getSecurityStatus()
      .then(async (s) => {
        setStatus(s);
        setLoadError(null);
        // Per-being key/recovery status is best-effort — one being failing must
        // not blank the whole panel. The failure is logged (not silent) so a
        // being showing no key/recovery tags is explainable.
        const entries = await Promise.all(
          s.beings.map((b) =>
            getRecoveryStatus(b.neumaId)
              .then((r) => [b.neumaId, r])
              .catch((err) => {
                console.warn(`recovery status unavailable for ${b.neumaId}: ${err.message}`);
                return [b.neumaId, null];
              })),
        );
        setRecovery(Object.fromEntries(entries));
      })
      .catch((e) => setLoadError(e.message));

  const loadBackups = () =>
    listBackups()
      .then((r) => { setBackups(r.backups); setBackupError(null); })
      .catch((e) => setBackupError(e.message)); // surfaced, not swallowed

  useEffect(() => { loadStatus(); }, []);
  const loadDestination = () =>
    getBackupDestination()
      .then((r) => { setDestination(r.destination); setDestError(null); })
      .catch((e) => setDestError(e.message)); // surfaced, not swallowed

  useEffect(() => { loadBackups(); loadDestination(); }, []);

  // CHOOSE a destination. A same-drive pick is accepted and marked; an
  // unwritable one is refused by the server and said out loud.
  const pickDestination = async () => {
    uiSound('activate');
    setDestError(null);
    const chosen = await window.neuma.chooseDirectory().catch(() => null);
    if (!chosen) return; // cancelled — not an error
    setDestBusy(true);
    try {
      const r = await setBackupDestination(chosen);
      setDestination(r.destination);
    } catch (e) {
      setDestError(e.message);
    } finally {
      setDestBusy(false);
    }
  };

  const clearDestination = async () => {
    uiSound('toggle');
    setDestBusy(true); setDestError(null);
    try {
      const r = await setBackupDestination(null);
      setDestination(r.destination);
    } catch (e) {
      setDestError(e.message);
    } finally {
      setDestBusy(false);
    }
  };

  const runPlan = async () => {
    uiSound('activate');
    setPlanBusy(true); setPlanError(null);
    try { setPlan(await getEncryptionPlan()); }
    catch (e) { setPlanError(e.message); }
    setPlanBusy(false);
  };

  const runBackup = async () => {
    uiSound('activate');
    setBackupBusy(true); setBackupError(null);
    try {
      await createBackup();
      await loadBackups();
    } catch (e) { setBackupError(e.message); }
    setBackupBusy(false);
  };

  const removeBackup = async (id) => {
    uiSound('activate');
    setDeletingBackup(id);
    setBackupError(null);
    try {
      await deleteBackup(id);
      await loadBackups();
      setConfirmDelete(null);
    } catch (e) { setBackupError(e.message); }
    finally { setDeletingBackup(null); }
  };

  const roots = status?.roots;
  const enc = status?.encryption;
  const rootWarning = roots && roots.aligned !== true; // false OR 'unknown'

  return (
    <>
      <GuardianSection beings={status?.beings || []} harness={harness} />

      {/* ── ENCRYPTION ─────────────────────────────────────────────── */}
      <section className="settings-sec">
        <div className="label-data settings-h">{t('encryption.heading')}</div>
        <p className="settings-note">{t('encryption.note')}</p>

        {loadError ? <p className="settings-err">{loadError}</p> : null}

        {status ? (
          <div className="settings-realm">
            <div className="settings-row">
              <span className="settings-k">{t('encryption.securedLabel')}</span>
              <span className="settings-v">
                {t('encryption.secured', { secured: enc.securedCount, total: enc.totalCount })}
                {enc.allSecured ? t('encryption.allSecured') : ''}
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-k">{t('encryption.activeRoot')}</span>
              <code className="settings-v">{roots.active}</code>
            </div>
            {roots.persisted && roots.persisted !== roots.active ? (
              <div className="settings-row">
                <span className="settings-k">{t('encryption.savedRoot')}</span>
                <code className="settings-v">{roots.persisted}</code>
              </div>
            ) : null}
            {rootWarning ? (
              <p className="settings-warn">
                {t('encryption.rootWarn', {
                  unreadable: roots.aligned === 'unknown' ? t('encryption.rootUnreadable') : '',
                })}
              </p>
            ) : null}
            <div className="settings-row">
              <span className="settings-k">{t('encryption.storage')}</span>
              <span className="settings-v">
                {status.storage.level === 'unknown'
                  ? t('encryption.storageUnknown')
                  : t('encryption.storageFree', { free: status.storage.freeGB, level: status.storage.level })}
              </span>
            </div>

            {status.beings.length ? (
              <ul className="settings-files">
                {status.beings.map((b) => {
                  const r = recovery[b.neumaId];
                  return (
                    <li key={b.neumaId}>
                      <code>{b.name}</code>
                      <span className="settings-sec-tags">
                        <span className={b.secured ? 'settings-tag-ok' : 'settings-tag-warn'}>
                          {b.secured ? t('encryption.ownKey') : t('encryption.sharedKey')}
                        </span>
                        {r ? (
                          <span className={r.hasRecoveryCodes ? 'settings-tag-ok' : 'settings-tag-warn'}>
                            {r.hasRecoveryCodes ? t('encryption.recoverySet') : t('encryption.noRecovery')}
                          </span>
                        ) : null}
                        {r && Number.isFinite(r.ageDays) ? (
                          <span className="settings-tag-dim">{t('encryption.keyAge', { age: r.ageDays })}</span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title={t('encryption.beingsEmpty')} />
            )}
          </div>
        ) : (
          !loadError && <EmptyState title={t('encryption.reading')} />
        )}

        <div className="settings-control">
          <button type="button" className="settings-set" onClick={runPlan} disabled={planBusy}>
            {planBusy ? t('encryption.checkBusy') : t('encryption.check')}
          </button>
        </div>
        {planError ? <p className="settings-err">{planError}</p> : null}
        {plan ? (
          <div className="settings-realm settings-plan">
            {plan.needsMigration === 0 ? (
              <p className="settings-note">{t('encryption.planDone')}</p>
            ) : plan.ready ? (
              <p className="settings-note">
                <Trans
                  i18nKey="settingsSecurity:encryption.planReady"
                  values={{
                    count: plan.needsMigration,
                    plural: pluralSuffix(plan.needsMigration),
                    command: 'npm run migrate:dek -- --all --execute --root <active root>',
                  }}
                  components={{ code: <code className="settings-v" /> }}
                />
              </p>
            ) : (
              <p className="settings-warn">
                {t('encryption.planBlocked', { count: plan.blocked, plural: pluralSuffix(plan.blocked) })}
              </p>
            )}
          </div>
        ) : null}
      </section>

      {/* ── BACKUPS ────────────────────────────────────────────────── */}
      <section className="settings-sec">
        <div className="label-data settings-h">{t('backups.heading')}</div>
        <p className="settings-note">{t('backups.note')}</p>

        {/* WHERE IT LANDS. The same-drive answer is measured server-side
            (stat().dev), so this states a fact rather than hedged advice. */}
        <div className="settings-control settings-dest">
          <span className="label-data settings-dest-k">{t('backups.destination')}</span>
          <span className="settings-dest-v" title={destination?.path || t('backups.destNotSet')}>
            {destination?.path || t('backups.destDefault')}
          </span>
          {canPickFolder ? (
            <button type="button" className="settings-set" onClick={pickDestination} disabled={destBusy}>
              {destBusy ? t('backups.destBusy') : t('backups.destChoose')}
            </button>
          ) : null}
          {destination?.path ? (
            <button type="button" className="settings-backup-del" onClick={clearDestination} disabled={destBusy}>
              {t('backups.clear')}
            </button>
          ) : null}
        </div>
        {destination ? (
          <p className={destination.protects ? 'settings-note' : 'settings-err'}>
            {destination.protects ? '' : t('backups.noticePrefix')}{destination.reason}
          </p>
        ) : null}
        {destError ? <p className="settings-err">{destError}</p> : null}

        <div className="settings-control">
          <button type="button" className="settings-set" onClick={runBackup} disabled={backupBusy || deletingBackup !== null || confirmDelete !== null}>
            {backupBusy ? t('backups.backupBusy') : t('backups.create')}
          </button>
        </div>
        {backupError ? <p className="settings-err">{backupError}</p> : null}

        {backups.length ? (
          <ul className="settings-files">
            {backups.map((b) => (
              <li key={b.id} className="settings-backup-row">
                <code>{formatDateTime(b.createdAt)}</code>
                <span className="settings-backup-meta">
                  {t('backups.beingCount', {
                    count: b.beingCount,
                    plural: pluralSuffix(b.beingCount),
                    size: formatBytes(b.sizeBytes),
                  })}
                </span>
                {confirmDelete === b.id ? (
                  <InlineActionConfirm label={t('backups.confirmAria')} confirmLabel={t('backups.confirmDelete')}
                    busy={deletingBackup === b.id}
                    onConfirm={() => removeBackup(b.id)}
                    onCancel={() => { uiSound('close'); setConfirmDelete(null); }}>
                    {t('backups.confirmBody', { date: formatDateTime(b.createdAt) })}
                  </InlineActionConfirm>
                ) : (
                  <button
                    type="button"
                    className="settings-backup-del"
                    disabled={backupBusy || deletingBackup !== null}
                    onClick={() => { uiSound('open'); setConfirmDelete(b.id); }}
                    aria-label={t('backups.deleteAria', { date: formatDateTime(b.createdAt) })}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t('backups.empty')} />
        )}
      </section>
    </>
  );
};
