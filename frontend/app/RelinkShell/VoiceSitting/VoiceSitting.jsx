// VoiceSitting — the immersion shell of a live voice sitting (SPEECH SYSTEM
// F-03, Design note, 2026-07-28: […]).
//
// Mounted by ChatBody when the pure mount decision (shouldMountVoiceSitting)
// holds: purpose === 'conversation' AND LIVE armed. The chat stream stays on
// screen as background context — dimmed and inert (pointer-events off); the
// composer is REPLACED by this panel, not hidden: nothing focusable, no
// caret, no send affordance. Leaving is a deliberate gesture — the EXIT
// button or Escape — which disarms LIVE; purpose stays conversation and the
// composer returns exactly.
//
// LINE & CYCLE: the void, one chamfered panel, «guillemets» only on the
// announcement, --signal only where voice is live. No emojis.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './VoiceSitting.css';
import { VoiceVisualizer } from './VoiceVisualizer.jsx';
import {
  readMicDevice, readMicState, readHeard, isLiveArmed, subscribeVoiceSitting,
} from '../voice-purpose-state.js';
import { micReadout, speakPrompt } from './voice-sitting-model.js';
import { PUSH_TO_TALK_DEFAULT } from '../VoiceSittingMic.jsx';

// pure over the seam's reads — one place builds both readouts, so the initial
// values and every update can never drift apart. `capturing` is the mic path's
// own word for […]; no second seam is needed to know it.
const currentMic = () => {
  const micState = readMicState();
  return {
    heard: readHeard(),
    mic: micReadout({ device: readMicDevice(), liveArmed: isLiveArmed(), micState }),
    prompt: speakPrompt({
      pushToTalk: PUSH_TO_TALK_DEFAULT,
      holding: micState === 'capturing',
      sending: micState === 'transcribing',
    }),
  };
};

export const VoiceSitting = ({ name, thinking, getPlaybackState, onExit, children }) => {
  const { t } = useTranslation('desk');
  // The mic readout mirrors the seam the mic path writes on every grant and
  // teardown — same subscribe pattern the stream hook uses for liveArmed.
  const [readout, setReadout] = useState(currentMic);
  useEffect(() => subscribeVoiceSitting(() => setReadout(currentMic())), []);
  const { mic, prompt, heard } = readout;
  // THE TAKEOVER CLAIMS FOCUS. Entering the sitting by clicking TALK leaves
  // TALK focused, and a focused button answers to Space — the same key the
  // sitting hands to hold-to-talk. The mic path refuses that default, but only
  // while it is armed; a sitting whose mic never opened would still have every
  // Space pressing whatever the desk left focused. So focus moves INTO the
  // panel on mount, the ordinary law for a surface that takes the window: the
  // desk keeps nothing operable behind it.
  const panelRef = useRef(null);
  useEffect(() => { panelRef.current?.focus(); }, []);
  // Escape is the keyboard half of the deliberate EXIT gesture. The composer
  // (and its own Escape ladder) is unmounted, so nothing else claims the key.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onExit?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  return (
    <div className="voice-sitting">
      {/* Background context only: visible, dimmed, inert. aria-hidden because
          nothing in here is operable while the sitting stands. */}
      <div className="voice-sitting-stream" aria-hidden="true">
        {children}
      </div>
      <div className="voice-sitting-panel cham" ref={panelRef} tabIndex={-1}>
        <header className="voice-sitting-head">
          <span className="voice-sitting-title">{t('stream.voiceSitting')}</span>
          <span className="voice-sitting-name label-data">{name || t('stream.theBeing')}</span>
          <button
            type="button"
            className="relink-snd on"
            title={t('stream.exitTitle')}
            onClick={() => onExit?.()}
          >
            {t('stream.exit')}
          </button>
        </header>
        <VoiceVisualizer name={name} thinking={thinking} getPlaybackState={getPlaybackState} />
        {/* WHAT WAS HEARD. The sitting takes the whole window, so the chat
            that renders transcripts is hidden underneath — the witness could
            not see his own words anywhere, which is most of why a slow turn
            felt like a lost one. A partial reads dim and is still changing; a
            settled line is what was actually sent. */}
        {heard.text ? (
          <p className="voice-sitting-heard" data-settled={heard.settled ? '1' : '0'}>
            {heard.text}
          </p>
        ) : null}
        <div className="voice-sitting-foot">
          <span className="voice-sitting-mic label-data" data-live={mic.live ? '1' : '0'}>
            {t(`stream.${mic.key}`, mic.args)}
          </span>
          <span className="voice-sitting-hint label-data" data-live={prompt.live ? '1' : '0'}>
            {t(`stream.${prompt.key}`)} {t('stream.escapeHint')}
          </span>
        </div>
      </div>
    </div>
  );
};
