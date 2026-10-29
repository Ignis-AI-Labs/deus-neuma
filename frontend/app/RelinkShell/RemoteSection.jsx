// RemoteSection — Neuma Remote inside Settings > Security.
//
// Four states, each an honest reading of the machine (SHINKEI): OFF,
// NO TAILSCALE, NOT SERVING, SERVING. The QR and the device list only appear
// in the last one, because only then does a phone have a road in. Every
// control here is local-only on the server — a phone opening this section
// is told to manage remote access from the desk.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { formatDateTime } from '../../utils/format.js';
import {
  getRemoteStatus, enableRemote, disableRemote, rotateRemote, pairPhone,
  enableHttps, disableHttps, revokeDevice, qrSource,
} from '../../services/remote-client.js';
import { AuthImage } from './AuthImage.jsx';
import './RemoteSection.css';

const POLL_MS = 4000;

/**
 * Which of the four states a status reads as. Pure.
 * @param {import('../../services/remote-client.js').RemoteStatus | null} status
 * @returns {'loading' | 'off' | 'no-tailscale' | 'not-serving' | 'serving'}
 */
export const remoteMode = (status) => {
  if (!status) return 'loading';
  if (!status.enabled) return 'off';
  if (!status.tailscale.installed || status.tailscale.backendState !== 'Running') return 'no-tailscale';
  return status.serving ? 'serving' : 'not-serving';
};

const Row = ({ k, children }) => (
  <div className="settings-row">
    <span className="settings-k">{k}</span>
    <span className="settings-v">{children}</span>
  </div>
);

export const RemoteSection = () => {
  const { t } = useTranslation('settingsSecurity');
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [fromPhone, setFromPhone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [pairing, setPairing] = useState(null); // { code, url, expiresAt }

  const load = useCallback(() =>
    getRemoteStatus()
      .then((s) => { setStatus(s); setLoadError(null); setFromPhone(false); })
      .catch((err) => {
        if (err?.http === 403) { setFromPhone(true); return; }
        setLoadError(err?.message || t('remote.statusFallback'));
      }), [t]);

  useEffect(() => { load(); }, [load]);

  // While a pairing code stands, watch for the phone to arrive — the device
  // list is the proof the scan worked. Stops with the code.
  useEffect(() => {
    if (!pairing) return undefined;
    const timer = setInterval(() => {
      if (Date.now() > pairing.expiresAt) { setPairing(null); return; }
      load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pairing, load]);

  const act = useCallback(async (fn, sound = 'activate') => {
    setBusy(true);
    setActionError(null);
    try {
      const next = await fn();
      if (next && typeof next.enabled === 'boolean') setStatus(next);
      uiSound(sound);
    } catch (err) {
      setActionError(err?.message || t('remote.actionFallback'));
      uiSound('deny');
    } finally {
      setBusy(false);
    }
  }, [t]);

  const startPairing = () => act(async () => {
    const p = await pairPhone();
    setPairing({ code: p.code, url: p.url, expiresAt: Date.now() + p.expiresIn });
    return null;
  });

  const cutAll = (fn) => act(async () => { setPairing(null); return fn(); }, 'close');

  if (fromPhone) {
    return (
      <section className="settings-sec">
        <h3 className="label-data settings-h">{t('remote.heading')}</h3>
        <p className="settings-note">{t('remote.phoneNote')}</p>
      </section>
    );
  }

  const mode = remoteMode(status);
  const ts = status?.tailscale;

  return (
    <section className="settings-sec">
      <h3 className="label-data settings-h">
        {t('remote.heading')}{mode === 'serving' ? <span className="remote-mark label-data">{t('remote.serving')}</span> : null}
      </h3>
      {loadError ? <p className="settings-err">{loadError}</p> : null}
      {mode === 'loading' ? <p className="settings-note">{t('remote.loading')}</p> : null}

      {mode === 'off' ? (
        <>
          <p className="settings-note">{t('remote.offNote')}</p>
          <div className="settings-control remote-actions">
            <button type="button" className="settings-set" disabled={busy} onClick={() => act(enableRemote)}>
              {t('remote.enable')}
            </button>
          </div>
        </>
      ) : null}

      {mode === 'no-tailscale' ? (
        <>
          <p className="settings-warn">
            {ts?.installed ? t('remote.tsInstalled') : t('remote.tsMissing')}
          </p>
          {ts?.detail ? <p className="settings-err">{ts.detail}</p> : null}
          <div className="settings-control remote-actions">
            <button type="button" className="settings-set" disabled={busy} onClick={load}>{t('remote.checkAgain')}</button>
            <button type="button" className="settings-set" disabled={busy} onClick={() => cutAll(disableRemote)}>{t('remote.disable')}</button>
          </div>
        </>
      ) : null}

      {mode === 'not-serving' ? (
        <>
          <Row k={t('remote.origin')}>{status.origin}</Row>
          <p className="settings-note">{t('remote.httpsNote')}</p>
          <div className="settings-control remote-actions">
            <button type="button" className="settings-set" disabled={busy} onClick={() => act(enableHttps)}>
              {t('remote.enableHttps')}
            </button>
            <button type="button" className="settings-set" disabled={busy} onClick={() => cutAll(disableRemote)}>{t('remote.disable')}</button>
          </div>
        </>
      ) : null}

      {mode === 'serving' ? (
        <>
          <Row k={t('remote.origin')}><span className="remote-url">https://{status.origin}</span></Row>
          <Row k={t('remote.port')}>{status.port}</Row>
          {pairing ? (
            <div className="remote-pair">
              <div className="remote-qr"><AuthImage src={qrSource(pairing.code)} alt={t('remote.pairingAlt')} menu={false} /></div>
              <p className="settings-note">{t('remote.pairingNote')}</p>
              <p className="remote-url label-data">{pairing.url}</p>
            </div>
          ) : null}
          <div className="settings-control remote-actions">
            <button type="button" className="settings-set" disabled={busy} onClick={startPairing}>
              {pairing ? t('remote.newCode') : t('remote.pairPhone')}
            </button>
            <button type="button" className="settings-set" disabled={busy} onClick={() => cutAll(rotateRemote)}>
              {t('remote.rotate')}
            </button>
            <button type="button" className="settings-set" disabled={busy} onClick={() => act(disableHttps, 'close')}>
              {t('remote.httpsOff')}
            </button>
            <button type="button" className="settings-set" disabled={busy} onClick={() => cutAll(disableRemote)}>{t('remote.disable')}</button>
          </div>
          <div className="remote-devices">
            <h4 className="label-data remote-devices-h">{t('remote.devicesHeading', { count: status.devices.length })}</h4>
            {status.devices.length === 0 ? <p className="settings-note">{t('remote.devicesNone')}</p> : null}
            {status.devices.map((d) => (
              <div className="settings-row remote-device" key={d.id}>
                <span className="settings-k">{d.label}</span>
                <span className="settings-v">
                  {t('remote.deviceSeen', { createdAt: formatDateTime(d.createdAt), lastSeenAt: formatDateTime(d.lastSeenAt) })}
                </span>
                <button type="button" className="settings-set" disabled={busy} onClick={() => act(() => revokeDevice(d.id), 'close')}>
                  {t('remote.revoke')}
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {actionError ? <p className="settings-err">{actionError}</p> : null}
    </section>
  );
};
