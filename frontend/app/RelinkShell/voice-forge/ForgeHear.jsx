// ForgeHear — step two: the being speaks in the chosen voice, on this
// machine's tier, through the exact chat path. A "say something" box for any
// line, another take, back, and STOP while it speaks (the chat's own stop —
// a live voice cannot be scrubbed; the player bar holds the files that can).
// Then the voice is OFFERED to the being — with the consent tick first when it
// is a real person's voice.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../../services/ui-sound.js';
import { useConsciousnessPick } from '../consciousness-context.js';
import { offerOf, pinnedTake } from './forge-model.js';
import { pausePlayer } from './forge-player.js';
import { useAudition } from './use-audition.js';
import { TakeCard } from './TakeCard.jsx';
import { ConsentTick } from './ConsentTick.jsx';

export const ForgeHear = ({ forge, name }) => {
  const { t } = useTranslation('voiceForge');
  const { wsService, voiceEnabled, toggleVoice, stopThought } = useConsciousnessPick('wsService', 'voiceEnabled', 'toggleVoice', 'stopThought');
  const audition = useAudition({ wsService, sessionId: forge.sessionId });
  const [line, setLine] = useState('');
  const [whose, setWhose] = useState(null);
  const [ticked, setTicked] = useState(false);
  const take = pinnedTake(forge.forge);
  const need = offerOf(take, { whose, ticked });
  const busy = Boolean(forge.busy);
  if (!take) return null;

  const errorText = audition.error === 'disconnected' ? t('hear.disconnected') : audition.error;
  const speaking = audition.phase === 'sent';
  // One voice at a time: a file in the player pauses before the being speaks.
  const speak = (text) => { pausePlayer(); audition.speak(text); };
  // The chat's own stop cuts the audition; the voice lane stays as it is (no
  // transcript is being cancelled here).
  const stop = () => { uiSound('toggle'); stopThought?.({ retireVoiceLane: false }); };

  return (
    <section className="vf-step vf-hear" data-step="hear">
      <TakeCard take={take} pinned sessionId={forge.sessionId} busy={forge.busy} onPick={forge.pick} name={name} previews={forge.previews} onRetry={(ref) => forge.preparePreview(ref, { autoplay: true })} />
      <div className="cham vf-hear-panel"><div className="cham-in vf-hear-in">
        <p className="vf-lead">{t('hear.lead', { name })}</p>
        {!voiceEnabled ? (
          <p className="vf-note vf-vox-off">
            {t('hear.voxOff')}{' '}
            <button type="button" className="vf-chip" onClick={() => { uiSound('toggle'); toggleVoice?.(); }}>{t('hear.voxOn')}</button>
          </p>
        ) : null}
        <div className="vf-actions vf-actions-start">
          <button type="button" className="btn btn-primary vf-speak" onClick={() => { uiSound('activate'); speak(); }}>
            {t('hear.speak', { name })}
          </button>
          <button type="button" className="btn btn-secondary" disabled={audition.phase === 'idle'} onClick={() => { pausePlayer(); audition.again(); }}>
            {t('hear.another')}
          </button>
          {speaking ? (
            <button type="button" className="btn btn-secondary vf-hear-stop" onClick={stop}>{t('hear.stop')}</button>
          ) : null}
        </div>
        <label className="vf-field">
          <span className="label-data">{t('hear.say')}</span>
          <span className="vf-say-row">
            <input
              className="vf-input"
              type="text"
              value={line}
              placeholder={t('hear.sayPlaceholder', { name })}
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && line.trim()) speak(line); }}
            />
            <button type="button" className="vf-chip" disabled={!line.trim()} onClick={() => speak(line)}>{t('hear.sayIt')}</button>
          </span>
        </label>
        {speaking ? <p className="label-data vf-live">{t('hear.sent', { name })}</p> : null}
        {errorText ? <p className="vf-note vf-note-alert">{errorText}</p> : null}
      </div></div>
      <ConsentTick need={need} whose={whose} ticked={ticked} onWhose={setWhose} onTick={setTicked} />
      {forge.errorAt === 'offer' ? <p className="vf-note vf-note-alert vf-door-error">{forge.error}</p> : null}
      <div className="vf-actions">
        <button type="button" className="btn btn-secondary" onClick={() => forge.goTo('find')}>{t('hear.back')}</button>
        <button
          type="button"
          className="btn btn-primary vf-offer"
          disabled={!need.ready || busy}
          onClick={() => { uiSound('activate'); forge.offer(need.body); }}
        >
          {t('hear.offer', { name })}
        </button>
      </div>
    </section>
  );
};
