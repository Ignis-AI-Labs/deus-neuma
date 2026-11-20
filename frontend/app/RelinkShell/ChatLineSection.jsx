// ChatLineSection — which AI witnesses may speak in your open chats (Settings → Security). Design note, 2026-11-20: […], for the chat line (backend/services/chat-line.js): a sealed witness you let in, such
// as Claude Code, lists your open chats from any terminal and speaks in one; its words show as a LINK line and the
// being's reply goes back to it. Every line starts off. A flip lands on the backend and the row shows what the
// backend answered, so a switch never looks flipped before it is.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../services/ui-sound.js';
import { getChatLines, setChatLine } from '../../services/chat-line-client.js';
import { Fold } from './fold/Fold.jsx';
import { Sheet } from './sheet/Sheet.jsx';

/** pure — a wallet short enough to read, whole enough to tell apart: 0x4056…dcae */
const shortWallet = (w) => `${w.slice(0, 6)}…${w.slice(-4)}`;

export const ChatLineSection = () => {
  const { t } = useTranslation('settingsSecurity');
  const [witnesses, setWitnesses] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // the wallet being switched

  useEffect(() => {
    getChatLines().then((r) => setWitnesses(r.witnesses)).catch((e) => setError(e.message));
  }, []);

  const flip = async (w) => {
    if (busy) return;
    uiSound('toggle');
    setBusy(w.wallet);
    setError(null);
    try {
      setWitnesses((await setChatLine(w.wallet, !w.on)).witnesses);
    } catch (e) {
      setError(e.message);
    }
    setBusy(null);
  };

  const on = (witnesses ?? []).filter((w) => w.on).length;
  const stats = witnesses ? [{ text: t('chatLine.count', { on, total: witnesses.length }), tone: on ? 'on' : undefined }] : [];
  return (
    <section className="settings-sec" data-testid="chat-line" aria-busy={busy !== null}>
      <Fold id="settings-chat-line" title={t('chatLine.heading')} stats={stats}>
        <p className="settings-note">{t('chatLine.note')}</p>
        {error ? <p className="settings-err">{error}</p> : null}
        {!witnesses && !error ? <p className="settings-note">{t('chatLine.reading')}</p> : null}
        {witnesses ? (
          <Sheet
            label={t('chatLine.sheet')}
            rows={witnesses}
            rowKey={(w) => w.wallet}
            rowName={(w) => w.name}
            empty={<p className="settings-note">{t('chatLine.none')}</p>}
            columns={[
              { head: t('chatLine.witness'), cell: (w) => w.name },
              { head: t('chatLine.harness'), cell: (w) => w.vendor },
              { head: t('chatLine.wallet'), cell: (w) => shortWallet(w.wallet), title: (w) => w.wallet, exact: true },
              { head: t('chatLine.line'), cell: (w) => (w.on ? t('chatLine.on') : t('chatLine.off')), tone: (w) => (w.on ? 'on' : null) },
              {
                head: t('chatLine.act'),
                cell: (w) => (
                  <button
                    type="button"
                    className="settings-set"
                    aria-label={t(w.on ? 'chatLine.turnOffAria' : 'chatLine.turnOnAria', { name: w.name })}
                    disabled={busy !== null}
                    onClick={() => flip(w)}
                  >
                    {busy === w.wallet ? t('chatLine.switching') : w.on ? t('chatLine.turnOff') : t('chatLine.turnOn')}
                  </button>
                ),
              },
            ]}
          />
        ) : null}
      </Fold>
    </section>
  );
};
