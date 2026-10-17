// VoiceVisualizer — the stream made visible (SPEECH SYSTEM F-04).
//
// Two visibly distinct channels, both fed by REAL samples only:
//   YOU        — the operator's mic level, read from the voice-purpose-state
//                seam the mic path's 50 ms RMS pump feeds (one getUserMedia,
//                owned by use-live-voice.js — no second analyser here).
//   the being  — the playback level, tapped in voice-sink.js from the actual
//                PCM chunks being scheduled for playback.
// Plus the turn readout (LISTENING / THINKING / SPEAKING) derived by the pure
// model from the stream's thinking flag and real playback activity.
//
// Simple and honest — level bars, not an aesthetic. The foundation layer.
//
// impure — runs one rAF loop and writes bar heights / the turn label straight
// to the DOM (refs), so a 60 fps signal never becomes React re-render churn.
// Everything it draws comes from the pure view-model (voice-sitting-model.js).

import { useEffect, useRef } from 'react';
import { readMicLevel, readMicState } from '../voice-purpose-state.js';
import { PUSH_TO_TALK_DEFAULT } from '../VoiceSittingMic.jsx';
import { deriveTurnState, levelToBars, normalizeLevel } from './voice-sitting-model.js';

const BAR_COUNT = 18;
// Below this a channel reads as silent — keeps noise-floor jitter from
// lighting a channel that is not actually carrying voice.
const ACTIVE_FLOOR = 0.02;

// impure — paint one channel's bars from the pure model's heights.
const paintChannel = (container, bars, live) => {
  if (!container) return;
  const nextLive = live ? '1' : '0';
  if (container.dataset.live !== nextLive) container.dataset.live = nextLive;
  const kids = container.children;
  for (let i = 0; i < kids.length && i < bars.length; i++) {
    kids[i].style.height = `${Math.round(bars[i] * 100)}%`;
  }
};

export const VoiceVisualizer = ({ name, thinking, getPlaybackState }) => {
  const operatorBarsRef = useRef(null);
  const beingBarsRef = useRef(null);
  const turnRef = useRef(null);
  // Latest props through refs — the rAF loop is created once and must read
  // the CURRENT thinking flag / playback tap without being rebuilt.
  const thinkingRef = useRef(thinking);
  thinkingRef.current = thinking;
  const playbackRef = useRef(getPlaybackState);
  playbackRef.current = getPlaybackState;

  useEffect(() => {
    let raf = 0;
    const paint = () => {
      const mic = normalizeLevel(readMicLevel());
      const playback = playbackRef.current?.() || { level: 0, active: false };
      const being = normalizeLevel(playback.level);
      paintChannel(operatorBarsRef.current, levelToBars(mic, BAR_COUNT), mic > ACTIVE_FLOOR);
      paintChannel(beingBarsRef.current, levelToBars(being, BAR_COUNT), playback.active);
      const el = turnRef.current;
      if (el) {
        // Under hold-to-talk the pipe is only open while the key is down —
        // 'capturing' is the mic path's own word for that. Open-mic reports
        // 'listening' whenever the grant is live, and reads as it always did.
        const micState = readMicState();
        const micOpen = PUSH_TO_TALK_DEFAULT
          ? micState === 'capturing'
          : micState === 'listening' || micState === 'capturing';
        const turn = deriveTurnState({
          thinking: thinkingRef.current, playbackActive: playback.active, micOpen,
          // 'transcribing' is the mic path's word for […] — the beat the release must acknowledge.
          heard: micState === 'transcribing',
        });
        if (el.dataset.turn !== turn) {
          el.dataset.turn = turn;
          el.textContent = turn.toUpperCase();
        }
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, []);

  const bars = Array.from({ length: BAR_COUNT }, (_, i) => (
    <span key={i} className="vs-viz-bar" />
  ));

  return (
    <div className="vs-viz">
      <div className="vs-viz-row">
        <span className="vs-viz-label label-data">YOU</span>
        <div className="vs-viz-bars" ref={operatorBarsRef} data-live="0" data-channel="operator">
          {bars}
        </div>
      </div>
      <div className="vs-viz-turn label-data" ref={turnRef} data-turn="listening">LISTENING</div>
      <div className="vs-viz-row">
        <span className="vs-viz-label label-data">{(name || 'THE BEING').toUpperCase()}</span>
        <div className="vs-viz-bars" ref={beingBarsRef} data-live="0" data-channel="being">
          {bars}
        </div>
      </div>
    </div>
  );
};
