// ChannelConnect — the CONNECT for a channel card in SETTINGS → API →
// CHANNEL KEYS whose key is a sign-in (YouTube through Google, TikTok
// through Login Kit). The house's own app client (saved above) signs in
// through the platform in the system browser; the backend's loopback
// listener receives the answer and seals the tokens. The card then names
// the account it speaks as.
//
// Three honest states: CONNECTED · <account> (the live flight test names
// it), a sign-in in flight (polled until it lands, cancellable), or not
// connected, with CONNECT waiting until the client fields are saved.
// impure — network + window.open.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { startAccountConnect, pollAccountConnect, cancelAccountConnect } from '../../services/social-accounts-client.js';

const POLL_MS = 1500;

// The words that name each platform's sign-in and client.
const COPY = Object.freeze({
  youtube: Object.freeze({ waiting: 'channelKeys.connect.waiting', needClient: 'channelKeys.connect.needClient' }),
  tiktok: Object.freeze({ waiting: 'channelKeys.connect.tiktokWaiting', needClient: 'channelKeys.connect.tiktokNeedClient' }),
});

/**
 * @param {object} props
 * @param {object} props.channel the masked board entry (fields carry `set`, `connect`)
 * @param {object|null} props.test the channel's flight test (account.title names the account)
 * @param {() => Promise<void>} props.onConnected reload the board and re-test
 * @param {string} [props.accountId] which of the house's accounts signs in (its first when unnamed)
 */
export const ChannelConnect = ({ channel, test, onConnected, accountId = `${channel.id}-1` }) => {
  const { t } = useTranslation('settingsApi');
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState(null);
  const [named, setNamed] = useState(null);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;
  const copy = COPY[channel.id] || COPY.youtube;

  const clientReady = channel.fields.filter((f) => !f.connect).every((f) => f.set);
  const connected = channel.fields.filter((f) => f.connect).every((f) => f.set);
  const title = named || test?.account?.title || test?.account?.name || null;

  useEffect(() => {
    if (!waiting) return undefined;
    let alive = true;
    let timer = null;
    const tick = async () => {
      const r = await pollAccountConnect(channel.id, accountId).catch((e) => ({ status: 'error', error: e.message }));
      if (!alive) return;
      if (r.status === 'pending') { timer = setTimeout(tick, POLL_MS); return; }
      setWaiting(false);
      if (r.status === 'complete') {
        uiSound('confirm');
        setNamed(r.channel?.title || null);
        await onConnectedRef.current();
      } else {
        setError(r.error || t('channelKeys.connect.failed'));
      }
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [waiting, channel.id, accountId, t]);

  const start = async () => {
    uiSound('activate');
    setError(null);
    try {
      const { authUrl } = await startAccountConnect(channel.id, accountId);
      window.open(authUrl, '_blank', 'noopener');
      setWaiting(true);
    } catch (e) {
      setError(e.message);
    }
  };

  const cancel = async () => {
    uiSound('deny');
    setWaiting(false);
    await cancelAccountConnect(channel.id, accountId).catch(() => null);
  };

  return (
    <div className="settings-row">
      <span className="settings-k">{t('channelKeys.connect.label')}</span>
      <span className="settings-v">
        {connected
          ? <span className="settings-tag-ok label-data">{t('channelKeys.connect.connected', { channel: title || '…' })}</span>
          : <span className="settings-tag-dim label-data">{t('channelKeys.connect.notConnected')}</span>}
        {connected && test?.profileNeeds ? <span className="settings-note">{test.profileNeeds}</span> : null}
        {waiting ? <span className="settings-note">{t(copy.waiting)}</span> : null}
        {!clientReady ? <span className="settings-note">{t(copy.needClient)}</span> : null}
        {error ? <span className="settings-err">{error}</span> : null}
      </span>
      {waiting
        ? <button type="button" className="settings-set" onClick={cancel}>{t('channelKeys.connect.cancel')}</button>
        : (
          <button type="button" className="settings-set" disabled={!clientReady} onClick={start}>
            {connected ? t('channelKeys.connect.reconnect') : t('channelKeys.connect.connect')}
          </button>
        )}
    </div>
  );
};
