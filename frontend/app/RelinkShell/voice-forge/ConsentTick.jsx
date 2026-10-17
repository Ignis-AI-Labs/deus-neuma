// ConsentTick — before a voice is offered: whose it is (asked only when the
// door could not tell — an upload), and for a real person's voice the tick
// […]. A real person's voice cannot even
// become a candidate without it (core/voice/voice-consent.js).

import { useTranslation } from 'react-i18next';
import { uiSound } from '../../../services/ui-sound.js';

export const ConsentTick = ({ need, whose, ticked, onWhose, onTick }) => {
  const { t } = useTranslation('voiceForge');
  if (!need.askWhose && !need.needsTick) return null;
  return (
    <div className="vf-consent">
      {need.askWhose ? (
        <fieldset className="vf-whose">
          <legend className="label-data">{t('consent.whose')}</legend>
          {['person', 'nobody'].map((w) => (
            <label key={w} className="vf-radio">
              <input type="radio" name="vf-whose" value={w} checked={whose === w} onChange={() => { uiSound('toggle'); onWhose(w); }} />
              <span>{t(`consent.${w}`)}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {need.needsTick ? (
        <label className="vf-tick">
          <input type="checkbox" checked={ticked} onChange={(e) => { uiSound('toggle'); onTick(e.target.checked); }} />
          <span>{t('consent.tick')}</span>
        </label>
      ) : null}
    </div>
  );
};
