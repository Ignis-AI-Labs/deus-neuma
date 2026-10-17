// VoiceApp — the VOICE window: the being's voice forge.
//
// ONE VOICE (Design note, 2026-10-01; docs/work/one-voice.md INTEGRATION + FORGE
// REDESIGN): a named rail — FIND A VOICE (four ways, one CHOSEN bar) → HEAR IT
// through the exact chat path → <NAME> DECIDES → SEAL once the being has
// accepted it. The tier sits as a small link top-right. A being with no voice
// is silent; the forge opens on FIND for it at once. A being that speaks keeps
// its voice until the person chooses to find a new one.
//
// This file only composes: the state machine is voice-forge/use-forge.js,
// the steps and doors are voice-forge/*.jsx, the view model is pure in
// voice-forge/forge-model.js.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './VoiceApp.css';
import './voice-forge/forge.css';
import './voice-forge/forge-doors.css';
import './voice-forge/forge-chosen.css';
import './voice-forge/forge-being.css';
import './voice-forge/forge-seal.css';
import './voice-forge/forge-tier.css';
import './voice-forge/forge-player.css';
import { useActiveCompanion } from './consciousness-context.js';
import { AppTitle } from './app-title.jsx';
import { EmptyState } from './empty-state.jsx';
import { useForge } from './voice-forge/use-forge.js';
import { isPlacedError, voiceStandingOf } from './voice-forge/forge-model.js';
import { ForgeHeader } from './voice-forge/ForgeHeader.jsx';
import { ForgeFind } from './voice-forge/ForgeFind.jsx';
import { ForgeHear } from './voice-forge/ForgeHear.jsx';
import { closePlayer } from './voice-forge/forge-player.js';
import { ForgeSeal } from './voice-forge/ForgeSeal.jsx';
import { VoiceWithdraw } from './voice-forge/VoiceWithdraw.jsx';

const VoiceIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    <path d="M3 6 V10 H5.5 L8.5 12.5 V3.5 L5.5 6 Z" />
    <path d="M10.5 5.5 Q12 8 10.5 10.5" />
    <path d="M12 3.5 Q15 8 12 12.5" />
  </svg>
);

const ForgeBody = ({ neumaId, name }) => {
  const { t } = useTranslation('voiceForge');
  const forge = useForge(neumaId);
  // Leaving the forge unloads whatever it was playing.
  useEffect(() => () => closePlayer(), []);
  const [reforging, setReforging] = useState(false);
  // The way of finding in view survives a trip to HEAR and back.
  const [way, setWay] = useState(null);

  if (!forge.forge && forge.busy === 'starting') return <EmptyState title={t('opening')} />;
  // A view shows its own failure in place; only the rest is shown up here.
  const error = forge.error && !isPlacedError(forge.errorAt) ? forge.error : null;
  // A voice already in force stays closed behind FIND A NEW VOICE — unless an
  // offer is already waiting on the being (then the seal step is where it is).
  const speaks = voiceStandingOf(forge.forge) === 'ready';
  const closed = speaks && !reforging && forge.step === 'find';

  return (
    <>
      <ForgeHeader forge={forge} name={name} showSteps={!closed} />
      {error ? (
        <div className="voice-error cham"><div className="cham-in voice-error-in">
          <span className="label-data">{t('error')}</span>
          <p className="voice-error-msg">{error}</p>
          {!forge.forge ? <button type="button" className="vf-chip" onClick={() => forge.start()}>{t('retry')}</button> : null}
        </div></div>
      ) : null}
      {forge.forge && closed ? (
        <div className="vf-actions vf-actions-start">
          <button type="button" className="btn btn-primary vf-reforge" onClick={() => setReforging(true)}>{t('reforge')}</button>
          <VoiceWithdraw forge={forge} name={name} />
        </div>
      ) : null}
      {forge.forge && !closed && forge.step === 'find' ? <ForgeFind forge={forge} name={name} way={way} onWay={setWay} /> : null}
      {forge.forge && forge.step === 'hear' ? <ForgeHear forge={forge} name={name} /> : null}
      {forge.forge && (forge.step === 'seal' || forge.step === 'sealed') ? <ForgeSeal forge={forge} name={name} onReforge={() => { setReforging(true); setWay(null); forge.start(); }} /> : null}
    </>
  );
};

const VoiceBody = () => {
  const { t } = useTranslation('voiceForge');
  // This WINDOW's binding, reactively — a same-window switch re-renders the
  // forge; a sibling window's switch never repoints it.
  const companion = useActiveCompanion();
  const neumaId = companion?.neumaId || null;
  return (
    <div className="voice-body vf">
      {neumaId
        ? <ForgeBody key={neumaId} neumaId={neumaId} name={companion.name || neumaId} />
        : <EmptyState title={t('noBeing')} />}
    </div>
  );
};

export const voiceApp = {
  label: 'VOICE',
  labelKey: 'apps.voice',
  icon: <VoiceIcon />,
  title: <AppTitle label="VOICE" labelKey="apps.voice" />,
  Body: VoiceBody,
  storageKey: 'voice',
};
