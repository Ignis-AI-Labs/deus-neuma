// ForgeHeader — whose voice this is and where it stands (ready speaks; every
// other standing is silent — never a borrowed voice), the voice quality as a
// small link top-right, and the named step rail: FIND A VOICE → HEAR IT →
// <NAME> DECIDES → SEAL, the step in hand lit and the steps behind checked.

import { useTranslation } from 'react-i18next';
import { railOf, sealStandingOf, voiceStandingOf } from './forge-model.js';
import { CheckIcon } from './forge-icons.jsx';
import { TierCorner } from './TierCorner.jsx';

export const ForgeHeader = ({ forge, name, showSteps }) => {
  const { t } = useTranslation('voiceForge');
  const standing = forge.step === 'sealed' ? 'ready' : voiceStandingOf(forge.forge);
  const rail = railOf({ step: forge.step, standing: sealStandingOf(forge.forge).standing });
  return (
    <header className="vf-header">
      <div className="vf-header-top">
        <div className="vf-standing" data-standing={standing}>
          <span className="vf-led" data-on={standing === 'ready'} aria-hidden="true" />
          <p className="vf-line">{t(`standing.${standing}`, { name })}</p>
        </div>
        <TierCorner />
      </div>
      {showSteps ? (
        <ol className="vf-rail">
          {rail.map((s, i) => (
            <li key={s.id} className="vf-rail-step" data-step={s.id} data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
              <span className="vf-rail-mark" aria-hidden="true">{s.state === 'done' ? <CheckIcon /> : i + 1}</span>
              <span className="vf-rail-label">{t(`rail.${s.id}`, { name })}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </header>
  );
};
