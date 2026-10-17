// VoicePlayer — the LINE & CYCLE audio player extracted verbatim from
// VoiceApp.jsx (size-law breakdown, 2026-08-26): the transport icons, the
// time formatter, and the player itself. PlayIcon is exported because the
// preset gallery's audition chip shares it. This module never imports
// VoiceApp.jsx.

import { useState, useRef } from 'react';
import { uiSound } from '../../services/ui-sound.js';

const fmtTime = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export const PlayIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3 2 L10 6 L3 10 Z" /></svg>
);
const PauseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="3" y="2" width="2.5" height="8" /><rect x="6.5" y="2" width="2.5" height="8" /></svg>
);

// A LINE & CYCLE audio player — replaces the native <audio controls> chrome
// (a light browser widget that clashed with the monochrome void). Transport +
// click-to-seek track + time readout, signal cyan only while live. The <audio>
// element stays in the tree (hidden) as the playback engine.
export const VoicePlayer = ({ src, autoPlay = true }) => {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);

  // impure — drives the hidden <audio> element's transport
  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    // play() rejects only under the browser autoplay policy; the visible transport
    // button is the operator's retry, so that rejection is expected and ignorable.
    uiSound('toggle');
    if (a.paused) a.play().catch(() => {}); else a.pause();
  };
  // impure — seeks the hidden <audio> element by click position along the track
  const seek = (e) => {
    const a = ref.current;
    if (!a || !Number.isFinite(a.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * a.duration;
  };
  const pct = dur > 0 ? (cur / dur) * 100 : 0;

  return (
    <div className="voice-player">
      <button type="button" className="voice-player-btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button type="button" className="voice-player-track" onClick={seek} aria-label="Seek">
        <span className="voice-player-fill" style={{ width: `${pct}%` }} />
      </button>
      <span className="voice-player-time label-data">{fmtTime(cur)} / {fmtTime(dur)}</span>
      <audio
        ref={ref}
        src={src}
        className="voice-audio"
        autoPlay={autoPlay}
        hidden
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
      />
    </div>
  );
};
