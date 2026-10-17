// SoundSection — the desk's own voice, inside Settings › GENERAL.
//
// The SND button in the chat header answers only […]; the
// LEVEL was a module constant nothing could reach (Design note, 2026-08-06: […]). Both switches live here now, on the same persisted
// keys the engine reads before every cue — and the dial is heard as it moves:
// a tick at the new level on release, and any sustained bed follows live.
//
// THE BOARD (Design note, 2026-08-06: […]) — every cue in the baked sprite, in one
// place, playable. It is the audition surface: the ACT cues shipped as
// CANDIDATE bindings, and a binding is only ratified once it has been heard
// here. The list is read from the BAKED SPRITE, not the manifest, so it can
// only ever show what will actually play.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getSoundVolume, isSoundOn, playSound, setSoundVolume, toggleSound,
} from '../../services/sound-engine.js';
import { uiSound } from '../../services/ui-sound.js';
import { ACT_CUES } from '../../services/act-sound-map.js';
import { EXECUTION_CUES, actionCueLabel } from '../../services/execution-sounds.js';
import spriteIndex from '../../sounds-baked/sprite.json';

const BAKED = Object.keys(spriteIndex.events);
const EXECUTIONS = EXECUTION_CUES.filter((cue) => BAKED.includes(cue));
const ACTS = ACT_CUES.filter((cue) => BAKED.includes(cue) && !EXECUTION_CUES.includes(cue));
const RATIFIED = BAKED.filter((cue) => !ACT_CUES.includes(cue));

// One row of the board. Says its own length, because "too long" is the most
// common reason a cue that reads well on paper is wrong in the ear.
const CueRow = ({ cue }) => (
  <button
    type="button"
    className="settings-cue"
    data-cue={cue}
    onClick={() => playSound(cue)}
    title={`Play ${actionCueLabel(cue)}`}
  >
    <span className="settings-cue-name">{actionCueLabel(cue)}</span>
    <span className="settings-cue-len label-data">
      {Math.round(spriteIndex.events[cue].duration * 1000)}ms
    </span>
  </button>
);

const CueGroup = ({ title, note, cues }) => (
  <div className="settings-board-group">
    <div className="settings-board-h label-data">{title}</div>
    <p className="settings-note">{note}</p>
    <div className="settings-board">
      {cues.map((cue) => <CueRow key={cue} cue={cue} />)}
    </div>
  </div>
);

export const SoundSection = () => {
  const { t } = useTranslation(['settings', 'common']);
  const [on, setOn] = useState(isSoundOn);
  const [volume, setVolume] = useState(getSoundVolume);

  // The chat header's SND button and sibling desk windows move the same two
  // keys — whichever surface moved it, re-read the persisted truth.
  useEffect(() => {
    const refresh = () => { setOn(isSoundOn()); setVolume(getSoundVolume()); };
    window.addEventListener('neuma:sound-changed', refresh);
    window.addEventListener('neuma:sound-volume', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('neuma:sound-changed', refresh);
      window.removeEventListener('neuma:sound-volume', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const flip = () => {
    const next = toggleSound();
    setOn(next);
    if (next) playSound('confirm');
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
      <div className={`settings-board-host${on ? '' : ' is-quiet'}`}>
        <CueGroup title={t('settings:sound.executionTitle', { count: EXECUTIONS.length })}
          note={t('settings:sound.executionNote')}
          cues={EXECUTIONS} />
        <CueGroup
          title={t('settings:sound.actsTitle', { count: ACTS.length })}
          note={t('settings:sound.actsNote')}
          cues={ACTS}
        />
        <CueGroup
          title={t('settings:sound.worldTitle', { count: RATIFIED.length })}
          note={t('settings:sound.worldNote')}
          cues={RATIFIED}
        />
      </div>
    </section>
  );
};
