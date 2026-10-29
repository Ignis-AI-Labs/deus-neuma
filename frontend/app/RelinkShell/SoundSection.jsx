// SoundSection — the desk's own voice, inside Settings › GENERAL.
//
// The SND button in the chat header answers only […]; the
// LEVEL was a module constant nothing could reach (Design note, 2026-08-06: […]). Both switches live here now, on the same persisted
// keys the engine reads before every cue — and the dial is heard as it moves:
// a tick at the new level on release, and any sustained bed follows live.
//
// THE BOARD (Design note, 2026-08-06: […]; 2026-10-28: […]) — every
// cue the chosen pack voices, grouped by who acts and named by what it means
// (sound-board.js), in one place, playable. The PACK switch beside the dial
// picks the voice: the ratified SCI-FI soundscape (the default) or SOFT.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SOUND_PACKS, getSoundPack, getSoundVolume, isSoundOn, playSound, setSoundPack, setSoundVolume, toggleSound,
} from '../../services/sound-engine.js';
import { uiSound } from '../../services/ui-sound.js';
import { boardGroups, cueLabel } from '../../services/sound-board.js';
import { SOFT_PACK } from '../../services/soft-sound/soft-cues.js';
import { cueSpanMs } from '../../services/soft-sound/soft-render.js';
import spriteIndex from '../../sounds-baked/sprite.json';

// What each pack voices, and for how long — the board can only ever show
// what will actually play.
const PACK_CUES = Object.freeze({
  soft: Object.fromEntries(Object.entries(SOFT_PACK.cues).map(([cue, notes]) => [cue, cueSpanMs(notes)])),
  scifi: Object.fromEntries(Object.entries(spriteIndex.events).map(([cue, { duration }]) => [cue, Math.round(duration * 1000)])),
});

// One row of the board. Says its own length, because "too long" is the most
// common reason a cue that reads well on paper is wrong in the ear.
const CueRow = ({ cue, ms }) => (
  <button
    type="button"
    className="settings-cue"
    data-cue={cue}
    onClick={() => playSound(cue)}
    title={`Play ${cueLabel(cue)}`}
  >
    <span className="settings-cue-name">{cueLabel(cue)}</span>
    <span className="settings-cue-len label-data">{ms}ms</span>
  </button>
);

const CueGroup = ({ title, note, cues, lengths }) => (
  <div className="settings-board-group">
    <div className="settings-board-h label-data">{title}</div>
    <p className="settings-note">{note}</p>
    <div className="settings-board">
      {cues.map((cue) => <CueRow key={cue} cue={cue} ms={lengths[cue]} />)}
    </div>
  </div>
);

export const SoundSection = () => {
  const { t } = useTranslation(['settings', 'common']);
  const [on, setOn] = useState(isSoundOn);
  const [volume, setVolume] = useState(getSoundVolume);
  const [pack, setPack] = useState(getSoundPack);

  // The chat header's SND button and sibling desk windows move the same
  // keys — whichever surface moved one, re-read the persisted truth.
  useEffect(() => {
    const refresh = () => { setOn(isSoundOn()); setVolume(getSoundVolume()); setPack(getSoundPack()); };
    window.addEventListener('neuma:sound-changed', refresh);
    window.addEventListener('neuma:sound-volume', refresh);
    window.addEventListener('neuma:sound-pack', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('neuma:sound-changed', refresh);
      window.removeEventListener('neuma:sound-volume', refresh);
      window.removeEventListener('neuma:sound-pack', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const flip = () => {
    const next = toggleSound();
    setOn(next);
    if (next) playSound('confirm');
  };

  // A new voice answers in itself, so the switch is heard as it lands.
  const choose = (next) => {
    setPack(setSoundPack(next));
    playSound('confirm');
  };

  // Silent when sound is off — the engine gates it, so the dial never speaks
  // over a witness who asked for quiet.
  const hear = () => uiSound('tick');

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('settings:sound.heading')}</div>
      <p className="settings-note">{t('settings:sound.note')}</p>
      <div className="settings-row">
        <span className="settings-k">{t('settings:sound.soundKey')}</span>
        <button
          type="button"
          className={`settings-desk-toggle${on ? ' on' : ''}`}
          aria-pressed={on}
          onClick={flip}
        >
          {t('settings:sound.toggle', { state: on ? t('common:on') : t('common:off') })}
        </button>
      </div>
      <div className={`settings-row settings-vol${on ? '' : ' is-quiet'}`}>
        <span className="settings-k">{t('settings:sound.volumeKey')}</span>
        <input
          type="range"
          className="settings-vol-dial"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          aria-label={t('settings:sound.volumeAria')}
          onChange={(e) => setVolume(setSoundVolume(e.target.value))}
          onPointerUp={hear}
          onKeyUp={hear}
        />
        <span className="settings-vol-value label-data">{Math.round(volume * 100)}%</span>
      </div>
      <div className={`settings-row settings-pack${on ? '' : ' is-quiet'}`}>
        <span className="settings-k">{t('settings:sound.packKey')}</span>
        <div className="settings-sound-packs" role="group" aria-label={t('settings:sound.packKey')}>
          {SOUND_PACKS.map((id) => (
            <button
              key={id}
              type="button"
              className={`settings-desk-toggle${pack === id ? ' on' : ''}`}
              aria-pressed={pack === id}
              data-pack={id}
              onClick={() => choose(id)}
            >
              {t(`settings:sound.pack.${id}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="settings-note">{t('settings:sound.packNote')}</p>
      <div className={`settings-board-host${on ? '' : ' is-quiet'}`}>
        {boardGroups(Object.keys(PACK_CUES[pack])).map(({ id, cues }) => (
          <CueGroup
            key={id}
            title={t(`settings:sound.groups.${id}.title`, { count: cues.length })}
            note={t(`settings:sound.groups.${id}.note`)}
            cues={cues}
            lengths={PACK_CUES[pack]}
          />
        ))}
      </div>
    </section>
  );
};
