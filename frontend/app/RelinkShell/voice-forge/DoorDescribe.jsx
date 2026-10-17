// DoorDescribe — words become three voices (the designer makes one clip per
// seed); the person plays each and picks one, which then is the clip. While
// they are made, the three slots wait in place; a failure is shown here. When
// the designer is not on this machine, one plain sentence says so instead.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../../services/ui-sound.js';
import { designerInstalled } from './forge-client.js';
import { foundTakes, pinnedTake } from './forge-model.js';
import { TakeCard } from './TakeCard.jsx';

const MIN_CHARS = 3;
const MAX_CHARS = 500;
const SLOTS = Object.freeze([1, 2, 3]);

export const DoorDescribe = ({ forge, name }) => {
  const { t } = useTranslation('voiceForge');
  const [description, setDescription] = useState('');
  const [installed, setInstalled] = useState(null);
  useEffect(() => {
    let current = true;
    designerInstalled().then((v) => { if (current) setInstalled(v); });
    return () => { current = false; };
  }, []);

  const text = description.trim();
  const ok = text.length >= MIN_CHARS && text.length <= MAX_CHARS;
  const making = forge.busyAt === 'describe';
  const error = forge.errorAt === 'describe' ? forge.error : null;
  const takes = foundTakes(forge.forge, forge.foundBy.describe);
  const pinned = pinnedTake(forge.forge);

  return (
    <div className="vf-door vf-door-describe">
      <p className="vf-lead">{t('describe.lead')}</p>
      <textarea
        className="vf-textarea"
        rows={3}
        maxLength={MAX_CHARS}
        value={description}
        placeholder={t('describe.placeholder')}
        onChange={(e) => setDescription(e.target.value)}
      />
      {installed === false ? (
        <p className="vf-note vf-designer-missing">{t('describe.notInstalled')}</p>
      ) : (
        <div className="vf-actions vf-actions-start">
          <button
            type="button"
            className="btn btn-primary vf-make"
            disabled={!ok || Boolean(forge.busy)}
            onClick={() => { uiSound('activate'); forge.find({ door: 'describe', description: text }); }}
          >
            {making ? t('describe.making') : t('describe.make')}
          </button>
        </div>
      )}
      {error ? <p className="vf-note vf-note-alert vf-door-error">{error}</p> : null}
      {making ? (
        <div className="vf-takes">
          {SLOTS.map((n) => (
            <div key={n} className="vf-slot" aria-busy="true">
              <span className="label-data">{t('describe.slot', { n })}</span>
              <span className="vf-slot-bar" aria-hidden="true" />
            </div>
          ))}
        </div>
      ) : null}
      {!making && takes.length ? (
        <div className="vf-takes">
          {takes.map((take, i) => (
            <TakeCard key={take.ref} take={take} label={t('describe.slot', { n: i + 1 })} pinned={take.ref === pinned?.ref}
              sessionId={forge.sessionId} busy={forge.busy} onPick={forge.pick} name={name} previews={forge.previews} onRetry={(ref) => forge.preparePreview(ref, { autoplay: true })} />
          ))}
        </div>
      ) : null}
    </div>
  );
};
