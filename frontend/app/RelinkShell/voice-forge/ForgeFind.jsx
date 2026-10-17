// ForgeFind — step one: […]
//
// Four large choices (browse · describe · record · upload), each opening a
// focused view with a way back to all four. Whatever is chosen in any view
// sits in the CHOSEN bar at the bottom, the one way on to HEAR IT.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../../services/ui-sound.js';
import { listLibrary } from './forge-client.js';
import { WAYS } from './forge-model.js';
import { BackIcon, WAY_ICONS } from './forge-icons.jsx';
import { DoorRecord } from './DoorRecord.jsx';
import { DoorUpload } from './DoorUpload.jsx';
import { DoorLibrary } from './DoorLibrary.jsx';
import { DoorDescribe } from './DoorDescribe.jsx';
import { ChosenBar } from './ChosenBar.jsx';

const DOOR_VIEWS = Object.freeze({ library: DoorLibrary, describe: DoorDescribe, record: DoorRecord, upload: DoorUpload });

export const ForgeFind = ({ forge, name, way, onWay }) => {
  const { t } = useTranslation('voiceForge');
  const [voices, setVoices] = useState(null);
  const [listError, setListError] = useState(null);
  useEffect(() => {
    let current = true;
    listLibrary().then((v) => { if (current) setVoices(v); }, (err) => { if (current) { setVoices([]); setListError(err?.message || String(err)); } });
    return () => { current = false; };
  }, []);

  const open = (w) => { uiSound('open'); forge.clearError(); onWay(w); };
  const Door = way ? DOOR_VIEWS[way] : null;

  return (
    <section className="vf-step vf-find" data-step="find" data-way={way ?? 'all'}>
      {Door ? (
        <div className="vf-way">
          <div className="vf-way-head">
            <button type="button" className="vf-back" onClick={() => { forge.clearError(); onWay(null); }}>
              <BackIcon />{t('ways.back')}
            </button>
            <h2 className="vf-way-title">{t(`ways.${way}.title`)}</h2>
          </div>
          {way === 'library' && listError ? <p className="vf-note vf-note-alert">{listError}</p> : null}
          <Door forge={forge} voices={voices} name={name} />
        </div>
      ) : (
        <div className="vf-ways">
          <h2 className="vf-question">{t('ways.question', { name })}</h2>
          <div className="vf-way-cards">
            {WAYS.map((w) => {
              const Icon = WAY_ICONS[w];
              return (
                <button key={w} type="button" className="vf-way-card cham" data-way={w} onClick={() => open(w)}>
                  <span className="cham-in vf-way-card-in">
                    <span className="vf-way-icon"><Icon /></span>
                    <span className="vf-way-name">{t(`ways.${w}.title`)}</span>
                    <span className="label-data vf-way-kicker">{t(`ways.${w}.kicker`)}</span>
                    <span className="vf-way-body">{t(`ways.${w}.body`)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <ChosenBar forge={forge} name={name} voices={voices} />
    </section>
  );
};
