// TakeCard — one found voice: its plain verdict and what was measured, the
// clip as found beside the being speaking in it, the words in the clip, and
// choose. A take is content-addressed (its ref is the sha256 of its clip), so
// the card keys and pins by that one string.
//
// The being's passage is asked for the moment the take arrives (use-forge.js).
// The card shows each stage as it happens — clip read, words written, the
// being's voice made — then both players sit side by side (the forge's one
// Player); a failure shows here with a retry. Cloning is zero-shot — the card
// says that plainly, so nobody waits for a training step that never comes.

import { useTranslation } from 'react-i18next';
import { takeAudioUrl, takePreviewUrl } from './forge-client.js';
import { beingPreviewOf, measuredOf, verdictOf } from './forge-model.js';
import { takeKeyOf } from './forge-player.js';
import { Player } from './Player.jsx';
import { Stages } from './Stages.jsx';

// pure — the take's stages: its clip, its words, the being's voice made from them.
const takeStagesOf = (t, take, preview, name) => {
  const made = preview.state === 'ready' && preview.kind === 'being';
  const voice = made ? 'done'
    : preview.state === 'failed' || (preview.state === 'ready' && preview.kind === 'recording') ? 'failed'
      : 'active';
  return [
    { id: 'clip', label: t('stage.clip'), state: 'done' },
    { id: 'words', label: t('stage.words'), state: take.words ? 'done' : 'failed' },
    { id: 'voice', label: made ? t('stage.voiceMade', { name }) : t('stage.voice', { name }), state: voice },
  ];
};

// The being's half of the card: making → its ▶, the engine-missing note, or the error and a retry.
const BeingSide = ({ t, name, preview, sessionId, takeRef, onRetry }) => {
  if (preview.state === 'making' || preview.state === 'none') {
    return (
      <span className="vf-being-making" role="status">
        <span className="vf-spin" aria-hidden="true" />{t('being.making', { name })}
      </span>
    );
  }
  if (preview.state === 'failed') {
    return (
      <span className="vf-being-failed">
        <span className="vf-note vf-note-alert">{t('being.failed', { name, error: preview.error })}</span>
        <button type="button" className="vf-chip" onClick={onRetry}>{t('retry')}</button>
      </span>
    );
  }
  if (preview.kind === 'recording') return <span className="vf-note vf-being-raw">{t('being.rawNote', { name })}</span>;
  return (
    <span className="vf-being-play">
      <Player playKey={takeKeyOf(takeRef, true)} label={t('being.theirs', { name })} load={async () => (await takePreviewUrl(sessionId, takeRef)).url} />
    </span>
  );
};

export const TakeCard = ({ take, label, pinned, sessionId, busy, onPick, name, previews, onRetry }) => {
  const { t } = useTranslation('voiceForge');
  const { verdict, good } = verdictOf(take);
  const m = measuredOf(take);
  const facts = [
    m.seconds !== null ? t('take.seconds', { seconds: m.seconds }) : null,
    m.pitchHz !== null ? t('take.pitch', { hz: m.pitchHz }) : null,
    m.wordsPerSecond !== null ? t('take.pace', { wps: m.wordsPerSecond }) : null,
  ].filter(Boolean).join(' · ');
  const preview = beingPreviewOf(previews, take.ref);
  return (
    <div className="vf-take cham" data-pinned={pinned} data-verdict={verdict} data-being={preview.state}>
      <div className="cham-in vf-take-in">
        <div className="vf-take-row">
          <div className="vf-take-head">
            {label ? <span className="vf-take-label">{label}</span> : null}
            <span className="label-data vf-take-facts">
              <span className="vf-verdict" data-good={good}>{t(`verdict.${verdict}`)}</span>
              {facts ? ` · ${facts}` : null}
            </span>
          </div>
          {pinned
            ? <span className="label-data vf-chosen">{t('take.chosen')}</span>
            : <button type="button" className="btn btn-secondary vf-use" disabled={Boolean(busy)} onClick={() => onPick(take.ref)}>{t('take.use')}</button>}
        </div>
        <Stages stages={takeStagesOf(t, take, preview, name)} label={t('stage.label')} />
        <div className="vf-being-row">
          <span className="vf-clip-play">
            <Player playKey={takeKeyOf(take.ref, false)} label={t('being.yours')} load={() => takeAudioUrl(sessionId, take.ref)} />
          </span>
          <BeingSide t={t} name={name} preview={preview} sessionId={sessionId} takeRef={take.ref} onRetry={() => onRetry(take.ref)} />
        </div>
        <p className="vf-being-how">{t('being.how', { name })}</p>
        {take.words ? <p className="vf-take-words" title={t('take.words')}>“{take.words}”</p> : null}
      </div>
    </div>
  );
};
