// DoorLibrary — BROWSE: the curated voices as a gallery of tiles, narrowed by
// two filters (feminine / masculine, accent). ▶ plays the being talking a while
// in that voice on this machine's tier (rendered once, then cached on disk by
// the backend); CHOOSE brings the voice into the forge. Licence and credit sit
// behind the ⓘ.
//
// impure: a preview is fetched only when asked and plays in the forge's one
// Player (pause, back 5 s, drag), one sound at a time.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../../services/ui-sound.js';
import { libraryPreviewUrl } from './forge-client.js';
import { filterVoices, galleryFiltersOf, pinnedTake } from './forge-model.js';
import { InfoIcon } from './forge-icons.jsx';
import { Player } from './Player.jsx';

const Filter = ({ label, value, options, labelOf, onChange }) => (
  <div className="vf-filter" role="group" aria-label={label}>
    <span className="label-data vf-filter-label">{label}</span>
    {[null, ...options].map((o) => (
      <button key={o ?? 'any'} type="button" className="vf-chip" aria-pressed={value === o} onClick={() => onChange(o)}>
        {labelOf(o)}
      </button>
    ))}
  </div>
);

export const DoorLibrary = ({ forge, voices, name }) => {
  const { t } = useTranslation('voiceForge');
  const [register, setRegister] = useState(null);
  const [accent, setAccent] = useState(null);
  // A preview that came back as the raw recording (no engine here) says so on its tile.
  const [notes, setNotes] = useState({});
  const loadPreview = (id) => async () => {
    const { url, kind } = await libraryPreviewUrl(id);
    setNotes((n) => ({ ...n, [id]: kind === 'recording' ? 'recording' : null }));
    return url;
  };
  const options = galleryFiltersOf(voices);
  const shown = filterVoices(voices, { register, accent });
  const chosenId = pinnedTake(forge.forge)?.origin?.libraryId ?? null;

  if (!voices) return <p className="label-data vf-working">{t('library.loading')}</p>;
  return (
    <div className="vf-door vf-door-library">
      <div className="vf-filters">
        <Filter label={t('library.voice')} value={register} options={options.registers} onChange={setRegister}
          labelOf={(o) => (o ? t(`library.${o}`) : t('library.any'))} />
        <Filter label={t('library.accent')} value={accent} options={options.accents} onChange={setAccent}
          labelOf={(o) => o ?? t('library.any')} />
        <span className="label-data vf-count">{t('library.count', { shown: shown.length, total: voices.length })}</span>
      </div>
      {shown.length === 0 ? <p className="vf-note">{t('library.empty')}</p> : null}
      <ul className="vf-gallery">
        {shown.map((v) => {
          const note = notes[v.id];
          const finding = forge.busyAt === `library:${v.id}`;
          const error = forge.errorAt === `library:${v.id}` ? forge.error : null;
          const chosen = chosenId === v.id;
          return (
            <li key={v.id} className="vf-tile cham" data-voice={v.id} data-chosen={chosen}>
              <div className="cham-in vf-tile-in">
                <div className="vf-tile-top">
                  <Player playKey={`library:${v.id}`} label={v.name} load={loadPreview(v.id)} compact />
                  <span className="vf-info" tabIndex={0} title={`${v.about}\n${v.licence} · ${v.attribution}`} aria-label={t('library.about')}>
                    <InfoIcon />
                  </span>
                </div>
                <span className="label-data vf-tile-meta">
                  {[v.accent || null, v.register ? t(`library.${v.register}`) : null].filter(Boolean).join(' · ') || t('library.unlisted')}
                </span>
                {note === 'recording' ? <span className="vf-tile-note">{t('library.rawNote')}</span> : null}
                {error ? <span className="vf-tile-note vf-note-alert">{error}</span> : null}
                {chosen
                  ? <span className="label-data vf-chosen vf-tile-chosen">{t('take.chosen')}</span>
                  : (
                    <button type="button" className="btn btn-secondary vf-choose" disabled={Boolean(forge.busy)}
                      onClick={() => { uiSound('activate'); forge.find({ door: 'library', libraryId: v.id }); }}>
                      {finding ? t('library.choosing') : t('library.choose')}
                    </button>
                  )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
