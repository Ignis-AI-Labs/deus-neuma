// ChosenBar — the voice chosen so far, under every way of finding one: play
// it (the being speaking in it once that is made, the clip until then), what
// it is, and HEAR <NAME> TALK. Choosing in any view replaces it; a
// failure in a view is shown in that view, never here beside an older pick.

import { useTranslation } from 'react-i18next';
import { uiSound } from '../../../services/ui-sound.js';
import { beingPreviewOf, chosenOf } from './forge-model.js';
import { takeAudioUrl, takePreviewUrl } from './forge-client.js';
import { takeKeyOf } from './forge-player.js';
import { Player } from './Player.jsx';

// pure — the chosen voice's one-line description.
const detailOf = (t, c) => [
  c.accent,
  c.register ? t(`library.${c.register}`) : null,
  c.seconds !== null ? t('take.seconds', { seconds: c.seconds }) : null,
  c.pitchHz !== null ? t('take.pitch', { hz: c.pitchHz }) : null,
].filter(Boolean).join(' · ');

export const ChosenBar = ({ forge, name, voices }) => {
  const { t } = useTranslation('voiceForge');
  const chosen = chosenOf(forge.forge, voices);
  const preview = chosen ? beingPreviewOf(forge.previews, chosen.ref) : null;
  const being = preview?.state === 'ready' && preview.kind === 'being';
  return (
    <div className="vf-chosen-bar" data-chosen={Boolean(chosen)}>
      {chosen ? (
        <>
          <Player
            key={`${chosen.ref}:${being}`}
            playKey={takeKeyOf(chosen.ref, being)}
            label={being ? t('being.theirs', { name }) : t('being.yours')}
            load={async () => (being ? (await takePreviewUrl(forge.sessionId, chosen.ref)).url : takeAudioUrl(forge.sessionId, chosen.ref))}
            compact
          />
          <div className="vf-chosen-text">
            <span className="label-data vf-chosen-kicker">{t('chosen.label')}</span>
            <span className="vf-chosen-name">{chosen.name ?? t(`chosen.doors.${chosen.door}`)}</span>
            <span className="vf-chosen-detail">{detailOf(t, chosen)}</span>
            {preview.state === 'making' ? <span className="vf-chosen-making" role="status"><span className="vf-spin" aria-hidden="true" />{t('being.making', { name })}</span> : null}
          </div>
        </>
      ) : (
        <p className="vf-chosen-none">{t('chosen.none')}</p>
      )}
      <button
        type="button"
        className="btn btn-primary vf-next"
        disabled={!chosen || Boolean(forge.busy)}
        onClick={() => { uiSound('activate'); forge.goTo('hear'); }}
      >
        {t('toHear', { name })}
      </button>
    </div>
  );
};
