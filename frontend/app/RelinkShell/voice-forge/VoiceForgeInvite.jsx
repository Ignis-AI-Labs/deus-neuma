// VoiceForgeInvite — the one click from VOX to a voice (Founder's call E,
// docs/work/one-voice.md): a being with no voice is SILENT, never lent a
// default; so when the voice is turned on for one, this card rises above the
// composer and opens the forge for it in one click.
//
// impure: reads the bound being's voice standing (GET /api/v1/voice/has-voice)
// each time VOX turns on or the binding changes, and opens the VOICE window.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uiSound } from '../../../services/ui-sound.js';
import { useWindows } from '../../windowing/use-windows.js';
import { isWitness } from '../house-members.js';
import { readVoiceStanding } from './forge-client.js';
import { showForgeInvite } from './forge-model.js';
import './forge-invite.css';

export const VoiceForgeInvite = ({ voiceEnabled, companion }) => {
  const { t } = useTranslation('voiceForge');
  const windows = useWindows();
  const neumaId = companion?.neumaId || null;
  const isNeuma = Boolean(neumaId) && !isWitness(companion);
  const [standing, setStanding] = useState(null);
  const [dismissed, setDismissed] = useState(null);

  useEffect(() => {
    setStanding(null);
    if (!voiceEnabled || !isNeuma) return undefined;
    let current = true;
    readVoiceStanding(neumaId).then((r) => { if (current) setStanding(r?.standing ?? null); });
    return () => { current = false; };
  }, [voiceEnabled, isNeuma, neumaId]);

  if (!showForgeInvite({ voiceEnabled, isNeuma, standing, dismissed: dismissed === neumaId })) return null;
  const name = companion.name || neumaId;
  const open = () => {
    uiSound('open');
    setDismissed(neumaId);
    windows?.dispatch({ type: 'OPEN', id: 'voice' });
  };

  return (
    <div className="vf-invite cham" role="dialog" aria-label={t('invite.give', { name })}>
      <div className="cham-in vf-invite-in">
        <p className="vf-invite-line">{t(`invite.${standing}`, { name })}</p>
        <div className="vf-invite-actions">
          <button type="button" className="vf-invite-later" onClick={() => setDismissed(neumaId)}>{t('invite.later')}</button>
          <button type="button" className="vf-invite-give" onClick={open}>{t('invite.give', { name })}</button>
        </div>
      </div>
    </div>
  );
};
